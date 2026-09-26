import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { fetchAniList, searchAniList } from "./anilist.ts";
import { queueEpisodeAudio, ensureLineAudio } from "./audio.ts";
import { appPassword, installAuth } from "./auth.ts";
import { audioDir, host, jimakuKey, llmName, port, rootDir, sampleDir } from "./config.ts";
import {
  addKnown,
  audioPaths,
  addUniqueStoryCards,
  cardCounts,
  cardLemmas,
  cardsForExport,
  createSeries,
  deleteSeries,
  findSampleSeries,
  getCardRow,
  getDb,
  getEpisode,
  getNewsState,
  getNewsStory,
  getSeries,
  getSubtitle,
  knownLemmas,
  listDueCards,
  listEpisodes,
  listKnown,
  listNewsDays,
  listNewsStories,
  listSeries,
  nextEpisodeNumber,
  newsCardCount,
  removeKnown,
  replaceTaught,
  saveNewsLesson,
  saveCard,
  getStudySettings,
  listSubtitleJobs,
  saveLesson,
  saveStudySettings,
  stats,
  storedFromRow,
  syncCards,
  taughtSets,
  type NewsStoryRecord,
} from "./db.ts";
import { cardsToApkg, cardsToCsv } from "./export.ts";
import { downloadJimakuFile, listJimakuFiles, searchJimaku } from "./jimaku.ts";
import { buildLesson } from "./lesson.ts";
import { ensureNewsAudio } from "./newsAudio.ts";
import { ensureFresh, lessonForStory, refreshNews, startNewsScheduler } from "./newsFeed.ts";
import { articleCues, tokyoDay, tokyoDayOffset } from "./newsParse.ts";
import { isFuriganaMode, isPassageLength, isStudyLevel } from "./level.ts";
import { loadDictionaries } from "./dictionary.ts";
import { describeTts, safeTtsName } from "./tts.ts";
import { voices } from "./config.ts";
import { filesFromUpload, guessEpisodeNumber, parseSubtitle } from "./subtitles.ts";
import { intervalLabels, reviewCard } from "./srs.ts";
import { loadTokenizer } from "./tokenizer.ts";
import type { MediaType, NewsDetail, NewsList, ReviewCard } from "../shared/types.ts";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 40 },
});

function paramNumber(value: string | string[] | undefined, min: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < min) throw new HttpError(400, "Missing id");
  return id;
}

function paramId(value: string | string[] | undefined): number {
  return paramNumber(value, 1);
}

async function clearEpisodeAudio(episodeId: number): Promise<void> {
  let names: string[] = [];
  try {
    names = await fs.readdir(audioDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(`line-${episodeId}-`) || name.startsWith(`episode-${episodeId}-`))
      .map((name) => fs.rm(path.join(audioDir, name), { force: true })),
  );
}

async function ingestSubtitle(input: {
  seriesId: number;
  number: number;
  filename: string;
  text: string;
  title?: string | null;
}): Promise<number> {
  const cues = parseSubtitle(input.text, input.filename);
  if (!cues.length) throw new HttpError(400, `No dialogue lines found in ${input.filename}.`);
  if (cues.length > 2500) throw new HttpError(400, "That subtitle file has too many lines.");
  const taught = taughtSets(input.seriesId, input.number);
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
    seriesId: input.seriesId,
    number: input.number,
    title: input.title || null,
    filename: path.basename(input.filename),
    subtitleText: input.text,
    cueCount: cues.length,
    lesson,
  });
  replaceTaught(
    input.seriesId,
    input.number,
    lesson.vocabulary.map((item) => item.lemma),
    lesson.grammar.map((item) => item.id),
  );
  syncCards(episodeId, input.seriesId, lesson.vocabulary);
  await clearEpisodeAudio(episodeId);
  queueEpisodeAudio(episodeId);
  return episodeId;
}

function toReviewCard(row: NonNullable<ReturnType<typeof getCardRow>>): ReviewCard {
  const card = storedFromRow(row);
  return {
    id: row.id,
    lemma: row.lemma,
    reading: row.reading,
    meaning: row.meaning,
    pos: row.pos,
    jlpt: row.jlpt,
    exampleJp: row.example_jp,
    exampleEn: row.example_en,
    seriesId: row.series_id,
    seriesTitle: row.series_title,
    episodeNumber: row.episode_number,
    episodeTitle: row.series_format === "news" ? row.episode_title : null,
    reps: row.reps,
    intervals: intervalLabels(card),
  };
}

function splitParagraphs(text: string | null): string[] {
  return (text || "").split(/\n\n/).map((part) => part.trim()).filter(Boolean);
}

function newsCard(story: NewsStoryRecord) {
  return {
    id: story.id,
    title: story.title,
    category: story.category,
    readingMinutes: story.readingMinutes,
    level: story.lessonLevel,
    publishedAt: story.publishedAt,
    hasEnglish: story.englishSource !== "none" && Boolean(story.bodyEn),
    englishSource: story.englishSource,
  };
}

async function newsList(day: string, error: string | null): Promise<NewsList> {
  const state = getNewsState();
  const message = error || state.message || null;
  return {
    day,
    today: tokyoDay(new Date()),
    days: listNewsDays(tokyoDayOffset(new Date(), -30)),
    error: message || null,
    refreshedAt: state.ranAt,
    stories: listNewsStories(day).map(newsCard),
  };
}

async function newsDetail(id: number): Promise<NewsDetail> {
  let story = getNewsStory(id);
  if (!story) throw new HttpError(404, "Story not found");
  if (!story.lesson) {
    saveNewsLesson(story.id, await lessonForStory(story));
    story = getNewsStory(id) || story;
  }
  const settings = getStudySettings();
  const lesson = story.lesson;
  return {
    ...newsCard(story),
    url: story.url,
    titleEn: story.titleEn,
    paragraphsJa: splitParagraphs(story.bodyJa),
    paragraphsEn: splitParagraphs(story.bodyEn),
    englishNote: story.englishNote,
    englishUrl: story.englishUrl,
    lesson,
    levelStale: Boolean(lesson && (lesson.level !== settings.level || lesson.passage !== settings.passage)),
    cardCount: newsCardCount(story.id),
    audioJa: Boolean(story.audioJaPath),
    audioEn: Boolean(story.audioEnPath),
  };
}

async function main() {
  getDb();
  await Promise.all([loadDictionaries(), loadTokenizer()]);

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  installAuth(app);

  app.get("/api/config", (_req, res) => {
    res.json({
      llm: llmName(),
      tts: describeTts(),
      jimaku: Boolean(jimakuKey()),
      voices: { ja: voices.ja, en: voices.en },
      ttsProvider: safeTtsName(),
    });
  });

  app.get("/api/stats", (_req, res) => {
    res.json(stats());
  });

  app.get("/api/anilist/search", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) throw new HttpError(400, "Type at least two characters.");
    res.json(await searchAniList(q));
  });

  app.get("/api/series", (_req, res) => {
    res.json(listSeries());
  });

  app.post("/api/series", async (req, res) => {
    const body = req.body || {};
    if (body.source === "anilist") {
      const media = await fetchAniList(Number(body.anilistId));
      if (!media) throw new HttpError(404, "AniList did not return that series.");
      const count = media.episodes && media.episodes > 0 ? Math.min(media.episodes, 200) : 12;
      const series = createSeries({
        title: media.title,
        titleNative: media.native,
        titleRomaji: media.romaji,
        coverUrl: media.coverUrl,
        synopsis: media.synopsis,
        episodeCount: count,
        mediaType: "anime",
        anilistId: media.id,
        year: media.year,
        format: media.format,
      });
      res.status(201).json(series);
      return;
    }
    const title = String(body.title || "").trim();
    if (!title) throw new HttpError(400, "Give the series a title.");
    const mediaType: MediaType = body.mediaType === "drama" ? "drama" : "anime";
    const episodeCount = Math.max(0, Math.min(500, Number(body.episodeCount) || 0));
    const series = createSeries({
      title,
      titleNative: String(body.titleNative || "").trim() || null,
      coverUrl: String(body.coverUrl || "").trim() || null,
      synopsis: String(body.synopsis || "").trim() || null,
      episodeCount: episodeCount || null,
      mediaType,
      year: body.year ? Number(body.year) : null,
      format: mediaType === "drama" ? "TV" : "TV",
    });
    res.status(201).json(series);
  });

  app.post("/api/series/sample", async (_req, res) => {
    const existing = findSampleSeries();
    if (existing) {
      res.json(existing);
      return;
    }
    const series = createSeries({
      title: "ホームの朝",
      titleNative: "ホームの朝",
      titleRomaji: "Hoomu no Asa",
      synopsis: "An original practice scene: two friends on a Tokyo morning, then again after work. Not from a broadcast show.",
      episodeCount: 2,
      mediaType: "anime",
      format: "original",
      sample: true,
    });
    const files = [
      { number: 1, name: "episode-01-morning-platform.ja.srt", title: "The platform" },
      { number: 2, name: "episode-02-after-work.ja.srt", title: "After work" },
    ];
    for (const file of files) {
      const text = await fs.readFile(path.join(sampleDir, file.name), "utf8");
      await ingestSubtitle({
        seriesId: series.id,
        number: file.number,
        filename: file.name,
        text,
        title: file.title,
      });
    }
    res.status(201).json(getSeries(series.id));
  });

  app.get("/api/series/:id", (req, res) => {
    const series = getSeries(paramId(req.params.id));
    if (!series) throw new HttpError(404, "Series not found");
    res.json({ series, episodes: listEpisodes(series.id) });
  });

  app.delete("/api/series/:id", (req, res) => {
    deleteSeries(paramId(req.params.id));
    res.status(204).end();
  });

  app.post("/api/series/:id/subtitles", upload.array("files", 40), async (req, res) => {
    const seriesId = paramId(req.params.id);
    if (!getSeries(seriesId)) throw new HttpError(404, "Series not found");
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length) throw new HttpError(400, "Choose a subtitle file or a zip.");
    const forced = Number(req.body?.episodeNumber);
    const collected: { name: string; text: string }[] = [];
    try {
      for (const file of files) {
        const extracted = await filesFromUpload(file.originalname, file.buffer);
        collected.push(...extracted);
      }
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Upload failed");
    }
    if (!collected.length) throw new HttpError(400, "No subtitle files were inside that upload.");
    let cursor = nextEpisodeNumber(seriesId);
    const planned = collected.map((file) => ({
      ...file,
      number: files.length === 1 && Number.isInteger(forced) && forced > 0 ? forced : guessEpisodeNumber(file.name),
    }));
    for (const item of planned) {
      if (item.number) continue;
      while (planned.some((other) => other.number === cursor)) cursor += 1;
      item.number = cursor;
      cursor += 1;
    }
    planned.sort((a, b) => (a.number || 0) - (b.number || 0));
    const episodes = [];
    for (const item of planned) {
      const id = await ingestSubtitle({
        seriesId,
        number: item.number || 1,
        filename: item.name,
        text: item.text,
      });
      episodes.push({ id, number: item.number });
    }
    res.status(201).json({ episodes });
  });

  app.get("/api/jimaku/search", async (req, res) => {
    const anilistId = Number(req.query.anilistId) || undefined;
    const query = String(req.query.q || "").trim();
    const anime = req.query.anime === "false" ? false : true;
    res.json(await searchJimaku({ query: query || undefined, anilistId, anime }));
  });

  app.get("/api/jimaku/entries/:id/files", async (req, res) => {
    const episode = Number(req.query.episode) || undefined;
    res.json(await listJimakuFiles(paramId(req.params.id), episode));
  });

  app.post("/api/series/:id/jimaku", async (req, res) => {
    const seriesId = paramId(req.params.id);
    if (!getSeries(seriesId)) throw new HttpError(404, "Series not found");
    const fileUrl = String(req.body?.fileUrl || "");
    const episodeNumber = Number(req.body?.episodeNumber);
    if (!fileUrl || !episodeNumber) throw new HttpError(400, "Choose a Jimaku file and an episode number.");
    const downloaded = await downloadJimakuFile(fileUrl);
    const extracted = await filesFromUpload(downloaded.filename, downloaded.buffer);
    if (!extracted.length) throw new HttpError(400, "That Jimaku file did not contain a text subtitle.");
    const target = extracted.find((file) => guessEpisodeNumber(file.name) === episodeNumber) || extracted[0];
    const id = await ingestSubtitle({
      seriesId,
      number: episodeNumber,
      filename: target.name,
      text: target.text,
    });
    res.status(201).json({ id, number: episodeNumber });
  });

  app.get("/api/settings", (_req, res) => {
    res.json(getStudySettings());
  });

  const writeSettings = (req: Request, res: Response) => {
    const current = getStudySettings();
    const level = isStudyLevel(String(req.body?.level || "")) ? String(req.body.level) : current.level;
    const passage = isPassageLength(String(req.body?.passage || "")) ? String(req.body.passage) : current.passage;
    const furigana = isFuriganaMode(String(req.body?.furigana || "")) ? String(req.body.furigana) : current.furigana;
    if (!isStudyLevel(level) || !isPassageLength(passage) || !isFuriganaMode(furigana)) {
      throw new HttpError(400, "Unknown level setting.");
    }
    res.json(saveStudySettings({ level, passage, furigana }));
  };
  app.put("/api/settings", writeSettings);
  app.post("/api/settings", writeSettings);

  app.post("/api/lessons/rebuild", async (_req, res) => {
    const jobs = listSubtitleJobs();
    const ids: number[] = [];
    for (const job of jobs) {
      ids.push(
        await ingestSubtitle({
          seriesId: job.seriesId,
          number: job.number,
          filename: job.filename,
          text: job.text,
          title: job.title,
        }),
      );
    }
    res.json({ rebuilt: ids.length });
  });

  app.get("/api/episodes/:id", (req, res) => {
    const episode = getEpisode(paramId(req.params.id));
    if (!episode) throw new HttpError(404, "Episode not found");
    const settings = getStudySettings();
    const lesson = episode.lesson;
    const levelStale = Boolean(lesson) && (lesson?.level !== settings.level || lesson?.passage !== settings.passage);
    const { cuesJson: _cues, ...detail } = episode;
    res.json({ ...detail, levelStale });
  });

  app.post("/api/episodes/:id/rebuild", async (req, res) => {
    const episodeId = paramId(req.params.id);
    const subtitle = getSubtitle(episodeId);
    if (!subtitle) throw new HttpError(400, "This episode has no subtitle to rebuild from.");
    const id = await ingestSubtitle({
      seriesId: subtitle.seriesId,
      number: subtitle.number,
      filename: subtitle.filename,
      text: subtitle.text,
    });
    const rebuilt = getEpisode(id);
    if (!rebuilt) throw new HttpError(404, "Episode not found");
    const settings = getStudySettings();
    const levelStale =
      Boolean(rebuilt.lesson) && (rebuilt.lesson?.level !== settings.level || rebuilt.lesson?.passage !== settings.passage);
    const { cuesJson: _cues, ...detail } = rebuilt;
    res.json({ ...detail, levelStale });
  });

  app.post("/api/episodes/:id/audio", (req, res) => {
    const episode = getEpisode(paramId(req.params.id));
    if (!episode?.lesson) throw new HttpError(400, "Build a lesson before generating audio.");
    queueEpisodeAudio(episode.id);
    res.status(202).json({ ok: true });
  });

  app.get("/api/episodes/:id/audio/:kind", (req, res) => {
    const episodeId = paramId(req.params.id);
    const kind = req.params.kind === "vocab" ? "vocab" : "dialogue";
    const paths = audioPaths(episodeId);
    const file = kind === "vocab" ? paths.vocab : paths.dialogue;
    if (!file) throw new HttpError(404, "Audio is not ready yet.");
    res.sendFile(file);
  });

  app.get("/api/episodes/:id/lines/:index/audio", async (req, res) => {
    const file = await ensureLineAudio(paramId(req.params.id), paramNumber(req.params.index, 0));
    res.sendFile(file);
  });

  app.get("/api/review", (req, res) => {
    const seriesId = Number(req.query.seriesId) || null;
    const level = getStudySettings().level;
    const rows = listDueCards(seriesId, 20, level);
    const counts = cardCounts(seriesId, level);
    res.json({
      cards: rows.map(toReviewCard),
      dueCount: counts.due,
      totalCount: counts.total,
      nextDue: counts.nextDue,
    });
  });

  app.post("/api/review/:id", (req, res) => {
    const row = getCardRow(paramId(req.params.id));
    if (!row) throw new HttpError(404, "Card not found");
    const rating = Number(req.body?.rating);
    const updated = reviewCard(storedFromRow(row), rating);
    saveCard(row.id, updated);
    const fresh = getCardRow(row.id);
    if (!fresh) throw new HttpError(404, "Card not found");
    res.json(toReviewCard(fresh));
  });

  app.get("/api/series/:id/export.csv", (req, res) => {
    const series = getSeries(paramId(req.params.id));
    if (!series) throw new HttpError(404, "Series not found");
    const csv = cardsToCsv(cardsForExport({ seriesId: series.id }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="yomu-${series.id}.csv"`);
    res.send(csv);
  });

  app.get("/api/episodes/:id/export.csv", (req, res) => {
    const episode = getEpisode(paramId(req.params.id));
    if (!episode) throw new HttpError(404, "Episode not found");
    const csv = cardsToCsv(cardsForExport({ episodeId: episode.id }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="yomu-ep-${episode.number}.csv"`);
    res.send(csv);
  });

  app.get("/api/series/:id/export.apkg", async (req, res) => {
    const series = getSeries(paramId(req.params.id));
    if (!series) throw new HttpError(404, "Series not found");
    const cards = cardsForExport({ seriesId: series.id });
    if (!cards.length) throw new HttpError(400, "No cards to export yet.");
    const buffer = await cardsToApkg(`Yomu — ${series.title}`, cards);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="yomu-${series.id}.apkg"`);
    res.send(buffer);
  });

  app.get("/api/known", (_req, res) => {
    res.json(listKnown());
  });

  app.post("/api/known", (req, res) => {
    const lemma = String(req.body?.lemma || "").trim();
    if (!lemma) throw new HttpError(400, "Missing word");
    const reading = String(req.body?.reading || "").trim() || null;
    addKnown(lemma, reading);
    res.status(201).json({ ok: true });
  });

  app.delete("/api/known", (req, res) => {
    const lemma = String(req.body?.lemma || "").trim();
    if (!lemma) throw new HttpError(400, "Missing word");
    removeKnown(lemma);
    res.status(204).end();
  });

  app.get("/api/news", async (req, res) => {
    const fresh = await ensureFresh();
    const requested = typeof req.query.day === "string" ? req.query.day : "";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : tokyoDay(new Date());
    res.json(await newsList(day, fresh?.message || null));
  });

  app.post("/api/news/refresh", async (_req, res) => {
    const fresh = await refreshNews();
    res.json(await newsList(tokyoDay(new Date()), fresh.message));
  });

  app.get("/api/news/:id", async (req, res) => {
    res.json(await newsDetail(paramId(req.params.id)));
  });

  app.post("/api/news/:id/rebuild", async (req, res) => {
    const story = getNewsStory(paramId(req.params.id));
    if (!story) throw new HttpError(404, "Story not found");
    const paragraphs = story.bodyJa.split(/\n\n/).map((part) => part.trim()).filter(Boolean);
    const settings = getStudySettings();
    const lesson = await buildLesson({
      cues: articleCues(story.title, paragraphs),
      known: knownLemmas(),
      taughtVocab: cardLemmas(),
      taughtGrammar: new Set(),
      level: settings.level,
      passage: settings.passage,
    });
    saveNewsLesson(story.id, lesson);
    res.json(await newsDetail(story.id));
  });

  app.post("/api/news/:id/cards", (req, res) => {
    const story = getNewsStory(paramId(req.params.id));
    if (!story?.lesson) throw new HttpError(400, "Open the story before adding words.");
    res.json(addUniqueStoryCards(story.id, story.title, story.lesson.vocabulary));
  });

  app.get("/api/news/:id/audio/:lang", async (req, res) => {
    const lang = req.params.lang === "en" ? "en" : req.params.lang === "ja" ? "ja" : null;
    if (!lang) throw new HttpError(400, "Choose Japanese or English audio.");
    const story = getNewsStory(paramId(req.params.id));
    if (!story) throw new HttpError(404, "Story not found");
    if (lang === "en" && !story.bodyEn) {
      throw new HttpError(404, "No English audio for this story. There is no English article to read aloud.");
    }
    try {
      res.sendFile(await ensureNewsAudio(story.id, lang));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not make the audio";
      throw new HttpError(502, message);
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (process.env.NODE_ENV === "production") {
    const clientDir = path.join(rootDir, "dist/client");
    app.use(
      express.static(clientDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
          if (filePath.endsWith(`${path.sep}sw.js`)) res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(clientDir, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Something went wrong";
    if (status >= 500) console.error(error);
    res.status(status).json({ error: message });
  });

  startNewsScheduler();

  app.listen(port, host, () => {
    const llm = llmName();
    console.log(`Yomu is running at http://localhost:${port}`);
    console.log(llm === "none" ? "Lessons: dictionary glosses and built-in grammar (no LLM key)." : `Lessons: ${llm} plus the dictionary.`);
    console.log(`Audio: ${describeTts()}.`);
    console.log(jimakuKey() ? "Jimaku: on." : "Jimaku: off (set JIMAKU_API_KEY to search subtitles).");
    console.log(appPassword() ? "Access: password required." : "Access: open (set APP_PASSWORD before putting this on the internet).");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
