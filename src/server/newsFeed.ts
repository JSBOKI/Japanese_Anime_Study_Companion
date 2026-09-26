import fs from "node:fs/promises";
import { newsFetchHour, newsRssUrl } from "./config.ts";
import {
  getNewsState,
  getStudySettings,
  knownLemmas,
  cardLemmas,
  pruneNewsStories,
  setNewsState,
  upsertNewsStory,
  type NewsStoryRecord,
} from "./db.ts";
import { buildLesson } from "./lesson.ts";
import { translateNews } from "./llm.ts";
import {
  SOURCE_DOWN_MESSAGE,
  articleCues,
  authorizeUrl,
  extractArticleText,
  extractEnglishParagraphs,
  matchEnglishStory,
  parseRssItems,
  parseWorldFeed,
  readingMinutes,
  resolveEnglish,
  skipRssItem,
  sourceIdFromUrl,
  tokyoDay,
  tokyoDayOffset,
  usableArticle,
  needsCatchup,
  needsScheduledRefresh,
  type RssItem,
  type WorldStory,
} from "./newsParse.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const CATEGORIES = ["総合", "社会", "暮らし", "科学・文化", "政治", "経済", "国際", "スポーツ"];
const WORLD_URL = "https://www3.nhk.or.jp/nhkworld/data/en/news/all.json";
const DEFAULT_RSS = "https://news.web.nhk/n-data/conf/na/rss/cat0.xml";

export type RefreshResult = { ok: boolean; message: string | null; count: number };

type Feed = { category: string; url: string; primary: boolean };
type Candidate = RssItem & { category: string; sourceId: string; primary: boolean };

let running: Promise<RefreshResult> | null = null;

export function newsFeeds(): Feed[] {
  const override = newsRssUrl();
  const main = override || DEFAULT_RSS;
  if (/cat0\.xml(?:$|\?)/.test(main)) {
    return CATEGORIES.map((category, index) => ({
      category,
      url: main.replace(/cat0\.xml/, `cat${index}.xml`),
      primary: index === 0,
    }));
  }
  return [{ category: "ニュース", url: main, primary: true }];
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(jar: Map<string, string>, lines: string[]): void {
  for (const line of lines) {
    const pair = line.split(";")[0] || "";
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function fetchText(url: string, jar: Map<string, string>, accept: string): Promise<{ status: number; text: string }> {
  let current = url;
  for (let hop = 0; hop < 12; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
        Cookie: cookieHeader(jar),
      },
    });
    storeCookies(jar, typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    return { status: response.status, text: await response.text() };
  }
  throw new Error("Too many redirects");
}

async function fetchArticle(url: string): Promise<string[]> {
  const jar = new Map<string, string>();
  const first = await fetchText(url, jar, "text/html,application/xhtml+xml");
  let paragraphs = first.status === 200 ? extractArticleText(first.text) : [];
  if (!usableArticle(paragraphs) && url.includes("news.web.nhk")) {
    const second = await fetchText(authorizeUrl(url), jar, "text/html,application/xhtml+xml");
    if (second.status === 200) paragraphs = extractArticleText(second.text);
  }
  return usableArticle(paragraphs) ? paragraphs : [];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function publishedDay(pubDate: string | null, fallback: string): { day: string; iso: string | null } {
  if (!pubDate) return { day: fallback, iso: null };
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) return { day: fallback, iso: null };
  return { day: tokyoDay(date), iso: date.toISOString() };
}

async function loadFeeds(): Promise<Candidate[]> {
  const feeds = newsFeeds();
  const batches = await mapPool(feeds, 4, async (feed) => {
    try {
      const response = await fetchText(feed.url, new Map(), "application/rss+xml, application/xml, text/xml");
      if (response.status !== 200 || !response.text.includes("<item")) return [];
      return parseRssItems(response.text)
        .filter((item) => !skipRssItem(item.title))
        .map((item) => {
          const sourceId = sourceIdFromUrl(item.link);
          return sourceId ? { ...item, category: feed.category, sourceId, primary: feed.primary } : null;
        })
        .filter((item): item is Candidate => Boolean(item));
    } catch (error) {
      console.error(`News feed failed: ${feed.url}`, error);
      return [];
    }
  });
  const seen = new Set<string>();
  const items: Candidate[] = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (seen.has(item.sourceId)) continue;
      seen.add(item.sourceId);
      items.push(item);
    }
  }
  return items;
}

function pickCandidates(items: Candidate[]): Candidate[] {
  const byDate = (left: Candidate, right: Candidate) => {
    const a = left.pubDate ? Date.parse(left.pubDate) : 0;
    const b = right.pubDate ? Date.parse(right.pubDate) : 0;
    return b - a;
  };
  const primary = items.filter((item) => item.primary).sort(byDate);
  const chosen: Candidate[] = primary.slice(0, 3);
  const ids = new Set(chosen.map((item) => item.sourceId));
  const categories = [...new Set(items.filter((item) => !item.primary).map((item) => item.category))];
  for (const category of categories) {
    const next = items.filter((item) => item.category === category && !ids.has(item.sourceId)).sort(byDate)[0];
    if (!next) continue;
    chosen.push(next);
    ids.add(next.sourceId);
  }
  for (const item of [...items].sort(byDate)) {
    if (chosen.length >= 12) break;
    if (ids.has(item.sourceId)) continue;
    chosen.push(item);
    ids.add(item.sourceId);
  }
  return chosen;
}

async function loadWorld(): Promise<WorldStory[]> {
  try {
    const response = await fetchText(WORLD_URL, new Map(), "application/json");
    if (response.status !== 200) return [];
    return parseWorldFeed(JSON.parse(response.text) as unknown);
  } catch (error) {
    console.error("NHK World feed failed", error);
    return [];
  }
}

async function englishFor(
  title: string,
  paragraphs: string[],
  publishedAt: string | null,
  world: WorldStory[],
): Promise<ReturnType<typeof resolveEnglish>> {
  const llm = await translateNews(title, paragraphs).catch(() => null);
  const match = matchEnglishStory({ title, body: paragraphs.join("\n"), publishedAt }, world);
  let worldParagraphs: string[] = [];
  if (match && !llm) {
    try {
      const page = await fetchText(match.pageUrl, new Map(), "text/html");
      if (page.status === 200) worldParagraphs = extractEnglishParagraphs(page.text);
    } catch (error) {
      console.error(`English article failed: ${match.pageUrl}`, error);
    }
  }
  return resolveEnglish({ llm, world: match, worldParagraphs });
}

async function buildStoryLesson(title: string, paragraphs: string[]) {
  const settings = getStudySettings();
  return buildLesson({
    cues: articleCues(title, paragraphs),
    known: knownLemmas(),
    taughtVocab: cardLemmas(),
    taughtGrammar: new Set(),
    level: settings.level,
    passage: settings.passage,
  });
}

async function doRefresh(): Promise<RefreshResult> {
  setNewsState({ attemptedAt: new Date().toISOString() });
  try {
    const items = await loadFeeds();
    if (!items.length) {
      setNewsState({ status: "error", message: SOURCE_DOWN_MESSAGE, storyCount: 0 });
      return { ok: false, message: SOURCE_DOWN_MESSAGE, count: 0 };
    }
    const candidates = pickCandidates(items);
    const world = await loadWorld();
    const fetched = await mapPool(candidates, 3, async (item) => {
      try {
        const paragraphs = await fetchArticle(item.link);
        if (!paragraphs.length) return null;
        return { item, paragraphs };
      } catch (error) {
        console.error(`Article failed: ${item.link}`, error);
        return null;
      }
    });
    const ready = fetched.filter((item): item is { item: Candidate; paragraphs: string[] } => Boolean(item)).slice(0, 8);
    if (!ready.length) {
      setNewsState({ status: "error", message: SOURCE_DOWN_MESSAGE, storyCount: 0 });
      return { ok: false, message: SOURCE_DOWN_MESSAGE, count: 0 };
    }
    const today = tokyoDay(new Date());
    for (const entry of ready) {
      const when = publishedDay(entry.item.pubDate, today);
      const english = await englishFor(entry.item.title, entry.paragraphs, when.iso, world);
      const body = entry.paragraphs.join("\n\n");
      let lesson = null;
      try {
        lesson = await buildStoryLesson(entry.item.title, entry.paragraphs);
      } catch (error) {
        console.error(`Lesson failed for ${entry.item.sourceId}`, error);
      }
      upsertNewsStory({
        sourceId: entry.item.sourceId,
        day: when.day,
        publishedAt: when.iso,
        title: entry.item.title,
        category: entry.item.category,
        url: entry.item.link,
        bodyJa: body,
        bodyEn: english.paragraphs.length ? english.paragraphs.join("\n\n") : null,
        titleEn: english.title,
        englishSource: english.source,
        englishUrl: english.url,
        englishNote: english.note,
        lesson,
        readingMinutes: readingMinutes(body),
      });
    }
    const removed = pruneNewsStories(tokyoDayOffset(new Date(), -30));
    await Promise.all(removed.flatMap((row) => [row.audioJaPath, row.audioEnPath].filter(Boolean).map((file) => fs.rm(file as string, { force: true }))));
    setNewsState({ ranAt: new Date().toISOString(), status: "ok", message: "", storyCount: ready.length });
    console.log(`News: saved ${ready.length} stories.`);
    return { ok: true, message: null, count: ready.length };
  } catch (error) {
    console.error("News refresh failed", error);
    setNewsState({ status: "error", message: SOURCE_DOWN_MESSAGE, storyCount: 0 });
    return { ok: false, message: SOURCE_DOWN_MESSAGE, count: 0 };
  }
}

export function refreshNews(): Promise<RefreshResult> {
  if (running) return running;
  const job = doRefresh().finally(() => {
    running = null;
  });
  running = job;
  return job;
}

export async function ensureFresh(): Promise<RefreshResult | null> {
  const state = getNewsState();
  const now = new Date();
  if (!needsCatchup(state.ranAt, now)) return null;
  if (state.status === "error" && state.attemptedAt && tokyoDay(new Date(state.attemptedAt)) === tokyoDay(now)) {
    if (!needsScheduledRefresh(state.attemptedAt, now, newsFetchHour())) return null;
  }
  return refreshNews();
}

export function startNewsScheduler(): void {
  const tick = () => {
    const state = getNewsState();
    const now = new Date();
    const hour = newsFetchHour();
    if (!needsScheduledRefresh(state.ranAt, now, hour)) return;
    if (state.attemptedAt && !needsScheduledRefresh(state.attemptedAt, now, hour)) return;
    void refreshNews().catch((error) => console.error(error));
  };
  tick();
  setInterval(tick, 30_000);
}

export async function lessonForStory(story: NewsStoryRecord) {
  if (story.lesson) return story.lesson;
  const paragraphs = story.bodyJa.split(/\n\n/).filter(Boolean);
  return buildStoryLesson(story.title, paragraphs);
}
