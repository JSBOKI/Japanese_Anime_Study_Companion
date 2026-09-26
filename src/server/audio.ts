import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { audioDir } from "./config.ts";
import { getEpisode, setAudioState } from "./db.ts";
import { synthesize } from "./tts.ts";
import type { Lesson } from "../shared/types.ts";

const running = new Set<number>();

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
      else reject(new Error(err.slice(-600) || `ffmpeg exited ${code}`));
    });
  });
}

async function silence(seconds: number, dest: string): Promise<void> {
  const clipped = Math.max(0.3, Math.min(6, seconds));
  await ffmpeg([
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=mono:sample_rate=24000",
    "-t",
    clipped.toFixed(2),
    "-acodec",
    "libmp3lame",
    "-b:a",
    "48k",
    dest,
  ]);
}

async function concatOnce(files: string[], dest: string): Promise<void> {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of files) args.push("-i", file);
  const filter = files.map((_, index) => `[${index}:a]`).join("") + `concat=n=${files.length}:v=0:a=1[a]`;
  args.push("-filter_complex", filter, "-map", "[a]", "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k", dest);
  await ffmpeg(args);
}

async function concat(files: string[], dest: string): Promise<void> {
  if (files.length === 0) throw new Error("No audio clips to join");
  if (files.length === 1) {
    await fs.copyFile(files[0], dest);
    return;
  }
  if (files.length <= 20) {
    await concatOnce(files, dest);
    return;
  }
  const parts: string[] = [];
  const scratch = path.dirname(files[0]);
  for (let offset = 0; offset < files.length; offset += 20) {
    const slice = files.slice(offset, offset + 20);
    const part = path.join(scratch, `part-${offset}-${path.basename(dest)}`);
    await concatOnce(slice, part);
    parts.push(part);
  }
  await concat(parts, dest);
}

function shadowSeconds(text: string): number {
  const morae = [...text.replace(/[ゃゅょぁぃぅぇぉ]/g, "")].length;
  return Math.min(4.5, Math.max(1.6, morae * 0.26));
}

async function writeClip(file: string, text: string, lang: "ja" | "en", slow = false): Promise<void> {
  const audio = await synthesize(text, lang, slow);
  await fs.writeFile(file, audio);
}

export function queueEpisodeAudio(episodeId: number): void {
  if (running.has(episodeId)) return;
  running.add(episodeId);
  void generateEpisodeAudio(episodeId)
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Audio failed";
      console.error(`Audio for episode ${episodeId} failed`, error);
      setAudioState(episodeId, { status: "error", error: message, progress: null });
    })
    .finally(() => running.delete(episodeId));
}

async function generateEpisodeAudio(episodeId: number): Promise<void> {
  const episode = getEpisode(episodeId);
  if (!episode?.lesson) throw new Error("Build a lesson before generating audio");
  const work = path.join(audioDir, `work-${episodeId}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  setAudioState(episodeId, { status: "pending", error: null, progress: "Starting the dialogue drill…" });

  const lesson = episode.lesson;
  const drillLines = pickDrillLines(lesson);
  const clips: string[] = [];
  let n = 0;
  const pushSilence = async (seconds: number) => {
    const file = path.join(work, `s-${n++}.mp3`);
    await silence(seconds, file);
    clips.push(file);
  };
  const pushSpeech = async (text: string, lang: "ja" | "en", slow = false) => {
    const file = path.join(work, `c-${n++}.mp3`);
    await writeClip(file, text, lang, slow);
    clips.push(file);
  };

  const speakEnglish = lesson.revealEnglish !== false;
  await pushSpeech(
    speakEnglish
      ? `Episode ${episode.number} reading drill. Listen, repeat in the pause, then check the English.`
      : `Episode ${episode.number} reading drill. Listen, repeat in the pause, then hear the Japanese again.`,
    "en",
  );
  await pushSilence(0.6);

  for (let i = 0; i < drillLines.length; i++) {
    const line = drillLines[i];
    setAudioState(episodeId, {
      status: "pending",
      error: null,
      progress: `Speaking line ${i + 1} of ${drillLines.length}`,
    });
    await pushSpeech(line.text, "ja");
    await pushSilence(shadowSeconds(line.text));
    if (speakEnglish) {
      const english = line.translation || (line.gloss ? `Gloss. ${line.gloss.replace(/ · /g, ", ")}` : "No gloss for this line.");
      await pushSpeech(english, "en");
      await pushSilence(0.45);
    }
    await pushSpeech(line.text, "ja");
    await pushSilence(0.7);
  }

  const dialoguePath = path.join(audioDir, `episode-${episodeId}-dialogue.mp3`);
  await concat(clips, dialoguePath);

  setAudioState(episodeId, { status: "pending", error: null, progress: "Recording the vocabulary drill…", dialoguePath });
  const vocabClips: string[] = [];
  let v = 0;
  const pushVocab = async (text: string, lang: "ja" | "en", slow = false) => {
    const file = path.join(work, `v-${v++}.mp3`);
    await writeClip(file, text, lang, slow);
    vocabClips.push(file);
  };
  const pushVocabSilence = async (seconds: number) => {
    const file = path.join(work, `vs-${v++}.mp3`);
    await silence(seconds, file);
    vocabClips.push(file);
  };
  await pushVocab("Vocabulary from this episode. Repeat each word, then listen to the example.", "en");
  await pushVocabSilence(0.5);
  const words = lesson.vocabulary.slice(0, 12);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    setAudioState(episodeId, {
      status: "pending",
      error: null,
      progress: `Vocabulary ${i + 1} of ${words.length}`,
      dialoguePath,
    });
    await pushVocab(word.lemma, "ja", true);
    await pushVocabSilence(0.8);
    const meaning = word.glosses.slice(0, 2).join(", ") || "No dictionary gloss";
    await pushVocab(meaning, "en");
    if (word.example) {
      await pushVocabSilence(0.3);
      await pushVocab(word.example, "ja");
    }
    await pushVocabSilence(0.6);
  }
  const vocabPath = path.join(audioDir, `episode-${episodeId}-vocab.mp3`);
  if (vocabClips.length) await concat(vocabClips, vocabPath);

  await fs.rm(work, { recursive: true, force: true });
  setAudioState(episodeId, {
    status: "ready",
    error: null,
    progress: null,
    dialoguePath,
    vocabPath: vocabClips.length ? vocabPath : null,
  });
}

function pickDrillLines(lesson: Lesson): { text: string; translation: string | null; gloss: string }[] {
  const passage = [...(lesson.passages || [])].sort((a, b) => b.charCount - a.charCount)[0];
  if (passage) {
    const parts = passage.text
      .split(/(?<=[。！？])/)
      .map((part) => part.trim())
      .filter((part) => [...part].length >= 12);
    if (parts.length) {
      return parts.slice(0, 8).map((text) => ({ text, translation: passage.translation, gloss: "" }));
    }
  }
  const featured = lesson.lines.filter((line) => line.featured && line.text.length > 1);
  const pool = featured.length ? featured : lesson.lines;
  return pool.slice(0, 8).map((line) => ({ text: line.text, translation: line.translation, gloss: line.gloss }));
}

export async function ensureLineAudio(episodeId: number, index: number): Promise<string> {
  const episode = getEpisode(episodeId);
  const line = episode?.lesson?.lines.find((item) => item.index === index);
  if (!line) throw new Error("That line is not in the lesson");
  await fs.mkdir(audioDir, { recursive: true });
  const file = path.join(audioDir, `line-${episodeId}-${index}.mp3`);
  try {
    await fs.access(file);
    return file;
  } catch {
    const audio = await synthesize(line.text, "ja");
    await fs.writeFile(file, audio);
    return file;
  }
}
