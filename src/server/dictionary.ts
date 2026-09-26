import fs from "node:fs/promises";
import path from "node:path";
import { dictDir } from "./config.ts";
import { ensureDictFiles } from "../../scripts/download-dicts.ts";
import { kataToHira, isKanaWord } from "./kana.ts";
import type { KanjiInfo } from "../shared/types.ts";

type DictEntry = {
  kanji: string[];
  kana: string[];
  glosses: string[];
  pos: string[];
};

type RawWord = {
  kanji?: { text: string }[];
  kana?: { text: string }[];
  sense?: {
    partOfSpeech?: string[];
    misc?: string[];
    gloss?: { lang?: string; text: string }[];
  }[];
};

type RawKanji = {
  literal: string;
  misc?: { grade?: number | null };
  readingMeaning?: {
    groups?: {
      readings?: { type: string; value: string }[];
      meanings?: { lang?: string; value: string }[];
    }[];
  };
};

const SKIP_MISC = new Set(["arch", "obsc", "rare"]);

let ready: Promise<void> | null = null;
const byKanji = new Map<string, DictEntry[]>();
const byKana = new Map<string, DictEntry[]>();
const jlptByExpr = new Map<string, string>();
const kanjiByChar = new Map<string, KanjiInfo>();

function push(map: Map<string, DictEntry[]>, key: string, entry: DictEntry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function glossesOf(word: RawWord): { glosses: string[]; pos: string[] } {
  const glosses: string[] = [];
  const pos = new Set<string>();
  for (const sense of word.sense || []) {
    for (const code of sense.partOfSpeech || []) pos.add(code);
    const misc = sense.misc || [];
    if (misc.some((tag) => SKIP_MISC.has(tag)) && glosses.length > 0) continue;
    for (const gloss of sense.gloss || []) {
      if (gloss.lang && gloss.lang !== "eng") continue;
      const text = gloss.text?.trim();
      if (!text || glosses.includes(text)) continue;
      glosses.push(text.length > 90 ? `${text.slice(0, 87)}…` : text);
      if (glosses.length >= 3) return { glosses, pos: [...pos] };
    }
  }
  return { glosses, pos: [...pos] };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function loadJlpt() {
  const order = ["n1", "n2", "n3", "n4", "n5"];
  for (const level of order) {
    const text = await fs.readFile(path.join(dictDir, `${level}.csv`), "utf8");
    const rows = parseCsv(text);
    for (const [expression, reading] of rows.slice(1)) {
      if (!expression || expression === "expression") continue;
      const label = level.toUpperCase();
      jlptByExpr.set(expression, label);
      if (reading) jlptByExpr.set(`${expression}\t${reading}`, label);
    }
  }
}

function firstReadings(readings: { type: string; value: string }[] | undefined, type: string): string[] {
  const values: string[] = [];
  for (const reading of readings || []) {
    if (reading.type !== type) continue;
    const value = reading.value.replace(/^-/, "").replace(/\..*$/, "");
    if (!value || values.includes(value)) continue;
    values.push(value);
    if (values.length >= 2) break;
  }
  return values;
}

export function loadDictionaries(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureDictFiles();
      const started = Date.now();
      const jm = JSON.parse(await fs.readFile(path.join(dictDir, "jmdict-eng-common.json"), "utf8")) as {
        words: RawWord[];
      };
      for (const word of jm.words) {
        const { glosses, pos } = glossesOf(word);
        if (glosses.length === 0) continue;
        const entry: DictEntry = {
          kanji: (word.kanji || []).map((item) => item.text),
          kana: (word.kana || []).map((item) => item.text),
          glosses,
          pos,
        };
        for (const kanji of entry.kanji) push(byKanji, kanji, entry);
        for (const kana of entry.kana) push(byKana, kataToHira(kana), entry);
      }
      const kn = JSON.parse(await fs.readFile(path.join(dictDir, "kanjidic2-en.json"), "utf8")) as {
        characters: RawKanji[];
      };
      for (const character of kn.characters) {
        const group = character.readingMeaning?.groups?.[0];
        const meanings = (group?.meanings || [])
          .filter((item) => !item.lang || item.lang === "en")
          .map((item) => item.value)
          .slice(0, 3);
        kanjiByChar.set(character.literal, {
          char: character.literal,
          meanings,
          on: firstReadings(group?.readings, "ja_on"),
          kun: firstReadings(group?.readings, "ja_kun"),
          grade: character.misc?.grade ?? null,
        });
      }
      await loadJlpt();
      console.log(
        `Dictionaries ready in ${Date.now() - started}ms (${byKanji.size} kanji keys, ${kanjiByChar.size} characters).`,
      );
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

function prefixLen(a: string, b: string): number {
  let count = 0;
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) break;
    count += 1;
  }
  return count;
}

export function lookupWord(lemma: string, reading: string): DictEntry | null {
  const readingHira = kataToHira(reading || "");
  const pools = [
    ...(byKanji.get(lemma) || []),
    ...(byKana.get(kataToHira(lemma)) || []),
    ...(readingHira ? byKana.get(readingHira) || [] : []),
  ];
  let best: DictEntry | null = null;
  let bestScore = 0;
  const seen = new Set<DictEntry>();
  for (const entry of pools) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    let score = 0;
    if (entry.kanji.includes(lemma) || entry.kana.some((kana) => kataToHira(kana) === kataToHira(lemma))) score += 5;
    if (readingHira) {
      const overlap = Math.max(...entry.kana.map((kana) => prefixLen(kataToHira(kana), readingHira)), 0);
      if (entry.kana.some((kana) => kataToHira(kana) === readingHira)) score += 6;
      else score += overlap;
    }
    if (entry.kanji[0] === lemma) score += 1;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function bestReading(lemma: string, surfaceReading: string): string {
  const entry = lookupWord(lemma, surfaceReading);
  if (!entry || entry.kana.length === 0) return kataToHira(surfaceReading);
  const reading = kataToHira(surfaceReading);
  let best = kataToHira(entry.kana[0]);
  let bestScore = -1;
  for (const kana of entry.kana) {
    const hira = kataToHira(kana);
    const score = hira === reading ? 100 : prefixLen(hira, reading);
    if (score > bestScore) {
      best = hira;
      bestScore = score;
    }
  }
  return best;
}

export function lookupKanji(char: string): KanjiInfo | null {
  return kanjiByChar.get(char) || null;
}

export function jlptOf(lemma: string, reading: string): string | null {
  const exact = jlptByExpr.get(lemma);
  if (exact) return exact;
  if (reading) {
    const paired = jlptByExpr.get(`${lemma}\t${reading}`) || jlptByExpr.get(`${lemma}\t${kataToHira(reading)}`);
    if (paired) return paired;
  }
  if (isKanaWord(lemma)) return jlptByExpr.get(kataToHira(lemma)) || null;
  return null;
}

export function friendlyPos(pos: string, detail: string, codes: string[]): string {
  if (detail === "固有名詞") return "name";
  if (detail === "形容動詞語幹" || codes.includes("adj-na")) return "な-adjective";
  if (codes.includes("v1")) return "ichidan verb";
  if (codes.some((code) => code.startsWith("v5") || code === "vk" || code === "vs-i")) return "godan verb";
  if (codes.includes("adj-i") || pos === "形容詞") return "い-adjective";
  if (pos === "副詞" || codes.includes("adv")) return "adverb";
  if (pos === "接続詞") return "conjunction";
  if (pos === "感動詞") return "interjection";
  if (pos === "動詞") return "verb";
  if (pos === "名詞") return "noun";
  return "word";
}
