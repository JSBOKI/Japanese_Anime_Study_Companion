import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { dataDir, llmName } from "./config.ts";
import {
  findInCatalog,
  lengthLabelFor,
  recommendedByCard,
  RECOMMENDED,
  searchCatalog,
  type CatalogWork,
} from "./aozoraCatalog.ts";
import { chapterLabel, decodeAozora, parseAozoraText, xhtmlToAozora } from "./aozoraParse.ts";
import { bookVocabulary, paragraphTokens } from "./bookText.ts";
import {
  addBookCards,
  bookChapterCount,
  getBook,
  getBookByCard,
  getBookChapter,
  getBookJob,
  getBookListen,
  getBookProgress,
  getStudySettings,
  listBookChapters,
  listBooks,
  replaceBookChapters,
  setBookLengthLabel,
  setBookProgress,
  setChapterTranslation,
  updateBookCopy,
  upsertBook,
  type BookRecord,
} from "./db.ts";
import { translateParagraphs } from "./llm.ts";
import type { BookChapterView, BookDetail, BookShelfItem } from "../shared/types.ts";

const CATALOG_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip";
const UA = "Mozilla/5.0 (compatible; Yomu/1.0; Japanese reading)";

export class BookError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let catalogText: string | null = null;
const opening = new Map<number, Promise<BookRecord>>();

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new BookError(502, `Aozora returned ${response.status} for this file.`);
  return Buffer.from(await response.arrayBuffer());
}

export async function loadCatalog(): Promise<string> {
  if (catalogText) return catalogText;
  const file = path.join(dataDir, "books", "list_person_all_extended_utf8.csv");
  try {
    const stat = await fs.stat(file);
    if (stat.size > 100_000) {
      catalogText = await fs.readFile(file, "utf8");
      return catalogText;
    }
  } catch {
    /* download the public catalog */
  }
  const zipBuf = await fetchBuffer(CATALOG_URL);
  const zip = await JSZip.loadAsync(zipBuf);
  const name = Object.keys(zip.files).find((entry) => entry.toLowerCase().endsWith(".csv"));
  if (!name) throw new BookError(502, "The Aozora catalog zip had no CSV.");
  const text = await zip.files[name].async("string");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  catalogText = text;
  return text;
}

async function workText(work: { cardId: number; textUrl: string | null; xhtmlUrl: string | null }): Promise<string> {
  const dir = path.join(dataDir, "books", "aozora", String(work.cardId));
  const cached = path.join(dir, "text.txt");
  try {
    const stat = await fs.stat(cached);
    if (stat.size > 20) return await fs.readFile(cached, "utf8");
  } catch {
    /* fetch */
  }
  await fs.mkdir(dir, { recursive: true });
  let text = "";
  if (work.textUrl) {
    const buf = await fetchBuffer(work.textUrl);
    const zipped = work.textUrl.toLowerCase().endsWith(".zip") || buf[0] === 0x50;
    if (zipped) {
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files).filter((entry) => entry.toLowerCase().endsWith(".txt") && !zip.files[entry].dir);
      if (!names.length) throw new BookError(502, "The Aozora zip had no text file.");
      names.sort((a, b) => Number(b.toLowerCase().includes("ruby")) - Number(a.toLowerCase().includes("ruby")));
      const raw = await zip.files[names[0]].async("uint8array");
      text = decodeAozora(Buffer.from(raw));
      await fs.writeFile(path.join(dir, "source.zip"), buf);
    } else {
      text = decodeAozora(buf);
    }
  }
  if (!text.trim() && work.xhtmlUrl) {
    const buf = await fetchBuffer(work.xhtmlUrl);
    text = xhtmlToAozora(decodeAozora(buf));
    await fs.writeFile(path.join(dir, "source.html"), buf);
  }
  if (!text.trim()) throw new BookError(502, "Aozora did not return a text for this work.");
  await fs.writeFile(cached, text);
  return text;
}

function remember(work: CatalogWork, recommended: boolean): BookRecord {
  const picked = recommendedByCard(work.cardId);
  return upsertBook({
    cardId: work.cardId,
    personId: work.personId,
    title: work.title,
    titleKana: work.titleKana,
    author: work.author,
    difficulty: picked?.difficulty || null,
    lengthLabel: picked?.lengthLabel || null,
    summary: picked?.summary || null,
    sourceUrl: work.sourceUrl,
    textUrl: work.textUrl,
    xhtmlUrl: work.xhtmlUrl,
    recommended,
  });
}

export async function ensureBook(cardId: number): Promise<BookRecord> {
  const pending = opening.get(cardId);
  if (pending) return pending;
  const job = openBook(cardId).finally(() => opening.delete(cardId));
  opening.set(cardId, job);
  return job;
}

async function openBook(cardId: number): Promise<BookRecord> {
  const recommended = recommendedByCard(cardId);
  let book = getBookByCard(cardId);
  if (!book) {
    if (recommended) book = remember(recommended, true);
    else {
      const found = findInCatalog(await loadCatalog(), cardId);
      if (!found) throw new BookError(404, "That work is not a public-domain Aozora text.");
      book = remember(found, false);
    }
  }
  if (recommended) {
    updateBookCopy(book.id, {
      difficulty: recommended.difficulty,
      lengthLabel: recommended.lengthLabel,
      summary: recommended.summary,
    });
    book = getBook(book.id) || book;
  }
  if (bookChapterCount(book.id) > 0) return getBook(book.id) || book;
  const text = await workText(book);
  const chapters = parseAozoraText(text);
  if (!chapters.length) throw new BookError(502, "This work had no chapters to read.");
  replaceBookChapters(book.id, chapters);
  const chars = chapters.reduce((sum, chapter) => sum + chapter.paragraphs.reduce((inner, paragraph) => inner + [...paragraph.text].length, 0), 0);
  if (!recommended) setBookLengthLabel(book.id, lengthLabelFor(chars));
  return getBook(book.id) || book;
}

function shelfItem(
  book: BookRecord | null,
  fallback: {
    cardId: number;
    title: string;
    titleKana: string | null;
    author: string;
    sourceUrl: string | null;
    difficulty?: string | null;
    lengthLabel?: string | null;
    summary?: string | null;
  },
): BookShelfItem {
  const progress = book ? getBookProgress(book.id) : null;
  const chapters = book ? listBookChapters(book.id) : [];
  const here = progress ? chapters.find((chapter) => chapter.index === progress.chapterIndex) : null;
  return {
    cardId: book?.cardId || fallback.cardId,
    title: book?.title || fallback.title,
    titleKana: book?.titleKana || fallback.titleKana,
    author: book?.author || fallback.author,
    difficulty: book?.difficulty || fallback.difficulty || null,
    lengthLabel: book?.lengthLabel || fallback.lengthLabel || null,
    summary: book?.summary || fallback.summary || null,
    recommended: book?.recommended || Boolean(recommendedByCard(fallback.cardId)),
    startHere: Boolean(recommendedByCard(book?.cardId || fallback.cardId)?.startHere),
    added: Boolean(book),
    chapterCount: chapters.length,
    sourceUrl: book?.sourceUrl || fallback.sourceUrl || null,
    progress: progress
      ? {
          chapterIndex: progress.chapterIndex,
          paragraphIndex: progress.paragraphIndex,
          chapterTitle: here ? chapterLabel(here.partTitle, here.title) : null,
        }
      : null,
  };
}

let shelfReady: Promise<void> | null = null;

/** Fetch and parse every recommended book so the shelf opens ready to read. */
export function warmRecommendedShelf(): Promise<void> {
  if (!shelfReady) {
    shelfReady = prepareShelf().catch((error) => {
      shelfReady = null;
      throw error;
    });
  }
  return shelfReady;
}

async function prepareShelf(): Promise<void> {
  const queue = [...RECOMMENDED];
  const failures: string[] = [];
  const workers = Array.from({ length: 2 }, async () => {
    while (queue.length) {
      const work = queue.shift();
      if (!work) return;
      try {
        const book = await ensureBook(work.cardId);
        const count = bookChapterCount(book.id);
        if (count < 1) throw new Error("no chapters");
        console.log(`Books: ${work.title} ready, ${count} chapters.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not prepare this book.";
        failures.push(`${work.title}: ${message}`);
        console.error(`Books: ${work.title} failed`, error);
      }
    }
  });
  await Promise.all(workers);
  if (failures.length) {
    throw new BookError(502, `These books are not ready to read. ${failures.join(" ")}`);
  }
}

export async function bookShelf(): Promise<{ books: BookShelfItem[]; llm: boolean }> {
  await warmRecommendedShelf();
  const saved = new Map(listBooks().map((book) => [book.cardId, book]));
  const books = RECOMMENDED.map((work) => shelfItem(saved.get(work.cardId) || null, work));
  for (const book of listBooks()) {
    if (RECOMMENDED.some((work) => work.cardId === book.cardId)) continue;
    books.push(shelfItem(book, book));
  }
  return { books, llm: llmName() !== "none" };
}

export async function searchBooks(query: string): Promise<(CatalogWork & { added: boolean; difficulty: string | null; lengthLabel: string | null })[]> {
  const needle = query.trim();
  if (!needle) return [];
  const hits = searchCatalog(await loadCatalog(), needle);
  const saved = new Map(listBooks().map((book) => [book.cardId, book]));
  return hits.map((hit) => {
    const known = saved.get(hit.cardId);
    const picked = recommendedByCard(hit.cardId);
    return {
      ...hit,
      added: Boolean(known) || Boolean(picked),
      difficulty: known?.difficulty || picked?.difficulty || null,
      lengthLabel: known?.lengthLabel || picked?.lengthLabel || null,
    };
  });
}

export async function addBook(cardId: number): Promise<BookShelfItem> {
  const book = await ensureBook(cardId);
  const picked = recommendedByCard(cardId);
  return shelfItem(book, picked || book);
}

export async function bookDetail(cardId: number): Promise<BookDetail> {
  const book = await ensureBook(cardId);
  const chapters = listBookChapters(book.id);
  return {
    cardId: book.cardId,
    title: book.title,
    titleKana: book.titleKana,
    author: book.author,
    difficulty: book.difficulty,
    lengthLabel: book.lengthLabel,
    summary: book.summary,
    startHere: Boolean(recommendedByCard(book.cardId)?.startHere),
    sourceUrl: book.sourceUrl,
    charCount: book.charCount,
    chapters: chapters.map((chapter) => ({
      index: chapter.index,
      partTitle: chapter.partTitle,
      title: chapter.title,
      label: chapterLabel(chapter.partTitle, chapter.title),
      charCount: chapter.charCount,
    })),
    progress: getBookProgress(book.id),
    job: getBookJob(book.id),
    llm: llmName() !== "none",
  };
}

export async function bookChapter(cardId: number, index: number): Promise<BookChapterView> {
  const book = await ensureBook(cardId);
  const chapter = getBookChapter(book.id, index);
  const chapters = listBookChapters(book.id);
  if (!chapter) throw new BookError(404, "That chapter is not in this book.");
  const level = getStudySettings().level;
  const listen = getBookListen(chapter.id);
  const hasKey = llmName() !== "none";
  return {
    cardId: book.cardId,
    title: book.title,
    author: book.author,
    index: chapter.index,
    partTitle: chapter.partTitle,
    chapterTitle: chapter.title,
    label: chapterLabel(chapter.partTitle, chapter.title),
    paragraphs: chapter.paragraphs.map((paragraph, paragraphIndex) => ({
      index: paragraphIndex,
      text: paragraph.text,
      tokens: paragraphTokens(paragraph, level),
      translation: chapter.translation?.[paragraphIndex] || null,
    })),
    translated: Boolean(chapter.translation?.length),
    translationNote: hasKey ? null : "English needs an OpenAI or Anthropic key on the server. The reading still works without it.",
    llm: hasKey,
    listenStatus: listen?.status || "idle",
    chapterCount: chapters.length,
    sourceUrl: book.sourceUrl,
  };
}

export async function saveReadingProgress(cardId: number, chapterIndex: number, paragraphIndex: number): Promise<void> {
  const book = await ensureBook(cardId);
  const chapters = listBookChapters(book.id);
  if (!chapters.some((chapter) => chapter.index === chapterIndex)) throw new BookError(404, "That chapter is not in this book.");
  setBookProgress(book.id, chapterIndex, paragraphIndex);
}

export async function addChapterCards(cardId: number, index: number): Promise<{ added: number; skipped: number }> {
  const book = await ensureBook(cardId);
  const chapter = getBookChapter(book.id, index);
  if (!chapter) throw new BookError(404, "That chapter is not in this book.");
  const vocab = bookVocabulary(chapter.paragraphs, getStudySettings().level);
  return addBookCards(book.id, index, vocab);
}

export async function translateChapter(cardId: number, index: number): Promise<{ translations: string[] | null; note: string | null }> {
  const book = await ensureBook(cardId);
  const chapter = getBookChapter(book.id, index);
  if (!chapter) throw new BookError(404, "That chapter is not in this book.");
  if (chapter.translation?.length) return { translations: chapter.translation, note: null };
  if (llmName() === "none") {
    return {
      translations: null,
      note: "English needs an OpenAI or Anthropic key on the server. The reading still works without it.",
    };
  }
  const translations = await translateParagraphs(chapter.paragraphs.map((paragraph) => paragraph.text));
  if (!translations) {
    return {
      translations: null,
      note: "English needs an OpenAI or Anthropic key on the server. The reading still works without it.",
    };
  }
  setChapterTranslation(chapter.id, translations);
  return { translations, note: null };
}
