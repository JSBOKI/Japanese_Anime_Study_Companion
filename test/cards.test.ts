import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { VocabItem } from "../src/shared/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yomu-cards-"));
process.env.DATA_DIR = dir;

const { dataDir } = await import("../src/server/config.ts");
const db = await import("../src/server/db.ts");
const { reviewCard } = await import("../src/server/srs.ts");

function word(lemma: string, jlpt: string | null): VocabItem {
  return {
    lemma,
    reading: "よみ",
    surface: lemma,
    glosses: [`meaning of ${lemma}`],
    pos: "noun",
    jlpt,
    count: 1,
    example: `${lemma}の例。`,
    exampleEn: "",
    kanji: [],
  };
}

test("rebuilding a lesson keeps review history and hides easier cards", () => {
  assert.equal(dataDir, dir);
  const series = db.createSeries({ title: "Cards", mediaType: "drama", episodeCount: 1 });
  const episode = db.listEpisodes(series.id)[0];
  const first = [word("電車", "N5"), word("根拠", "N1"), word("懸念", null)];
  db.syncCards(episode.id, series.id, first);

  const rows = db.getDb().prepare("SELECT id, lemma, reps, meaning FROM cards ORDER BY lemma").all() as {
    id: number;
    lemma: string;
    reps: number;
    meaning: string;
  }[];
  const hard = rows.find((row) => row.lemma === "根拠");
  assert.ok(hard);
  assert.equal(hard.reps, 0);
  const stored = db.getCardRow(hard.id);
  assert.ok(stored);
  db.saveCard(hard.id, reviewCard(db.storedFromRow(stored), 3, new Date("2026-02-01T00:00:00Z")));

  const revised = first.map((item) => ({ ...item, glosses: [`updated ${item.lemma}`] }));
  db.syncCards(episode.id, series.id, revised);

  const after = db.getCardRow(hard.id);
  assert.equal(after?.reps, 1);
  assert.match(after?.meaning || "", /updated 根拠/);
  const easy = rows.find((row) => row.lemma === "電車");
  assert.ok(easy);
  assert.equal(db.getCardRow(easy.id)?.reps, 0);

  db.saveStudySettings({ level: "N2", passage: "scene", furigana: "level" });
  assert.equal(db.cardCounts(null, "N2").total, 2);
  assert.equal(db.cardCounts(null, "N5").total, 3);
  const due = db.listDueCards(null, 20, "N2").map((card) => card.lemma);
  assert.ok(!due.includes("電車"));
  assert.ok(due.includes("懸念"));
});
