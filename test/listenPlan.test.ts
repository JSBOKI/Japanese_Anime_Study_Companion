import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JA_LISTEN_VOICES,
  assignVoices,
  bytesToFree,
  engineNote,
  estimateListen,
  lineAtTime,
  pickEvictions,
  planListenParts,
  spokenLine,
  timeForLine,
} from "../src/server/listenPlan.ts";

test("music notes and bare punctuation are not sent to speech", () => {
  assert.equal(spokenLine("♪♪～"), null);
  assert.equal(spokenLine("……。"), null);
  assert.equal(spokenLine("{\\an8}♪"), null);
  assert.equal(spokenLine("(黒崎 一護)あ～…。なんとか言わんかい！"), "あ～…。なんとか言わんかい！");
  assert.equal(spokenLine("(ｻｲﾚﾝ)"), "サイレン");
  assert.equal(spokenLine("…ﾒｼ｡"), "…メシ。");
  assert.equal(spokenLine("ｷｬｯ！"), "キャッ！");
  assert.match(engineNote(["edge"], 4), /Microsoft Edge/);
  assert.match(engineNote(["edge"], 4), /4 lines/);
  assert.match(engineNote(["gtts"], 0), /Google Translate/);
  assert.match(engineNote(["gtts"], 0), /could not read/);
});

test("speakers keep a voice, and lines without names alternate", () => {
  const named = assignVoices([
    { speaker: "一護", text: "おはよう。" },
    { speaker: "ルキア", text: "遅い。" },
    { speaker: "一護", text: "ごめん。" },
    { speaker: null, text: "……。" },
  ]);
  assert.equal(named[0], JA_LISTEN_VOICES[0]);
  assert.equal(named[1], JA_LISTEN_VOICES[1]);
  assert.equal(named[2], named[0]);
  assert.equal(named[3], named[2]);

  const plain = assignVoices([
    { speaker: null, text: "おはよう。" },
    { speaker: null, text: "うん。" },
    { speaker: null, text: "まだ、" },
    { speaker: null, text: "来てない。" },
  ]);
  assert.equal(plain[0], JA_LISTEN_VOICES[0]);
  assert.equal(plain[1], JA_LISTEN_VOICES[1]);
  assert.equal(plain[2], JA_LISTEN_VOICES[0]);
  assert.equal(plain[3], plain[2]);
});

test("listen-along parts keep each line whole and the clock matches", () => {
  const lines = [0, 1, 2, 3].map((index) => ({ index, seconds: 800, bytes: 800 * 6_000 }));
  const parts = planListenParts(lines, { maxSeconds: 1500, maxBytes: 50_000_000 });
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.map((part) => part.cues.map((cue) => cue.index)), [[0], [1], [2], [3]]);
  assert.equal(parts[0].cues[0].start, 0);
  assert.equal(parts[0].cues[0].end, 800);
  assert.equal(parts[1].cues[0].start, 800);
  assert.equal(parts[1].cues[0].offset, 0);
  assert.ok(parts.every((part) => part.seconds <= 1500));
  assert.ok(parts.every((part) => part.cues.every((cue) => cue.end - cue.start === 800)));

  const packed = planListenParts(
    [0, 1, 2].map((index) => ({ index, seconds: 400, bytes: 1000 })),
    { maxSeconds: 900, maxBytes: 50_000_000 },
  );
  assert.equal(packed.length, 2);
  assert.deepEqual(packed[0].cues.map((cue) => cue.index), [0, 1]);
  assert.deepEqual(packed[1].cues.map((cue) => cue.index), [2]);

  const cues = packed.flatMap((part) => part.cues);
  assert.equal(lineAtTime(cues, 0), 0);
  assert.equal(lineAtTime(cues, 399), 0);
  assert.equal(lineAtTime(cues, 400), 1);
  assert.equal(lineAtTime(cues, 900), 2);
  assert.equal(timeForLine(cues, 2)?.start, 800);
  assert.equal(timeForLine(cues, 2)?.part, 2);
  assert.equal(timeForLine(cues, 2)?.offset, 0);
});

test("size estimates and eviction use the spare-disk reserve", () => {
  const estimate = estimateListen([{ text: "あ" }, { text: "いいね。" }]);
  assert.ok(estimate.seconds > 1);
  assert.equal(estimate.bytes, Math.round(estimate.seconds * 6_000));
  assert.equal(bytesToFree(200_000_000, 10_000_000, 150_000_000), 0);
  assert.equal(bytesToFree(100_000_000, 10_000_000, 150_000_000), 60_000_000);
  const evict = pickEvictions(
    [
      { episodeId: 2, bytes: 40_000_000, playedAt: "2026-09-02" },
      { episodeId: 9, bytes: 30_000_000, playedAt: "2026-09-01" },
      { episodeId: 4, bytes: 90_000_000, playedAt: "2026-09-03" },
    ],
    60_000_000,
    4,
  );
  assert.deepEqual(evict, [9, 2]);
});
