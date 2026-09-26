import assert from "node:assert/strict";
import { test } from "node:test";
import {
  netflixTitleFromLinks,
  netflixWatchesFromStreams,
  normalizeNetflixTitleUrl,
  normalizeNetflixWatchUrl,
  pickNetflixTitle,
} from "../src/server/netflix.ts";

test("keeps a Netflix series title link and rejects other pages", () => {
  assert.equal(normalizeNetflixTitleUrl("https://www.netflix.com/title/70204957"), "https://www.netflix.com/title/70204957");
  assert.equal(normalizeNetflixTitleUrl("https://www.netflix.com/jp/title/70204957?source=android"), "https://www.netflix.com/title/70204957");
  assert.equal(normalizeNetflixTitleUrl("70204957"), "https://www.netflix.com/title/70204957");
  assert.equal(normalizeNetflixTitleUrl("https://www.netflix.com/watch/80000000"), null);
  assert.equal(normalizeNetflixTitleUrl("https://www.youtube.com/watch?v=abc"), null);
  assert.equal(normalizeNetflixWatchUrl("https://www.netflix.com/watch/81234567"), "https://www.netflix.com/watch/81234567");
});

test("uses an AniList Netflix link and ignores other streams", () => {
  const url = netflixTitleFromLinks([
    { site: "Crunchyroll", url: "https://www.crunchyroll.com/series/bleach" },
    { site: "Netflix", url: "https://www.netflix.com/title/70204957" },
  ]);
  assert.equal(url, "https://www.netflix.com/title/70204957");
  assert.equal(netflixTitleFromLinks([{ site: "Hulu", url: "https://www.hulu.com/bleach" }]), null);
});

test("picks the TV series and does not invent episode watch ids", () => {
  const url = pickNetflixTitle(
    ["Bleach", "BLEACH"],
    2004,
    [
      { title: "Bleach: Sennen Kessen-hen", year: 2022, urls: ["https://www.netflix.com/title/999"] },
      { title: "Bleach", year: 2004, urls: ["https://www.netflix.com/title/70204957"] },
      { title: "Bleach", year: 2018, urls: ["https://www.netflix.com/title/80217733"] },
    ],
  );
  assert.equal(url, "https://www.netflix.com/title/70204957");

  const watches = netflixWatchesFromStreams([
    { site: "Crunchyroll", title: "Episode 1 - Untitled", url: "http://www.crunchyroll.com/watch/GR2PWW38R/untitled" },
    { site: "Netflix", title: "Episode 3", url: "https://www.netflix.com/title/70204957" },
    { site: "Netflix", title: "Episode 4", url: "https://www.netflix.com/watch/81230004" },
  ]);
  assert.deepEqual(watches, [{ number: 4, url: "https://www.netflix.com/watch/81230004" }]);
});
