import { jimakuKey } from "./config.ts";
import {
  getSeries,
  getStudySettings,
  getSubtitleByNumber,
  getSubtitleFetch,
  knownLemmas,
  listEpisodeSubtitleState,
  listRunningSubtitleFetches,
  replaceTaught,
  saveLesson,
  saveSubtitleText,
  setSubtitleFetch,
  syncCards,
  taughtSets,
  type SubtitleFetchState,
} from "./db.ts";
import { downloadJimakuFile, listJimakuFiles, searchJimaku } from "./jimaku.ts";
import { ARCHIVE_DOWN, findKitsunekkoChoice, mapSubtitleFiles, subtitlesFromPack, unpackArchive } from "./kitsunekko.ts";
import { buildLesson } from "./lesson.ts";
import { chooseSubtitlePack, looksJapanese, type RemoteSub, type SubtitleChoice } from "./subtitleMatch.ts";
import { filesFromUpload, guessEpisodeNumber, parseSubtitle } from "./subtitles.ts";

const jobs: { seriesId: number; number: number }[] = [];
const remaining = new Map<number, number>();
let pumping = false;
const starting = new Set<number>();

export function startAutoSubtitles(seriesId: number, onlyNumber?: number): SubtitleFetchState {
  const series = getSeries(seriesId);
  if (!series) throw new Error("Series not found");
  if (starting.has(seriesId) || (remaining.get(seriesId) || 0) > 0) return getSubtitleFetch(seriesId);
  starting.add(seriesId);
  const total = listEpisodeSubtitleState(seriesId).length || series.episodeCount || 0;
  setSubtitleFetch(seriesId, { status: "running", message: "Looking for Japanese subtitles…", matched: 0, total, source: null });
  void runFetch(seriesId, onlyNumber)
    .catch((error) => {
      console.error(`Subtitle fetch failed for series ${seriesId}`, error);
      const message = error instanceof Error && /fetch|network|ENOTFOUND|timed out|listing failed|download failed/i.test(error.message)
        ? ARCHIVE_DOWN
        : error instanceof Error
          ? error.message
          : ARCHIVE_DOWN;
      setSubtitleFetch(seriesId, { status: "error", message });
    })
    .finally(() => starting.delete(seriesId));
  return getSubtitleFetch(seriesId);
}

async function runFetch(seriesId: number, onlyNumber?: number): Promise<void> {
  const series = getSeries(seriesId);
  if (!series) throw new Error("Series not found");
  const state = listEpisodeSubtitleState(seriesId);
  const total = state.length || series.episodeCount || 0;
  if (!total) {
    setSubtitleFetch(seriesId, { status: "error", message: "This series has no episodes to attach subtitles to.", total: 0 });
    return;
  }
  const missing = state.filter((episode) => !episode.hasSubtitle).map((episode) => episode.number);
  const targets = onlyNumber ? missing.filter((number) => number === onlyNumber) : missing;
  const titles = [series.title, series.titleNative, series.titleRomaji].filter((title): title is string => Boolean(title));
  let matched = 0;
  let source: string | null = null;
  if (targets.length) {
    const found = await collectSubtitles({
      anilistId: series.anilistId,
      titles,
      anime: series.mediaType !== "drama",
      wanted: total,
      targets,
    });
    source = found.source;
    for (const number of targets) {
      const file = found.episodes.get(number);
      if (!file) continue;
      if (saveSubtitleText({ seriesId, number, filename: file.name, text: file.text })) matched += 1;
    }
    matched = listEpisodeSubtitleState(seriesId).filter((episode) => episode.hasSubtitle).length;
    if (!matched) {
      setSubtitleFetch(seriesId, {
        status: "error",
        source,
        matched: 0,
        total,
        message: found.source ? "No Japanese subtitle set was found for this series." : ARCHIVE_DOWN,
      });
      return;
    }
  }
  const pending = listEpisodeSubtitleState(seriesId)
    .filter((episode) => episode.hasSubtitle && !episode.hasLesson && (!onlyNumber || episode.number === onlyNumber))
    .map((episode) => episode.number);
  if (!pending.length) {
    setSubtitleFetch(seriesId, {
      status: "done",
      source,
      matched,
      total,
      message: matched ? `${countReady(seriesId)} of ${total} ready` : "Those episodes already have subtitles.",
    });
    return;
  }
  setSubtitleFetch(seriesId, { status: "running", source, matched: matched || pending.length, total, message: `${countReady(seriesId)} of ${total} ready` });
  enqueue(seriesId, pending);
}

async function collectSubtitles(input: {
  anilistId: number | null;
  titles: string[];
  anime: boolean;
  wanted: number;
  targets: number[];
}): Promise<{ source: string | null; episodes: Map<number, { name: string; text: string }> }> {
  const episodes = new Map<number, { name: string; text: string }>();
  const sources: string[] = [];
  if (jimakuKey() && input.anilistId) {
    try {
      const choice = await jimakuChoice(input.anilistId, input.titles, input.anime, input.wanted);
      if (choice) {
        const mapped = await subtitlesFromJimaku(choice, input.wanted);
        for (const number of input.targets) {
          const file = mapped.get(number);
          if (file) episodes.set(number, file);
        }
        if (episodes.size) sources.push("jimaku");
      }
    } catch (error) {
      console.error("Jimaku subtitle search failed", error);
    }
  }
  const still = input.targets.filter((number) => !episodes.has(number));
  if (still.length) {
    try {
      const choice = await findKitsunekkoChoice(input.titles, input.wanted);
      if (choice) {
        const mapped = await subtitlesFromPack(choice, input.wanted);
        for (const number of still) {
          const file = mapped.get(number);
          if (file) episodes.set(number, file);
        }
        if (still.some((number) => episodes.has(number))) sources.push("kitsunekko");
      }
    } catch (error) {
      console.error("Kitsunekko subtitle search failed", error);
      if (!episodes.size) throw error;
    }
  }
  return { source: sources.join("+") || null, episodes };
}

export async function jimakuChoice(anilistId: number, titles: string[], anime: boolean, wanted: number): Promise<SubtitleChoice | null> {
  const entries = await searchJimaku({ anilistId, anime });
  const entry = entries.find((item) => item.anilistId === anilistId) || entries[0];
  if (!entry) return null;
  const files = await listJimakuFiles(entry.id);
  const remote: RemoteSub[] = files.map((file) => ({ name: file.name, url: file.url }));
  return chooseSubtitlePack(remote, wanted, titles[0] || entry.englishName || entry.name, false);
}

async function subtitlesFromJimaku(choice: SubtitleChoice, wanted: number): Promise<Map<number, { name: string; text: string }>> {
  if (choice.kind === "archive") {
    const downloaded = await downloadJimakuFile(choice.file.url);
    const files = /\.zip$/i.test(downloaded.filename) ? await filesFromUpload(downloaded.filename, downloaded.buffer) : await unpackArchive(downloaded.filename, downloaded.buffer);
    return mapSubtitleFiles(files, wanted);
  }
  const mapped = new Map<number, { name: string; text: string }>();
  for (const file of choice.files) {
    const number = guessEpisodeNumber(file.name);
    if (!number || number > wanted || mapped.has(number)) continue;
    try {
      const downloaded = await downloadJimakuFile(file.url);
      const extracted = await filesFromUpload(downloaded.filename, downloaded.buffer);
      const picked = extracted.find((item) => guessEpisodeNumber(item.name) === number) || extracted[0];
      if (!picked || !looksJapanese(picked.text)) continue;
      mapped.set(number, { name: picked.name, text: picked.text });
    } catch (error) {
      console.error(`Jimaku file failed: ${file.name}`, error);
    }
  }
  return mapped;
}

function enqueue(seriesId: number, numbers: number[]): void {
  const fresh = numbers.filter((number) => !jobs.some((job) => job.seriesId === seriesId && job.number === number));
  fresh.sort((a, b) => a - b);
  remaining.set(seriesId, (remaining.get(seriesId) || 0) + fresh.length);
  jobs.push(...fresh.map((number) => ({ seriesId, number })));
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (jobs.length) {
      const job = jobs.shift();
      if (!job) break;
      try {
        await buildStoredLesson(job.seriesId, job.number);
      } catch (error) {
        console.error(`Lesson build failed for series ${job.seriesId} episode ${job.number}`, error);
      }
      const left = (remaining.get(job.seriesId) || 1) - 1;
      remaining.set(job.seriesId, left);
      const total = getSubtitleFetch(job.seriesId).total || listEpisodeSubtitleState(job.seriesId).length;
      const ready = countReady(job.seriesId);
      if (left <= 0) {
        remaining.delete(job.seriesId);
        setSubtitleFetch(job.seriesId, { status: "done", message: `${ready} of ${total} ready` });
      } else {
        setSubtitleFetch(job.seriesId, { status: "running", message: `${ready} of ${total} ready` });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    pumping = false;
    if (jobs.length) void pump();
  }
}

async function buildStoredLesson(seriesId: number, number: number): Promise<void> {
  const stored = getSubtitleByNumber(seriesId, number);
  if (!stored || stored.hasLesson) return;
  const cues = parseSubtitle(stored.text, stored.filename);
  if (!cues.length || cues.length > 2500) return;
  const taught = taughtSets(seriesId, number);
  const settings = getStudySettings();
  const lesson = await buildLesson({
    cues,
    known: knownLemmas(),
    taughtVocab: taught.vocab,
    taughtGrammar: taught.grammar,
    level: settings.level,
    passage: settings.passage,
  });
  const episodeId = saveLesson({
    seriesId,
    number,
    title: null,
    filename: stored.filename,
    subtitleText: stored.text,
    cueCount: cues.length,
    lesson,
  });
  replaceTaught(
    seriesId,
    number,
    lesson.vocabulary.map((item) => item.lemma),
    lesson.grammar.map((item) => item.id),
  );
  syncCards(episodeId, seriesId, lesson.vocabulary);
}

function countReady(seriesId: number): number {
  return listEpisodeSubtitleState(seriesId).filter((episode) => episode.hasLesson).length;
}

export function recoverSubtitleJobs(): void {
  for (const seriesId of listRunningSubtitleFetches()) {
    if (starting.has(seriesId) || (remaining.get(seriesId) || 0) > 0) continue;
    const state = listEpisodeSubtitleState(seriesId);
    const pending = state.filter((episode) => episode.hasSubtitle && !episode.hasLesson).map((episode) => episode.number);
    const total = getSubtitleFetch(seriesId).total || state.length;
    if (pending.length) {
      setSubtitleFetch(seriesId, { status: "running", total, message: `${countReady(seriesId)} of ${total} ready` });
      enqueue(seriesId, pending);
      continue;
    }
    const matched = state.filter((episode) => episode.hasSubtitle).length;
    if (matched) setSubtitleFetch(seriesId, { status: "done", matched, total, message: `${countReady(seriesId)} of ${total} ready` });
    else setSubtitleFetch(seriesId, { status: "idle", source: null, message: null, matched: 0, total });
  }
}

export async function countSourceMatches(input: {
  anilistId: number | null;
  titles: string[];
  anime: boolean;
  wanted: number;
}): Promise<{ jimaku: number | null; kitsunekko: number | null }> {
  let jimaku: number | null = null;
  if (jimakuKey() && input.anilistId) {
    const choice = await jimakuChoice(input.anilistId, input.titles, input.anime, input.wanted);
    jimaku = choice ? choice.coverage : 0;
  }
  let kitsunekko: number | null = null;
  try {
    const choice = await findKitsunekkoChoice(input.titles, input.wanted);
    if (!choice) kitsunekko = 0;
    else if (choice.kind === "files") kitsunekko = choice.files.filter((file) => {
      const number = guessEpisodeNumber(file.name);
      return number !== null && number <= input.wanted;
    }).length;
    else {
      const mapped = await subtitlesFromPack(choice, input.wanted);
      kitsunekko = mapped.size;
    }
  } catch (error) {
    console.error(error);
    kitsunekko = null;
  }
  return { jimaku, kitsunekko };
}
