// npm test  (node --test test/guide.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guide, score, TOL } from "../guide.js";

const all = JSON.parse(readFileSync(new URL("../refs.json", import.meta.url))).refs;
const stance = r => r.frames[r.stance];
const asp = r => r.width / r.height;

// Perturb a pose the way a camera move would look in 2D.
const scale = (p, k) => p.map(([x, y, z, v]) => [0.5 + (x - 0.5) * k, 0.5 + (y - 0.5) * k, z, v]);
const shift = (p, dx) => p.map(([x, y, z, v]) => [x + dx, y, z, v]);

for (const r of all) {
  test(`${r.id}: reference against itself is aligned`, () => {
    const res = guide(stance(r), stance(r), asp(r), asp(r));
    assert.deepEqual(res.instructions, []);
    assert.equal(res.score, 100);
    assert.ok(res.ok);
  });
  test(`${r.id}: body too small -> move camera closer; too big -> move it back`, () => {
    assert.equal(guide(scale(stance(r), 0.75), stance(r), asp(r), asp(r)).instructions.find(i => i.kind === "size")?.say, "カメラを近づけて");
    assert.equal(guide(scale(stance(r), 1.3), stance(r), asp(r), asp(r)).instructions.find(i => i.kind === "size")?.say, "カメラを離して");
  });
  test(`${r.id}: body too far left / right -> turn camera left / right`, () => {
    assert.equal(guide(shift(stance(r), -0.15), stance(r), asp(r), asp(r)).instructions.find(i => i.kind === "pan")?.say, "カメラを少し左に向けて");
    assert.equal(guide(shift(stance(r), 0.15), stance(r), asp(r), asp(r)).instructions.find(i => i.kind === "pan")?.say, "カメラを少し右に向けて");
  });
  test(`${r.id}: selfie camera flips the left/right wording to the player's view`, () => {
    assert.equal(guide(shift(stance(r), -0.15), stance(r), asp(r), asp(r), { front: true }).instructions.find(i => i.kind === "pan")?.say, "スマホを、あなたから見て少し右に向けて");
  });
  test(`${r.id}: score ignores size and position`, () => {
    assert.equal(score(shift(scale(stance(r), 0.7), 0.1), stance(r), asp(r), asp(r)), 100);
  });
}

// The OK threshold must reject a camera 45 degrees off: the pro's other views stand in for that.
test("every other pro view scores below the OK threshold", () => {
  for (const a of all) for (const b of all) {
    if (a === b) continue;
    const s = score(stance(a), stance(b), asp(a), asp(b));
    assert.ok(s < TOL.okScore, `${a.id} vs ${b.id} = ${s}`);
  }
});
