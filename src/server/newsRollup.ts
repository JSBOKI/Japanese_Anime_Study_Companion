import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { audioDir } from "./config.ts";
import {
  clearRollupPicks,
  createRollup,
  getDeepDive,
  getNewsStory,
  listRollupPicks,
  setDeepAudioPath,
  updateRollup,
  type RollupPartRecord,
} from "./db.ts";
import { concatMp3, ensureNewsAudio, renderSpokenFile } from "./newsAudio.ts";
import { splitRollup, type RollupSlice } from "./rollupSplit.ts";

export type RollupLang = "ja" | "en" | "both";

const active = new Set<number>();

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

async function measure(file: string): Promise<{ seconds: number; bytes: number }> {
  const stat = await fs.stat(file);
  let seconds = stat.size / 6000;
  try {
    seconds = await probe(file);
  } catch {
    /* size is a usable estimate at 48 kbps */
  }
  return { seconds: Math.max(1, seconds), bytes: stat.size };
}

export function startRollup(input: { lang: RollupLang; speed: number; clearAfter: boolean }): number {
  const id = createRollup(input.lang, input.speed);
  active.add(id);
  void runRollup(id, input).catch((error) => {
    console.error(`Roll-up ${id} failed`, error);
    updateRollup(id, { status: "error", message: error instanceof Error ? error.message : "The roll-up could not be built." });
  }).finally(() => active.delete(id));
  return id;
}

async function runRollup(id: number, input: { lang: RollupLang; speed: number; clearAfter: boolean }): Promise<void> {
  const picks = listRollupPicks();
  if (!picks.length) {
    updateRollup(id, { status: "error", message: "Check at least one story first." });
    return;
  }
  const work = path.join(audioDir, `rollup-work-${id}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const files = new Map<string, { file: string; label: string }>();
  const clips: { id: string; seconds: number; bytes: number }[] = [];
  let skippedEnglish = false;
  try {
    for (let index = 0; index < picks.length; index++) {
      const pick = picks[index];
      const story = getNewsStory(pick.storyId);
      if (!story) continue;
      updateRollup(id, { message: `Preparing story ${index + 1} of ${picks.length}…` });
      const number = index + 1;
      const langs: ("ja" | "en")[] = input.lang === "both" ? ["ja", "en"] : [input.lang];
      for (const lang of langs) {
        const body = lang === "ja" ? story.bodyJa : story.bodyEn;
        const headline = lang === "en" && story.titleEn ? story.titleEn : story.title;
        if (!body?.trim()) {
          if (lang === "en") skippedEnglish = true;
          continue;
        }
        const introId = `s${story.id}-${lang}-intro`;
        const introFile = path.join(work, `${introId}.mp3`);
        const intro = lang === "ja" ? `ストーリー${number}。${headline}` : `Story ${number}: ${headline}`;
        await renderSpokenFile(intro, lang, introFile);
        const introSize = await measure(introFile);
        files.set(introId, { file: introFile, label: lang === "ja" ? `ストーリー${number}：${headline}` : `Story ${number}: ${headline}` });
        clips.push({ id: introId, ...introSize });
        const spoken = await ensureNewsAudio(story.id, lang);
        const spokenId = `s${story.id}-${lang}`;
        const spokenSize = await measure(spoken);
        files.set(spokenId, { file: spoken, label: headline });
        clips.push({ id: spokenId, ...spokenSize });
      }
      if (pick.includeDeep) {
        const dive = getDeepDive(story.id);
        const diveLangs: ("ja" | "en")[] = input.lang === "both" ? ["ja", "en"] : [input.lang];
        for (const lang of diveLangs) {
          const diveBody = lang === "ja" ? dive?.bodyJa : dive?.bodyEn;
          const cachedPath = lang === "ja" ? dive?.audioJaPath : dive?.audioEnPath;
          if (!diveBody?.trim()) continue;
          const diveFile = cachedPath || path.join(audioDir, `deep-${story.id}-${lang}.mp3`);
          if (!cachedPath) {
            await renderSpokenFile(diveBody, lang, diveFile);
            setDeepAudioPath(story.id, lang, diveFile);
          }
          const diveId = `s${story.id}-deep-${lang}`;
          const introId = `${diveId}-intro`;
          const introFile = path.join(work, `${introId}.mp3`);
          await renderSpokenFile(lang === "ja" ? "深掘り。" : "Deep dive.", lang, introFile);
          const introSize = await measure(introFile);
          files.set(introId, { file: introFile, label: `Deep dive: ${story.title}` });
          clips.push({ id: introId, ...introSize });
          const diveSize = await measure(diveFile);
          files.set(diveId, { file: diveFile, label: story.title });
          clips.push({ id: diveId, ...diveSize });
        }
      }
    }
    if (!clips.length) {
      updateRollup(id, { status: "error", message: "None of the checked stories have audio in that language." });
      return;
    }
    const plans = splitRollup(clips);
    const parts: RollupPartRecord[] = [];
    for (let index = 0; index < plans.length; index++) {
      updateRollup(id, { message: `Mixing part ${index + 1} of ${plans.length}…` });
      const pieces: string[] = [];
      for (const slice of plans[index].slices) {
        const source = files.get(slice.id);
        if (!source) continue;
        pieces.push(await sliceFile(source.file, slice, path.join(work, `slice-${index}-${pieces.length}.mp3`)));
      }
      const mixed = path.join(work, `mixed-${index}.mp3`);
      await concatMp3(pieces, mixed);
      const dest = path.join(audioDir, `rollup-${id}-part-${index + 1}.mp3`);
      await applySpeed(mixed, dest, input.speed);
      const size = await measure(dest);
      const first = plans[index].slices[0] ? files.get(plans[index].slices[0].id)?.label : null;
      parts.push({ index: index + 1, file: dest, seconds: Math.round(size.seconds), bytes: size.bytes, label: first || `Part ${index + 1}` });
    }
    const note = skippedEnglish ? "Some stories have no English text, so those English sections were left out." : `Ready. ${parts.length} part${parts.length === 1 ? "" : "s"}.`;
    updateRollup(id, { status: "done", message: note, parts });
    if (input.clearAfter) clearRollupPicks();
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function sliceFile(file: string, slice: RollupSlice, dest: string): Promise<string> {
  if (slice.whole) return file;
  const duration = Math.max(0.5, slice.end - slice.start);
  await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-ss", String(slice.start), "-t", String(duration), "-i", file, "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k", dest]);
  return dest;
}

async function applySpeed(src: string, dest: string, speed: number): Promise<void> {
  if (Math.abs(speed - 1) < 0.01) {
    await fs.copyFile(src, dest);
    return;
  }
  await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-filter:a", `atempo=${speed}`, "-acodec", "libmp3lame", "-ar", "24000", "-ac", "1", "-b:a", "48k", dest]);
}
