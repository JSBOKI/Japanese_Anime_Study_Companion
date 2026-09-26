import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dbPath, dataDir } from "./config.ts";
import type {
  EpisodeSummary,
  KnownWord,
  Lesson,
  SeriesSummary,
  Stats,
  StudyLevel,
  StudySettings,
  VocabItem,
} from "../shared/types.ts";
import { DEFAULT_FURIGANA, DEFAULT_LEVEL, DEFAULT_PASSAGE, isFuriganaMode, isPassageLength, isStudyLevel, levelRank } from "./level.ts";
import { emptyStoredCard, fromStored, toStored, type StoredCard } from "./srs.ts";
import type { Card } from "ts-fsrs";

export type EpisodeRecord = EpisodeSummary & {
  seriesTitle: string;
  seriesNative: string | null;
  lesson: Lesson | null;
  cuesJson: string | null;
};

let database: DatabaseSync | null = null;

function now(): string {
  return new Date().toISOString();
}

export function getDb(): DatabaseSync {
  if (database) return database;
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      title_native TEXT,
      title_romaji TEXT,
      cover_url TEXT,
      synopsis TEXT,
      episode_count INTEGER,
      media_type TEXT NOT NULL DEFAULT 'anime',
      anilist_id INTEGER,
      year INTEGER,
      format TEXT,
      sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT,
      subtitle_name TEXT,
      subtitle_text TEXT,
      cues_json TEXT,
      lesson_json TEXT,
      lesson_generated_at TEXT,
      cue_count INTEGER NOT NULL DEFAULT 0,
      new_word_count INTEGER NOT NULL DEFAULT 0,
      audio_status TEXT NOT NULL DEFAULT 'idle',
      audio_error TEXT,
      audio_progress TEXT,
      audio_dialogue_path TEXT,
      audio_vocab_path TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(series_id, number)
    );
    CREATE TABLE IF NOT EXISTS known_words (
      lemma TEXT PRIMARY KEY,
      reading TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      lemma TEXT NOT NULL,
      reading TEXT NOT NULL,
      meaning TEXT NOT NULL,
      pos TEXT,
      jlpt TEXT,
      example_jp TEXT,
      example_en TEXT,
      due TEXT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      elapsed_days REAL NOT NULL,
      scheduled_days REAL NOT NULL,
      learning_steps INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      state INTEGER NOT NULL,
      last_review TEXT,
      UNIQUE(episode_id, lemma)
    );
    CREATE TABLE IF NOT EXISTS taught_items (
      series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      episode_number INTEGER NOT NULL,
      kind TEXT NOT NULL,
      item_key TEXT NOT NULL,
      PRIMARY KEY (series_id, episode_number, kind, item_key)
    );
    CREATE INDEX IF NOT EXISTS cards_due ON cards(due);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL UNIQUE,
      day TEXT NOT NULL,
      published_at TEXT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      url TEXT,
      body_ja TEXT NOT NULL,
      body_en TEXT,
      title_en TEXT,
      english_source TEXT NOT NULL DEFAULT 'none',
      english_url TEXT,
      english_note TEXT,
      lesson_json TEXT,
      lesson_level TEXT,
      reading_minutes INTEGER NOT NULL DEFAULT 1,
      audio_ja_path TEXT,
      audio_en_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS news_stories_day ON news_stories(day);
    CREATE TABLE IF NOT EXISTS news_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_deep_dives (
      story_id INTEGER PRIMARY KEY REFERENCES news_stories(id) ON DELETE CASCADE,
      llm TEXT NOT NULL,
      note TEXT,
      reaction_note TEXT,
      sources_json TEXT NOT NULL,
      body_ja TEXT,
      body_en TEXT,
      lesson_json TEXT,
      lesson_level TEXT,
      audio_ja_path TEXT,
      audio_en_path TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_rollup_picks (
      story_id INTEGER PRIMARY KEY REFERENCES news_stories(id) ON DELETE CASCADE,
      include_deep INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_rollups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      speed REAL NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      parts_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("UPDATE episodes SET audio_status = 'idle', audio_progress = NULL WHERE audio_status = 'pending'").run();
  database = db;
  return db;
}

type SeriesRow = {
  id: number;
  title: string;
  title_native: string | null;
  title_romaji: string | null;
  cover_url: string | null;
  synopsis: string | null;
  episode_count: number | null;
  media_type: string;
  anilist_id: number | null;
  year: number | null;
  format: string | null;
  sample: number;
  created_at: string;
  lessons_ready: number;
  card_count: number;
  due_count: number;
};

function mapSeries(row: SeriesRow): SeriesSummary {
  return {
    id: row.id,
    title: row.title,
    titleNative: row.title_native,
    titleRomaji: row.title_romaji,
    coverUrl: row.cover_url,
    synopsis: row.synopsis,
    episodeCount: row.episode_count,
    mediaType: row.media_type === "drama" ? "drama" : "anime",
    anilistId: row.anilist_id,
    year: row.year,
    format: row.format,
    sample: Boolean(row.sample),
    createdAt: row.created_at,
    lessonsReady: row.lessons_ready || 0,
    cardCount: row.card_count || 0,
    dueCount: row.due_count || 0,
  };
}

const seriesSelect = `
  SELECT s.*,
    (SELECT COUNT(*) FROM episodes e WHERE e.series_id = s.id AND e.lesson_json IS NOT NULL) AS lessons_ready,
    (SELECT COUNT(*) FROM cards c WHERE c.series_id = s.id) AS card_count,
    (SELECT COUNT(*) FROM cards c WHERE c.series_id = s.id AND c.due <= ?) AS due_count
  FROM series s
`;

export function listSeries(): SeriesSummary[] {
  const rows = getDb().prepare(`${seriesSelect} WHERE COALESCE(s.format, '') != 'news' ORDER BY s.created_at DESC`).all(now()) as SeriesRow[];
  return rows.map(mapSeries);
}

export function getSeries(id: number): SeriesSummary | null {
  const row = getDb().prepare(`${seriesSelect} WHERE s.id = ?`).get(now(), id) as SeriesRow | undefined;
  return row ? mapSeries(row) : null;
}

export function findSampleSeries(): SeriesSummary | null {
  const row = getDb().prepare(`${seriesSelect} WHERE s.sample = 1 ORDER BY s.id LIMIT 1`).get(now()) as SeriesRow | undefined;
  return row ? mapSeries(row) : null;
}

export function createSeries(input: {
  title: string;
  titleNative?: string | null;
  titleRomaji?: string | null;
  coverUrl?: string | null;
  synopsis?: string | null;
  episodeCount?: number | null;
  mediaType: "anime" | "drama";
  anilistId?: number | null;
  year?: number | null;
  format?: string | null;
  sample?: boolean;
}): SeriesSummary {
  const db = getDb();
  const created = now();
  const info = db.prepare(
    `INSERT INTO series (title, title_native, title_romaji, cover_url, synopsis, episode_count, media_type, anilist_id, year, format, sample, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.title,
    input.titleNative || null,
    input.titleRomaji || null,
    input.coverUrl || null,
    input.synopsis || null,
    input.episodeCount || null,
    input.mediaType,
    input.anilistId || null,
    input.year || null,
    input.format || null,
    input.sample ? 1 : 0,
    created,
  );
  const id = Number(info.lastInsertRowid);
  const count = input.episodeCount || 0;
  const insert = db.prepare(
    `INSERT INTO episodes (series_id, number, title, created_at, audio_status) VALUES (?, ?, ?, ?, 'idle')`,
  );
  for (let number = 1; number <= count; number++) {
    insert.run(id, number, `Episode ${number}`, created);
  }
  const series = getSeries(id);
  if (!series) throw new Error("Could not create the series");
  return series;
}

export function deleteSeries(id: number): void {
  getDb().prepare("DELETE FROM series WHERE id = ?").run(id);
}

type EpisodeRow = {
  id: number;
  series_id: number;
  number: number;
  title: string | null;
  subtitle_name: string | null;
  lesson_json: string | null;
  lesson_generated_at: string | null;
  cue_count: number;
  new_word_count: number;
  audio_status: string;
  audio_error: string | null;
  audio_progress: string | null;
  audio_dialogue_path: string | null;
  audio_vocab_path: string | null;
  prev_generated: string | null;
  series_title?: string;
  series_native?: string | null;
};

function mapEpisode(row: EpisodeRow): EpisodeSummary {
  const stale = Boolean(
    row.lesson_generated_at && row.prev_generated && row.prev_generated > row.lesson_generated_at,
  );
  const status = row.audio_status === "pending" || row.audio_status === "ready" || row.audio_status === "error"
    ? row.audio_status
    : "idle";
  return {
    id: row.id,
    seriesId: row.series_id,
    number: row.number,
    title: row.title,
    subtitleName: row.subtitle_name,
    hasLesson: Boolean(row.lesson_json),
    cueCount: row.cue_count || 0,
    newWords: row.new_word_count || 0,
    audioStatus: status,
    audioProgress: row.audio_progress,
    audioError: row.audio_error,
    stale,
  };
}

const episodeSelect = `
  SELECT e.*,
    (SELECT MAX(p.lesson_generated_at) FROM episodes p WHERE p.series_id = e.series_id AND p.number < e.number) AS prev_generated
  FROM episodes e
`;

export function listEpisodes(seriesId: number): EpisodeSummary[] {
  const rows = getDb().prepare(`${episodeSelect} WHERE e.series_id = ? ORDER BY e.number`).all(seriesId) as EpisodeRow[];
  return rows.map(mapEpisode);
}

export function getEpisode(id: number): EpisodeRecord | null {
  const row = getDb().prepare(
    `SELECT e.*,
       (SELECT MAX(p.lesson_generated_at) FROM episodes p WHERE p.series_id = e.series_id AND p.number < e.number) AS prev_generated,
       s.title AS series_title,
       s.title_native AS series_native
     FROM episodes e
     JOIN series s ON s.id = e.series_id
     WHERE e.id = ?`,
  ).get(id) as (EpisodeRow & { series_title: string; series_native: string | null }) | undefined;
  if (!row) return null;
  let lesson: Lesson | null = null;
  if (row.lesson_json) {
    try {
      lesson = JSON.parse(row.lesson_json) as Lesson;
    } catch {
      lesson = null;
    }
  }
  return {
    ...mapEpisode(row),
    seriesTitle: row.series_title,
    seriesNative: row.series_native,
    lesson,
    cuesJson: null,
  };
}

export function saveLesson(input: {
  seriesId: number;
  number: number;
  title: string | null;
  filename: string;
  subtitleText: string;
  cueCount: number;
  lesson: Lesson;
}): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM episodes WHERE series_id = ? AND number = ?").get(input.seriesId, input.number) as
    | { id: number }
    | undefined;
  const lessonJson = JSON.stringify(input.lesson);
  const generated = input.lesson.generatedAt;
  const words = input.lesson.vocabulary.length;
  if (existing) {
    db.prepare(
      `UPDATE episodes
       SET title = COALESCE(?, title), subtitle_name = ?, subtitle_text = ?, lesson_json = ?, lesson_generated_at = ?,
           cue_count = ?, new_word_count = ?, audio_status = 'idle', audio_error = NULL, audio_progress = NULL,
           audio_dialogue_path = NULL, audio_vocab_path = NULL
       WHERE id = ?`,
    ).run(input.title, input.filename, input.subtitleText, lessonJson, generated, input.cueCount, words, existing.id);
    return existing.id;
  }
  const info = db.prepare(
    `INSERT INTO episodes (
      series_id, number, title, subtitle_name, subtitle_text, lesson_json, lesson_generated_at,
      cue_count, new_word_count, audio_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)`,
  ).run(
    input.seriesId,
    input.number,
    input.title || `Episode ${input.number}`,
    input.filename,
    input.subtitleText,
    lessonJson,
    generated,
    input.cueCount,
    words,
    now(),
  );
  const series = db.prepare("SELECT episode_count FROM series WHERE id = ?").get(input.seriesId) as { episode_count: number | null };
  if (!series.episode_count || series.episode_count < input.number) {
    db.prepare("UPDATE series SET episode_count = ? WHERE id = ?").run(input.number, input.seriesId);
  }
  return Number(info.lastInsertRowid);
}

export function setAudioState(
  episodeId: number,
  state: {
    status: "idle" | "pending" | "ready" | "error";
    error: string | null;
    progress: string | null;
    dialoguePath?: string | null;
    vocabPath?: string | null;
  },
): void {
  getDb().prepare(
    `UPDATE episodes
     SET audio_status = ?, audio_error = ?, audio_progress = ?,
         audio_dialogue_path = COALESCE(?, audio_dialogue_path),
         audio_vocab_path = COALESCE(?, audio_vocab_path)
     WHERE id = ?`,
  ).run(state.status, state.error, state.progress, state.dialoguePath ?? null, state.vocabPath ?? null, episodeId);
}

export function audioPaths(episodeId: number): { dialogue: string | null; vocab: string | null } {
  const row = getDb().prepare("SELECT audio_dialogue_path, audio_vocab_path FROM episodes WHERE id = ?").get(episodeId) as
    | { audio_dialogue_path: string | null; audio_vocab_path: string | null }
    | undefined;
  return { dialogue: row?.audio_dialogue_path || null, vocab: row?.audio_vocab_path || null };
}

export function knownLemmas(): Set<string> {
  const rows = getDb().prepare("SELECT lemma FROM known_words").all() as { lemma: string }[];
  return new Set(rows.map((row) => row.lemma));
}

export function listKnown(): KnownWord[] {
  const rows = getDb().prepare("SELECT lemma, reading, created_at FROM known_words ORDER BY created_at DESC").all() as {
    lemma: string;
    reading: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({ lemma: row.lemma, reading: row.reading, createdAt: row.created_at }));
}

export function addKnown(lemma: string, reading: string | null): void {
  const db = getDb();
  db.prepare("INSERT INTO known_words (lemma, reading, created_at) VALUES (?, ?, ?) ON CONFLICT(lemma) DO UPDATE SET reading = excluded.reading").run(
    lemma,
    reading,
    now(),
  );
  db.prepare("DELETE FROM cards WHERE lemma = ? AND reps = 0").run(lemma);
}

export function removeKnown(lemma: string): void {
  getDb().prepare("DELETE FROM known_words WHERE lemma = ?").run(lemma);
}

export function taughtSets(seriesId: number, beforeEpisode: number): { vocab: Set<string>; grammar: Set<string> } {
  const rows = getDb().prepare(
    "SELECT kind, item_key FROM taught_items WHERE series_id = ? AND episode_number < ?",
  ).all(seriesId, beforeEpisode) as { kind: string; item_key: string }[];
  const vocab = new Set<string>();
  const grammar = new Set<string>();
  for (const row of rows) {
    if (row.kind === "grammar") grammar.add(row.item_key);
    else vocab.add(row.item_key);
  }
  return { vocab, grammar };
}

export function replaceTaught(seriesId: number, episodeNumber: number, vocab: string[], grammar: string[]): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM taught_items WHERE series_id = ? AND episode_number = ?").run(seriesId, episodeNumber);
    const insert = db.prepare(
      "INSERT INTO taught_items (series_id, episode_number, kind, item_key) VALUES (?, ?, ?, ?)",
    );
    for (const key of vocab) insert.run(seriesId, episodeNumber, "vocab", key);
    for (const key of grammar) insert.run(seriesId, episodeNumber, "grammar", key);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function syncCards(episodeId: number, seriesId: number, vocab: VocabItem[]): void {
  const db = getDb();
  const fresh = emptyStoredCard();
  const statement = db.prepare(
    `INSERT INTO cards (
      episode_id, series_id, lemma, reading, meaning, pos, jlpt, example_jp, example_en,
      due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, lemma) DO UPDATE SET
      reading = excluded.reading,
      meaning = excluded.meaning,
      pos = excluded.pos,
      jlpt = excluded.jlpt,
      example_jp = excluded.example_jp,
      example_en = excluded.example_en`,
  );
  for (const item of vocab) {
    const meaning = item.glosses.join("; ") || "No common-dictionary gloss yet";
    statement.run(
      episodeId,
      seriesId,
      item.lemma,
      item.reading,
      meaning,
      item.pos,
      item.jlpt,
      item.example,
      item.exampleEn,
      fresh.due,
      fresh.stability,
      fresh.difficulty,
      fresh.elapsed_days,
      fresh.scheduled_days,
      fresh.learning_steps,
      fresh.reps,
      fresh.lapses,
      fresh.state,
      fresh.last_review,
    );
  }
}

type CardRow = StoredCard & {
  id: number;
  episode_id: number;
  series_id: number;
  lemma: string;
  reading: string;
  meaning: string;
  pos: string | null;
  jlpt: string | null;
  example_jp: string | null;
  example_en: string | null;
  series_title: string;
  series_format: string | null;
  episode_number: number;
  episode_title: string | null;
};

function levelSql(alias = "c"): string {
  return `(CASE ${alias}.jlpt WHEN 'N5' THEN 5 WHEN 'N4' THEN 4 WHEN 'N3' THEN 3 WHEN 'N2' THEN 2 WHEN 'N1' THEN 1 ELSE 0 END) <= ?`;
}

export function getStudySettings(): StudySettings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const level = map.get("level");
  const passage = map.get("passage");
  const furigana = map.get("furigana");
  return {
    level: level && isStudyLevel(level) ? level : DEFAULT_LEVEL,
    passage: passage && isPassageLength(passage) ? passage : DEFAULT_PASSAGE,
    furigana: furigana && isFuriganaMode(furigana) ? furigana : DEFAULT_FURIGANA,
  };
}

export function saveStudySettings(input: StudySettings): StudySettings {
  const db = getDb();
  const write = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  write.run("level", input.level);
  write.run("passage", input.passage);
  write.run("furigana", input.furigana);
  return getStudySettings();
}

export function listDueCards(seriesId: number | null, limit: number, level: StudyLevel = DEFAULT_LEVEL): CardRow[] {
  const params: (string | number)[] = [now(), levelRank(level)];
  let filter = "";
  if (seriesId) {
    filter = "AND c.series_id = ?";
    params.push(seriesId);
  }
  params.push(limit);
  return getDb().prepare(
    `SELECT c.*, s.title AS series_title, s.format AS series_format, e.number AS episode_number, e.title AS episode_title
     FROM cards c
     JOIN series s ON s.id = c.series_id
     JOIN episodes e ON e.id = c.episode_id
     WHERE c.due <= ? AND ${levelSql("c")} ${filter}
     ORDER BY c.due ASC
     LIMIT ?`,
  ).all(...params) as CardRow[];
}

export function cardCounts(seriesId: number | null, level: StudyLevel = DEFAULT_LEVEL): { due: number; total: number; nextDue: string | null } {
  const db = getDb();
  const rank = levelRank(level);
  const seriesSql = seriesId ? "AND series_id = ?" : "";
  const seriesParams = seriesId ? [seriesId] : [];
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${levelSql("cards")} ${seriesSql}`).get(rank, ...seriesParams) as { n: number }
  ).n;
  const due = (
    db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE due <= ? AND ${levelSql("cards")} ${seriesSql}`).get(now(), rank, ...seriesParams) as {
      n: number;
    }
  ).n;
  const next = db.prepare(`SELECT MIN(due) AS due FROM cards WHERE due > ? AND ${levelSql("cards")} ${seriesSql}`).get(
    now(),
    rank,
    ...seriesParams,
  ) as { due: string | null };
  return { due, total, nextDue: next.due };
}

export function getCardRow(id: number): CardRow | null {
  const row = getDb().prepare(
    `SELECT c.*, s.title AS series_title, s.format AS series_format, e.number AS episode_number, e.title AS episode_title
     FROM cards c JOIN series s ON s.id = c.series_id JOIN episodes e ON e.id = c.episode_id
     WHERE c.id = ?`,
  ).get(id) as CardRow | undefined;
  return row || null;
}

export function saveCard(id: number, card: Card): void {
  const stored = toStored(card);
  getDb().prepare(
    `UPDATE cards SET due=?, stability=?, difficulty=?, elapsed_days=?, scheduled_days=?, learning_steps=?, reps=?, lapses=?, state=?, last_review=?
     WHERE id = ?`,
  ).run(
    stored.due,
    stored.stability,
    stored.difficulty,
    stored.elapsed_days,
    stored.scheduled_days,
    stored.learning_steps,
    stored.reps,
    stored.lapses,
    stored.state,
    stored.last_review,
    id,
  );
}

export function storedFromRow(row: CardRow): Card {
  return fromStored(row);
}

export type ExportCard = {
  lemma: string;
  reading: string;
  meaning: string;
  pos: string | null;
  jlpt: string | null;
  exampleJp: string | null;
  exampleEn: string | null;
  seriesTitle: string;
  episodeNumber: number;
};

export function cardsForExport(filter: { seriesId?: number; episodeId?: number }): ExportCard[] {
  const clauses: string[] = [];
  const params: number[] = [];
  if (filter.seriesId) {
    clauses.push("c.series_id = ?");
    params.push(filter.seriesId);
  }
  if (filter.episodeId) {
    clauses.push("c.episode_id = ?");
    params.push(filter.episodeId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().prepare(
    `SELECT c.*, s.title AS series_title, e.number AS episode_number
     FROM cards c JOIN series s ON s.id = c.series_id JOIN episodes e ON e.id = c.episode_id
     ${where}
     ORDER BY e.number, c.lemma`,
  ).all(...params) as CardRow[];
  return rows.map((row) => ({
    lemma: row.lemma,
    reading: row.reading,
    meaning: row.meaning,
    pos: row.pos,
    jlpt: row.jlpt,
    exampleJp: row.example_jp,
    exampleEn: row.example_en,
    seriesTitle: row.series_title,
    episodeNumber: row.episode_number,
  }));
}

export function stats(): Stats {
  const db = getDb();
  const counts = cardCounts(null, getStudySettings().level);
  return {
    dueCount: counts.due,
    cardCount: counts.total,
    knownCount: (db.prepare("SELECT COUNT(*) AS n FROM known_words").get() as { n: number }).n,
    seriesCount: (db.prepare("SELECT COUNT(*) AS n FROM series WHERE COALESCE(format, '') != 'news'").get() as { n: number }).n,
  };
}

export function listSubtitleJobs(): { seriesId: number; number: number; title: string | null; filename: string; text: string }[] {
  const rows = getDb().prepare(
    `SELECT series_id, number, title, subtitle_name, subtitle_text
     FROM episodes
     WHERE subtitle_text IS NOT NULL AND subtitle_text != ''
     ORDER BY series_id, number`,
  ).all() as {
    series_id: number;
    number: number;
    title: string | null;
    subtitle_name: string | null;
    subtitle_text: string;
  }[];
  return rows.map((row) => ({
    seriesId: row.series_id,
    number: row.number,
    title: row.title,
    filename: row.subtitle_name || "episode.srt",
    text: row.subtitle_text,
  }));
}

export function getSubtitle(episodeId: number): { seriesId: number; number: number; filename: string; text: string } | null {
  const row = getDb().prepare(
    "SELECT series_id, number, subtitle_name, subtitle_text FROM episodes WHERE id = ?",
  ).get(episodeId) as
    | { series_id: number; number: number; subtitle_name: string | null; subtitle_text: string | null }
    | undefined;
  if (!row?.subtitle_text) return null;
  return {
    seriesId: row.series_id,
    number: row.number,
    filename: row.subtitle_name || "episode.srt",
    text: row.subtitle_text,
  };
}

export function nextEpisodeNumber(seriesId: number): number {
  const row = getDb().prepare("SELECT COALESCE(MAX(number), 0) AS n FROM episodes WHERE series_id = ?").get(seriesId) as {
    n: number;
  };
  return row.n + 1;
}

export function episodeHasSubtitle(seriesId: number, number: number): boolean {
  const row = getDb().prepare("SELECT subtitle_text FROM episodes WHERE series_id = ? AND number = ?").get(seriesId, number) as
    | { subtitle_text: string | null }
    | undefined;
  return Boolean(row?.subtitle_text);
}

export function cardLemmas(): Set<string> {
  const rows = getDb().prepare("SELECT DISTINCT lemma FROM cards").all() as { lemma: string }[];
  return new Set(rows.map((row) => row.lemma));
}

export function ensureNewsSeries(): number {
  const existing = getDb().prepare("SELECT id FROM series WHERE format = 'news' LIMIT 1").get() as { id: number } | undefined;
  if (existing) return existing.id;
  return createSeries({
    title: "ニュース",
    titleNative: "ニュース",
    mediaType: "anime",
    format: "news",
    synopsis: "Daily news readings",
  }).id;
}

export function ensureNewsEpisode(seriesId: number, storyId: number, title: string): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM episodes WHERE series_id = ? AND number = ?").get(seriesId, storyId) as
    | { id: number }
    | undefined;
  if (existing) {
    db.prepare("UPDATE episodes SET title = ? WHERE id = ?").run(title, existing.id);
    return existing.id;
  }
  const info = db.prepare(
    "INSERT INTO episodes (series_id, number, title, cue_count, new_word_count, audio_status, created_at) VALUES (?, ?, ?, 0, 0, 'idle', ?)",
  ).run(seriesId, storyId, title, now());
  return Number(info.lastInsertRowid);
}

export function addUniqueStoryCards(storyId: number, title: string, vocab: VocabItem[]): { added: number; skipped: number } {
  const seriesId = ensureNewsSeries();
  const episodeId = ensureNewsEpisode(seriesId, storyId, title);
  const existing = cardLemmas();
  const fresh = vocab.filter((item) => item.lemma && !existing.has(item.lemma));
  if (fresh.length) syncCards(episodeId, seriesId, fresh);
  return { added: fresh.length, skipped: vocab.length - fresh.length };
}

export function newsCardCount(storyId: number): number {
  const series = getDb().prepare("SELECT id FROM series WHERE format = 'news' LIMIT 1").get() as { id: number } | undefined;
  if (!series) return 0;
  const episode = getDb().prepare("SELECT id FROM episodes WHERE series_id = ? AND number = ?").get(series.id, storyId) as
    | { id: number }
    | undefined;
  if (!episode) return 0;
  return (getDb().prepare("SELECT COUNT(*) AS n FROM cards WHERE episode_id = ?").get(episode.id) as { n: number }).n;
}

export type NewsState = {
  ranAt: string | null;
  attemptedAt: string | null;
  status: string | null;
  message: string | null;
  storyCount: number;
};

export function getNewsState(): NewsState {
  const rows = getDb().prepare("SELECT key, value FROM news_state").all() as { key: string; value: string }[];
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    ranAt: map.get("ran_at") || null,
    attemptedAt: map.get("attempted_at") || null,
    status: map.get("status") || null,
    message: map.get("message") || null,
    storyCount: Number(map.get("story_count") || 0),
  };
}

export function setNewsState(patch: { ranAt?: string; attemptedAt?: string; status?: string; message?: string; storyCount?: number }): void {
  const write = getDb().prepare(
    "INSERT INTO news_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  if (patch.ranAt) write.run("ran_at", patch.ranAt);
  if (patch.attemptedAt) write.run("attempted_at", patch.attemptedAt);
  if (patch.status !== undefined) write.run("status", patch.status);
  if (patch.message !== undefined) write.run("message", patch.message);
  if (patch.storyCount !== undefined) write.run("story_count", String(patch.storyCount));
}

export type NewsStoryRecord = {
  id: number;
  sourceId: string;
  day: string;
  publishedAt: string | null;
  title: string;
  category: string;
  url: string | null;
  bodyJa: string;
  bodyEn: string | null;
  titleEn: string | null;
  englishSource: "llm" | "nhk-world" | "none";
  englishUrl: string | null;
  englishNote: string | null;
  lesson: Lesson | null;
  lessonLevel: StudyLevel | null;
  readingMinutes: number;
  audioJaPath: string | null;
  audioEnPath: string | null;
};

type NewsRow = {
  id: number;
  source_id: string;
  day: string;
  published_at: string | null;
  title: string;
  category: string;
  url: string | null;
  body_ja: string;
  body_en: string | null;
  title_en: string | null;
  english_source: string;
  english_url: string | null;
  english_note: string | null;
  lesson_json: string | null;
  lesson_level: string | null;
  reading_minutes: number;
  audio_ja_path: string | null;
  audio_en_path: string | null;
};

function mapNews(row: NewsRow): NewsStoryRecord {
  let lesson: Lesson | null = null;
  if (row.lesson_json) {
    try {
      lesson = JSON.parse(row.lesson_json) as Lesson;
    } catch {
      lesson = null;
    }
  }
  const source = row.english_source === "llm" || row.english_source === "nhk-world" ? row.english_source : "none";
  const level = row.lesson_level && isStudyLevel(row.lesson_level) ? row.lesson_level : null;
  return {
    id: row.id,
    sourceId: row.source_id,
    day: row.day,
    publishedAt: row.published_at,
    title: row.title,
    category: row.category,
    url: row.url,
    bodyJa: row.body_ja,
    bodyEn: row.body_en,
    titleEn: row.title_en,
    englishSource: source,
    englishUrl: row.english_url,
    englishNote: row.english_note,
    lesson,
    lessonLevel: level,
    readingMinutes: row.reading_minutes,
    audioJaPath: row.audio_ja_path,
    audioEnPath: row.audio_en_path,
  };
}

const newsColumns = `id, source_id, day, published_at, title, category, url, body_ja, body_en, title_en, english_source, english_url, english_note, lesson_json, lesson_level, reading_minutes, audio_ja_path, audio_en_path`;

export function listNewsStories(day: string): NewsStoryRecord[] {
  const rows = getDb().prepare(
    `SELECT ${newsColumns} FROM news_stories WHERE day = ? ORDER BY published_at DESC, id DESC`,
  ).all(day) as NewsRow[];
  return rows.map(mapNews);
}

export function listNewsDays(sinceDay: string): string[] {
  const rows = getDb().prepare(
    "SELECT DISTINCT day FROM news_stories WHERE day >= ? ORDER BY day DESC",
  ).all(sinceDay) as { day: string }[];
  return rows.map((row) => row.day);
}

export function getNewsStory(id: number): NewsStoryRecord | null {
  const row = getDb().prepare(`SELECT ${newsColumns} FROM news_stories WHERE id = ?`).get(id) as NewsRow | undefined;
  return row ? mapNews(row) : null;
}

export function upsertNewsStory(input: {
  sourceId: string;
  day: string;
  publishedAt: string | null;
  title: string;
  category: string;
  url: string | null;
  bodyJa: string;
  bodyEn: string | null;
  titleEn: string | null;
  englishSource: "llm" | "nhk-world" | "none";
  englishUrl: string | null;
  englishNote: string | null;
  lesson: Lesson | null;
  readingMinutes: number;
}): number {
  const db = getDb();
  const existing = db.prepare(
    "SELECT id, body_ja, english_source, body_en, title_en, english_url, english_note, lesson_json, lesson_level FROM news_stories WHERE source_id = ?",
  ).get(input.sourceId) as
    | {
        id: number;
        body_ja: string;
        english_source: string;
        body_en: string | null;
        title_en: string | null;
        english_url: string | null;
        english_note: string | null;
        lesson_json: string | null;
        lesson_level: string | null;
      }
    | undefined;
  const lessonJson = input.lesson ? JSON.stringify(input.lesson) : null;
  const lessonLevel = input.lesson?.level || null;
  const stamp = now();
  if (!existing) {
    const info = db.prepare(
      `INSERT INTO news_stories (
        source_id, day, published_at, title, category, url, body_ja, body_en, title_en, english_source, english_url, english_note,
        lesson_json, lesson_level, reading_minutes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sourceId,
      input.day,
      input.publishedAt,
      input.title,
      input.category,
      input.url,
      input.bodyJa,
      input.bodyEn,
      input.titleEn,
      input.englishSource,
      input.englishUrl,
      input.englishNote,
      lessonJson,
      lessonLevel,
      input.readingMinutes,
      stamp,
      stamp,
    );
    return Number(info.lastInsertRowid);
  }
  const bodyChanged = existing.body_ja !== input.bodyJa;
  const keepEnglish = input.englishSource === "none" && existing.english_source !== "none";
  db.prepare(
    `UPDATE news_stories SET
      published_at = ?, title = ?, category = ?, url = ?, body_ja = ?,
      body_en = ?, title_en = ?, english_source = ?, english_url = ?, english_note = ?,
      lesson_json = ?, lesson_level = ?, reading_minutes = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.publishedAt,
    input.title,
    input.category,
    input.url,
    input.bodyJa,
    keepEnglish ? existing.body_en : input.bodyEn,
    keepEnglish ? existing.title_en : input.titleEn,
    keepEnglish ? existing.english_source : input.englishSource,
    keepEnglish ? existing.english_url : input.englishUrl,
    keepEnglish ? existing.english_note : input.englishNote,
    bodyChanged ? lessonJson : existing.lesson_json,
    bodyChanged ? lessonLevel : existing.lesson_level,
    input.readingMinutes,
    stamp,
    existing.id,
  );
  return existing.id;
}

export function saveNewsLesson(id: number, lesson: Lesson): void {
  getDb().prepare("UPDATE news_stories SET lesson_json = ?, lesson_level = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(lesson),
    lesson.level,
    now(),
    id,
  );
}

export function setNewsAudioPath(id: number, lang: "ja" | "en", file: string): void {
  const column = lang === "ja" ? "audio_ja_path" : "audio_en_path";
  getDb().prepare(`UPDATE news_stories SET ${column} = ?, updated_at = ? WHERE id = ?`).run(file, now(), id);
}

export type DeepDiveRecord = {
  storyId: number;
  llm: string;
  note: string | null;
  reactionNote: string | null;
  sourcesJson: string;
  bodyJa: string | null;
  bodyEn: string | null;
  lesson: Lesson | null;
  lessonLevel: StudyLevel | null;
  audioJaPath: string | null;
  audioEnPath: string | null;
};

export function getDeepDive(storyId: number): DeepDiveRecord | null {
  const row = getDb().prepare(
    "SELECT story_id, llm, note, reaction_note, sources_json, body_ja, body_en, lesson_json, lesson_level, audio_ja_path, audio_en_path FROM news_deep_dives WHERE story_id = ?",
  ).get(storyId) as {
    story_id: number;
    llm: string;
    note: string | null;
    reaction_note: string | null;
    sources_json: string;
    body_ja: string | null;
    body_en: string | null;
    lesson_json: string | null;
    lesson_level: string | null;
    audio_ja_path: string | null;
    audio_en_path: string | null;
  } | undefined;
  if (!row) return null;
  let lesson: Lesson | null = null;
  if (row.lesson_json) {
    try {
      lesson = JSON.parse(row.lesson_json) as Lesson;
    } catch {
      lesson = null;
    }
  }
  return {
    storyId: row.story_id,
    llm: row.llm,
    note: row.note,
    reactionNote: row.reaction_note,
    sourcesJson: row.sources_json,
    bodyJa: row.body_ja,
    bodyEn: row.body_en,
    lesson,
    lessonLevel: row.lesson_level && isStudyLevel(row.lesson_level) ? row.lesson_level : null,
    audioJaPath: row.audio_ja_path,
    audioEnPath: row.audio_en_path,
  };
}

export function saveDeepDive(input: {
  storyId: number;
  llm: string;
  note: string | null;
  reactionNote: string | null;
  sourcesJson: string;
  bodyJa: string | null;
  bodyEn: string | null;
  lesson: Lesson | null;
}): void {
  getDb().prepare(
    `INSERT INTO news_deep_dives (
      story_id, llm, note, reaction_note, sources_json, body_ja, body_en, lesson_json, lesson_level, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id) DO UPDATE SET
      llm = excluded.llm, note = excluded.note, reaction_note = excluded.reaction_note,
      sources_json = excluded.sources_json, body_ja = excluded.body_ja, body_en = excluded.body_en,
      lesson_json = excluded.lesson_json, lesson_level = excluded.lesson_level,
      audio_ja_path = NULL, audio_en_path = NULL, updated_at = excluded.updated_at`,
  ).run(
    input.storyId,
    input.llm,
    input.note,
    input.reactionNote,
    input.sourcesJson,
    input.bodyJa,
    input.bodyEn,
    input.lesson ? JSON.stringify(input.lesson) : null,
    input.lesson?.level || null,
    now(),
  );
}

export function saveDeepLesson(storyId: number, lesson: Lesson): void {
  getDb().prepare("UPDATE news_deep_dives SET lesson_json = ?, lesson_level = ?, updated_at = ? WHERE story_id = ?").run(
    JSON.stringify(lesson),
    lesson.level,
    now(),
    storyId,
  );
}

export function setDeepAudioPath(storyId: number, lang: "ja" | "en", file: string): void {
  const column = lang === "ja" ? "audio_ja_path" : "audio_en_path";
  getDb().prepare(`UPDATE news_deep_dives SET ${column} = ?, updated_at = ? WHERE story_id = ?`).run(file, now(), storyId);
}

export type RollupPickRow = { storyId: number; title: string; includeDeep: boolean };

export function listRollupPicks(): RollupPickRow[] {
  const rows = getDb().prepare(
    `SELECT p.story_id, s.title, p.include_deep
     FROM news_rollup_picks p JOIN news_stories s ON s.id = p.story_id
     ORDER BY p.created_at, p.story_id`,
  ).all() as { story_id: number; title: string; include_deep: number }[];
  return rows.map((row) => ({ storyId: row.story_id, title: row.title, includeDeep: Boolean(row.include_deep) }));
}

export function setRollupPick(storyId: number, includeDeep: boolean): void {
  getDb().prepare(
    `INSERT INTO news_rollup_picks (story_id, include_deep, created_at) VALUES (?, ?, ?)
     ON CONFLICT(story_id) DO UPDATE SET include_deep = excluded.include_deep`,
  ).run(storyId, includeDeep ? 1 : 0, now());
}

export function clearRollupPick(storyId: number): void {
  getDb().prepare("DELETE FROM news_rollup_picks WHERE story_id = ?").run(storyId);
}

export function clearRollupPicks(): void {
  getDb().prepare("DELETE FROM news_rollup_picks").run();
}

export type RollupPartRecord = { index: number; file: string; seconds: number; bytes: number; label: string };

export function createRollup(lang: string, speed: number): number {
  const info = getDb().prepare(
    "INSERT INTO news_rollups (lang, speed, status, message, parts_json, created_at) VALUES (?, ?, 'running', ?, NULL, ?)",
  ).run(lang, speed, "Gathering the stories…", now());
  return Number(info.lastInsertRowid);
}

export function updateRollup(id: number, patch: { status?: string; message?: string | null; parts?: RollupPartRecord[] | null }): void {
  const current = getRollup(id);
  if (!current) return;
  getDb().prepare("UPDATE news_rollups SET status = ?, message = ?, parts_json = ? WHERE id = ?").run(
    patch.status || current.status,
    patch.message === undefined ? current.message : patch.message,
    patch.parts === undefined ? (current.parts.length ? JSON.stringify(current.parts) : null) : patch.parts ? JSON.stringify(patch.parts) : null,
    id,
  );
}

export function getRollup(id: number): { id: number; lang: string; speed: number; status: string; message: string | null; parts: RollupPartRecord[] } | null {
  const row = getDb().prepare("SELECT id, lang, speed, status, message, parts_json FROM news_rollups WHERE id = ?").get(id) as {
    id: number;
    lang: string;
    speed: number;
    status: string;
    message: string | null;
    parts_json: string | null;
  } | undefined;
  if (!row) return null;
  let parts: RollupPartRecord[] = [];
  if (row.parts_json) {
    try {
      parts = JSON.parse(row.parts_json) as RollupPartRecord[];
    } catch {
      parts = [];
    }
  }
  return { id: row.id, lang: row.lang, speed: row.speed, status: row.status, message: row.message, parts };
}

export function latestRollup(): { id: number; lang: string; speed: number; status: string; message: string | null; parts: RollupPartRecord[] } | null {
  const row = getDb().prepare("SELECT id FROM news_rollups ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  return row ? getRollup(row.id) : null;
}

export function pruneNewsStories(beforeDay: string): { id: number; audioJaPath: string | null; audioEnPath: string | null }[] {
  const rows = getDb().prepare(
    "SELECT id, audio_ja_path, audio_en_path FROM news_stories WHERE day < ?",
  ).all(beforeDay) as { id: number; audio_ja_path: string | null; audio_en_path: string | null }[];
  if (rows.length) getDb().prepare("DELETE FROM news_stories WHERE day < ?").run(beforeDay);
  return rows.map((row) => ({ id: row.id, audioJaPath: row.audio_ja_path, audioEnPath: row.audio_en_path }));
}
