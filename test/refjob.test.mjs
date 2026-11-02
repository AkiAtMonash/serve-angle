import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { serveWindows, reference, videoTime } from "../refjob.js";

const refs = JSON.parse(readFileSync(new URL("../refs.json", import.meta.url))).refs;
const right = refs.find(x => x.id === "right_rear");

test("keeps the window around the serve it found", () => {
  const doc = { frames: right.frames, width: right.width, height: right.height, fps: 30 };
  const wins = serveWindows(doc);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].trophy, right.trophy);
  assert.equal(wins[0].stance, right.stance);
  assert.ok(wins[0].from <= wins[0].stance && wins[0].to >= wins[0].contact);

  const r = reference(doc, wins[0], { id: "user_test", label: "テスト" });
  assert.equal(r.trophy, right.trophy - wins[0].from);
  assert.equal(r.contact, right.contact - wins[0].from);
  assert.equal(r.frames.length, wins[0].to - wins[0].from + 1);
  assert.ok(r.frames.every(p => p && p.length === 33), "every kept frame has a pose");
  // the kept video still starts at the whole file, so frame 0 is drawn at that offset
  assert.equal(videoTime(r, 0), wins[0].from / 30);
  assert.equal(videoTime(r, 30), (wins[0].from + 30) / 30);
});

test("the built-in references keep their slow-motion timing", () => {
  assert.equal(videoTime(right, 0), 0);
  assert.equal(Math.round(videoTime(right, 30) * 10) / 10, 3);
});

test("a video with two serves offers both", () => {
  const gap = Array.from({ length: 60 }, () => null);          // hands down between the two serves
  const doc = { frames: [...right.frames, ...gap, ...right.frames], width: right.width, height: right.height, fps: 30 };
  const wins = serveWindows(doc);
  assert.equal(wins.length, 2);
  assert.equal(wins[0].trophy, right.trophy);
  assert.equal(wins[1].trophy, right.frames.length + gap.length + right.trophy);
});
