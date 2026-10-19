// Camera placement guide: compares your ready-stance skeleton with the reference stance.
// Pure functions; runs in the browser and in Node (tests).
//
// A pose is an array of 33 MediaPipe landmarks [x, y, z, visibility], x/y normalized to the frame.
// `aspect` = frame width / height, so x * aspect and y share one unit.
//
// Not included on purpose: telling you which way to walk the camera around you. Estimating the camera
// angle from one 2D skeleton failed leave-one-out checks on the reference clips (MediaPipe depth,
// shoulder order and view matching all missed), so the angle is matched with the court-line overlay
// and the similarity score instead.

const NOSE = 0, LSH = 11, RSH = 12, LHI = 23, RHI = 24, LKN = 25, RKN = 26, LAN = 27, RAN = 28;
const CORE = [NOSE, LSH, RSH, LHI, RHI, LKN, RKN, LAN, RAN];

// OK_SCORE: the pro's own views 45 degrees apart score 73-79 against each other, so 90+ means
// the shape matches more closely than a neighbouring view does.
export const TOL = { size: 0.10, pan: 0.05, okScore: 90 };

const mid = (p, a, b) => [(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2];

export function features(p) {
  const nose = p[NOSE], hip = mid(p, LHI, RHI);
  const feetOk = p[LAN][3] > 0.3 && p[RAN][3] > 0.3;
  const foot = feetOk ? mid(p, LAN, RAN) : mid(p, LKN, RKN);
  const height = foot[1] - nose[1];
  return { height: feetOk ? height : height * 1.33, cx: hip[0] };  // knees instead of ankles: scale up roughly
}

// Similarity-aligned (rotation, scale, shift) RMS distance of the core points -> 0..100 score.
export function score(you, ref, aspectYou, aspectRef) {
  const pts = (p, a) => CORE.map(i => [p[i][0] * a, p[i][1]]);
  const A = pts(you, aspectYou), B = pts(ref, aspectRef);
  const c = P => P.reduce((s, q) => [s[0] + q[0] / P.length, s[1] + q[1] / P.length], [0, 0]);
  const ca = c(A), cb = c(B);
  const a = A.map(q => [q[0] - ca[0], q[1] - ca[1]]), b = B.map(q => [q[0] - cb[0], q[1] - cb[1]]);
  const n = P => Math.sqrt(P.reduce((s, q) => s + q[0] ** 2 + q[1] ** 2, 0));
  const na = n(a), nb = n(b);
  const an = a.map(q => [q[0] / na, q[1] / na]), bn = b.map(q => [q[0] / nb, q[1] / nb]);
  let sxx = 0, sxy = 0;
  an.forEach((q, i) => { sxx += q[0] * bn[i][0] + q[1] * bn[i][1]; sxy += q[0] * bn[i][1] - q[1] * bn[i][0]; });
  const th = Math.atan2(sxy, sxx), co = Math.cos(th), si = Math.sin(th);
  const rms = Math.sqrt(an.reduce((s, q, i) => s + (q[0] * co - q[1] * si - bn[i][0]) ** 2 + (q[0] * si + q[1] * co - bn[i][1]) ** 2, 0) / an.length);
  return Math.max(0, Math.round(100 - rms * 400));
}

// Instructions for moving the camera, most important first. ok = shape, size and framing all match.
export function guide(you, ref, aspectYou, aspectRef) {
  const f = features(you), g = features(ref);
  const out = [];
  const size = f.height / g.height;
  if (Math.abs(size - 1) > TOL.size) out.push({ kind: "size", value: size, say: size < 1 ? "カメラを近づけて" : "カメラを離して" });
  const pan = f.cx - g.cx;
  if (Math.abs(pan) > TOL.pan) out.push({ kind: "pan", value: pan, say: `カメラを少し${pan < 0 ? "左" : "右"}に向けて` });
  const s = score(you, ref, aspectYou, aspectRef);
  return { instructions: out, score: s, ok: !out.length && s >= TOL.okScore, size, pan };
}
