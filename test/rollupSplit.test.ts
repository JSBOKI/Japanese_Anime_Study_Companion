import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLLUP_MAX_BYTES, ROLLUP_MAX_SECONDS, splitRollup } from "../src/server/rollupSplit.ts";

test("a roll-up stays near 30 minutes and splits a long story", () => {
  const minute = (id: string, minutes: number) => ({ id, seconds: minutes * 60, bytes: 1000 });
  const packed = splitRollup([minute("a", 12), minute("b", 12), minute("c", 12)], { maxSeconds: ROLLUP_MAX_SECONDS, maxBytes: ROLLUP_MAX_BYTES });
  assert.equal(packed.length, 2);
  assert.deepEqual(packed[0].slices.map((slice) => slice.id), ["a", "b"]);
  assert.equal(packed[0].seconds, 24 * 60);
  assert.deepEqual(packed[1].slices.map((slice) => slice.id), ["c"]);

  const long = splitRollup([minute("long", 40)], { maxSeconds: 30 * 60, maxBytes: ROLLUP_MAX_BYTES });
  assert.equal(long.length, 2);
  assert.equal(long[0].slices[0].whole, false);
  assert.equal(long[0].seconds, 20 * 60);
  assert.equal(long[1].seconds, 20 * 60);
  assert.ok(long.every((part) => part.seconds <= 30 * 60));
});

test("a roll-up also splits when a part would be too large", () => {
  const parts = splitRollup(
    [
      { id: "one", seconds: 60, bytes: 8 * 1024 * 1024 },
      { id: "two", seconds: 60, bytes: 8 * 1024 * 1024 },
    ],
    { maxSeconds: ROLLUP_MAX_SECONDS, maxBytes: 12 * 1024 * 1024 },
  );
  assert.equal(parts.length, 2);
  assert.equal(parts[0].slices[0].id, "one");
  assert.equal(parts[1].slices[0].id, "two");
});
