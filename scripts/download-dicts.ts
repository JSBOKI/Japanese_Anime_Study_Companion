import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { dictDir } from "../src/server/config.ts";

const JM_NAME = "jmdict-eng-common.json";
const KN_NAME = "kanjidic2-en.json";
const JLPT = ["n5", "n4", "n3", "n2", "n1"] as const;

const FALLBACK_RELEASE = "3.6.2+20260921173324";

async function exists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "yomu" } });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} for ${url}`);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

async function latestZip(match: (name: string) => boolean): Promise<string> {
  try {
    const res = await fetch("https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "yomu",
      },
    });
    if (res.ok) {
      const body = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] };
      const asset = body.assets?.find((item) => match(item.name) && item.name.endsWith(".zip"));
      if (asset) return asset.browser_download_url;
    }
  } catch (error) {
    console.warn("Could not read the latest JMdict release, using the pinned fallback.", error);
  }
  const tag = encodeURIComponent(FALLBACK_RELEASE);
  if (match("jmdict-eng-common")) {
    return `https://github.com/scriptin/jmdict-simplified/releases/download/${tag}/jmdict-eng-common-${FALLBACK_RELEASE}.json.zip`;
  }
  return `https://github.com/scriptin/jmdict-simplified/releases/download/${tag}/kanjidic2-en-${FALLBACK_RELEASE}.json.zip`;
}

async function unzipJson(zipPath: string, dest: string): Promise<void> {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const entry = Object.values(zip.files).find((file) => !file.dir && file.name.endsWith(".json"));
  if (!entry) throw new Error(`No JSON inside ${zipPath}`);
  const text = await entry.async("string");
  await fs.writeFile(dest, text);
}

export async function ensureDictFiles(): Promise<void> {
  await fs.mkdir(dictDir, { recursive: true });
  const jmPath = path.join(dictDir, JM_NAME);
  const knPath = path.join(dictDir, KN_NAME);

  if (!(await exists(jmPath)) || !(await exists(knPath))) {
    console.log("Downloading JMdict (common English) and KANJIDIC…");
    const jmZip = path.join(dictDir, "jmdict.zip");
    const knZip = path.join(dictDir, "kanji.zip");
    if (!(await exists(jmPath))) {
      await download(await latestZip((name) => name.startsWith("jmdict-eng-common-")), jmZip);
      await unzipJson(jmZip, jmPath);
    }
    if (!(await exists(knPath))) {
      await download(await latestZip((name) => name.startsWith("kanjidic2-en-")), knZip);
      await unzipJson(knZip, knPath);
    }
    console.log("Dictionaries saved.");
  }

  for (const level of JLPT) {
    const file = path.join(dictDir, `${level}.csv`);
    if (await exists(file)) continue;
    const url = `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/master/src/${level}.csv`;
    console.log(`Downloading JLPT ${level.toUpperCase()} list…`);
    await download(url, file);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirect) {
  ensureDictFiles().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function fileURLToPath(url: string): string {
  return new URL(url).pathname;
}
