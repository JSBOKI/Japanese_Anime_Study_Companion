import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chooseKitsunekkoFolder, chooseSubtitlePack, looksJapanese, parseKitsunekkoPage, type RemoteSub, type SubtitleChoice } from "./subtitleMatch.ts";
import { decodeSubtitle, filesFromUpload, guessEpisodeNumber } from "./subtitles.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const INDEX = "https://kitsunekko.net/dirlist.php?dir=subtitles/japanese/";
const MAX_BYTES = 40_000_000;

export const ARCHIVE_DOWN = "The subtitle archive is not responding right now. Episodes that already have a subtitle are unchanged.";

let sevenZip: boolean | null = null;

function commandExistsSync(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["i"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function canExtract7zSync(): boolean {
  if (sevenZip !== null) return sevenZip;
  sevenZip = commandExistsSync("7z") || commandExistsSync("7zz");
  return sevenZip;
}

function allowedHost(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === "https:" && (parsed.hostname === "kitsunekko.net" || parsed.hostname.endsWith(".kitsunekko.net"));
}

async function fetchText(url: string): Promise<string> {
  if (!allowedHost(url)) throw new Error("Refusing that subtitle URL.");
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Subtitle listing failed (${response.status})`);
  return response.text();
}

export async function fetchKitsunekkoFile(url: string): Promise<{ filename: string; buffer: Buffer }> {
  if (!allowedHost(url)) throw new Error("Refusing that subtitle URL.");
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`Subtitle download failed (${response.status})`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new Error("That subtitle archive is too large.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error("That subtitle archive is too large.");
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "subtitles.zip");
  return { filename, buffer };
}

export async function findKitsunekkoChoice(titles: string[], wanted: number): Promise<SubtitleChoice | null> {
  const index = parseKitsunekkoPage(await fetchText(INDEX));
  const folderName = chooseKitsunekkoFolder(
    index.filter((entry) => entry.kind === "dir").map((entry) => entry.name),
    titles,
  );
  if (!folderName) return null;
  const folder = index.find((entry) => entry.kind === "dir" && entry.name === folderName);
  if (!folder) return null;
  const page = parseKitsunekkoPage(await fetchText(folder.url));
  const files: RemoteSub[] = page.filter((entry) => entry.kind === "file").map((entry) => ({ name: entry.name, url: entry.url }));
  const title = titles[0] || folderName;
  return chooseSubtitlePack(files, wanted, title, canExtract7zSync());
}

export async function subtitlesFromPack(choice: SubtitleChoice, wanted: number): Promise<Map<number, { name: string; text: string }>> {
  if (choice.kind === "archive") {
    const downloaded = await fetchKitsunekkoFile(choice.file.url);
    return mapSubtitleFiles(await unpackArchive(downloaded.filename, downloaded.buffer), wanted);
  }
  const mapped = new Map<number, { name: string; text: string }>();
  let cursor = 0;
  const files = choice.files;
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor];
      cursor += 1;
      try {
        const downloaded = await fetchKitsunekkoFile(file.url);
        const text = decodeSubtitle(downloaded.buffer);
        const number = guessEpisodeNumber(file.name);
        if (!number || number > wanted || mapped.has(number) || !looksJapanese(text)) continue;
        mapped.set(number, { name: file.name, text });
      } catch (error) {
        console.error(`Subtitle file failed: ${file.name}`, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
  return mapped;
}

export async function unpackArchive(filename: string, buffer: Buffer): Promise<{ name: string; text: string }[]> {
  if (/\.zip$/i.test(filename)) return filesFromUpload(filename, buffer);
  if (/\.7z$/i.test(filename)) return unpack7z(buffer);
  throw new Error("That archive type is not supported. A .zip of the subtitles is required.");
}

async function unpack7z(buffer: Buffer): Promise<{ name: string; text: string }[]> {
  const cmd = commandExistsSync("7z") ? "7z" : commandExistsSync("7zz") ? "7zz" : "";
  if (!cmd) throw new Error("7z archives need the 7z command, which is not installed.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yomu-subs-"));
  try {
    const archive = path.join(dir, "pack.7z");
    const out = path.join(dir, "out");
    await fs.mkdir(out);
    await fs.writeFile(archive, buffer);
    await run(cmd, ["x", "-y", `-o${out}`, archive]);
    const found: { name: string; text: string }[] = [];
    await walk(out, found);
    return found;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function walk(dir: string, found: { name: string; text: string }[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, found);
      continue;
    }
    if (!/\.(?:srt|ass|ssa|vtt)$/i.test(entry.name)) continue;
    found.push({ name: entry.name, text: decodeSubtitle(await fs.readFile(full)) });
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

export function mapSubtitleFiles(files: { name: string; text: string }[], wanted: number): Map<number, { name: string; text: string }> {
  const mapped = new Map<number, { name: string; text: string }>();
  for (const file of files) {
    const number = guessEpisodeNumber(file.name);
    if (!number || number > wanted || mapped.has(number)) continue;
    if (!looksJapanese(file.text)) continue;
    mapped.set(number, file);
  }
  return mapped;
}
