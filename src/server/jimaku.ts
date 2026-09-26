import { jimakuKey } from "./config.ts";
import { guessEpisodeNumber } from "./subtitles.ts";
import type { JimakuEntry, JimakuFile } from "../shared/types.ts";

type RawEntry = {
  id: number;
  name: string;
  english_name?: string | null;
  japanese_name?: string | null;
  anilist_id?: number | null;
  flags?: { anime?: boolean };
};

type RawFile = {
  name: string;
  size: number;
  url: string;
};

function authHeaders(): HeadersInit {
  const key = jimakuKey();
  if (!key) throw new Error("Set JIMAKU_API_KEY to search Jimaku.");
  return { Authorization: key, Accept: "application/json" };
}

async function jimakuGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new Error("Jimaku rejected the API key.");
  if (res.status === 429) throw new Error("Jimaku rate limit reached. Wait a moment and try again.");
  if (!res.ok) throw new Error(`Jimaku request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function searchJimaku(input: { query?: string; anilistId?: number; anime?: boolean }): Promise<JimakuEntry[]> {
  const params = new URLSearchParams();
  params.set("anime", input.anime === false ? "false" : "true");
  if (input.anilistId) params.set("anilist_id", String(input.anilistId));
  if (input.query) params.set("query", input.query);
  const entries = await jimakuGet<RawEntry[]>(`https://jimaku.cc/api/entries/search?${params}`);
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    englishName: entry.english_name || null,
    japaneseName: entry.japanese_name || null,
    anilistId: entry.anilist_id || null,
    anime: entry.flags?.anime !== false,
  }));
}

export async function listJimakuFiles(entryId: number, episode?: number): Promise<JimakuFile[]> {
  const params = new URLSearchParams();
  if (episode) params.set("episode", String(episode));
  const suffix = params.size ? `?${params}` : "";
  const files = await jimakuGet<RawFile[]>(`https://jimaku.cc/api/entries/${entryId}/files${suffix}`);
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    url: file.url,
    episodeGuess: guessEpisodeNumber(file.name),
  }));
}

export async function downloadJimakuFile(url: string): Promise<{ filename: string; buffer: Buffer }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("jimaku.cc")) {
    throw new Error("Refusing to download that file. Jimaku downloads stay on jimaku.cc.");
  }
  const res = await fetch(parsed, { headers: authHeaders(), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Jimaku download failed (${res.status})`);
  const filename = decodeURIComponent(parsed.pathname.split("/").pop() || "subtitle.srt");
  return { filename, buffer: Buffer.from(await res.arrayBuffer()) };
}
