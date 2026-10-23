// node --test test/clips.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { nextBatch } from "../clips.js";

const MB = 1024 * 1024;
const clips = sizes => sizes.map((s, i) => ({ name: `c${i}`, blob: { size: s * MB } }));

test("at most 10 clips per share", () => {
  assert.equal(nextBatch(clips(Array(23).fill(3))).length, 10);
});

test("at most 50 MB per share", () => {
  assert.deepEqual(nextBatch(clips([20, 20, 20, 5])).map(c => c.name), ["c0", "c1"]);
});

test("an oversized clip still goes, alone", () => {
  assert.deepEqual(nextBatch(clips([60, 1])).map(c => c.name), ["c0"]);
});

test("nothing to send", () => {
  assert.deepEqual(nextBatch([]), []);
});
