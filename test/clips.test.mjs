import test from "node:test";
import assert from "node:assert/strict";
import { favName } from "../clips.js";

// A favourite is marked in the Drive file name, so the upload must keep the extension.
test("a favourite keeps its extension and gets _fav before it", () => {
  assert.equal(favName("serve_right_20261025_105521.mp4"), "serve_right_20261025_105521_fav.mp4");
  assert.equal(favName("serve_right_20261025_105521.webm"), "serve_right_20261025_105521_fav.webm");
});
