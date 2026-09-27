import type { Cue } from "./subtitles.ts";
import { tokenize, type Token } from "./tokenizer.ts";
import { bestReading, friendlyPos, jlptOf, lookupKanji, lookupWord } from "./dictionary.ts";
import { hasKanji, kanjiChars } from "./kana.ts";
import {
  endersExplanation,
  endersIn,
  endersName,
  matchPatternIds,
  patternInRange,
  patternInfo,
  patternLevel,
} from "./grammar.ts";
import { llmName } from "./config.ts";
import { enrichLesson } from "./llm.ts";
import {
  DEFAULT_LEVEL,
  DEFAULT_PASSAGE,
  grammarCap,
  isEasierThan,
  isHarderThan,
  levelRank,
  revealEnglishByDefault,
  vocabCap,
  type StudyLevel,
} from "./level.ts";
import type { PassageLength } from "./level.ts";
import { buildPassages, composeProse } from "./passages.ts";
import type { GrammarItem, GrammarNote, Lesson, LessonLine, LineToken, ProseReading, ReviewVocab, VocabItem } from "../shared/types.ts";

const SKIP_LEMMAS = new Set(["の", "よう", "さん", "くん", "ちゃん", "さま", "様", "ちゃん"]);

const PARTICLE_GLOSS: Record<string, string> = {
  は: "topic marker",
  が: "subject marker, or the thing you want to single out",
  を: "object marker",
  に: "to, at, or a point in time",
  で: "place of an action, or means",
  と: "and, with, or a quotation",
  も: "also, even",
  へ: "toward",
  から: "from",
  まで: "until, as far as",
  より: "than",
  ね: "right? / seeking agreement",
  よ: "emphasis, new information",
  か: "question",
  な: "casual agreement",
  ぞ: "rough emphasis",
  ぜ: "rough emphasis",
  わ: "soft emphasis",
  さ: "casual emphasis",
  の: "of, or a soft ending",
  って: "casual topic or quotation",
  けど: "but",
  ば: "if",
  て: "て-form connector",
  で_te: "て-form connector",
};

type Accum = {
  lemma: string;
  reading: string;
  pos: string;
  detail: string;
  codes: string[];
  count: number;
  surfaces: Map<string, number>;
  examples: string[];
};

export async function buildLesson(input: {
  cues: Cue[];
  known: Set<string>;
  taughtVocab: Set<string>;
  taughtGrammar: Set<string>;
  level?: StudyLevel;
  passage?: PassageLength;
}): Promise<Lesson> {
  const level = input.level || DEFAULT_LEVEL;
  const passage = input.passage || DEFAULT_PASSAGE;
  const analyzed = input.cues.map((cue) => ({ cue, tokens: tokenize(cue.text) }));
  const vocab = new Map<string, Accum>();

  for (const { cue, tokens } of analyzed) {
    for (const token of tokens) {
      if (!keepToken(token)) continue;
      const key = token.lemma;
      let row = vocab.get(key);
      if (!row) {
        const entry = lookupWord(token.lemma, token.reading);
        row = {
          lemma: token.lemma,
          reading: bestReading(token.lemma, token.reading),
          pos: token.pos,
          detail: token.detail,
          codes: entry?.pos || [],
          count: 0,
          surfaces: new Map(),
          examples: [],
        };
        vocab.set(key, row);
      }
      row.count += 1;
      row.surfaces.set(token.surface, (row.surfaces.get(token.surface) || 0) + 1);
      if (row.examples.length < 4 && !row.examples.includes(cue.text)) row.examples.push(cue.text);
    }
  }

  const ranked = [...vocab.values()]
    .map((row) => ({ row, score: scoreRow(row, level) }))
    .filter((item) => item.score > -1000)
    .sort((a, b) => b.score - a.score);

  const vocabulary: VocabItem[] = [];
  const reviewVocabulary: ReviewVocab[] = [];
  let carriedOver = 0;
  let skippedKnown = 0;
  let skippedEasy = 0;
  const newLemmas = new Set<string>();
  const cap = vocabCap(level);

  for (const { row, score } of ranked) {
    const jlpt = jlptOf(row.lemma, row.reading);
    if (isEasierThan(jlpt, level)) {
      skippedEasy += 1;
      continue;
    }
    if (levelRank(level) <= 3 && row.detail === "固有名詞") continue;
    if (score < 8 && row.count < 2 && !lookupWord(row.lemma, row.reading)) continue;
    if (input.known.has(row.lemma)) {
      skippedKnown += 1;
      continue;
    }
    if (input.taughtVocab.has(row.lemma)) {
      carriedOver += 1;
      if (reviewVocabulary.length < 6) {
        const entry = lookupWord(row.lemma, row.reading);
        reviewVocabulary.push({
          lemma: row.lemma,
          reading: row.reading,
          gloss: entry?.glosses[0] || "review",
          count: row.count,
        });
      }
      continue;
    }
    if (vocabulary.length >= cap) continue;
    vocabulary.push(toVocab(row));
    newLemmas.add(row.lemma);
  }

  const patternHits = new Map<string, { count: number; examples: string[]; enders: Set<string> }>();
  for (const { cue, tokens } of analyzed) {
    for (const id of matchPatternIds(cue.text, tokens)) {
      let hit = patternHits.get(id);
      if (!hit) {
        hit = { count: 0, examples: [], enders: new Set() };
        patternHits.set(id, hit);
      }
      hit.count += 1;
      if (hit.examples.length < 2 && !hit.examples.includes(cue.text)) hit.examples.push(cue.text);
      if (id === "enders") {
        for (const ender of endersIn(tokens, cue.text)) hit.enders.add(ender);
      }
    }
  }

  const grammar: GrammarItem[] = [];
  const grammarReview: GrammarNote[] = [];
  const alsoNoticed: GrammarNote[] = [];
  const rankedPatterns = [...patternHits.entries()].sort((a, b) => {
    const distance = (id: string) => levelRank(level) - levelRank(patternLevel(id));
    const da = distance(a[0]);
    const db = distance(b[0]);
    if (da !== db) return da - db;
    const pa = patternInfo(a[0])?.priority || 0;
    const pb = patternInfo(b[0])?.priority || 0;
    return pb - pa || b[1].count - a[1].count;
  });

  const newPatternIds = new Set<string>();
  const grammarLimit = grammarCap(level);
  for (const [id, hit] of rankedPatterns) {
    const info = patternInfo(id);
    if (!info) continue;
    if (!patternInRange(id, level)) {
      skippedEasy += 1;
      continue;
    }
    const enders = [...hit.enders];
    const name = id === "enders" ? endersName(enders) : info.name;
    const explanation = id === "enders" ? endersExplanation(enders) : info.explanation;
    const note: GrammarNote = { id, name, reminder: info.reminder, count: hit.count };
    if (input.taughtGrammar.has(id)) {
      grammarReview.push(note);
      continue;
    }
    if (grammar.length < grammarLimit) {
      grammar.push({ id, name, explanation, examples: hit.examples, count: hit.count });
      newPatternIds.add(id);
    } else {
      alsoNoticed.push(note);
    }
  }

  const lines: LessonLine[] = analyzed.map(({ cue, tokens }) => {
    const patternIds = matchPatternIds(cue.text, tokens);
    const featured =
      tokens.some((token) => newLemmas.has(token.lemma)) || patternIds.some((id) => newPatternIds.has(id));
    const lineTokens = tokens.map((token) => toLineToken(token, level));
    return {
      index: cue.index,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      translation: null,
      gloss: glossLine(lineTokens),
      featured,
      tokens: lineTokens,
    };
  });

  const featuredCount = lines.filter((line) => line.featured).length;
  if (featuredCount < Math.min(8, lines.length)) {
    for (const line of lines) {
      if (lines.filter((item) => item.featured).length >= Math.min(8, lines.length)) break;
      line.featured = true;
    }
  }

  for (const item of vocabulary) {
    const line = lines.find((candidate) => candidate.text === item.example);
    if (line) item.exampleEn = line.gloss;
  }

  const passages = buildPassages(lines, passage);
  const composed = composeProse(lines, level);
  const prose: ProseReading = {
    ...composed,
    tokens: tokenize(composed.text).map((token) => toLineToken(token, level)),
  };

  const summary = summarize({
    level,
    passageCount: passages.length,
    passageChars: passages.reduce((sum, item) => sum + item.charCount, 0),
    newWords: vocabulary.length,
    grammarCount: grammar.length,
    carriedOver,
    skippedKnown,
    skippedEasy,
    revealEnglish: revealEnglishByDefault(level),
  });

  const lesson: Lesson = {
    generatedAt: new Date().toISOString(),
    llm: llmName(),
    level,
    passage,
    revealEnglish: revealEnglishByDefault(level),
    summary,
    vocabulary,
    reviewVocabulary,
    grammar,
    grammarReview,
    alsoNoticed,
    lines,
    passages,
    prose,
    carriedOver,
    skippedKnown,
    skippedEasy,
  };

  if (lesson.llm !== "none") {
    try {
      await enrichLesson(lesson);
      if (lesson.prose && lesson.prose.source === "llm") {
        lesson.prose.tokens = tokenize(lesson.prose.text).map((token) => toLineToken(token, level));
      }
    } catch (error) {
      console.warn("LLM enrichment failed, keeping dictionary lesson.", error);
      lesson.llm = "none";
      lesson.prose = prose;
      lesson.summary = summarize({
        level,
        passageCount: passages.length,
        passageChars: passages.reduce((sum, item) => sum + item.charCount, 0),
        newWords: vocabulary.length,
        grammarCount: grammar.length,
        carriedOver,
        skippedKnown,
        skippedEasy,
        revealEnglish: lesson.revealEnglish,
      });
    }
  }
  return lesson;
}

function summarize(input: {
  level: StudyLevel;
  passageCount: number;
  passageChars: number;
  newWords: number;
  grammarCount: number;
  carriedOver: number;
  skippedKnown: number;
  skippedEasy: number;
  revealEnglish: boolean;
}): string {
  const parts = [
    `${input.level} reading. ${input.passageCount} passage${input.passageCount === 1 ? "" : "s"}, ${input.passageChars} characters of dialogue in a row.`,
  ];
  parts.push(
    input.newWords
      ? `${input.newWords} words at ${input.level} or harder, weighted by how often they appear.`
      : `No new words at ${input.level} or above. The scene may be easier than this level, or you have already studied its vocabulary.`,
  );
  if (input.grammarCount) parts.push(`${input.grammarCount} grammar points at this level that actually appear.`);
  if (input.skippedEasy) parts.push(`${input.skippedEasy} easier words or patterns were left out so the lesson does not drop back to beginner material.`);
  if (input.carriedOver) parts.push(`${input.carriedOver} words were already taught in an earlier episode.`);
  if (input.skippedKnown) parts.push(`${input.skippedKnown} words were skipped because you marked them known.`);
  if (!input.revealEnglish) parts.push("English stays hidden until you tap a passage or a word.");
  else if (llmName() === "none") parts.push("The English is a dictionary gloss, in word order, not a polished translation.");
  return parts.join(" ");
}

function keepToken(token: Token): boolean {
  if (!token.lemma || SKIP_LEMMAS.has(token.lemma)) return false;
  if (token.pos === "助詞" || token.pos === "助動詞" || token.pos === "記号" || token.pos === "接頭詞" || token.pos === "フィラー") {
    return false;
  }
  if (token.pos === "名詞" && (token.detail === "非自立" || token.detail === "接尾" || token.detail === "数")) return false;
  if (token.pos === "動詞" && token.detail !== "自立") return false;
  if (token.pos === "形容詞" && token.detail !== "自立") return false;
  if (token.surface.length === 1 && !hasKanji(token.surface) && token.pos !== "名詞") return false;
  return true;
}

function scoreRow(row: Accum, level: StudyLevel): number {
  const entry = lookupWord(row.lemma, row.reading);
  const jlpt = jlptOf(row.lemma, row.reading);
  if (isEasierThan(jlpt, level)) return -1000;
  let score = row.count * 14;
  if (jlpt === level) score += 70;
  else if (jlpt && isHarderThan(jlpt, level)) score += 48;
  else if (!jlpt && entry) score += 36;
  if (!entry) score -= 8;
  if (hasKanji(row.lemma)) score += 10;
  if (row.detail === "固有名詞") score -= 20;
  if (row.pos === "感動詞") score -= 12;
  if (row.lemma.length === 1 && !hasKanji(row.lemma)) score -= 10;
  return score;
}

function topSurface(row: Accum): string {
  let best = row.lemma;
  let bestCount = -1;
  for (const [surface, count] of row.surfaces) {
    if (count > bestCount) {
      best = surface;
      bestCount = count;
    }
  }
  return best;
}

function pickExample(examples: string[], surface: string, lemma: string): string {
  const hits = examples.filter((line) => line.includes(surface) || line.includes(lemma));
  const pool = hits.length ? hits : examples;
  return [...pool].sort((a, b) => a.length - b.length)[0] || "";
}

function toVocab(row: Accum): VocabItem {
  const entry = lookupWord(row.lemma, row.reading);
  const surface = topSurface(row);
  const chars = [...new Set(kanjiChars(row.lemma))].slice(0, 4);
  return {
    lemma: row.lemma,
    reading: row.reading,
    surface,
    glosses: entry?.glosses || [],
    pos: friendlyPos(row.pos, row.detail, row.codes.length ? row.codes : entry?.pos || []),
    jlpt: jlptOf(row.lemma, row.reading),
    count: row.count,
    example: pickExample(row.examples, surface, row.lemma),
    exampleEn: "",
    kanji: chars.map((char) => lookupKanji(char)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
  };
}

export function readLine(text: string, level: StudyLevel): { tokens: LineToken[]; gloss: string } {
  const tokens = tokenize(text).map((token) => toLineToken(token, level));
  return { tokens, gloss: glossLine(tokens) };
}

function toLineToken(token: Token, level: StudyLevel): LineToken {
  const entry = isContent(token) ? lookupWord(token.lemma, token.reading) : null;
  const jlpt = jlptOf(token.lemma, token.reading);
  const showReading =
    Boolean(token.reading) &&
    token.reading !== token.surface &&
    hasKanji(token.surface) &&
    isHarderThan(jlpt, level);
  return {
    surface: token.surface,
    lemma: token.lemma,
    reading: token.reading,
    lemmaReading: bestReading(token.lemma, token.reading),
    pos: token.pos === "助詞" ? "particle" : token.pos === "助動詞" ? "auxiliary" : friendlyPos(token.pos, token.detail, entry?.pos || []),
    gloss: glossFor(token, entry?.glosses[0] || null),
    furigana: showReading,
  };
}

function isContent(token: Token): boolean {
  return token.pos !== "助詞" && token.pos !== "助動詞" && token.pos !== "記号";
}

function glossFor(token: Token, dictGloss: string | null): string | null {
  if (token.pos === "記号") return null;
  if (token.surface === "から" && token.detail === "接続助詞") return "because, so";
  if (token.surface === "から" && token.detail === "格助詞") return "from";
  if (token.surface === "て" || (token.surface === "で" && token.pos === "助詞" && token.detail === "接続助詞")) {
    return "て-form connector";
  }
  if (token.pos === "助動詞") {
    const aux: Record<string, string> = {
      ない: "not",
      ぬ: "not",
      た: token.conjugation === "仮定形" ? "if / when" : "past",
      だ: "is (plain)",
      です: "is (polite)",
      ます: "polite ending",
      たい: "want to",
      られる: "can, or passive",
      れる: "can, or passive",
      させる: "make or let someone",
      せる: "make or let someone",
      そうだ: "I hear / it seems",
      ようだ: "it seems",
      らしい: "it seems",
    };
    if (token.lemma === "た" && token.surface === "たら") return "if / when";
    return aux[token.lemma] || aux[token.surface] || "auxiliary";
  }
  if (token.pos === "助詞") return PARTICLE_GLOSS[token.surface] || "particle";
  if (token.lemma === "てる" && token.detail === "非自立") return "is doing / state (casual ている)";
  if ((token.lemma === "ちゃう" || token.lemma === "じゃう") && token.detail === "非自立") return "ended up (casual てしまう)";
  if (dictGloss) return dictGloss;
  if (token.detail === "固有名詞") return "name";
  return null;
}

function glossLine(tokens: LineToken[]): string {
  const parts = tokens
    .filter((token) => token.gloss && token.pos !== "particle" && token.pos !== "auxiliary")
    .map((token) => token.gloss as string);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique[unique.length - 1] !== part) unique.push(part);
  }
  return unique.slice(0, 8).join(" · ");
}
