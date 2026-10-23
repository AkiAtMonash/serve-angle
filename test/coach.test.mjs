// node --test test/coach.test.mjs
// Plays sequences like the field test (walk, stand, walk to the tripod, come back) through the coach.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCoach, step } from "../coach.js";

const ref = JSON.parse(readFileSync(new URL("../refs.json", import.meta.url))).refs.find(r => r.id === "left_rear");
const A = ref.width / ref.height;
const base = ref.frames[ref.stance];
const scale = (p, k, cx = 0.5, cy = 0.5) => p.map(([x, y, z, v]) => [cx + (x - cx) * k, cy + (y - cy) * k, z, v]);
const shift = (p, dx) => p.map(([x, y, z, v]) => [x + dx, y, z, v]);
const jitter = (p, i) => p.map(([x, y, z, v], k) => [x + 0.002 * Math.sin(i * 1.7 + k), y + 0.002 * Math.cos(i * 1.3 + k), z, v]);

// Run `sec` seconds at 15 fps of poses produced by f(i); returns everything said.
function run(coach, t0, sec, f, front = false) {
  const said = []; let last;
  for (let i = 0; i < sec * 15; i++) {
    const t = t0 + i / 15;
    last = step(coach, { t, pose: f(i), ref, aspect: A, refAspect: A, front });
    if (last.say) said.push(last.say);
  }
  return { said, last, t: t0 + sec };
}

test("walking around says nothing", () => {
  const c = createCoach();
  const r = run(c, 0, 5, i => shift(base, -0.3 + i * 0.01));
  assert.deepEqual(r.said, []);
});

test("standing still too big: one sentence with the distance factor, said once", () => {
  const c = createCoach();
  const r = run(c, 0, 6, i => jitter(scale(base, 1.3, 0.5, base[0][1]), i));
  assert.equal(r.said.length, 1, JSON.stringify(r.said));
  assert.match(r.said[0], /約1\.3倍の距離まで離して/);
});

test("too small and off to the side: both in one sentence", () => {
  const c = createCoach();
  const r = run(c, 0, 3, i => jitter(shift(scale(base, 0.75, 0.5, base[0][1]), -0.12), i));
  assert.equal(r.said.length, 1);
  assert.match(r.said[0], /約0\.[78]倍の距離まで近づけて/);
  assert.match(r.said[0], /カメラを少し左に向けて/);
});

test("walking to the tripod (huge in frame) stays quiet, then advice again once back in stance", () => {
  const c = createCoach();
  let r = run(c, 0, 3, i => jitter(scale(base, 1.3, 0.5, base[0][1]), i));
  assert.equal(r.said.length, 1);
  r = run(c, r.t, 4, i => jitter(scale(base, 3, 0.5, 0.5), i));       // next to the camera
  assert.deepEqual(r.said, []);
  r = run(c, r.t, 1, i => shift(base, -0.2 + i * 0.02));                // walking back
  assert.deepEqual(r.said, []);
  r = run(c, r.t, 3, i => jitter(shift(scale(base, 0.8, 0.5, base[0][1]), 0.1), i));
  assert.equal(r.said.length, 1);
  assert.match(r.said[0], /近づけて/);
});

test("aligned and still: says OK once and reports ok after about 2 seconds", () => {
  const c = createCoach();
  const said = []; let okAt = null;
  for (let i = 0; i < 60; i++) {
    const res = step(c, { t: i / 15, pose: jitter(base, i), ref, aspect: A, refAspect: A });
    if (res.say) said.push(res.say);
    if (res.ok && okAt === null) okAt = i / 15;
  }
  assert.deepEqual(said, ["OK、そのまま構えて"]);
  assert.ok(okAt >= 1.9 && okAt <= 2.3, `ok at ${okAt}`);
});

test("front camera words left/right from the player's view", () => {
  const c = createCoach();
  const r = run(c, 0, 3, i => jitter(shift(base, -0.12), i), true);
  assert.match(r.said[0], /スマホを、あなたから見て少し右に向けて/);
});

// ---------- both hands up to start recording ----------
import { createHandsUp, handsUpStep } from "../coach.js";

// Both wrists `h` frame heights above the nose (negative: below), waving a little sideways.
const handsUp = (i, h = 0.1) => base.map((q, k) => (k === 15 || k === 16
  ? [base[k === 15 ? 11 : 12][0] + 0.02 * Math.sin(i), base[0][1] - h, q[2], 1] : q));
function firesAt(f, sec, fps = 15) {
  const st = createHandsUp(), at = [];
  for (let i = 0; i < sec * fps; i++) if (handsUpStep(st, i / fps, f(i), A)) at.push(i / fps);
  return at;
}

test("both hands up for a second starts recording, once per raise", () => {
  const at = firesAt(i => handsUp(i), 4);
  assert.equal(at.length, 1);
  assert.ok(at[0] >= 0.9 && at[0] <= 1.2, `at ${at[0]}`);
});

test("a one-frame dropout does not break the hold; lowering the hands re-arms", () => {
  assert.equal(firesAt(i => (i === 8 ? null : handsUp(i)), 2).length, 1);
  assert.equal(firesAt(i => (i % 30 < 20 ? handsUp(i) : base), 4).length, 2);
});

test("hands up too briefly, one hand only, or hands at face height do not start recording", () => {
  assert.deepEqual(firesAt(i => (i < 10 ? handsUp(i) : base), 3), []);
  assert.deepEqual(firesAt(i => handsUp(i).map((q, k) => (k === 15 ? base[15] : q)), 3), []);
  assert.deepEqual(firesAt(i => handsUp(i, -0.02), 3), []);
});

const allRefs = JSON.parse(readFileSync(new URL("../refs.json", import.meta.url))).refs;
for (const r of allRefs) {
  test(`${r.id}: the reference serve itself does not start recording`, () => {
    const st = createHandsUp();
    assert.equal(r.frames.filter((p, i) => handsUpStep(st, i / 30, p, r.width / r.height)).length, 0);
  });
}
