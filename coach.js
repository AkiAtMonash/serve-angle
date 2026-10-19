// When and what to say while you set up the camera. Pure state machine; tested in test/coach.test.mjs.
//
// Field test (2026-10-19): speaking on every frame made setup impossible. Walking to the tripod to
// adjust it made you look big ("move the camera back"), and every small jitter changed the advice.
// So: judge only while you stand still in your stance, say everything that needs fixing in one
// sentence, say it once, and stay quiet while you walk or stand next to the camera.

import { guide, TOL } from "./guide.js";

export const COACH = {
  stillSec: 1.0,     // stand still this long before anything is judged
  stillMove: 0.02,   // "still" = hips move less than this fraction of the frame
  okHoldSec: 1.0,    // after stillness, aligned for this long = OK (so ~2 s in total)
  repeatSec: 15,     // repeat unchanged advice at most this often
  speakSize: 0.15,   // speak about distance beyond +-15 % (OK needs +-10 %: no flip-flopping in between)
  speakPan: 0.07,
};

const LSH = 11, RSH = 12, LHI = 23, RHI = 24, NOSE = 0, LAN = 27, RAN = 28;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function createCoach() {
  return { hist: [], spokeThisStill: false, lastSay: "", lastAt: -Infinity, okSince: null, saidOk: false };
}

// One frame. Returns { display, say (string or null), ok (aligned and held: start recording) }.
export function step(st, { t, pose, ref, aspect, refAspect, front = false }) {
  const reset = display => { st.hist = []; st.spokeThisStill = false; st.okSince = null; st.saidOk = false; return { display, say: null, ok: false }; };
  if (!pose) return reset("全身が映るところで構えてほしいのだ");
  const vis = i => pose[i][3] > 0.5;
  const height = (pose[LAN][1] + pose[RAN][1]) / 2 - pose[NOSE][1];
  // Next to the camera (adjusting it): head or hips missing, or far bigger than the frame. Stay quiet.
  if (!vis(NOSE) || !vis(LHI) || !vis(RHI) || !vis(LSH) || !vis(RSH) || height > 1.2) return reset("調整中…（サーブ位置で構えると判定するのだ）");

  const res = guide(pose, ref.frames[ref.stance], aspect, refAspect, { front });
  const hx = (pose[LHI][0] + pose[RHI][0]) / 2, hy = (pose[LHI][1] + pose[RHI][1]) / 2;
  st.hist.push({ t, hx, hy, size: res.size, pan: res.pan, score: res.score });
  while (st.hist.length && t - st.hist[0].t > COACH.stillSec + 0.5) st.hist.shift();

  const span = t - st.hist[0].t;
  const dev = Math.max(...st.hist.map(h => Math.hypot(h.hx - hx, h.hy - hy)));
  if (span < COACH.stillSec || dev > COACH.stillMove) {
    if (dev > COACH.stillMove) { st.hist = st.hist.slice(-1); st.spokeThisStill = false; st.okSince = null; st.saidOk = false; }
    return { display: "構えて止まると判定するのだ", say: null, ok: false, score: res.score };
  }

  // Standing still: decide from the median of the last second, not one jittery frame.
  const size = median(st.hist.map(h => h.size)), pan = median(st.hist.map(h => h.pan)), score = median(st.hist.map(h => h.score));
  const feetOk = pose[LAN][3] > 0.3 && pose[RAN][3] > 0.3;
  const parts = [];
  if (!feetOk) parts.push("足まで入るようにカメラを離して");
  else if (Math.abs(size - 1) > COACH.speakSize) {
    // apparent size is inversely proportional to distance, so the factor to change the distance by is `size`
    parts.push(`カメラを今の約${size.toFixed(1)}倍の距離まで${size > 1 ? "離して" : "近づけて"}`);
  }
  if (Math.abs(pan) > COACH.speakPan) {
    const camLeft = pan < 0, much = Math.abs(pan) > 0.15 ? "" : "少し";
    parts.push(front ? `スマホを、あなたから見て${much}${camLeft ? "右" : "左"}に向けて` : `カメラを${much}${camLeft ? "左" : "右"}に向けて`);
  }
  const aligned = !parts.length && Math.abs(size - 1) <= TOL.size && Math.abs(pan) <= TOL.pan && score >= TOL.okScore;
  if (!parts.length && !aligned && score < TOL.okScore) parts.push("角度が違うのだ。赤い線が重なるようにカメラを回り込ませて");

  if (aligned) {
    st.okSince ??= t;
    const ok = t - st.okSince >= COACH.okHoldSec;
    const say = st.saidOk ? null : "OK、そのまま構えて";
    st.saidOk = true;
    return { display: "OK、そのまま構えて", say, ok, score };
  }
  st.okSince = null; st.saidOk = false;
  if (!parts.length) return { display: `あと少し（${score}）`, say: null, ok: false, score };

  const text = parts.join("。");
  let say = null;
  if (!st.spokeThisStill || t - st.lastAt > COACH.repeatSec) {
    say = text; st.spokeThisStill = true; st.lastSay = text; st.lastAt = t;
  }
  return { display: text, say, ok: false, score };
}
