import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { audioDir } from "./config.ts";
import { getNewsStory, setNewsAudioPath } from "./db.ts";
import { chunkSpeech } from "./newsParse.ts";
import { synthesize } from "./tts.ts";

const jobs = new Map<string, Promise<string>>();

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

async function concatOnce(files: string[], dest: string): Promise<void> {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of files) args.push("-i", file);
  const filter = files.map((_, index) => `[${index}:a]`).join("") + `concat=n=${files.length}:v=0:a=1[a]`;
  args.push("-filter_complex", filter, "-map", "[a]", "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k", dest);
  await ffmpeg(args);
}

async function concat(files: string[], dest: string): Promise<void> {
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
    const part = path.join(scratch, `part-${offset}.mp3`);
    await concatOnce(files.slice(offset, offset + 20), part);
    parts.push(part);
  }
  await concat(parts, dest);
}

function spokenText(title: string, body: string, lang: "ja" | "en"): string {
  const paragraphs = body.split(/\n\n/).map((part) => part.trim()).filter(Boolean);
  const pieces = [title, ...paragraphs.filter((part) => part !== title)];
  return pieces.join(lang === "ja" ? "" : " ");
}

async function writeAudio(storyId: number, lang: "ja" | "en", title: string, body: string): Promise<string> {
  const text = spokenText(title, body, lang);
  const chunks = chunkSpeech(text, lang);
  if (!chunks.length) throw new Error("Nothing to read aloud");
  await fs.mkdir(audioDir, { recursive: true });
  const work = path.join(audioDir, `news-work-${storyId}-${lang}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const clips: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const file = path.join(work, `c-${index}.mp3`);
    await fs.writeFile(file, await synthesize(chunks[index], lang, false));
    clips.push(file);
  }
  const dest = path.join(audioDir, `news-${storyId}-${lang}.mp3`);
  await concat(clips, dest);
  await fs.rm(work, { recursive: true, force: true });
  setNewsAudioPath(storyId, lang, dest);
  return dest;
}

export async function ensureNewsAudio(storyId: number, lang: "ja" | "en"): Promise<string> {
  const story = getNewsStory(storyId);
  if (!story) throw new Error("Story not found");
  const body = lang === "ja" ? story.bodyJa : story.bodyEn;
  if (!body?.trim()) throw new Error(lang === "en" ? "No English text to read aloud for this story." : "This story has no Japanese text.");
  const cached = lang === "ja" ? story.audioJaPath : story.audioEnPath;
  if (cached) {
    try {
      await fs.access(cached);
      return cached;
    } catch {
      /* generate again */
    }
  }
  const key = `${storyId}-${lang}`;
  const existing = jobs.get(key);
  if (existing) return existing;
  const title = lang === "en" && story.titleEn ? story.titleEn : story.title;
  const job = writeAudio(storyId, lang, title, body).finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job;
}
