import test from "node:test";
import assert from "node:assert/strict";
import { poseFrames } from "../estimate.js";

// Stand-in for <video>: a seek lands after `polls` reads of `seeking`, unless blocked() says the page
// cannot decode right now (hidden page, lost decoder).
class FakeVideo {
  #t = 0; #seeking = false; #left = 0;
  constructor({ duration = 0.1, polls = 1, blocked = () => false } = {}) {
    this.duration = duration; this.readyState = 2; this.polls = polls; this.blocked = blocked;
  }
  get currentTime() { return this.#t; }
  set currentTime(t) { this.#t = t; this.#seeking = true; this.#left = this.polls; }
  get seeking() {
    if (!this.#seeking) return false;
    if (!this.blocked()) this.#seeking = --this.#left > 0;
    return this.#seeking;
  }
}

const opts = { step: 1, wait: 5 };

test("estimates every sampled frame and reports progress", async () => {
  const seen = [];
  const frames = await poseFrames(new FakeVideo({ duration: 0.1 }), v => [v.currentTime], {
    ...opts, onProgress: p => seen.push(p),
  });
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.flat(), [0, 1 / 30, 2 / 30]);
  assert.equal(seen.at(-1), 1);
});

test("waits for the screen instead of stopping, then carries on from the same frame", { timeout: 5000 }, async () => {
  let hidden = true;
  let said;
  const waited = new Promise(r => { said = r; });
  const video = new FakeVideo({ duration: 0.1, blocked: () => hidden });
  const run = poseFrames(video, v => [v.currentTime], {
    ...opts, hidden: () => hidden, onWait: () => said(),
  });
  try {
    await waited;                                  // it told the user it is waiting, not silently frozen
    hidden = false;
    const frames = await run;
    assert.equal(frames.length, 3);
    assert.ok(frames.every(Boolean));
  } finally {
    hidden = false;                                // never leave the loop waiting in a failed test
  }
});

test("a frame the decoder never gives up becomes a gap, not the end of the run", async () => {
  const frames = await poseFrames(new FakeVideo({ duration: 0.1, blocked: () => true }), v => [v.currentTime], opts);
  assert.deepEqual(frames, [null, null, null]);
});
