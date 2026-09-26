import { guessEpisodeNumber } from "./subtitles.ts";

export type RemoteSub = { name: string; url: string };

export type SubtitleChoice =
  | { kind: "archive"; file: RemoteSub; coverage: number }
  | { kind: "files"; files: RemoteSub[]; coverage: number };

const ZIP = /\.zip$/i;
const SEVEN = /\.7z$/i;
const SUB = /\.(?:srt|ass|ssa|vtt)$/i;

export function normTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_\-:+：]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function rejectSubtitleName(name: string): boolean {
  return /(?:big5|gb_big5|\b(?:eng|english|chs|cht|chi|zh|chinese)\b|简体|繁体|中文|英訳)/i.test(name);
}

export function movieName(name: string): boolean {
  return /movie|劇場版|映画/i.test(name);
}

export function droppedFillers(name: string): boolean {
  return /no\s*fillers?|filler episodes removed/i.test(name);
}

export function episodeRange(name: string): { start: number; end: number } | null {
  const match = name.match(/(\d{1,4})\s*[-~～]\s*(\d{1,4})/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start || end > 5000) return null;
  return { start, end };
}

export function rangeCoverage(range: { start: number; end: number }, wanted: number): number {
  const from = Math.max(1, range.start);
  const to = Math.min(wanted, range.end);
  return to >= from ? to - from + 1 : 0;
}

function foreignToSeries(name: string, seriesTitle: string): boolean {
  const title = normTitle(seriesTitle);
  const file = normTitle(name);
  return ["sennen", "kessen", "ova", "special", "movie"].some((word) => file.includes(word) && !title.includes(word));
}

export function chooseKitsunekkoFolder(names: string[], titles: string[]): string | null {
  const wanted = titles.map(normTitle).filter((title) => title.length >= 2);
  if (!wanted.length) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of names) {
    const folder = normTitle(name);
    if (!folder) continue;
    let score = 0;
    for (const title of wanted) {
      if (folder === title) score = Math.max(score, 1000);
      else if (folder.startsWith(`${title} `)) score = Math.max(score, 500 - (folder.length - title.length));
    }
    if (!best || score > best.score) best = { name, score };
  }
  return best && best.score >= 200 ? best.name : null;
}

function archiveScore(name: string, wanted: number, seriesTitle: string, allow7z: boolean): number | null {
  if (rejectSubtitleName(name) || droppedFillers(name)) return null;
  const zip = ZIP.test(name);
  const seven = SEVEN.test(name);
  if (!zip && !(seven && allow7z)) return null;
  const range = episodeRange(name);
  if (!range) return null;
  const covered = rangeCoverage(range, wanted);
  if (covered < 1) return null;
  let score = covered * 100 + Math.min(range.end, wanted + 400);
  if (range.start === 1) score += 40;
  if (zip) score += 30;
  if (movieName(name) || foreignToSeries(name, seriesTitle)) score -= 250;
  return score;
}

function looseKey(name: string): string {
  const base = name.split("/").pop() || name;
  const tag = base.match(/^\[([^\]]+)\]/);
  if (tag) return tag[1].toLowerCase().trim();
  return base.replace(/\d+/g, "#").replace(/\.[a-z0-9]+$/i, "").toLowerCase().slice(0, 48) || "loose";
}

function loosePreference(name: string): number {
  let score = name.length;
  if (/v\d/i.test(name)) score += 100;
  if (/\b(?:1080|720|480)p?\b/i.test(name)) score += 20;
  return score;
}

export function chooseSubtitlePack(files: RemoteSub[], wanted: number, seriesTitle: string, allow7z = false): SubtitleChoice | null {
  let bestArchive: { file: RemoteSub; score: number; coverage: number } | null = null;
  for (const file of files) {
    const score = archiveScore(file.name, wanted, seriesTitle, allow7z);
    if (score === null) continue;
    const coverage = rangeCoverage(episodeRange(file.name) as { start: number; end: number }, wanted);
    if (!bestArchive || score > bestArchive.score) bestArchive = { file, score, coverage };
  }

  const groups = new Map<string, RemoteSub[]>();
  for (const file of files) {
    if (!SUB.test(file.name) || rejectSubtitleName(file.name) || movieName(file.name) || foreignToSeries(file.name, seriesTitle)) continue;
    const key = looseKey(file.name);
    const list = groups.get(key) || [];
    list.push(file);
    groups.set(key, list);
  }
  let bestLoose: { files: RemoteSub[]; coverage: number; key: string } | null = null;
  for (const [key, group] of groups) {
    const byEpisode = new Map<number, RemoteSub>();
    for (const file of [...group].sort((a, b) => loosePreference(a.name) - loosePreference(b.name))) {
      const number = guessEpisodeNumber(file.name);
      if (!number || number > wanted || byEpisode.has(number)) continue;
      byEpisode.set(number, file);
    }
    const chosen = [...byEpisode.values()];
    if (!bestLoose || chosen.length > bestLoose.coverage || (chosen.length === bestLoose.coverage && key < bestLoose.key)) {
      bestLoose = { files: chosen, coverage: chosen.length, key };
    }
  }

  if (bestArchive && (!bestLoose || bestArchive.coverage >= bestLoose.coverage)) {
    return { kind: "archive", file: bestArchive.file, coverage: bestArchive.coverage };
  }
  if (bestLoose && bestLoose.coverage > 0) return { kind: "files", files: bestLoose.files, coverage: bestLoose.coverage };
  return null;
}

export function looksJapanese(text: string): boolean {
  const jp = text.match(/[\u3040-\u30ff\u4e00-\u9fff\uff66-\uff9d]/g)?.length || 0;
  if (jp < 30) return false;
  const latin = text.match(/[A-Za-z]/g)?.length || 0;
  return jp >= latin;
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export type KitsunekkoEntry = { name: string; url: string; kind: "dir" | "file" };

export function parseKitsunekkoPage(html: string): KitsunekkoEntry[] {
  const entries: KitsunekkoEntry[] = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*href="([^"]+)"[^>]*>\s*(?:<strong>)?([^<]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = decodeHtml(match[1].replace(/&amp;/g, "&"));
    const label = decodeHtml(match[2] || "");
    let url: string;
    try {
      url = new URL(href, "https://kitsunekko.net/dirlist.php").href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    if (/dirlist\.php/i.test(url)) {
      const dir = new URL(url).searchParams.get("dir") || "";
      const name = label || decodeURIComponent(dir.split("/").filter(Boolean).pop() || "");
      if (!name || name === "japanese" || name === "subtitles") continue;
      entries.push({ name, url, kind: "dir" });
      continue;
    }
    const name = label || decodeURIComponent(url.split("/").pop() || "");
    if (!name || !/\.(?:zip|7z|rar|srt|ass|ssa|vtt)$/i.test(name)) continue;
    entries.push({ name, url, kind: "file" });
  }
  return entries;
}
