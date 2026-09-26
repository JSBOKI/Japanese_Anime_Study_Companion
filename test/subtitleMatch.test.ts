import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseKitsunekkoFolder,
  chooseSubtitlePack,
  looksJapanese,
  parseKitsunekkoPage,
  rejectSubtitleName,
} from "../src/server/subtitleMatch.ts";
import { guessEpisodeNumber } from "../src/server/subtitles.ts";

const INDEX = `
<html><body>
<a href="/dirlist.php?dir=subtitles%2Fjapanese%2F"><strong>japanese</strong></a>
<a href="/dirlist.php?dir=subtitles%2Fjapanese%2FBleach%2F"><strong>Bleach</strong></a>
<a href="/dirlist.php?dir=subtitles%2Fjapanese%2FBleach%3A%20Sennen%20Kessen-hen%2F"><strong>Bleach: Sennen Kessen-hen</strong></a>
<a href="/dirlist.php?dir=subtitles%2Fjapanese%2FBLEACH%3A%20Sennen%20Kessen-hen%20-%20Soukoku-tan%2F"><strong>BLEACH: Sennen Kessen-hen - Soukoku-tan</strong></a>
</body></html>`;

const FOLDER = `
<html><body>
<a href="subtitles/japanese/Bleach/Bleach%20%5B1-366%5D.zip"><strong>Bleach [1-366].zip</strong></a>
<a href="subtitles/japanese/Bleach/Bleach%5B1-300%5D.zip">Bleach[1-300].zip</a>
<a href="subtitles/japanese/Bleach/Bleach.rar">Bleach.rar</a>
<a href="subtitles/japanese/Bleach/%5BHorriblesubs%5D%20Bleach%20%28NO%20FILLERS%29.rar">[Horriblesubs] Bleach (NO FILLERS).rar</a>
<a href="subtitles/japanese/Bleach/Bleach%20movie.ass">Bleach movie.ass</a>
<a href="subtitles/japanese/Bleach/%5BHYSUB%5D%20Bleach%20%5BGB_BIG5_JP%5D.sub.zip">[HYSUB] Bleach [GB_BIG5_JP].sub.zip</a>
<a href="subtitles/japanese/Bleach/%5BNanakoRaws%5D%20Bleach%20Sennen%20Kessen-hen%2001.srt">[NanakoRaws] Bleach Sennen Kessen-hen 01.srt</a>
<a href="subtitles/japanese/Bleach/Lambert%20S07.7z">Lambert S07.7z</a>
</body></html>`;

test("picks the exact Kitsunekko folder and the TV zip", () => {
  const dirs = parseKitsunekkoPage(INDEX).filter((entry) => entry.kind === "dir").map((entry) => entry.name);
  assert.deepEqual(dirs, ["Bleach", "Bleach: Sennen Kessen-hen", "BLEACH: Sennen Kessen-hen - Soukoku-tan"]);
  assert.equal(chooseKitsunekkoFolder(dirs, ["Bleach", "BLEACH"]), "Bleach");

  const files = parseKitsunekkoPage(FOLDER).filter((entry) => entry.kind === "file");
  assert.equal(files.some((file) => file.name === "Bleach [1-366].zip"), true);
  assert.match(files[0].url, /^https:\/\/kitsunekko\.net\/subtitles\/japanese\/Bleach\//);

  const choice = chooseSubtitlePack(files, 200, "Bleach", false);
  assert.equal(choice?.kind, "archive");
  if (choice?.kind !== "archive") return;
  assert.equal(choice.file.name, "Bleach [1-366].zip");
  assert.equal(choice.coverage, 200);
  assert.equal(rejectSubtitleName("[HYSUB] Bleach [GB_BIG5_JP].sub.zip"), true);
});

test("keeps one consistent loose release group and skips English", () => {
  const files = [
    { name: "[GroupA] Show - 01.srt", url: "a1" },
    { name: "[GroupA] Show - 02.srt", url: "a2" },
    { name: "[GroupA] Show - 03.srt", url: "a3" },
    { name: "[GroupB] Show - 01.srt", url: "b1" },
    { name: "[English] Show - 01.srt", url: "e1" },
    { name: "[English] Show - 02.srt", url: "e2" },
    { name: "[English] Show - 03.srt", url: "e3" },
    { name: "[English] Show - 04.srt", url: "e4" },
  ];
  const choice = chooseSubtitlePack(files, 200, "Show", false);
  assert.equal(choice?.kind, "files");
  if (choice?.kind !== "files") return;
  assert.equal(choice.coverage, 3);
  assert.deepEqual(choice.files.map((file) => file.name), ["[GroupA] Show - 01.srt", "[GroupA] Show - 02.srt", "[GroupA] Show - 03.srt"]);
});

test("numbers broadcast files and recognizes Japanese text", () => {
  assert.equal(guessEpisodeNumber("Bleach [1-366]/Bleach_001.srt"), 1);
  assert.equal(guessEpisodeNumber("Bleach_200.srt"), 200);
  const japanese = "1\n00:00:01,000 --> 00:00:02,000\n朝の電車は混んでいて、隣の人に小さく挨拶をしてから席を譲ったよ。\n";
  assert.equal(looksJapanese(japanese), true);
  assert.equal(looksJapanese("This is an English subtitle with no Japanese dialogue at all."), false);
});
