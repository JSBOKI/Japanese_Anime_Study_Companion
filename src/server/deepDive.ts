import { llmName } from "./config.ts";
import { cardLemmas, getDeepDive, getNewsStory, getStudySettings, knownLemmas, saveDeepDive, saveDeepLesson, type DeepDiveRecord } from "./db.ts";
import { buildLesson } from "./lesson.ts";
import { llmText, parseJson } from "./llm.ts";
import { articleCues } from "./newsParse.ts";

export type DiveKind = "report" | "opinion" | "reaction";

export type DiveSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  kind: DiveKind;
  lang: "ja" | "en";
};

export type DiveParagraph = {
  ja: string;
  en: string;
  kind: "background" | "report" | "opinion" | "reaction" | "history";
  sourceIds: string[];
};

export const NEEDS_KEY_NOTE =
  "The written deep dive needs an OpenAI or Anthropic key. The links below are the sources that were found. No article text was invented.";

export const NO_REACTION_NOTE = "No public social posts were available without signing in.";

const OPINION = /社説|論説|オピニオン|コラム|editorial|\bopinion\b|op-ed/i;

export function classifyCoverage(title: string, url: string): DiveKind {
  return OPINION.test(`${title} ${url}`) ? "opinion" : "report";
}

export function decodeNewsText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourcesFromNewsRss(xml: string, lang: "ja" | "en", limit = 5): DiveSource[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const sources: DiveSource[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const title = decodeNewsText(tag(block, "title") || "");
    const link = (tag(block, "link") || "").trim();
    if (!title || !/^https:\/\//i.test(link) || seen.has(link)) continue;
    seen.add(link);
    const sourceTag = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const publisher = decodeNewsText(sourceTag?.[2] || "") || publisherFromTitle(title);
    const snippet = decodeNewsText(tag(block, "description") || "") || title;
    sources.push({
      id: `s${sources.length + 1}`,
      title: title.slice(0, 180),
      url: link,
      publisher: publisher.slice(0, 80),
      snippet: snippet.slice(0, 360),
      kind: classifyCoverage(title, link),
      lang,
    });
    if (sources.length >= limit) break;
  }
  return sources;
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1].trim() : null;
}

function publisherFromTitle(title: string): string {
  const parts = title.split(/\s[-|｜]\s/);
  return parts.length > 1 ? parts[parts.length - 1] : "News";
}

export function reactionFromMastodon(body: unknown): DiveSource[] {
  const statuses = body && typeof body === "object" && Array.isArray((body as { statuses?: unknown }).statuses)
    ? ((body as { statuses: unknown[] }).statuses)
    : [];
  const sources: DiveSource[] = [];
  for (const status of statuses) {
    if (!status || typeof status !== "object") continue;
    const row = status as { url?: unknown; content?: unknown; account?: { display_name?: unknown; username?: unknown } };
    const url = typeof row.url === "string" ? row.url : "";
    const text = decodeNewsText(typeof row.content === "string" ? row.content : "");
    if (!/^https:\/\//i.test(url) || text.length < 20) continue;
    const name = String(row.account?.display_name || row.account?.username || "Mastodon");
    sources.push({
      id: `r${sources.length + 1}`,
      title: text.slice(0, 80),
      url,
      publisher: name.slice(0, 80),
      snippet: text.slice(0, 360),
      kind: "reaction",
      lang: /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? "ja" : "en",
    });
    if (sources.length >= 3) break;
  }
  return sources;
}

export function renumberSources(sources: DiveSource[]): DiveSource[] {
  return sources.map((source, index) => ({ ...source, id: `s${index + 1}` }));
}

export function deepDiveWithoutKey(sources: DiveSource[]): { note: string; reactionNote: string | null; paragraphs: DiveParagraph[] } {
  return {
    note: NEEDS_KEY_NOTE,
    reactionNote: sources.some((source) => source.kind === "reaction") ? null : NO_REACTION_NOTE,
    paragraphs: [],
  };
}

export function acceptModelParagraphs(raw: unknown, sources: DiveSource[], material: string): DiveParagraph[] | null {
  const body = raw && typeof raw === "object" ? (raw as { paragraphs?: unknown }).paragraphs : null;
  if (!Array.isArray(body)) return null;
  const allowed = new Set(sources.map((source) => source.id));
  const urls = sources.map((source) => source.url);
  const kept: DiveParagraph[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const row = item as { ja?: unknown; en?: unknown; kind?: unknown; sourceIds?: unknown };
    const ja = typeof row.ja === "string" ? row.ja.trim() : "";
    const en = typeof row.en === "string" ? row.en.trim() : "";
    const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds.map((id) => String(id)) : [];
    if (!ja || !en || !sourceIds.length) continue;
    if (!sourceIds.every((id) => allowed.has(id))) continue;
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(ja) || !/[A-Za-z]/.test(en)) continue;
    if (outsideLink(ja, urls) || outsideLink(en, urls)) continue;
    if (inventedQuote(ja, material) || inventedQuote(en, material)) continue;
    let kind: DiveParagraph["kind"] =
      row.kind === "background" || row.kind === "opinion" || row.kind === "reaction" || row.kind === "history" ? row.kind : "report";
    const cited = sources.filter((source) => sourceIds.includes(source.id));
    if (kind === "opinion" && !cited.some((source) => source.kind === "opinion")) kind = "report";
    if (kind === "reaction" && !cited.some((source) => source.kind === "reaction")) kind = "report";
    kept.push({ ja, en, kind, sourceIds });
  }
  return kept.length ? kept : null;
}

function outsideLink(text: string, urls: string[]): boolean {
  const links = text.match(/https?:\/\/[^\s)]+/g) || [];
  return links.some((link) => !urls.some((url) => link.startsWith(url)));
}

function inventedQuote(text: string, material: string): boolean {
  const quotes = [
    ...(text.match(/「([^」]{8,})」/g) || []),
    ...(text.match(/"([^"]{8,})"/g) || []),
  ];
  return quotes.some((quote) => {
    const inner = quote.replace(/^[「"]|[」"]$/g, "");
    return !material.includes(inner);
  });
}

export function labelParagraph(paragraph: DiveParagraph): { ja: string; en: string } {
  if (paragraph.kind === "opinion") return { ja: `意見：${paragraph.ja}`, en: `Opinion: ${paragraph.en}` };
  if (paragraph.kind === "reaction") return { ja: `反応：${paragraph.ja}`, en: `Reaction: ${paragraph.en}` };
  if (paragraph.kind === "history") return { ja: `経緯：${paragraph.ja}`, en: `Background: ${paragraph.en}` };
  return { ja: paragraph.ja, en: paragraph.en };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function gatherDiveSources(input: { title: string; titleEn: string | null; url: string | null; body: string }): Promise<DiveSource[]> {
  const query = input.title.replace(/\s+[-|｜].*$/, "").slice(0, 80);
  const [japanese, english, social] = await Promise.all([
    fetchRss(googleNewsUrl(query, "ja"), "ja"),
    fetchRss(googleNewsUrl(input.titleEn || query, "en"), "en"),
    fetchReaction(query),
  ]);
  const own: DiveSource[] = input.url
    ? [{
        id: "story",
        title: input.title,
        url: input.url,
        publisher: "NHK",
        snippet: input.body.slice(0, 360),
        kind: "report",
        lang: "ja",
      }]
    : [];
  const merged = [...own, ...japanese, ...english, ...social].filter((source, index, all) => {
    return all.findIndex((item) => item.url === source.url) === index;
  });
  return renumberSources(merged).slice(0, 12);
}

function googleNewsUrl(query: string, lang: "ja" | "en"): string {
  const params = new URLSearchParams(
    lang === "ja"
      ? { q: query, hl: "ja", gl: "JP", ceid: "JP:ja" }
      : { q: query, hl: "en", gl: "US", ceid: "US:en" },
  );
  return `https://news.google.com/rss/search?${params}`;
}

async function fetchRss(url: string, lang: "ja" | "en"): Promise<DiveSource[]> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return [];
    return sourcesFromNewsRss(await response.text(), lang);
  } catch (error) {
    console.error("Related news search failed", error);
    return [];
  }
}

async function fetchReaction(query: string): Promise<DiveSource[]> {
  try {
    const url = `https://mastodon.social/api/v2/search?type=statuses&limit=5&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return [];
    return reactionFromMastodon(await response.json());
  } catch {
    return [];
  }
}

export async function writeDeepDive(input: { title: string; body: string; sources: DiveSource[] }): Promise<{ note: string | null; reactionNote: string | null; paragraphs: DiveParagraph[] }> {
  const chat = await llmText(deepSystem(getStudySettings().level), JSON.stringify({
    title: input.title,
    article: input.body.slice(0, 4000),
    sources: input.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      kind: source.kind,
      snippet: source.snippet,
    })),
  })).catch((error) => {
    console.error("Deep dive model failed", error);
    return null;
  });
  if (!chat) return deepDiveWithoutKey(input.sources);
  const material = `${input.body}\n${input.sources.map((source) => `${source.title}\n${source.snippet}`).join("\n")}`;
  let parsed: DiveParagraph[] | null = null;
  try {
    parsed = acceptModelParagraphs(parseJson(chat), input.sources, material);
  } catch (error) {
    console.error("Deep dive JSON was unusable", error);
  }
  if (!parsed) {
    return {
      note: "A written deep dive was not kept, because it was not tied to the sources below. No article text was invented.",
      reactionNote: input.sources.some((source) => source.kind === "reaction") ? null : NO_REACTION_NOTE,
      paragraphs: [],
    };
  }
  return {
    note: null,
    reactionNote: input.sources.some((source) => source.kind === "reaction") ? null : NO_REACTION_NOTE,
    paragraphs: parsed,
  };
}

function deepSystem(level: string): string {
  return [
    `You write a news briefing for an adult learning Japanese at JLPT ${level}.`,
    "Use only the article and the source snippets. Do not add facts, numbers, names, or quotes that are not in that material.",
    "If a section cannot be supported, omit it. History, opinion, and public reaction are optional.",
    "Return only JSON: {\"paragraphs\":[{\"ja\":string,\"en\":string,\"kind\":\"background\"|\"report\"|\"opinion\"|\"reaction\"|\"history\",\"sourceIds\":[string]}]}.",
    "ja is Japanese at that JLPT level, no furigana, no markdown. en is a full English version of the same paragraph.",
    "kind opinion is allowed only when a cited source kind is opinion. kind reaction is allowed only when a cited source kind is reaction.",
    "Every paragraph must cite one or more source ids from the input. Do not invent urls.",
    "Quote someone only when those exact words are in a snippet or the article. Otherwise paraphrase.",
  ].join(" ");
}

export function modelAvailable(): boolean {
  return llmName() !== "none";
}

export async function ensureDeepDive(storyId: number, refresh = false): Promise<DeepDiveRecord | null> {
  const story = getNewsStory(storyId);
  if (!story) return null;
  const cached = getDeepDive(storyId);
  const llm = llmName();
  if (cached && !refresh && (cached.llm !== "none" || llm === "none")) {
    if (cached.bodyJa && cached.lessonLevel !== getStudySettings().level) {
      saveDeepLesson(storyId, await lessonFromParagraphs(cached.bodyJa));
      return getDeepDive(storyId);
    }
    return cached;
  }
  const sources = await gatherDiveSources({ title: story.title, titleEn: story.titleEn, url: story.url, body: story.bodyJa });
  const written = await writeDeepDive({ title: story.title, body: story.bodyJa, sources });
  const labeled = written.paragraphs.map(labelParagraph);
  const bodyJa = labeled.length ? labeled.map((paragraph) => paragraph.ja).join("\n\n") : null;
  const bodyEn = labeled.length ? labeled.map((paragraph) => paragraph.en).join("\n\n") : null;
  const lesson = bodyJa ? await lessonFromParagraphs(bodyJa) : null;
  saveDeepDive({
    storyId,
    llm: written.paragraphs.length ? llm : "none",
    note: written.note,
    reactionNote: written.reactionNote,
    sourcesJson: JSON.stringify(sources),
    bodyJa,
    bodyEn,
    lesson,
  });
  return getDeepDive(storyId);
}

async function lessonFromParagraphs(body: string) {
  const settings = getStudySettings();
  const paragraphs = body.split(/\n\n/).map((part) => part.trim()).filter(Boolean);
  return buildLesson({
    cues: articleCues("深掘り", paragraphs),
    known: knownLemmas(),
    taughtVocab: cardLemmas(),
    taughtGrammar: new Set(),
    level: settings.level,
    passage: settings.passage,
  });
}
