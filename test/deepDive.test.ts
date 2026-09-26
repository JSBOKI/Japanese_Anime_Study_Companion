import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NEEDS_KEY_NOTE,
  acceptModelParagraphs,
  deepDiveWithoutKey,
  sourcesFromNewsRss,
} from "../src/server/deepDive.ts";

const rss = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>日銀の展望 - 朝日新聞</title>
    <link>https://news.google.com/rss/articles/example1</link>
    <description>日銀が物価の見通しを示した。</description>
    <source url="https://www.asahi.com">朝日新聞</source>
  </item>
  <item>
    <title>社説：利上げの順番</title>
    <link>https://news.google.com/rss/articles/example2</link>
    <description>社説です。</description>
    <source url="https://example.com/editorial">Example</source>
  </item>
</channel></rss>`;

test("a deep dive without a model keeps the real links and writes no article", () => {
  const sources = sourcesFromNewsRss(rss, "ja");
  assert.equal(sources.length, 2);
  assert.equal(sources[1].kind, "opinion");
  assert.equal(sources[0].publisher, "朝日新聞");
  const dive = deepDiveWithoutKey(sources);
  assert.equal(dive.note, NEEDS_KEY_NOTE);
  assert.deepEqual(dive.paragraphs, []);
  assert.match(dive.reactionNote || "", /signing in/);
});

test("model text is kept only when it cites the gathered sources", () => {
  const sources = sourcesFromNewsRss(rss, "ja");
  const material = sources.map((source) => source.snippet).join("\n");
  const kept = acceptModelParagraphs({
    paragraphs: [
      { ja: "日銀は物価の見通しを更新した。", en: "The Bank of Japan updated its price outlook.", kind: "report", sourceIds: ["s1"] },
      { ja: "意見として順番が問われている。", en: "The order of rate hikes is the editorial point.", kind: "opinion", sourceIds: ["s2"] },
      { ja: "「存在しない発言ですよ」と誰かが言った。", en: "Someone said a sentence that was never published.", kind: "report", sourceIds: ["s1"] },
      { ja: "出典のない段落です。", en: "This paragraph cites a missing source.", kind: "report", sourceIds: ["missing"] },
    ],
  }, sources, material);
  assert.equal(kept?.length, 2);
  assert.equal(kept?.[0].kind, "report");
  assert.equal(kept?.[1].kind, "opinion");
});
