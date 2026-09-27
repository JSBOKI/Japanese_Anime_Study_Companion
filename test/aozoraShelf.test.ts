import assert from "node:assert/strict";
import test from "node:test";
import { RECOMMENDED } from "../src/server/aozoraCatalog.ts";

const EASIEST_FIRST = [
  "手袋を買いに",
  "ごん狐",
  "注文の多い料理店",
  "蜘蛛の糸",
  "走れメロス",
  "夢十夜",
  "羅生門",
  "鼻",
  "怪人二十面相",
  "坊っちゃん",
  "銀河鉄道の夜",
  "こころ",
];

test("the recommended shelf is easiest first and marks two starting points", () => {
  const titles = RECOMMENDED.map((work) => work.title);
  assert.deepEqual(titles.slice(0, EASIEST_FIRST.length), EASIEST_FIRST);
  assert.deepEqual(
    RECOMMENDED.filter((work) => work.startHere).map((work) => work.title),
    ["走れメロス", "夢十夜"],
  );
  const ids = RECOMMENDED.map((work) => work.cardId);
  assert.equal(new Set(ids).size, ids.length);
  for (const work of RECOMMENDED) {
    assert.equal(work.orthography, "新字新仮名");
    assert.ok(work.textUrl?.includes(`${work.cardId}_ruby_`));
    assert.ok(work.sourceUrl.includes(`card${work.cardId}.html`));
  }
});
