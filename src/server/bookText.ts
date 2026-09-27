import type { LineToken, StudyLevel, VocabItem } from "../shared/types.ts";
import type { AozoraSpan } from "./aozoraParse.ts";
import { friendlyPos, jlptOf, lookupKanji, lookupWord } from "./dictionary.ts";
import { hasKanji, kanjiChars, kataToHira } from "./kana.ts";
import { readLine } from "./lesson.ts";
import { isEasierThan, vocabCap } from "./level.ts";
import type { StoredParagraph } from "./db.ts";
import { tokenize, type Token } from "./tokenizer.ts";

export function mergeAuthorRuby(tokens: LineToken[], spans: AozoraSpan[]): LineToken[] {
  const joined = tokens.map((token) => token.surface).join("");
  const spanText = spans.map((span) => span.base).join("");
  if (!spans.length || joined !== spanText) return tokens;
  let pos = 0;
  const located = spans.map((span) => {
    const start = pos;
    pos += span.base.length;
    return { ...span, start, end: pos };
  });
  const out: LineToken[] = [];
  let index = 0;
  let cursor = 0;
  while (index < tokens.length) {
    const span = located.find((item) => item.reading && item.start === cursor);
    if (span?.reading) {
      let acc = "";
      let end = index;
      while (end < tokens.length && acc.length < span.base.length) {
        acc += tokens[end].surface;
        end += 1;
      }
      if (acc === span.base) {
        const head = tokens[index];
        const reading = kataToHira(span.reading);
        out.push({
          ...head,
          surface: span.base,
          lemma: end === index + 1 ? head.lemma : span.base,
          reading,
          lemmaReading: reading,
          furigana: reading !== span.base,
        });
        index = end;
        cursor += span.base.length;
        continue;
      }
    }
    out.push(tokens[index]);
    cursor += tokens[index].surface.length;
    index += 1;
  }
  return out;
}

export function paragraphTokens(paragraph: StoredParagraph, level: StudyLevel): LineToken[] {
  const read = readLine(paragraph.text, level);
  return mergeAuthorRuby(read.tokens, paragraph.spans);
}

function keep(token: Token): boolean {
  if (!token.lemma || token.lemma === "*") return false;
  if (token.pos === "助詞" || token.pos === "助動詞" || token.pos === "記号" || token.pos === "接頭詞" || token.pos === "フィラー") {
    return false;
  }
  if (token.pos === "名詞" && (token.detail === "非自立" || token.detail === "接尾" || token.detail === "数")) return false;
  if (token.pos === "動詞" && token.detail !== "自立") return false;
  if (token.pos === "形容詞" && token.detail !== "自立") return false;
  if (token.surface.length === 1 && !hasKanji(token.surface) && token.pos !== "名詞") return false;
  return true;
}

type Row = {
  lemma: string;
  reading: string;
  pos: string;
  detail: string;
  count: number;
  surfaces: Map<string, number>;
  examples: string[];
};

export function bookVocabulary(paragraphs: StoredParagraph[], level: StudyLevel): VocabItem[] {
  const rows = new Map<string, Row>();
  for (const paragraph of paragraphs) {
    let cursor = 0;
    const spans = paragraph.spans;
    let spanPos = 0;
    const located = spans.map((span) => {
      const start = spanPos;
      spanPos += span.base.length;
      return { ...span, start, end: spanPos };
    });
    for (const token of tokenize(paragraph.text)) {
      const start = cursor;
      cursor += token.surface.length;
      if (!keep(token)) continue;
      const author = located.find((span) => span.reading && span.start === start && span.base === token.surface);
      const reading = kataToHira(author?.reading || token.reading);
      const jlpt = jlptOf(token.lemma, reading);
      if (isEasierThan(jlpt, level)) continue;
      const entry = lookupWord(token.lemma, reading);
      const glosses = entry?.glosses || (token.detail === "固有名詞" ? ["name"] : []);
      if (!glosses.length) continue;
      const key = `${token.lemma}\t${reading}`;
      const row = rows.get(key) || {
        lemma: token.lemma,
        reading,
        pos: token.pos,
        detail: token.detail,
        count: 0,
        surfaces: new Map<string, number>(),
        examples: [],
      };
      row.count += 1;
      row.surfaces.set(token.surface, (row.surfaces.get(token.surface) || 0) + 1);
      if (row.examples.length < 4) row.examples.push(paragraph.text);
      rows.set(key, row);
    }
  }
  const ranked = [...rows.values()]
    .map((row) => ({ row, score: scoreRow(row, level) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score || b.row.count - a.row.count)
    .slice(0, vocabCap(level));
  return ranked.map((item) => toVocab(item.row));
}

function scoreRow(row: Row, level: StudyLevel): number {
  const jlpt = jlptOf(row.lemma, row.reading);
  let score = row.count * 14;
  if (jlpt === level) score += 70;
  else if (jlpt && !isEasierThan(jlpt, level)) score += 48;
  else if (!jlpt) score += 20;
  if (hasKanji(row.lemma)) score += 10;
  if (row.detail === "固有名詞") score -= 8;
  return score;
}

function toVocab(row: Row): VocabItem {
  const entry = lookupWord(row.lemma, row.reading);
  let surface = row.lemma;
  let best = -1;
  for (const [name, count] of row.surfaces) {
    if (count > best) {
      surface = name;
      best = count;
    }
  }
  const example = [...row.examples].sort((a, b) => a.length - b.length)[0] || "";
  return {
    lemma: row.lemma,
    reading: row.reading,
    surface,
    glosses: entry?.glosses || (row.detail === "固有名詞" ? ["name"] : []),
    pos: friendlyPos(row.pos, row.detail, entry?.pos || []),
    jlpt: jlptOf(row.lemma, row.reading),
    count: row.count,
    example: example.length > 80 ? `${[...example].slice(0, 80).join("")}…` : example,
    exampleEn: "",
    kanji: [...new Set(kanjiChars(row.lemma))].slice(0, 4).map((char) => lookupKanji(char)).filter((item) => Boolean(item)) as VocabItem["kanji"],
  };
}
