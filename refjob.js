// Turning a whole pose sequence into a reference: which frames are serves, and what to keep of one.
// Used by server.mjs after the PC estimates an uploaded video, and by test/refjob.test.mjs.
import { fixSwaps, findServes, stanceFrame } from "./serve.js";

// One entry per serve, with the window that gets kept: the stance to a little after the contact.
export function serveWindows(doc) {
  const fixed = fixSwaps(doc.frames, doc.width / doc.height);
  return findServes(fixed, doc.fps).map(sv => {
    const stance = stanceFrame(fixed, sv.trophy);
    return {
      trophy: sv.trophy, contact: sv.contact, stance,
      from: Math.max(0, stance - 10),
      to: Math.min(fixed.length - 1, sv.contact + Math.round(0.7 * doc.fps)),
    };
  });
}

// Seconds in the reference video for pose frame `frame`. The built-in references are re-rendered at
// one third of the speed (about 0.1 s of video per pose frame); an uploaded video keeps its own speed,
// and starts at the beginning of the kept window, so it carries where it starts.
export const videoTime = (ref, frame) => (ref.videoFrom ?? 0) + frame * (ref.videoStep ?? 0.1);

// The reference entry for one window, in the same shape as refs.json (trophy/contact/stance counted
// from the start of the window, because the app draws these frames without the rest of the video).
export function reference(doc, win, { id, label }) {
  const fixed = fixSwaps(doc.frames, doc.width / doc.height);
  const frames = fixed.slice(win.from, win.to + 1);
  for (let i = 0; i < frames.length; i++) frames[i] ??= frames[i - 1] ?? frames.find(Boolean);
  const round = p => p.map(q => q.map(x => Math.round(x * 1e4) / 1e4));
  return {
    id, user: true, server: true, label, at: "", width: doc.width, height: doc.height,
    trophy: win.trophy - win.from, contact: win.contact - win.from, stance: win.stance - win.from,
    lines: [], videoFrom: win.from / doc.fps, videoStep: 1 / doc.fps, frames: frames.map(round),
  };
}
