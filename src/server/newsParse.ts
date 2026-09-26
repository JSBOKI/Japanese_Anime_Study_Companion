import type { Cue } from "./subtitles.ts";

export const SOURCE_DOWN_MESSAGE =
  "NHK news is not responding right now. Stories already saved on this server are still here.";

export const NO_ENGLISH_NOTE =
  "No English text is available for this story. NHK World has not published a matching English article, and no translation key is set.";

export const WORLD_REPORT_NOTE =
  "NHK World-Japan English report. This is a separate English article, not a translation of the Japanese story.";

export const WORLD_SUMMARY_NOTE =
  "NHK World-Japan English summary from the public feed. This is not a translation of the Japanese story.";

export const LLM_NOTE = "English translation of this Japanese article.";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

export type RssItem = {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
};

export type WorldStory = {
  id: string;
  title: string;
  description: string;
  pageUrl: string;
  updatedAt: number;
};

export type EnglishDraft = {
  title: string | null;
  paragraphs: string[];
  source: "llm" | "nhk-world" | "none";
  url: string | null;
  note: string;
};

export function tokyoParts(now: Date): { year: number; month: number; day: number; hour: number } {
  const shifted = new Date(now.getTime() + TOKYO_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

export function tokyoDay(now: Date): string {
  const parts = tokyoParts(now);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function tokyoDayOffset(now: Date, days: number): string {
  return tokyoDay(new Date(now.getTime() + days * 24 * 60 * 60 * 1000));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function tokyoInstant(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0) - TOKYO_OFFSET_MS);
}

function parseTime(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True when this Tokyo calendar day has not had a successful fetch yet. */
export function needsCatchup(lastRanAt: string | null, now: Date): boolean {
  const last = parseTime(lastRanAt);
  if (!last) return true;
  return tokyoDay(last) !== tokyoDay(now);
}

/**
 * True once today's scheduled hour has arrived and the last success was before that instant.
 * A fetch earlier the same day still leaves the morning job to run.
 */
export function needsScheduledRefresh(lastRanAt: string | null, now: Date, hour: number): boolean {
  const parts = tokyoParts(now);
  const scheduled = tokyoInstant(parts.year, parts.month, parts.day, hour);
  if (now.getTime() < scheduled.getTime()) return false;
  const last = parseTime(lastRanAt);
  if (!last) return true;
  return last.getTime() < scheduled.getTime();
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function textOf(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  let raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) raw = cdata[1];
  return decodeEntities(raw.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseRssItems(xml: string): RssItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const items: RssItem[] = [];
  for (const block of blocks) {
    const title = textOf(block, "title");
    const link = textOf(block, "link") || textOf(block, "guid");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: textOf(block, "pubDate") || null,
      description: textOf(block, "description") || null,
    });
  }
  return items;
}

export function sourceIdFromUrl(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return segment || null;
  } catch {
    return null;
  }
}

export function authorizeUrl(articleUrl: string): string {
  const query = new URLSearchParams({
    idp: "a-alaz",
    profileType: "abroad",
    redirect_uri: articleUrl,
    entity: "none",
    area: "130",
    pref: "13",
    jisx0402: "13101",
    postal: "1000001",
  });
  return `https://news.web.nhk/tix/build_authorize?${query.toString()}`;
}

const STOP_HEADING = /^(あわせて読みたい|注目ワード|深掘りコンテンツ|最新・注目の動画|新着ニュース|各地のニュース|天気予報)/;
const BOILERPLATE = /Copyright NHK|許可なく転載|受信料で制作|この記事をシェア/;

function cleanInline(fragment: string): string {
  const withoutRuby = fragment.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, "");
  return decodeEntities(withoutRuby.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function keepBlock(text: string, kind: "p" | "h2"): boolean {
  if (STOP_HEADING.test(text) || BOILERPLATE.test(text)) return false;
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return false;
  if (kind === "h2") return [...text].length >= 2;
  return [...text].length >= 12;
}

export function extractArticleText(html: string): string[] {
  const withoutChrome = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const stopAt = withoutChrome.search(/<h2\b[^>]*>\s*(?:あわせて読みたい|注目ワード|深掘りコンテンツ)/);
  const stripped = stopAt > 0 ? withoutChrome.slice(0, stopAt) : withoutChrome;
  const divAt = stripped.search(/<div\b[^>]*\bclass="[^"]*\bc-part\b/i);
  const lead: string[] = [];
  if (divAt > 0) {
    const head = stripped.slice(0, divAt);
    const leadRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let leadMatch: RegExpExecArray | null;
    while ((leadMatch = leadRe.exec(head))) {
      const text = cleanInline(leadMatch[1]);
      if (keepBlock(text, "p") && !/(?:…|⋯|\.\.\.)$/.test(text)) lead.push(text);
    }
  }

  const tokens = stripped.split(/(<[^>]+>)/);
  let depth = 0;
  let inPart = false;
  let partDepth = 0;
  let capture: "p" | "h2" | null = null;
  let captureDepth = 0;
  let buf = "";
  let skipRuby = false;
  const body: string[] = [];

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (capture && !skipRuby) buf += token;
      continue;
    }
    const name = /^<\/?\s*([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase();
    if (!name) continue;
    const closing = token.startsWith("</");
    const selfClosing = /\/>$/.test(token) || ["br", "hr", "img", "meta", "link", "input", "source", "wbr"].includes(name);
    if (name === "div" && !closing && !selfClosing) {
      depth += 1;
      if (/\bc-part\b/.test(token)) {
        inPart = true;
        partDepth = depth;
      }
    } else if (name === "div" && closing) {
      if (inPart && depth === partDepth) inPart = false;
      depth = Math.max(0, depth - 1);
    }
    if (name === "rt" && !closing && !selfClosing) skipRuby = true;
    if (name === "rt" && closing) skipRuby = false;
    if (!inPart) continue;
    if ((name === "p" || name === "h2") && !closing && !selfClosing && !capture) {
      capture = name;
      captureDepth = 1;
      buf = "";
      continue;
    }
    if (capture && name === capture && !closing && !selfClosing) captureDepth += 1;
    if (capture && name === capture && closing) {
      captureDepth -= 1;
      if (captureDepth <= 0) {
        const text = decodeEntities(buf).replace(/\s+/g, " ").trim();
        if (capture === "h2" && STOP_HEADING.test(text)) {
          capture = null;
          buf = "";
          break;
        }
        if (capture && keepBlock(text, capture)) body.push(text);
        capture = null;
        buf = "";
      }
    }
  }

  const merged = [...lead, ...body];
  return merged.filter((text, index) => merged.indexOf(text) === index);
}

export function usableArticle(paragraphs: string[]): boolean {
  const text = paragraphs.join("");
  const length = [...text].length;
  if (length < 120) return false;
  if (/(?:…|⋯|\.\.\.)$/.test(text.trim()) && length < 500) return false;
  return true;
}

export function readingMinutes(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  return Math.max(1, Math.round(chars / 500));
}

export function articleCues(title: string, paragraphs: string[]): Cue[] {
  const texts = paragraphs[0] === title ? paragraphs : [title, ...paragraphs];
  return texts.map((text, index) => {
    const startMs = index * 1000;
    return {
      index,
      start: formatStamp(startMs),
      end: formatStamp(startMs + 500),
      text,
    };
  });
}

function formatStamp(totalMs: number): string {
  const seconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `00:${pad(mm)}:${pad(ss)},${String(ms).padStart(3, "0")}`;
}

export function chunkSpeech(text: string, lang: "ja" | "en"): string[] {
  const limit = 600;
  const parts = text
    .split(lang === "ja" ? /(?<=[。！？])/ : /(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  const push = (value: string) => {
    if (value) chunks.push(value);
  };
  for (const part of parts) {
    if ([...part].length > limit) {
      push(buf);
      buf = "";
      for (let offset = 0; offset < part.length; offset += limit) push(part.slice(offset, offset + limit));
      continue;
    }
    const next = buf ? (lang === "ja" ? buf + part : `${buf} ${part}`) : part;
    if ([...next].length > limit) {
      push(buf);
      buf = part;
    } else {
      buf = next;
    }
  }
  push(buf);
  return chunks;
}

function digitNumbers(text: string): Set<string> {
  return new Set(text.match(/\d{2,}/g) || []);
}

function latinTokens(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z][A-Za-z0-9]{2,}/g) || []).map((token) => token.toLowerCase()));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function matchEnglishStory(
  story: { title: string; body: string; publishedAt: string | null },
  world: WorldStory[],
  now = Date.now(),
): WorldStory | null {
  const published = story.publishedAt ? Date.parse(story.publishedAt) : now;
  const when = Number.isNaN(published) ? now : published;
  const haystack = `${story.title}\n${story.body}`;
  const numbers = digitNumbers(haystack);
  const latin = latinTokens(haystack);
  let best: { item: WorldStory; score: number } | null = null;
  for (const item of world) {
    if (Math.abs(item.updatedAt - when) > MATCH_WINDOW_MS) continue;
    const text = `${item.title} ${item.description}`;
    const score = overlap(numbers, digitNumbers(text)) * 3 + overlap(latin, latinTokens(text)) * 4;
    if (score < 6) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item || null;
}

export function parseWorldFeed(payload: unknown): WorldStory[] {
  const record = payload && typeof payload === "object" ? (payload as { data?: unknown }) : null;
  const rows = Array.isArray(payload) ? payload : Array.isArray(record?.data) ? record.data : [];
  const stories: WorldStory[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; title?: unknown; description?: unknown; page_url?: unknown; updated_at?: unknown };
    const title = String(item.title || "").trim();
    const page = String(item.page_url || "").trim();
    if (!title || !page) continue;
    const updatedAt = Number(item.updated_at);
    if (!Number.isFinite(updatedAt)) continue;
    const pageUrl = page.startsWith("http") ? page : `https://www3.nhk.or.jp${page.startsWith("/") ? "" : "/"}${page}`;
    stories.push({
      id: String(item.id || pageUrl),
      title,
      description: String(item.description || "").trim(),
      pageUrl,
      updatedAt,
    });
  }
  return stories;
}

export function extractEnglishParagraphs(html: string): string[] {
  const stripped = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const paragraphs: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const letters = text.match(/[A-Za-z]/g)?.length || 0;
    if (text.length < 40 || letters < 20) continue;
    if (/copyright|all rights reserved/i.test(text) && text.length < 180) continue;
    paragraphs.push(text);
  }
  return paragraphs;
}

function looksEnglish(text: string): boolean {
  return (text.match(/[A-Za-z]/g)?.length || 0) >= 20;
}

export function resolveEnglish(input: {
  llm: { title: string; paragraphs: string[] } | null;
  world: WorldStory | null;
  worldParagraphs: string[];
}): EnglishDraft {
  if (input.llm && looksEnglish(`${input.llm.title} ${input.llm.paragraphs.join(" ")}`)) {
    const paragraphs = input.llm.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
    if (input.llm.title.trim() && paragraphs.length) {
      return {
        title: input.llm.title.trim(),
        paragraphs,
        source: "llm",
        url: null,
        note: LLM_NOTE,
      };
    }
  }
  if (!input.world) {
    return { title: null, paragraphs: [], source: "none", url: null, note: NO_ENGLISH_NOTE };
  }
  const paragraphs = input.worldParagraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length) {
    return {
      title: input.world.title,
      paragraphs,
      source: "nhk-world",
      url: input.world.pageUrl,
      note: WORLD_REPORT_NOTE,
    };
  }
  if (input.world.description.trim()) {
    return {
      title: input.world.title,
      paragraphs: [input.world.description.trim()],
      source: "nhk-world",
      url: input.world.pageUrl,
      note: WORLD_SUMMARY_NOTE,
    };
  }
  return { title: null, paragraphs: [], source: "none", url: null, note: NO_ENGLISH_NOTE };
}

export function skipRssItem(title: string): boolean {
  return /【動画】|【ライブ】|【中継】/.test(title);
}
