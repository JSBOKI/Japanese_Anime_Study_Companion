import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { audioDir, dataDir } from "./config.ts";
import {
  clearListen,
  getEpisode,
  getListen,
  getSubtitle,
  getListenJob,
  listListenEvictions,
  listSeriesSubtitleEpisodes,
  saveListen,
  setListenJob,
  type ListenCueRecord,
  type ListenPartRecord,
} from "./db.ts";
import { concatMp3 } from "./newsAudio.ts";
import {
  DISK_RESERVE_BYTES,
  LISTEN_AUDIO_REVISION,
  LISTEN_PAUSE_SECONDS,
  assignVoices,
  bytesToFree,
  engineNote,
  estimateListen,
  listenNeedsRebuild,
  pickEvictions,
  planListenParts,
  shouldEnlarge,
  silenceTightenFilter,
  spokenLine,
} from "./listenPlan.ts";
import { parseSubtitle } from "./subtitles.ts";
import { speakJapanese } from "./tts.ts";

const queue: number[] = [];
const seriesLeft = new Map<number, { ids: number[]; done: number }>();
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
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { stdio: ["ignore", "pipe", "ignore"] });
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
    const seconds = await probe(dest);
    return seconds >= 0.12;
  } catch {
    return false;
  }
}

export async function refreshStaleListen(episodeId: number): Promise<void> {
  const current = getListen(episodeId);
  if (!current || current.status !== "ready" || !listenNeedsRebuild(current.revision)) return;
  const removed = clearListen(episodeId);
  await Promise.all(removed.map((part) => fs.rm(part.file, { force: true })));
  enqueueListen(episodeId);
}

export function enqueueListen(episodeId: number): void {
  const current = getListen(episodeId);
  if (current?.status === "pending" || queue.includes(episodeId)) return;
  if (current?.status === "ready" && current.parts.length && listenNeedsRebuild(current.revision)) {
    void refreshStaleListen(episodeId);
    return;
  }
  if (current?.status === "ready" && current.parts.length) return;
  saveListen({ episodeId, status: "pending", progress: "Waiting to record the episode. Playback starts when the file is ready.", error: null, parts: [], cues: [] });
  queue.push(episodeId);
  void pump();
}

export function enqueueSeriesListen(seriesId: number): { queued: number; total: number } {
  const episodes = listSeriesSubtitleEpisodes(seriesId);
  const pending = episodes.filter((episode) => {
    const row = getListen(episode.id);
    if (!row || row.status !== "ready") return true;
    return listenNeedsRebuild(row.revision);
  });
  seriesLeft.set(seriesId, { ids: pending.map((episode) => episode.id), done: 0 });
  setListenJob(seriesId, {
    status: pending.length ? "running" : "done",
    done: 0,
    total: pending.length,
    message: pending.length ? `Queued ${pending.length} episode${pending.length === 1 ? "" : "s"}.` : "Every episode that has a subtitle already has listen-along audio.",
  });
  for (const episode of pending) enqueueListen(episode.id);
  return { queued: pending.length, total: episodes.length };
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const episodeId = queue.shift();
      if (episodeId === undefined) break;
      try {
        await generateListen(episodeId);
        noteSeries(episodeId, null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not make the episode audio.";
        console.error(`Listen-along ${episodeId} failed`, error);
        saveListen({ episodeId, status: "error", error: message, progress: null });
        noteSeries(episodeId, message);
      }
    }
  } finally {
    pumping = false;
    if (queue.length) void pump();
  }
}

function noteSeries(episodeId: number, error: string | null): void {
  for (const [seriesId, job] of seriesLeft) {
    if (!job.ids.includes(episodeId)) continue;
    job.done += 1;
    const finished = job.done >= job.ids.length && !queue.some((id) => job.ids.includes(id));
    setListenJob(seriesId, {
      status: finished ? (error ? "error" : "done") : "running",
      done: job.done,
      total: job.ids.length,
      message: finished
        ? error || `${job.ids.length} episode${job.ids.length === 1 ? "" : "s"} ready.`
        : `Audio ${job.done} of ${job.ids.length}${error ? `. ${error}` : "…"}`,
    });
    if (finished) seriesLeft.delete(seriesId);
  }
}

async function generateListen(episodeId: number): Promise<void> {
  const episode = getEpisode(episodeId);
  const subtitle = getSubtitle(episodeId);
  if (!episode || !subtitle) throw new Error("This episode has no subtitle to read aloud.");
  const cues = parseSubtitle(subtitle.text, subtitle.filename);
  if (!cues.length) throw new Error("This subtitle has no dialogue lines.");
  const voices = assignVoices(cues.map((cue) => ({ speaker: cue.speaker, text: cue.text })));
  const estimate = estimateListen(cues);
  await makeRoom(episodeId, estimate.bytes);
  const work = path.join(audioDir, `listen-work-${episodeId}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });
  const pause = path.join(work, "pause.mp3");
  await ffmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
    "-t", LISTEN_PAUSE_SECONDS.toFixed(2),
    "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k",
    pause,
  ]);
  const measured: { index: number; seconds: number; bytes: number; speech: string }[] = [];
  const engines = new Set<string>();
  let skipped = 0;
  let unspoken = 0;
  try {
    for (let index = 0; index < cues.length; index++) {
      const say = spokenLine(cues[index].text);
      if (!say) {
        skipped += 1;
        continue;
      }
      saveListen({
        episodeId,
        status: "pending",
        progress: `Recording line ${index + 1} of ${cues.length}. Playback starts when the file is ready.`,
        error: null,
      });
      const raw = path.join(work, `raw-${index}.mp3`);
      const speech = path.join(work, `line-${index}.mp3`);
      try {
        const spoken = await speakJapanese(say, voices[index]);
        await fs.writeFile(raw, spoken.audio);
        const kept = await tightenClip(raw, speech);
        if (!kept) {
          unspoken += 1;
          continue;
        }
        engines.add(spoken.engine);
      } catch (error) {
        console.error(`Listen line ${index + 1} skipped`, error);
        unspoken += 1;
        continue;
      }
      const seconds = await probe(speech);
      const stat = await fs.stat(speech);
      measured.push({ index: cues[index].index, seconds: seconds + LISTEN_PAUSE_SECONDS, bytes: stat.size, speech });
    }
    if (!measured.length) {
      throw new Error("No speech engine could read this episode. Edge returned empty audio, and the backup voices failed too.");
    }
    const plans = planListenParts(measured);
    const parts: ListenPartRecord[] = [];
    const timed: ListenCueRecord[] = [];
    for (const plan of plans) {
      const clips: string[] = [];
      for (const cue of plan.cues) {
        const row = measured.find((item) => item.index === cue.index);
        const source = cues.find((item) => item.index === cue.index);
        if (!row || !source) continue;
        clips.push(row.speech, pause);
        timed.push({
          index: cue.index,
          text: source.text,
          speaker: source.speaker || null,
          voice: voices[cues.findIndex((item) => item.index === cue.index)] || voices[0],
          part: cue.part,
          start: cue.start,
          end: cue.end,
          offset: cue.offset,
        });
      }
      const dest = path.join(audioDir, `listen-${episodeId}-part-${plan.index}.mp3`);
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
    saveListen({
      episodeId,
      status: "ready",
      progress: null,
      error: null,
      parts,
      cues: timed,
      seconds,
      bytes,
      engineNote: `${note}${extra}`,
      revision: LISTEN_AUDIO_REVISION,
    });
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function freeBytes(): Promise<number> {
  const stats = await fs.statfs(dataDir);
  return Number(stats.bavail) * Number(stats.bsize);
}

export async function makeRoom(episodeId: number, neededBytes: number): Promise<void> {
  let free = await freeBytes();
  let short = bytesToFree(free, neededBytes);
  if (short <= 0) return;
  const victims = pickEvictions(
    (await Promise.resolve(listListenEvictions())).map((row) => ({ episodeId: row.episodeId, bytes: row.bytes, playedAt: row.playedAt })),
    short,
    episodeId,
  );
  for (const id of victims) {
    const removed = clearListen(id);
    for (const part of removed) {
      await fs.rm(part.file, { force: true }).catch(() => undefined);
    }
  }
  free = await freeBytes();
  short = bytesToFree(free, neededBytes);
  if (short > 0) {
    throw new Error("Not enough room on the data disk for this episode audio. Enlarge the Render disk (it is 1 GB) or remove other listen-along files.");
  }
}

export async function diskPicture(seriesId: number): Promise<{
  freeBytes: number;
  reserveBytes: number;
  estimatedBytes: number;
  readyBytes: number;
  enlarge: boolean;
  warning: string | null;
}> {
  const episodes = listSeriesSubtitleEpisodes(seriesId);
  let estimatedBytes = 0;
  let readyBytes = 0;
  for (const episode of episodes) {
    const ready = getListen(episode.id);
    if (ready?.status === "ready") {
      readyBytes += ready.bytes;
      continue;
    }
    estimatedBytes += estimateListen(parseSubtitle(episode.text, episode.filename)).bytes;
  }
  const available = await freeBytes();
  const enlarge = shouldEnlarge(available, estimatedBytes + readyBytes);
  const mb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));
  const warning = enlarge
    ? `Listen-along audio for this series is about ${mb(estimatedBytes + readyBytes)} MB at 48 kbps mono. About ${mb(available)} MB is free, and ${mb(DISK_RESERVE_BYTES)} MB stays spare. Enlarge the Render disk if you want every episode kept.`
    : null;
  return { freeBytes: available, reserveBytes: DISK_RESERVE_BYTES, estimatedBytes, readyBytes, enlarge, warning };
}

export function seriesListenStatus(seriesId: number): { status: string; done: number; total: number; message: string | null } {
  const job = getListenJob(seriesId);
  if (job) return job;
  const running = listSeriesSubtitleEpisodes(seriesId).some((episode) => getListen(episode.id)?.status === "pending");
  return { status: running ? "running" : "idle", done: 0, total: 0, message: null };
}
