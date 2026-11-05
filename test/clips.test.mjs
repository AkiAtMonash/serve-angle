import test from "node:test";
import assert from "node:assert/strict";
import { favName, figName, memoName, notesName } from "../clips.js";

// A favourite is marked in the Drive file name, so the upload must keep the extension.
test("a favourite keeps its extension and gets _fav before it", () => {
  assert.equal(favName("serve_right_20261025_105521.mp4"), "serve_right_20261025_105521_fav.mp4");
  assert.equal(favName("serve_right_20261025_105521.webm"), "serve_right_20261025_105521_fav.webm");
});

// The memo sits next to the clip it belongs to, with the same _fav name.
test("a favourite's memo is a .txt beside the clip", () => {
  assert.equal(memoName("serve_right_20261025_105521.mp4"), "serve_right_20261025_105521_fav.txt");
});

// The figure travels with the clip too, as a PNG with the same name.
test("a favourite's figure is a .png beside the clip", () => {
  assert.equal(figName("serve_right_20261025_105521.mp4"), "serve_right_20261025_105521_fav.png");
});

// One note per practice end, and the name carries the date so two sessions never collide.
test("today's memo is named with the date and time", () => {
  assert.equal(notesName(new Date(2026, 10, 4, 17, 3, 9)), "serve_notes_20261104_170309.txt");
});
