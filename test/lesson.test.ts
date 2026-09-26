import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadDictionaries } from "../src/server/dictionary.ts";
import { buildLesson } from "../src/server/lesson.ts";
import { parseSubtitle } from "../src/server/subtitles.ts";
import { loadTokenizer, tokenize } from "../src/server/tokenizer.ts";
import { matchPatternIds } from "../src/server/grammar.ts";
import { emptyStoredCard, fromStored, reviewCard } from "../src/server/srs.ts";

const root = path.resolve(import.meta.dirname, "..");

test("tokenizer and grammar catch the patterns in the sample", async () => {
  await loadTokenizer();
  const line = "雨が降ったら、駅で待ってて。";
  const tokens = tokenize(line);
  const ids = matchPatternIds(line, tokens);
  assert.ok(ids.includes("tara"), ids.join(","));
  assert.ok(ids.includes("teiru"), ids.join(","));
  assert.ok(matchPatternIds("電車来ちゃった。", tokenize("電車来ちゃった。")).includes("chau"));
  assert.ok(matchPatternIds("温かいのが飲みたい。", tokenize("温かいのが飲みたい。")).includes("tai"));
  assert.ok(matchPatternIds("昨日、あんまり寝てないんだ。", tokenize("昨日、あんまり寝てないんだ。")).includes("nda"));
  assert.ok(matchPatternIds("急がなくていいから。", tokenize("急がなくていいから。")).includes("nakuteii"));
});

test("episode lessons teach new words once and gloss the dialogue", async () => {
  await Promise.all([loadDictionaries(), loadTokenizer()]);
  const episode1 = parseSubtitle(
    fs.readFileSync(path.join(root, "sample/episode-01-morning-platform.ja.srt"), "utf8"),
    "episode-01-morning-platform.ja.srt",
  );
  const lesson1 = await buildLesson({
    cues: episode1,
    known: new Set(),
    taughtVocab: new Set(),
    taughtGrammar: new Set(),
    level: "N5",
  });
  const lemmas = lesson1.vocabulary.map((item) => item.lemma);
  assert.ok(lemmas.includes("電車"), lemmas.join(","));
  assert.ok(lesson1.vocabulary.every((item) => item.reading && item.example));
  const drink = lesson1.vocabulary.find((item) => item.lemma === "飲む");
  assert.equal(drink?.reading, "のむ");
  const train = lesson1.vocabulary.find((item) => item.lemma === "電車");
  assert.equal(train?.jlpt, "N5");
  assert.ok(train && train.kanji.some((kanji) => kanji.char === "電"));
  const grammar = lesson1.grammar.map((item) => item.id);
  for (const id of ["teiru", "tai", "tara"]) {
    assert.ok(grammar.includes(id), grammar.join(","));
  }
  const noticed = [...grammar, ...lesson1.alsoNoticed.map((item) => item.id)];
  assert.ok(noticed.includes("chau"), noticed.join(","));
  const spoken = lesson1.lines.find((line) => line.text.includes("電車"));
  assert.ok(spoken);
  const token = spoken?.tokens.find((item) => item.surface === "電車");
  assert.equal(token?.furigana, false);
  assert.equal(token?.reading, "でんしゃ");
  assert.match(token?.gloss || "", /train|電車/i);

  const lessonKnown = await buildLesson({
    cues: episode1,
    known: new Set(["電車"]),
    taughtVocab: new Set(),
    taughtGrammar: new Set(),
    level: "N5",
  });
  assert.ok(!lessonKnown.vocabulary.some((item) => item.lemma === "電車"));
  assert.ok(lessonKnown.skippedKnown >= 1);

  const episode2 = parseSubtitle(
    fs.readFileSync(path.join(root, "sample/episode-02-after-work.ja.srt"), "utf8"),
    "episode-02-after-work.ja.srt",
  );
  const lesson2 = await buildLesson({
    cues: episode2,
    known: new Set(),
    taughtVocab: new Set(lemmas),
    taughtGrammar: new Set(grammar),
    level: "N5",
  });
  assert.ok(!lesson2.vocabulary.some((item) => item.lemma === "電車"));
  assert.ok(lesson2.vocabulary.some((item) => ["仕事", "弁当", "傘", "終わる"].includes(item.lemma)));
  assert.ok(lesson2.grammarReview.some((item) => item.id === "teiru"));
  assert.ok(lesson2.carriedOver >= 1);
  assert.equal(lesson1.revealEnglish, true);
  assert.ok(lesson1.passages.length >= 1);
  assert.ok(lesson1.passages[0].charCount > 0);
});

test("an advanced lesson keeps a long passage and drops easier words", async () => {
  await Promise.all([loadDictionaries(), loadTokenizer()]);
  const cues = parseSubtitle(
    fs.readFileSync(path.join(root, "sample/episode-03-late-office.ja.srt"), "utf8"),
    "episode-03-late-office.ja.srt",
  );
  const lesson = await buildLesson({
    cues,
    known: new Set(),
    taughtVocab: new Set(),
    taughtGrammar: new Set(),
    level: "N2",
    passage: "scene",
  });
  const lemmas = lesson.vocabulary.map((item) => item.lemma);
  assert.equal(lesson.level, "N2");
  assert.equal(lesson.revealEnglish, false);
  assert.equal(lesson.passages.length, 2);
  assert.ok(lesson.passages[0].charCount >= 360, String(lesson.passages.map((passage) => passage.charCount)));
  assert.ok(lesson.prose && [...lesson.prose.text].length >= 80);
  assert.equal(lesson.prose?.source, "composed");
  assert.ok((lesson.prose?.translation || "").length > 40);
  assert.ok(lesson.prose.tokens.length > 10);
  for (const easy of ["電車", "飲む", "仕事", "責任", "雨", "今日"]) {
    assert.ok(!lemmas.includes(easy), `${easy} in ${lemmas.join(",")}`);
  }
  assert.ok(lemmas.some((lemma) => ["根拠", "妥協", "指摘", "前提", "了承", "余地", "資料", "締切", "矛盾"].includes(lemma)), lemmas.join(","));
  const grammar = lesson.grammar.map((item) => item.id);
  for (const easy of ["teiru", "tai", "nai", "kara", "enders"]) {
    assert.ok(!grammar.includes(easy), grammar.join(","));
  }
  assert.ok(
    grammar.some((id) => ["wake", "contractions", "zaruoenai", "chigainai", "naikotoniwa", "seide", "kaneru"].includes(id)),
    grammar.join(","),
  );
  const hard = lesson.lines.flatMap((line) => line.tokens).find((token) => token.surface === "根拠" || token.lemma === "根拠");
  assert.equal(hard?.furigana, true);
  const atLevel = lesson.lines.flatMap((line) => line.tokens).find((token) => token.surface === "資料" || token.lemma === "資料");
  if (atLevel?.surface && /[\u4e00-\u9fff]/.test(atLevel.surface)) assert.equal(atLevel.furigana, false);

  const longer = await buildLesson({
    cues,
    known: new Set(),
    taughtVocab: new Set(),
    taughtGrammar: new Set(),
    level: "N2",
    passage: "long",
  });
  const sceneMax = Math.max(...lesson.passages.map((passage) => passage.charCount));
  const longMax = Math.max(...longer.passages.map((passage) => passage.charCount));
  assert.equal(longer.passages.length, 1);
  assert.ok(longMax > sceneMax);
});

test("FSRS review moves a new card forward", () => {
  const card = fromStored(emptyStoredCard(new Date("2026-01-01T00:00:00Z")));
  const next = reviewCard(card, 3, new Date("2026-01-01T00:00:00Z"));
  assert.equal(next.reps, 1);
  assert.ok(next.due.getTime() > card.due.getTime());
});
