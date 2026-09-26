import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { decodeSubtitle, filesFromUpload, guessEpisodeNumber, parseSubtitle } from "../src/server/subtitles.ts";

test("parses srt, vtt, and ass dialogue", () => {
  const srt = parseSubtitle("1\n00:00:01,000 --> 00:00:02,000\nおはよう。\n\n2\n00:00:02,000 --> 00:00:03,000\nおはよう。\n", "a.srt");
  assert.equal(srt.length, 1);
  assert.equal(srt[0].text, "おはよう。");

  const vtt = parseSubtitle("WEBVTT\n\n00:00:01.000 --> 00:00:02.000 line:80%\n電車、まだ来てないよ。\n", "a.vtt");
  assert.equal(vtt[0].text, "電車、まだ来てないよ。");

  const ass = parseSubtitle(
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}温かいのが飲みたい。\n",
    "a.ass",
  );
  assert.equal(ass[0].text, "温かいのが飲みたい。");
});

test("guesses episode numbers and ignores resolutions", () => {
  assert.equal(guessEpisodeNumber("Show.S01E02.1080p.srt"), 2);
  assert.equal(guessEpisodeNumber("episode-01-morning-platform.ja.srt"), 1);
  assert.equal(guessEpisodeNumber("第12話.ass"), 12);
  assert.equal(guessEpisodeNumber("[03] title.srt"), 3);
  assert.equal(guessEpisodeNumber("movie.1080p.srt"), null);
});

test("decodes shift-jis and reads zip archives", async () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,000\n日本語\n";
  const decoded = decodeSubtitle(iconv.encode(srt, "shift_jis"));
  assert.match(decoded, /日本語/);
  const zip = new JSZip();
  zip.file("episode-02.srt", srt);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const files = await filesFromUpload("subs.zip", buffer);
  assert.equal(files.length, 1);
  assert.equal(guessEpisodeNumber(files[0].name), 2);
});
