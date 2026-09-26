import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_ENGLISH_NOTE,
  WORLD_REPORT_NOTE,
  WORLD_SUMMARY_NOTE,
  extractArticleText,
  matchEnglishStory,
  needsCatchup,
  needsScheduledRefresh,
  parseRssItems,
  resolveEnglish,
  tokyoDay,
  type WorldStory,
} from "../src/server/newsParse.ts";

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Sample</title>
    <item>
      <title>福岡の朝</title>
      <link>https://news.example/newsweb/na/nd-sample1</link>
      <guid>https://news.example/newsweb/na/nd-sample1</guid>
      <description><![CDATA[短い説明です。]]></description>
      <pubDate>Sun, 27 Sep 2026 05:41:14 +0900</pubDate>
    </item>
    <item>
      <title></title>
      <link>https://news.example/missing</link>
    </item>
  </channel>
</rss>`;

test("RSS items keep title, link, and description", () => {
  const items = parseRssItems(rss);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "福岡の朝");
  assert.equal(items[0].link, "https://news.example/newsweb/na/nd-sample1");
  assert.equal(items[0].description, "短い説明です。");
  assert.match(items[0].pubDate || "", /27 Sep 2026/);
});

const articleHtml = `<html><body>
  <p class="lead">これは導入の段落です。記事の最初に置かれ、本文の前に読まれます。十分な長さになるように書いてあります。</p>
  <div class="c-part">
    <h2>現場から</h2>
    <p>本文の第一段落です。漢字とひらがなが混ざっていて、読み物として使います。</p>
    <p>本文の第二段落です。数字の1500とWTOが出てきます。</p>
  </div>
  <h2>あわせて読みたい</h2>
  <div class="c-part"><p>ここは関連記事なので本文に入れません。別の話題です。</p></div>
</body></html>`;

test("article HTML keeps the lead and the body, and stops at related links", () => {
  const paragraphs = extractArticleText(articleHtml);
  assert.deepEqual(paragraphs, [
    "これは導入の段落です。記事の最初に置かれ、本文の前に読まれます。十分な長さになるように書いてあります。",
    "現場から",
    "本文の第一段落です。漢字とひらがなが混ざっていて、読み物として使います。",
    "本文の第二段落です。数字の1500とWTOが出てきます。",
  ]);
});

function tokyo(isoDay: string, hour: number, minute = 0): Date {
  const [year, month, day] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60 * 1000);
}

test("the daily job catches up once per Tokyo day and still runs at 6:00", () => {
  const early = tokyo("2026-09-27", 2);
  assert.equal(tokyoDay(early), "2026-09-27");
  assert.equal(needsCatchup(null, early), true);
  assert.equal(needsScheduledRefresh(null, early, 6), false);

  const afterEarlyFetch = early.toISOString();
  const stillMorning = tokyo("2026-09-27", 3);
  assert.equal(needsCatchup(afterEarlyFetch, stillMorning), false);
  assert.equal(needsScheduledRefresh(afterEarlyFetch, stillMorning, 6), false);

  const atSix = tokyo("2026-09-27", 6, 1);
  assert.equal(needsCatchup(afterEarlyFetch, atSix), false);
  assert.equal(needsScheduledRefresh(afterEarlyFetch, atSix, 6), true);

  const afterSix = tokyo("2026-09-27", 6, 30).toISOString();
  const noon = tokyo("2026-09-27", 12);
  assert.equal(needsCatchup(afterSix, noon), false);
  assert.equal(needsScheduledRefresh(afterSix, noon, 6), false);

  const yesterday = tokyo("2026-09-26", 22).toISOString();
  const nextMorning = tokyo("2026-09-27", 1);
  assert.equal(needsCatchup(yesterday, nextMorning), true);
  assert.equal(needsScheduledRefresh(yesterday, nextMorning, 6), false);
  assert.equal(needsScheduledRefresh(null, tokyo("2026-09-27", 7), 6), true);
});

function world(partial: Partial<WorldStory> & Pick<WorldStory, "title">): WorldStory {
  return {
    id: partial.id || "en-1",
    title: partial.title,
    description: partial.description || "",
    pageUrl: partial.pageUrl || "https://www3.nhk.or.jp/nhkworld/en/news/example/",
    updatedAt: partial.updatedAt || Date.parse("2026-09-27T00:00:00Z"),
  };
}

test("English without an API key uses a real NHK World match or says none is available", () => {
  const published = "2026-09-27T00:00:00Z";
  const matched = world({
    title: "WTO members discuss a 1500-page draft",
    description: "Talks continue around the 1500 figure at the WTO.",
    updatedAt: Date.parse(published),
  });
  const hit = matchEnglishStory(
    { title: "WTOの会合", body: "文書は1500ページです。WTOが公表しました。", publishedAt: published },
    [matched, world({ title: "Unrelated weather", description: "Rain in the north.", id: "other" })],
    Date.parse(published),
  );
  assert.equal(hit?.id, "en-1");

  const stale = matchEnglishStory(
    { title: "WTOの会合", body: "文書は1500ページです。", publishedAt: published },
    [world({ title: "WTO 1500", updatedAt: Date.parse("2026-09-20T00:00:00Z") })],
    Date.parse(published),
  );
  assert.equal(stale, null);

  const weak = matchEnglishStory(
    { title: "朝の天気", body: "雨が降りました。", publishedAt: published },
    [world({ title: "Morning rain", description: "A front brought showers." })],
    Date.parse(published),
  );
  assert.equal(weak, null);

  const none = resolveEnglish({ llm: null, world: null, worldParagraphs: [] });
  assert.equal(none.source, "none");
  assert.deepEqual(none.paragraphs, []);
  assert.equal(none.note, NO_ENGLISH_NOTE);
  assert.equal(none.title, null);

  const report = resolveEnglish({
    llm: null,
    world: matched,
    worldParagraphs: ["Heavy rain is pounding southwestern Japan, raising the risk of disasters across the prefecture."],
  });
  assert.equal(report.source, "nhk-world");
  assert.equal(report.note, WORLD_REPORT_NOTE);
  assert.equal(report.paragraphs.length, 1);

  const summary = resolveEnglish({ llm: null, world: matched, worldParagraphs: [] });
  assert.equal(summary.source, "nhk-world");
  assert.equal(summary.note, WORLD_SUMMARY_NOTE);
  assert.equal(summary.paragraphs[0], matched.description);
});
