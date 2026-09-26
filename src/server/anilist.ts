import type { AniListHit } from "../shared/types.ts";

const QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      episodes
      coverImage { large }
      description(asHtml: false)
      format
      seasonYear
    }
  }
}`;

type Media = {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  episodes: number | null;
  coverImage: { large: string | null } | null;
  description: string | null;
  format: string | null;
  seasonYear: number | null;
};

function plain(text: string | null): string | null {
  if (!text) return null;
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 500);
}

export async function searchAniList(search: string): Promise<AniListHit[]> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { search } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`AniList search failed (${res.status})`);
  const body = (await res.json()) as { data?: { Page?: { media?: Media[] } }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return (body.data?.Page?.media || []).map((media) => ({
    id: media.id,
    title: media.title.english || media.title.romaji || media.title.native || "Untitled",
    native: media.title.native,
    romaji: media.title.romaji,
    episodes: media.episodes,
    coverUrl: media.coverImage?.large || null,
    synopsis: plain(media.description),
    format: media.format,
    year: media.seasonYear,
  }));
}

export async function fetchAniList(id: number): Promise<AniListHit | null> {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        episodes
        coverImage { large }
        description(asHtml: false)
        format
        seasonYear
      }
    }`;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables: { id } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`AniList lookup failed (${res.status})`);
  const body = (await res.json()) as { data?: { Media?: Media | null } };
  const media = body.data?.Media;
  if (!media) return null;
  return {
    id: media.id,
    title: media.title.english || media.title.romaji || media.title.native || "Untitled",
    native: media.title.native,
    romaji: media.title.romaji,
    episodes: media.episodes,
    coverUrl: media.coverImage?.large || null,
    synopsis: plain(media.description),
    format: media.format,
    year: media.seasonYear,
  };
}
