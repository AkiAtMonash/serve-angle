// node --test test/serve.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findServes, fixSwaps, skipRaise, stanceFrame, warp } from "../serve.js";

const refs = JSON.parse(readFileSync(new URL("../refs.json", import.meta.url))).refs;

// refs.json trophy/contact/stance come from serve_analyze.py (Python); the JS port must agree.
for (const r of refs) {
  test(`${r.id}: JS finds the same serve as the PC analysis`, () => {
    const s = findServes(r.frames, 30);
    assert.equal(s.length, 1);
    assert.ok(Math.abs(s[0].trophy - r.trophy) <= 1, `trophy ${s[0].trophy} vs ${r.trophy}`);
    assert.ok(Math.abs(s[0].contact - r.contact) <= 1, `contact ${s[0].contact} vs ${r.contact}`);
    assert.equal(stanceFrame(r.frames, r.trophy), r.stance);
  });
}

// Field test 2026-10-25: three clips stopped 2.5 s in. Recording starts with both hands still up, one hand
// comes down first, and findServes took that for a toss and a hit, so the "2 s after contact" rule fired.
test("the hands-up start of a recording is not a serve", () => {
  const d = JSON.parse(readFileSync(new URL("./raise.json", import.meta.url)));
  const f = fixSwaps(d.frames, d.aspect);
  assert.equal(findServes(f, d.fps).length, 1);          // what made the recording stop
  assert.deepEqual(findServes(skipRaise(f), d.fps), []);
});

test("skipRaise leaves a serve that starts from the stance alone", () => {
  for (const r of refs) assert.deepEqual(findServes(skipRaise(r.frames), 30), findServes(r.frames, 30));
});

test("fixSwaps undoes a single left/right swapped frame", () => {
  const f = refs[0].frames.map(p => p.map(q => q.slice()));
  const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
  const bad = f.map(p => p.slice());
  for (const [a, b] of PAIRS) [bad[20][a], bad[20][b]] = [bad[20][b], bad[20][a]];
  assert.deepEqual(fixSwaps(bad, 16 / 9)[20], f[20]);
});

test("warp maps your trophy/contact onto the reference's", () => {
  const you = { trophy: 2.0, contact: 2.5 }, ref = { trophy: 40, contact: 55 };
  assert.equal(warp(2.0, you, ref), 40);
  assert.equal(warp(2.5, you, ref), 55);
});
