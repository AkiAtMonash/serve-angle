// Serve detection on a landmark sequence. Same rules as serve_analyze.py on the PC,
// so trophy/contact land on the same frames (checked in test/serve.test.mjs).
// frames: array of poses (33 x [x, y, z, v], normalized) or null where no person was found.
// times: seconds for each frame.

const NOSE = 0, LSH = 11, RSH = 12, LEL = 13, REL = 14, LWR = 15, RWR = 16, LHI = 23, RHI = 24;
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const SIDE = { L: [LSH, LEL, LWR], R: [RSH, REL, RWR] };

// Undo frames where the model swapped left/right: keep whichever labelling is closer to the previous frame.
export function fixSwaps(frames, aspect = 1) {
  const perm = [...Array(33).keys()];
  for (const [a, b] of PAIRS) [perm[a], perm[b]] = [b, a];
  const dist = (p, q, map) => p.reduce((s, _, i) => s + Math.hypot((p[map[i]][0] - q[i][0]) * aspect, p[map[i]][1] - q[i][1]), 0);
  const ident = [...Array(33).keys()];
  let prev = null;
  return frames.map(p => {
    if (!p) return p;
    let out = p;
    if (prev && dist(p, prev, perm) < dist(p, prev, ident)) out = perm.map(i => p[i]);
    prev = out;
    return out;
  });
}

const torso = p => Math.hypot((p[LSH][0] + p[RSH][0]) / 2 - (p[LHI][0] + p[RHI][0]) / 2, (p[LSH][1] + p[RSH][1]) / 2 - (p[LHI][1] + p[RHI][1]) / 2);
const angle = (a, b, c) => {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

// One entry per serve: {trophy, contact} frame indices. fps = frames per second of the sequence.
export function findServes(frames, fps) {
  const above = frames.map(p => p ? (p[NOSE][1] - Math.min(p[LWR][1], p[RWR][1])) / torso(p) : -Infinity);
  const idx = above.flatMap((a, i) => (a > 0.5 ? [i] : []));
  const groups = [];
  let start = null;
  idx.forEach((i, k) => {
    if (start === null) start = i;
    if (k === idx.length - 1 || idx[k + 1] - i > 1.5 * fps) {
      if (i - start >= 0.15 * fps) groups.push([start, i]);
      start = null;
    }
  });
  const serves = [];
  for (const [s, e] of groups) {
    const pad = Math.floor(0.5 * fps), lo = Math.max(0, s - pad), hi = Math.min(frames.length - 1, e + pad);
    const peak = {};
    for (const k of ["L", "R"]) {
      let best = -1, by = Infinity;
      for (let i = lo; i <= hi; i++) if (frames[i] && frames[i][SIDE[k][2]][1] < by) { by = frames[i][SIDE[k][2]][1]; best = i; }
      peak[k] = best;
    }
    const [toss, hit] = ["L", "R"].sort((a, b) => peak[a] - peak[b]);   // toss arm peaks first
    const trophy = peak[toss], contact = peak[hit];
    if (contact - trophy < 2 || trophy < 0) continue;
    const T = frames[trophy], [ts, te, tw] = SIDE[toss];
    if (angle(T[ts], T[te], T[tw]) < 130) continue;                     // bent toss arm: not a real serve
    serves.push({ trophy, contact });
  }
  return serves;
}

// Frame of the ready stance before a serve: last frame before the trophy with both wrists below the shoulders.
export function stanceFrame(frames, trophy) {
  for (let i = trophy; i >= 0; i--) {
    const p = frames[i];
    if (p && p[LWR][1] > p[LSH][1] && p[RWR][1] > p[RSH][1]) return i;
  }
  return 0;
}

// Linear map from your time (s) to the reference frame index so that trophy and contact coincide.
export function warp(t, you, ref) {
  // you: {trophy, contact} in seconds; ref: {trophy, contact} in frame indices
  const k = (ref.contact - ref.trophy) / (you.contact - you.trophy);
  return ref.trophy + (t - you.trophy) * k;
}
