import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { audioDir, voices } from "./config.ts";
import { chapterLabel, speechCues } from "./aozoraParse.ts";
import { mergeAuthorRuby } from "./bookText.ts";
import { BookError, ensureBook } from "./aozora.ts";
import {
  clearBookListen,
  getBookByCard,
  getBookChapter,
  getBookChapterById,
  getBookJob,
  getBookListen,
  getStudySettings,
  listBookChapters,
  saveBookListen,
  setBookJob,
  touchBookPlayed,
  type BookCueRecord,
  type ListenPartRecord,
} from "./db.ts";
import { freeDiskSpace } from "./listenAudio.ts";
import {
  LISTEN_PAUSE_SECONDS,
  engineNote,
  estimateListen,
  silenceTightenFilter,
  spokenLine,
  planListenParts,
} from "./listenPlan.ts";
import { readLine } from "./lesson.ts";
import { concatMp3 } from "./newsAudio.ts";
import { speakJapanese } from "./tts.ts";
import type { BookListenView } from "../shared/types.ts";

export const BOOK_AUDIO_REVISION = 1;

const queue: number[] = [];
const bookLeft = new Map<number, { ids: number[]; done: number; failed: boolean }>();
let pumping = false;

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `ffmpeg exited ${code}`));
    });
  });
}

function probe(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const seconds = Number(out.trim());
      if (code === 0 && Number.isFinite(seconds)) resolve(seconds);
      else reject(new Error("Could not read audio length"));
    });
  });
}

function peakVolume(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const match = err.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
      if (code === 0 && match) resolve(Number(match[1]));
      else reject(new Error("Could not measure loudness"));
    });
  });
}

async function tightenClip(src: string, dest: string): Promise<boolean> {
  await ffmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", src,
    "-af", silenceTightenFilter(),
    "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k",
    dest,
  ]);
  const stat = await fs.stat(dest);
  if (stat.size < 400) return false;
  try {
    return (await probe(dest)) >= 0.12;
  } catch {
    return false;
  }
}

function needsRebuild(revision: number | null | undefined): boolean {
  return (revision || 0) < BOOK_AUDIO_REVISION;
}

export async function refreshStaleBook(chapterId: number): Promise<void> {
  const current = getBookListen(chapterId);
  if (!current || current.status !== "ready" || !needsRebuild(current.revision)) return;
  const removed = clearBookListen(chapterId);
  await Promise.all(removed.map((part) => fs.rm(part.file, { force: true })));
  enqueueChapter(chapterId);
}

export function enqueueChapter(chapterId: number): void {
  const current = getBookListen(chapterId);
  if (current?.status === "pending" || queue.includes(chapterId)) return;
  if (current?.status === "ready" && current.parts.length && needsRebuild(current.revision)) {
    void refreshStaleBook(chapterId);
    return;
  }
  if (current?.status === "ready" && current.parts.length) return;
  saveBookListen({
    chapterId,
    status: "pending",
    progress: "Recording… Playback starts when the file is ready.",
    error: null,
    parts: [],
    cues: [],
  });
  queue.push(chapterId);
  void pump();
}

export function enqueueBook(bookId: number): { queued: number; total: number } {
  const chapters = listBookChapters(bookId);
  const pending = chapters.filter((chapter) => {
    const row = getBookListen(chapter.id);
    if (!row || row.status !== "ready" || !row.parts.length) return true;
    return needsRebuild(row.revision);
  });
  bookLeft.set(bookId, { ids: pending.map((chapter) => chapter.id), done: 0, failed: false });
  setBookJob(bookId, {
    status: pending.length ? "running" : "done",
    done: 0,
    total: pending.length,
    message: pending.length
      ? `Queued ${pending.length} chapter${pending.length === 1 ? "" : "s"}. One chapter is recorded at a time.`
      : "Every chapter already has audio.",
  });
  for (const chapter of pending) enqueueChapter(chapter.id);
  return { queued: pending.length, total: chapters.length };
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const chapterId = queue.shift();
      if (chapterId === undefined) break;
      try {
        await generateChapter(chapterId);
        noteBook(chapterId, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not make this chapter audio.";
        console.error(`Book audio ${chapterId} failed`, error);
        saveBookListen({ chapterId, status: "error", error: message, progress: null });
        noteBook(chapterId, message);
      }
    }
  } finally {
    pumping = false;
    if (queue.length) void pump();
  }
}

function noteBook(chapterId: number, error: string | null): void {
  for (const [bookId, job] of bookLeft) {
    if (!job.ids.includes(chapterId)) continue;
    job.done += 1;
    if (error) job.failed = true;
    const finished = job.done >= job.ids.length && !queue.some((id) => job.ids.includes(id));
    setBookJob(bookId, {
      status: finished ? (job.failed ? "error" : "done") : "running",
      done: job.done,
      total: job.ids.length,
      message: finished
        ? job.failed
          ? error || "Some chapters could not be read."
          : `${job.ids.length} chapter${job.ids.length === 1 ? "" : "s"} ready.`
        : `Audio ${job.done} of ${job.ids.length}${error ? `. ${error}` : "…"}`,
    });
    if (finished) bookLeft.delete(bookId);
  }
}

async function generateChapter(chapterId: number): Promise<void> {
  const chapter = getBookChapterBySafe(chapterId);
  if (!chapter) throw new Error("That chapter is not in this book.");
  const spoken = speechCues(chapter.paragraphs);
  const title = spokenLine(chapter.title);
  const lines = [
    ...(title ? [{ text: chapter.title, speak: title, spans: [{ base: chapter.title, reading: null }] }] : []),
    ...spoken,
  ];
  const sayable = lines
    .map((line, index) => ({ ...line, index, say: spokenLine(line.speak) }))
    .filter((line) => line.say);
  if (!sayable.length) throw new Error("This chapter has nothing to read aloud.");
  const estimate = estimateListen(sayable.map((line) => ({ text: line.say || "" })));
  await freeDiskSpace(`book:${chapterId}`, estimate.bytes);
  const work = path.join(audioDir, `book-work-${chapterId}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  const existing = await fs.readdir(audioDir).catch(() => [] as string[]);
  await Promise.all(
    existing
      .filter((name) => name.startsWith(`book-${chapterId}-part-`))
      .map((name) => fs.rm(path.join(audioDir, name), { force: true })),
  );
  const pause = path.join(work, "pause.mp3");
  await ffmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
    "-t", LISTEN_PAUSE_SECONDS.toFixed(2),
    "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k",
    pause,
  ]);
  const measured: { index: number; seconds: number; bytes: number; speech: string; text: string; speak: string; spans: BookCueRecord["spans"] }[] = [];
  const engines = new Set<string>();
  let skipped = lines.length - sayable.length;
  let unspoken = 0;
  try {
    for (let index = 0; index < sayable.length; index += 1) {
      const line = sayable[index];
      saveBookListen({
        chapterId,
        status: "pending",
        progress: `Recording line ${index + 1} of ${sayable.length}. Playback starts when the file is ready.`,
        error: null,
      });
      const raw = path.join(work, `raw-${index}.mp3`);
      const speech = path.join(work, `line-${index}.mp3`);
      try {
        const spokenLineAudio = await speakJapanese(line.say || "", voices.ja);
        await fs.writeFile(raw, spokenLineAudio.audio);
        const kept = await tightenClip(raw, speech);
        if (!kept) {
          unspoken += 1;
          continue;
        }
        engines.add(spokenLineAudio.engine);
      } catch (error) {
        console.error(`Book line ${index + 1} skipped`, error);
        unspoken += 1;
        continue;
      }
      const seconds = await probe(speech);
      const stat = await fs.stat(speech);
      measured.push({
        index: line.index,
        seconds: seconds + LISTEN_PAUSE_SECONDS,
        bytes: stat.size,
        speech,
        text: line.text,
        speak: line.speak,
        spans: line.spans,
      });
    }
    if (!measured.length) {
      throw new Error("No speech engine could read this chapter. Edge returned empty audio, and the backup voices failed too.");
    }
    const plans = planListenParts(measured);
    const parts: ListenPartRecord[] = [];
    const timed: BookCueRecord[] = [];
    for (const plan of plans) {
      const clips: string[] = [];
      for (const cue of plan.cues) {
        const row = measured.find((item) => item.index === cue.index);
        if (!row) continue;
        clips.push(row.speech, pause);
        timed.push({
          index: cue.index,
          text: row.text,
          speak: row.speak,
          spans: row.spans,
          part: cue.part,
          start: cue.start,
          end: cue.end,
          offset: cue.offset,
        });
      }
      const dest = path.join(audioDir, `book-${chapterId}-part-${plan.index}.mp3`);
      await concatMp3(clips, dest);
      const stat = await fs.stat(dest);
      const peak = await peakVolume(dest);
      if (peak < -45) throw new Error("The recording was silent, so it was not saved.");
      parts.push({ index: plan.index, file: dest, seconds: plan.seconds, bytes: stat.size });
    }
    const seconds = timed.reduce((sum, cue) => sum + (cue.end - cue.start), 0);
    const bytes = parts.reduce((sum, part) => sum + part.bytes, 0);
    const note = engineNote([...engines], skipped);
    const extra = unspoken ? ` ${unspoken} line${unspoken === 1 ? "" : "s"} could not be read and ${unspoken === 1 ? "was" : "were"} skipped.` : "";
    saveBookListen({
      chapterId,
      status: "ready",
      progress: null,
      error: null,
      parts,
      cues: timed,
      seconds,
      bytes,
      engineNote: `${note}${extra}`,
      revision: BOOK_AUDIO_REVISION,
    });
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

function getBookChapterBySafe(chapterId: number) {
  return getBookChapterById(chapterId);
}

export function bookJobStatus(bookId: number): { status: string; done: number; total: number; message: string | null } {
  return getBookJob(bookId) || { status: "idle", done: 0, total: 0, message: null };
}

export async function presentBookListen(cardId: number, index: number): Promise<BookListenView> {
  const book = await ensureBook(cardId);
  const chapters = listBookChapters(book.id);
  const meta = chapters.find((chapter) => chapter.index === index);
  if (!meta) throw new BookError(404, "That chapter is not in this book.");
  await refreshStaleBook(meta.id);
  const listen = getBookListen(meta.id);
  const full = getBookChapterById(meta.id);
  const planned = full ? speechCues(full.paragraphs) : [];
  const estimate = estimateListen(planned.map((cue) => ({ text: cue.speak })));
  const level = getStudySettings().level;
  const next = chapters.find((chapter) => chapter.index === index + 1) || null;
  const prev = chapters.find((chapter) => chapter.index === index - 1) || null;
  const nextListen = next ? getBookListen(next.id) : null;
  return {
    cardId: book.cardId,
    bookTitle: book.title,
    author: book.author,
    chapterIndex: index,
    chapterTitle: meta.title,
    partTitle: meta.partTitle,
    label: chapterLabel(meta.partTitle, meta.title),
    status: listen?.status || "idle",
    progress: listen?.progress || null,
    error: listen?.error || null,
    parts: (listen?.parts || []).map((part) => ({ index: part.index, seconds: part.seconds, bytes: part.bytes })),
    cues: (listen?.status === "ready" ? listen.cues : []).map((cue) => {
      const read = readLine(cue.text, level);
      return {
        index: cue.index,
        text: cue.text,
        part: cue.part,
        start: cue.start,
        end: cue.end,
        offset: cue.offset,
        tokens: mergeAuthorRuby(read.tokens, cue.spans),
        gloss: read.gloss,
      };
    }),
    seconds: listen?.seconds || 0,
    bytes: listen?.bytes || 0,
    engineNote: listen?.engineNote || null,
    estimate,
    nextChapter: next?.index ?? null,
    nextReady: nextListen?.status === "ready" && !needsRebuild(nextListen.revision),
    prevChapter: prev?.index ?? null,
  };
}

export async function startChapterAudio(cardId: number, index: number): Promise<BookListenView> {
  const book = await ensureBook(cardId);
  const chapter = getBookChapter(book.id, index);
  if (!chapter) throw new BookError(404, "That chapter is not in this book.");
  enqueueChapter(chapter.id);
  return presentBookListen(cardId, index);
}

export async function startBookAudio(cardId: number): Promise<{ status: string; done: number; total: number; message: string | null }> {
  const book = await ensureBook(cardId);
  enqueueBook(book.id);
  return bookJobStatus(book.id);
}

export function readyBookPart(cardId: number, index: number, partIndex: number): { file: string; chapterId: number } | null {
  const book = getBookByCard(cardId);
  if (!book) return null;
  const chapter = getBookChapter(book.id, index);
  if (!chapter) return null;
  const listen = getBookListen(chapter.id);
  const part = listen?.parts.find((item) => item.index === partIndex);
  if (!listen || listen.status !== "ready" || !part || needsRebuild(listen.revision)) return null;
  touchBookPlayed(chapter.id);
  return { file: part.file, chapterId: chapter.id };
}
