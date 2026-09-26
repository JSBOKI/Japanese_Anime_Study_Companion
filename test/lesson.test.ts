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
  for (const id of ["teiru", "tai", "tara", "chau"]) {
    assert.ok(grammar.includes(id), grammar.join(","));
  }
  const spoken = lesson1.lines.find((line) => line.text.includes("電車"));
  assert.ok(spoken);
  const token = spoken?.tokens.find((item) => item.surface === "電車");
  assert.equal(token?.furigana, true);
  assert.equal(token?.reading, "でんしゃ");
  assert.match(token?.gloss || "", /train|電車/i);

  const lessonKnown = await buildLesson({
    cues: episode1,
    known: new Set(["電車"]),
    taughtVocab: new Set(),
    taughtGrammar: new Set(),
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
  });
  assert.ok(!lesson2.vocabulary.some((item) => item.lemma === "電車"));
  assert.ok(lesson2.vocabulary.some((item) => ["仕事", "弁当", "傘", "終わる"].includes(item.lemma)));
  assert.ok(lesson2.grammarReview.some((item) => item.id === "teiru"));
  assert.ok(lesson2.carriedOver >= 1);
});

test("FSRS review moves a new card forward", () => {
  const card = fromStored(emptyStoredCard(new Date("2026-01-01T00:00:00Z")));
  const next = reviewCard(card, 3, new Date("2026-01-01T00:00:00Z"));
  assert.equal(next.reps, 1);
  assert.ok(next.due.getTime() > card.due.getTime());
});
