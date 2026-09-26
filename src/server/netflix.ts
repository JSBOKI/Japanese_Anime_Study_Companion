import type { SeriesSummary } from "../shared/types.ts";
import { saveNetflixWatches, setSeriesNetflix } from "./db.ts";

export type NetflixSource = "anilist" | "justwatch" | "manual" | "none";

const TITLE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(\d{4,12})\/?$/i;

export function normalizeNetflixTitleUrl(value: string): string | null {
  const raw = value.trim();
  if (/^\d{4,12}$/.test(raw)) return `https://www.netflix.com/title/${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== "netflix.com" && host !== "www.netflix.com") return null;
  const match = parsed.pathname.match(TITLE);
  if (!match) return null;
  return `https://www.netflix.com/title/${match[1]}`;
}

export function normalizeNetflixWatchUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== "netflix.com" && host !== "www.netflix.com") return null;
  const match = parsed.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/(\d{4,12})\/?$/i);
  if (!match) return null;
  return `https://www.netflix.com/watch/${match[1]}`;
}

function normTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_\-:+：]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type NetflixCandidate = { title: string; year: number | null; urls: string[] };

export function pickNetflixTitle(titles: string[], year: number | null, candidates: NetflixCandidate[]): string | null {
  const wanted = titles.map(normTitle).filter((title) => title.length >= 2);
  let best: { url: string; score: number } | null = null;
  for (const candidate of candidates) {
    const name = normTitle(candidate.title);
    let score = 0;
    for (const title of wanted) {
      if (name === title) score = Math.max(score, 1000);
    }
    if (!score) continue;
    if (year && candidate.year && candidate.year !== year) score -= 400;
    if (year && candidate.year === year) score += 50;
    const url = candidate.urls.map((item) => normalizeNetflixTitleUrl(item)).find((item): item is string => Boolean(item));
    if (!url || score < 1000) continue;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url || null;
}

export function netflixTitleFromLinks(links: { site?: string | null; url?: string | null }[]): string | null {
  for (const link of links) {
    const site = link.site || "";
    const url = link.url || "";
    if (!/netflix/i.test(site) && !/netflix\.com/i.test(url)) continue;
    const title = normalizeNetflixTitleUrl(url);
    if (title) return title;
  }
  return null;
}

export function netflixWatchesFromStreams(episodes: { title?: string | null; url?: string | null; site?: string | null }[]): { number: number; url: string }[] {
  const watches: { number: number; url: string }[] = [];
  const seen = new Set<number>();
  for (const episode of episodes) {
    if (!/netflix/i.test(episode.site || "") && !/netflix\.com/i.test(episode.url || "")) continue;
    const url = normalizeNetflixWatchUrl(episode.url || "");
    const match = (episode.title || "").match(/episode\s*0*(\d{1,4})/i);
    if (!url || !match) continue;
    const number = Number(match[1]);
    if (number < 1 || seen.has(number)) continue;
    seen.add(number);
    watches.push({ number, url });
  }
  return watches;
}

type FoundNetflix = { url: string; source: "anilist" | "justwatch"; watches: { number: number; url: string }[] };

async function anilistNetflix(anilistId: number): Promise<FoundNetflix | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        externalLinks { site url }
        streamingEpisodes { title url site }
      }
    }`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { id: anilistId } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`AniList lookup failed (${res.status})`);
  const body = (await res.json()) as {
    data?: {
      Media?: {
        title?: { romaji?: string | null; english?: string | null; native?: string | null };
        seasonYear?: number | null;
        externalLinks?: { site?: string | null; url?: string | null }[];
        streamingEpisodes?: { title?: string | null; url?: string | null; site?: string | null }[];
      } | null;
    };
  };
  const media = body.data?.Media;
  if (!media) return null;
  const watches = netflixWatchesFromStreams(media.streamingEpisodes || []);
  const url = netflixTitleFromLinks(media.externalLinks || []);
  if (!url) return { url: "", source: "anilist", watches };
  return { url, source: "anilist", watches };
}

async function justWatchNetflix(titles: string[], year: number | null): Promise<string | null> {
  const queryTitle = titles.find((title) => /[A-Za-z]/.test(title)) || titles[0];
  if (!queryTitle) return null;
  const query = `
    query ($country: Country!, $language: Language!, $filter: TitleFilter) {
      popularTitles(country: $country, filter: $filter, first: 8) {
        edges {
          node {
            content(country: $country, language: $language) { title originalReleaseYear }
            offers(country: $country, platform: WEB, filter: { packages: ["nfx", "nfa"] }) { standardWebURL }
          }
        }
      }
    }`;
  const res = await fetch("https://apis.justwatch.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        country: "JP",
        language: "en",
        filter: { searchQuery: queryTitle, objectTypes: ["SHOW"] },
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Netflix catalog lookup failed (${res.status})`);
  const body = (await res.json()) as {
    data?: {
      popularTitles?: {
        edges?: {
          node?: {
            content?: { title?: string | null; originalReleaseYear?: number | null };
            offers?: { standardWebURL?: string | null }[];
          };
        }[];
      };
    };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  const candidates: NetflixCandidate[] = [];
  for (const edge of body.data?.popularTitles?.edges || []) {
    const node = edge.node;
    if (!node?.content?.title) continue;
    candidates.push({
      title: node.content.title,
      year: node.content.originalReleaseYear || null,
      urls: (node.offers || []).map((offer) => offer.standardWebURL || "").filter(Boolean),
    });
  }
  return pickNetflixTitle(titles, year, candidates);
}

export async function lookupNetflixTitle(input: { anilistId: number | null; titles: string[]; year: number | null }): Promise<FoundNetflix | null> {
  let watches: { number: number; url: string }[] = [];
  let anilistFailed = false;
  if (input.anilistId) {
    try {
      const fromAniList = await anilistNetflix(input.anilistId);
      watches = fromAniList?.watches || [];
      if (fromAniList?.url) return { url: fromAniList.url, source: "anilist", watches };
    } catch (error) {
      anilistFailed = true;
      console.error("AniList Netflix links failed", error);
    }
  }
  try {
    const url = await justWatchNetflix(input.titles, input.year);
    if (url) return { url, source: "justwatch", watches };
  } catch (error) {
    if (anilistFailed || !input.anilistId) throw error;
    console.error("JustWatch Netflix lookup failed", error);
    throw error;
  }
  return null;
}

export async function ensureSeriesNetflix(series: SeriesSummary): Promise<SeriesSummary> {
  if (series.netflixSource) return series;
  try {
    const found = await lookupNetflixTitle({
      anilistId: series.anilistId,
      titles: [series.title, series.titleRomaji || "", series.titleNative || ""].filter(Boolean),
      year: series.year,
    });
    if (found?.watches.length) saveNetflixWatches(series.id, found.watches);
    return setSeriesNetflix(series.id, found?.url || null, found?.source || "none");
  } catch (error) {
    console.error(`Netflix lookup failed for series ${series.id}`, error);
    return series;
  }
}
