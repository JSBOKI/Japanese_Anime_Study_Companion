import iconv from "iconv-lite";
import JSZip from "jszip";

export type Cue = {
  index: number;
  start: string;
  end: string;
  text: string;
};

const SUB_EXT = /\.(srt|ass|ssa|vtt)$/i;

export function decodeSubtitle(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  let sjis = "";
  try {
    sjis = iconv.decode(buffer, "shift_jis");
  } catch {
    return utf8.replace(/^\uFEFF/, "");
  }
  return scoreJapanese(sjis) > scoreJapanese(utf8) ? sjis : utf8.replace(/^\uFEFF/, "");
}

function scoreJapanese(text: string): number {
  const letters = text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g);
  const bad = text.match(/\uFFFD/g);
  return (letters?.length || 0) - (bad?.length || 0) * 5;
}

export function cleanSubtitleText(input: string): string {
  return input
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\[Nn]/g, " ")
    .replace(/\\h/g, " ")
    .replace(/\\[a-zA-Z]+\([^)]*\)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([、。！？])/g, "$1")
    .trim();
}

export function guessEpisodeNumber(filename: string): number | null {
  const base = filename.replace(/\\/g, "/").split("/").pop() || filename;
  const resolutions = new Set([480, 720, 1080, 1280, 1920, 2160]);
  const explicit = [
    /(?:episode|ep|第)\s*0*(\d{1,4})/i,
    /S\d{1,2}E0*(\d{1,4})/i,
    /[\[\(（【]0*(\d{1,3})[\]\)）】]/,
  ];
  for (const pattern of explicit) {
    const match = base.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (number >= 1 && number <= 2000) return number;
  }
  const bare = base.match(/(?:^|[^0-9])(\d{1,3})(?=[^0-9]*\.(?:srt|ass|ssa|vtt)$)/i);
  if (!bare) return null;
  const number = Number(bare[1]);
  if (number < 1 || number > 999 || resolutions.has(number)) return null;
  return number;
}

export function parseSubtitle(text: string, filename = "episode.srt"): Cue[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const lower = filename.toLowerCase();
  let cues: Cue[] = [];
  if (lower.endsWith(".ass") || lower.endsWith(".ssa") || trimmed.includes("[Events]")) cues = parseAss(trimmed);
  else if (lower.endsWith(".vtt") || trimmed.startsWith("WEBVTT")) cues = parseVtt(trimmed);
  else cues = parseSrt(trimmed);
  const unique: Cue[] = [];
  for (const cue of cues) {
    if (!cue.text) continue;
    if (unique.length && unique[unique.length - 1].text === cue.text) continue;
    unique.push({ ...cue, index: unique.length });
  }
  return unique;
}

function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);
    const timeLine = lines.find((line) => line.includes("-->"));
    if (!timeLine) continue;
    const [start, end] = timeLine.split("-->").map((part) => part.trim().split(" ")[0]);
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const text = cleanSubtitleText(textLines.join(" "));
    if (!text || !start || !end) continue;
    cues.push({ index: cues.length, start, end, text });
  }
  return cues;
}

function parseVtt(text: string): Cue[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes("-->")) {
      i++;
      continue;
    }
    const [startRaw, endRaw] = lines[i].split("-->");
    const start = startRaw.trim().split(" ")[0];
    const end = endRaw.trim().split(" ")[0];
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }
    const text = cleanSubtitleText(textLines.join(" "));
    if (text) cues.push({ index: cues.length, start, end, text });
  }
  return cues;
}

function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    const body = line.slice("Dialogue:".length).trim();
    const parts = body.split(",");
    if (parts.length < 10) continue;
    const start = parts[1]?.trim();
    const end = parts[2]?.trim();
    const text = cleanSubtitleText(parts.slice(9).join(",").replace(/\\N/g, " "));
    if (!text || !start || !end) continue;
    cues.push({ index: cues.length, start, end, text });
  }
  return cues;
}

export async function filesFromUpload(filename: string, buffer: Buffer): Promise<{ name: string; text: string }[]> {
  if (filename.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(buffer);
    const files: { name: string; text: string }[] = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !SUB_EXT.test(entry.name)) continue;
      const content = Buffer.from(await entry.async("uint8array"));
      files.push({ name: entry.name, text: decodeSubtitle(content) });
    }
    files.sort((a, b) => a.name.localeCompare(b.name, "en"));
    return files;
  }
  if (!SUB_EXT.test(filename)) {
    throw new Error("Upload a .srt, .ass, .ssa, .vtt, or .zip of those files.");
  }
  return [{ name: filename, text: decodeSubtitle(buffer) }];
}
