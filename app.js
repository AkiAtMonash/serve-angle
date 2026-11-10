import { createCoach, createHandsUp, handsUpStep, step as coachStep } from "./coach.js";
import { findServes, fixSwaps, skipRaise, stanceFrame, warp } from "./serve.js";
import { reference, serveWindows, videoTime } from "./refjob.js";
import { poseFrames } from "./estimate.js";
import { addClip, allClips, dropClip, favName, figName, memoName, notesName, setFav, setFig, stamp, putRef, allRefs, dropRef } from "./clips.js?v=22";
import { DRIVE_URL } from "./drive-url.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const MODEL = n => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${n}/float16/latest/pose_landmarker_${n}.task`;
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
const COL = { you: "#ffd60a", ref: "#5ce1e6", line: "#ff453a" };
const $ = id => document.getElementById(id);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: settings just don't stick */ } },
};
// 送信先は drive-url.js だけ。URLらしくなければ送信しない（クリップはスマホに残る）。
const driveUrl = () => (DRIVE_URL.startsWith("https://") ? DRIVE_URL.trim() : "");

// A phone on a weak connection drops a request now and then: try again before giving up, because
// without refs.json the home screen has nothing to show.
async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    try { return await fetch(url).then(r => r.json()); }
    catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
}

// Show any crash on screen: on a phone at the court there is no console to look at.
const showError = e => { const w = $("warn"); w.style.display = "block"; w.textContent = `エラー: ${e?.message || e}`; };
addEventListener("error", e => showError(e.error || e.message));
addEventListener("unhandledrejection", e => showError(e.reason));

let refs = [], ref = null;
let vision = null, live = null, still = null, Pose = null;   // MediaPipe fileset, VIDEO/IMAGE-mode landmarkers, class
let stream = null, wakeLock = null;

// ---------- small helpers ----------
function show(id) { for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id); }

// ---------- memo sheet ----------
// The two notes this app keeps: what a favourite was watching for, and the note left when practice
// ends. "保存" with an empty box is allowed, so a favourite does not need words.
let memoBack = null;
function askMemo(title, value = "", placeholder = "") {
  $("memoTitle").textContent = title;
  $("memoText").value = value;
  $("memoText").placeholder = placeholder;
  $("memo").classList.add("on");
  setTimeout(() => $("memoText").focus(), 0);
  return new Promise(res => { memoBack = res; });
}
function closeMemo(v) {
  $("memo").classList.remove("on");
  const done = memoBack;
  memoBack = null;
  done?.(v);                                  // null = やめる, otherwise the words (may be empty)
}
$("memoOk").onclick = () => closeMemo($("memoText").value.trim());
$("memoCancel").onclick = () => closeMemo(null);

// ---------- figure: your serve beside the pro's, at the moment the racket meets the ball ----------
// Made on the phone right after a favourite, so it is there while you are still at the court. The same
// PNG goes to Drive with the clip.
const FIG = { w: 540, h: 960, torso: 5.6, up: 1.1, gap: 10, banner: 0.12 };
const fHip = p => [(p[23][0] + p[24][0]) / 2, (p[23][1] + p[24][1]) / 2];
const fTorso = p => {
  const h = fHip(p);
  return Math.hypot((p[11][0] + p[12][0]) / 2 - h[0], (p[11][1] + p[12][1]) / 2 - h[1]);
};

// Wait for the frame at `t` to show. A seek takes a few hundred ms; give up rather than hang the screen.
function seekTo(v, t) {
  return new Promise(res => {
    if (!v || !v.videoWidth || !isFinite(t)) return res(false);
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", onSeek);
      res(ok);
    };
    const onSeek = () => finish(true);
    v.addEventListener("seeked", onSeek);
    setTimeout(() => finish(v.readyState >= 2), 1500);
    try { v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.02)); } catch { finish(false); }
  });
}

function figBones(g, q, color, width, dash) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round";
  g.setLineDash(dash ? [width * 2, width * 2] : []);
  for (const [a, b] of BONES) {
    if (!q[a] || !q[b]) continue;
    g.beginPath(); g.moveTo(q[a][0], q[a][1]); g.lineTo(q[b][0], q[b][1]); g.stroke();
  }
  g.restore();
}

function figPanel(g, src, sw, sh, pts, color, k, topCut, ox, overlay) {
  const tor = fTorso(pts), [hx, hy] = fHip(pts);
  const ch = FIG.torso * tor * k, cw = ch * FIG.w / FIG.h;
  const x0 = Math.max(0, Math.min(sw - cw, hx - cw / 2));
  const y0 = Math.max(topCut, Math.min(sh - ch, hy - FIG.up * tor - ch / 2));
  const sx = FIG.w / cw, sy = FIG.h / ch;
  if (src) g.drawImage(src, x0, y0, cw, ch, ox, 0, FIG.w, FIG.h);
  const at = p => [ox + (p[0] - x0) * sx, (p[1] - y0) * sy];
  if (overlay) figBones(g, overlay.map(at), "rgba(92,225,230,0.92)", 2.5, true);
  figBones(g, pts.map(at), color, 3, false);
}

function wrapText(g, text, maxWidth) {
  const out = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") { out.push(line); line = ""; continue; }
    if (line && g.measureText(line + ch).width > maxWidth) { out.push(line); line = ch; }
    else line += ch;
  }
  if (line) out.push(line);
  return out;
}

async function makeFigure() {
  if (!rv || !ref) return;
  const rvV = $("rv"), refV = $("refV");
  $("figNote").textContent = "";
  rvV.pause();
  $("play").textContent = "再生";
  if (!rv.you) { $("rvMemo").textContent = "サーブが見つからなかったので、図は作れないのだ"; return; }

  const youI = Math.min(rv.poses.length - 1, nearestIndex(rv.you.contact) + 1);
  const proI = Math.min(ref.frames.length - 1, ref.impact ?? ref.contact);
  const youPose = rv.poses[youI], proPose = ref.frames[proI];
  if (!youPose || !proPose) return;

  await seekTo(rvV, rv.times[youI] ?? 0);
  const refOk = ref.video ? await seekTo(refV, videoTime(ref, proI)) : false;

  const ys = { w: rvV.videoWidth || 1080, h: rvV.videoHeight || 1920 };
  const ps = refOk ? { w: refV.videoWidth, h: refV.videoHeight } : { w: ref.width, h: ref.height };
  const topCut = ref.video ? Math.round(ps.h * FIG.banner) : 0;
  const yp = youPose.map(p => [p[0] * ys.w, p[1] * ys.h]);
  const pp = proPose.map(p => [p[0] * ps.w, p[1] * ps.h]);

  // One scale for both panels: the window is the same number of torso lengths on each side, made as
  // tall as the tighter of the two frames allows, so the two people come out the same size.
  const torY = fTorso(yp), torP = fTorso(pp);
  const baseY = FIG.torso * torY, baseP = FIG.torso * torP;
  const maxY = Math.min(ys.h, ys.w * FIG.h / FIG.w);
  const maxP = Math.min(ps.h - topCut, ps.w * FIG.h / FIG.w);
  if (baseY <= 0 || baseP <= 0 || maxY <= 0 || maxP <= 0) return;
  const k = Math.min(maxY / baseY, maxP / baseP);

  const scale = torY / torP, [yhx, yhy] = fHip(yp), [phx, phy] = fHip(pp);
  const proOnYou = pp.map(q => [yhx + (q[0] - phx) * scale, yhy + (q[1] - phy) * scale]);

  const cv = $("figCv"), g0 = cv.getContext("2d");
  const memo = rv.memo || "";
  let lines = [];
  if (memo) { g0.font = "21px 'Yu Gothic', Meiryo, system-ui, sans-serif"; lines = wrapText(g0, memo, FIG.w * 2 + FIG.gap - 44).slice(0, 3); }
  const barH = lines.length ? 20 + lines.length * 30 : 0;
  cv.width = FIG.w * 2 + FIG.gap;
  cv.height = FIG.h + barH;
  const g = cv.getContext("2d");
  g.fillStyle = "#0c0c0c"; g.fillRect(0, 0, cv.width, cv.height);

  figPanel(g, rvV.videoWidth ? rvV : null, ys.w, ys.h, yp, "#ffd60a", k, 0, 0, proOnYou);
  figPanel(g, refOk ? refV : null, ps.w, ps.h, pp, "#5ce1e6", k, topCut, FIG.w + FIG.gap);
  if (ref.video && !refOk) $("figNote").textContent = "お手本の映像を読み込めなかったのだ（骨格だけ出しているのだ）";

  if (lines.length) {
    g.fillStyle = "rgba(0,0,0,0.92)"; g.fillRect(0, FIG.h, cv.width, barH);
    g.font = "21px 'Yu Gothic', Meiryo, system-ui, sans-serif"; g.fillStyle = "#ffffff"; g.textBaseline = "top";
    lines.forEach((line, n) => g.fillText(line, 22, FIG.h + 12 + n * 30));
  }

  $("fig").classList.add("on");
  cv.toBlob(b => { if (b) { setFig(rv.name, b); uploadClips(); } }, "image/png");
}

$("figClose").onclick = () => $("fig").classList.remove("on");


// Where a video is actually drawn inside its element (object-fit: contain).
function rectOf(el, vw, vh) {
  const W = el.clientWidth, H = el.clientHeight, k = Math.min(W / vw, H / vh);
  return { x: el.offsetLeft + (W - vw * k) / 2, y: el.offsetTop + (H - vh * k) / 2, w: vw * k, h: vh * k };
}

function fitCanvas(cv) {
  const d = devicePixelRatio || 1;
  if (cv.width !== cv.clientWidth * d || cv.height !== cv.clientHeight * d) { cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; }
  const g = cv.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  return g;
}

// pts: points in canvas pixels, [x, y, visibility]. Joints the model could not see (visibility < 0.5,
// e.g. the racket-arm elbow behind the head during the racket drop) are guesses: drawn dashed.
function drawBones(g, pts, color, width = 2, alpha = 1) {
  g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round";
  for (const [a, b] of BONES) {
    if (!pts[a] || !pts[b]) continue;
    g.setLineDash((pts[a][2] ?? 1) < 0.5 || (pts[b][2] ?? 1) < 0.5 ? [width * 1.5, width * 2] : []);
    g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
  }
  g.restore();
}
const toCanvas = (pose, r) => pose.map(p => [r.x + p[0] * r.w, r.y + p[1] * r.h, p[3]]);

function drawLines(g, lines, r, alpha = 0.8) {
  g.save(); g.globalAlpha = alpha; g.strokeStyle = COL.line; g.lineWidth = 3;
  for (const [x0, y0, x1, y1] of lines) { g.beginPath(); g.moveTo(r.x + x0 * r.w, r.y + y0 * r.h); g.lineTo(r.x + x1 * r.w, r.y + y1 * r.h); g.stroke(); }
  g.restore();
}

const asPose = lm => lm.map(p => [p.x, p.y, p.z, p.visibility ?? 1]);
const lerpPose = (frames, f) => {
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(f))), j = Math.min(frames.length - 1, i + 1), t = Math.max(0, Math.min(1, f - i));
  return frames[i].map((p, k) => p.map((v, c) => v * (1 - t) + frames[j][k][c] * t));
};

// ---------- MediaPipe ----------
async function landmarkers() {
  if (live) return;
  const { FilesetResolver, PoseLandmarker } = await import(`${MP}/vision_bundle.mjs`);
  Pose = PoseLandmarker;
  vision ??= await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = async (mode, delegate) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL("full"), delegate }, runningMode: mode, numPoses: 1,
  });
  try { live = await make("VIDEO", "GPU"); } catch { live = await make("VIDEO", "CPU"); }
}
// One still frame at a time, for the reference video: the video is seeked frame by frame on the phone.
async function stillLandmarker() {
  await landmarkers();
  if (!still) {
    const opts = { baseOptions: { modelAssetPath: MODEL("full"), delegate: "GPU" }, runningMode: "IMAGE", numPoses: 1 };
    try { still = await Pose.createFromOptions(vision, opts); }
    catch { still = await Pose.createFromOptions(vision, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "CPU" } }); }
  }
  return still;
}
function detect(lm, src, ts) {
  let out = null;
  const cb = r => { if (r.landmarks.length) out = asPose(r.landmarks[0]); };
  ts === undefined ? lm.detect(src, cb) : lm.detectForVideo(src, ts, cb);
  return out;
}

// ---------- home: pick the angle on the half court ----------
// Seven angles around the server. 0 (front) is not offered: the phone would sit where you serve from.
const ANGLES = [
  { deg: 45, name: "右前" }, { deg: 90, name: "右" }, { deg: 135, name: "右後ろ" },
  { deg: 180, name: "真後ろ" }, { deg: 225, name: "左後ろ" }, { deg: 270, name: "左" },
  { deg: 315, name: "左前" },
];
const AZ = { cx: 185, cy: 300, r: 105 };          // サーバー（頭の中心）と、目のアイコンの軌道半径
const azPos = deg => [
  Math.round(AZ.cx + AZ.r * Math.sin(deg * Math.PI / 180)),
  Math.round(AZ.cy - AZ.r * Math.cos(deg * Math.PI / 180)),
];
const atAngle = deg => refs.filter(r => +r.azimuth === deg);
const angleName = deg => ANGLES.find(a => a.deg === deg)?.name ?? "";

let pick = {};          // { az }: the angle chosen on the court, { az, ref }: the serve chosen at that angle
let addAz = null;       // the angle a reference video was added from (pre-selected in the picker)
let addJob = null;      // a finished estimation, kept until the status is tapped to check it

function thumb(cv, r) {
  const g = cv.getContext("2d"); cv.width = 320; cv.height = 180;
  g.fillStyle = "#000"; g.fillRect(0, 0, 320, 180);
  const k = Math.min(320 / r.width, 180 / r.height), rr = { w: r.width * k, h: r.height * k };
  rr.x = (320 - rr.w) / 2; rr.y = (180 - rr.h) / 2;
  drawLines(g, r.lines || [], rr, 1);
  drawBones(g, toCanvas(r.frames[r.stance], rr), COL.ref, 1);
}

function renderEyes() {
  const svg = $("court");
  for (const g of svg.querySelectorAll("g.eye")) g.remove();
  for (const a of ANGLES) {
    const [x, y] = azPos(a.deg);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", `eye${atAngle(a.deg).length ? "" : " none"}${pick.az === a.deg ? " sel" : ""}`);
    g.setAttribute("transform", `translate(${x},${y})`);
    g.innerHTML = `<circle class="halo" r="23"/><circle class="bg" r="15"/><ellipse class="ball" rx="7.5" ry="4.8"/><circle class="pupil" r="2.6"/><text class="lbl" y="28" text-anchor="middle">${a.name}</text>`;
    g.dataset.az = a.deg;
    svg.append(g);
  }
}
$("court").onclick = e => {
  const g = e.target.closest("g.eye");
  if (g) pickAngle(+g.dataset.az);
};

// The sheet under the court says what the chosen angle can do: nothing yet, one serve, or two to pick from.
function renderSheet() {
  const box = $("sheet"); box.innerHTML = "";
  const add = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = text; box.append(el); return el; };
  add("div", "grab", "");
  if (!pick.az) { add("div", "ask", "コートの目のアイコンで、撮る角度を選ぶのだ"); return; }
  add("div", "sel", `${angleName(pick.az)}から`);
  const list = atAngle(pick.az);
  if (!list.length) {
    add("div", "ask", "この角度の動画はまだ無いのだ");
    const b = add("button", "go", "この角度で動画を追加");
    b.onclick = () => { addAz = pick.az; $("addFile").click(); };
    return;
  }
  const r = pick.ref || (list.length === 1 ? list[0] : null);
  if (!r) {
    add("div", "ask", `この角度のお手本は${list.length}本あるのだ`);
    const b = add("button", "go", "どちらのサーブにする？");
    b.onclick = () => openChoose(pick.az, list);
    return;
  }
  add("div", "ask", "この角度から撮る？");
  const name = add("div", "refname", r.label);
  if (r.user) name.oncontextmenu = e => { e.preventDefault(); forgetRef(r); };   // 長押しで削除
  const b = add("button", "go", "この角度で撮る");
  b.onclick = () => startShoot(r);
}

function pickAngle(deg) {
  pick = { az: deg };
  const list = atAngle(deg);
  renderEyes(); renderSheet();
  if (list.length >= 2) openChoose(deg, list);
}

// どちらのサーブにする？: the serves kept at one angle, thumbnail and label.
function openChoose(deg, list) {
  const box = $("chList"); box.innerHTML = "";
  for (const r of list) {
    const b = document.createElement("button"); b.className = "card";
    const cv = document.createElement("canvas"); thumb(cv, r);
    const t = document.createElement("b"); t.textContent = r.label;
    b.append(cv, t);
    if (r.user) {                                   // 自分で足したお手本だけ、長押しで消せる
      const del = document.createElement("small"); del.textContent = "長押しで削除";
      del.style.color = "var(--mut)";
      b.append(del);
      b.oncontextmenu = e => {
        e.preventDefault();
        if (!confirm(`「${r.label}」を削除するのだ？`)) return;
        if (r.server) fetch(`/ref/${r.id.replace(/^user_/, "")}/forget`, { method: "POST" }).catch(() => {});
        else dropRef(r.id).catch(() => {});
        refs = refs.filter(x => x !== r);
        const list2 = atAngle(deg);
        if (list2.length >= 2) return openChoose(deg, list2);
        pick = { az: deg };                         // 角度は選んだまま、残り1本か0本の表示に戻す
        renderEyes(); renderSheet();
        show("home");
      };
    }
    b.onclick = () => { pick = { az: deg, ref: r }; renderEyes(); renderSheet(); show("home"); };
    box.append(b);
  }
  show("choose");
}
$("chBack").onclick = () => { pick = {}; renderEyes(); renderSheet(); show("home"); };

// お手本を消す（サーバーの一覧からも、この端末の一覧からも）
function forgetRef(r) {
  if (!confirm(`「${r.label}」を削除するのだ？`)) return;
  if (r.server) fetch(`/ref/${r.id.replace(/^user_/, "")}/forget`, { method: "POST" }).catch(() => {});
  else dropRef(r.id).catch(() => {});
  refs = refs.filter(x => x !== r);
  pick = {};
  renderEyes(); renderSheet();
}

// Add a reference from a video file on the phone. Everything runs here — the pose estimation, the
// serve search and the save — so the app needs no PC, and the video never leaves the phone. The
// confirmation screen plays the video with the skeleton and lists every serve found in it.
// This button is not tied to an angle: clear the one left by an earlier add.
$("addBtn").onclick = () => { addAz = null; $("addFile").click(); };
$("addFile").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  const st = $("addStatus"), video = URL.createObjectURL(file);
  if (addJob) { URL.revokeObjectURL(addJob.video); addJob = null; }
  // A hidden page stops decoding the video, and the estimation with it: keep the screen on. Recording
  // a serve pauses the estimation too (paused below), so the camera gets the phone to itself.
  const wake = await navigator.wakeLock?.request("screen").catch(() => null);
  try {
    st.textContent = "骨格推定を準備中…";
    const lm = await stillLandmarker();
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = video;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("動画を読めなかったのだ")); });
    const doc = { fps: 30, width: v.videoWidth, height: v.videoHeight };
    doc.frames = await poseFrames(v, src => detect(lm, src), {
      fps: 30,
      paused: () => document.hidden || rec !== null,
      onProgress: p => { st.textContent = `骨格推定中… ${Math.round(p * 100)}%（画面を消さないでほしいのだ）`; },
      onWait: () => { st.textContent = "画面を消したか録画中なので待っている。戻ると続きから進むのだ"; },
    });
    const serves = serveWindows(doc);
    if (!serves.length) throw new Error("サーブが見つからなかったのだ。1本のサーブが全身で映っている動画にしてほしいのだ");
    addJob = { doc, serves, video, blob: file };
    st.textContent = "お手本の準備ができたのだ（押して確認）";
  } catch (err) { st.textContent = String(err.message || err); URL.revokeObjectURL(video); }
  finally { wake?.release?.(); }
};

// The estimation waits here instead of jumping to the check screen: tapping the status opens it.
$("addStatus").onclick = () => {
  if (!addJob) return;
  const job = addJob; addJob = null;
  openConfirm(job);
};

// ---------- check screen: does the skeleton match the video? ----------
// Two uses: a video the PC just estimated (pick which serve to keep) and an existing reference
// (look at it before shooting, and say where the skeleton looks wrong).
let cf = null, cfLoop = 0, cfStepIx = -1;

// The estimation just finished on this phone: check it, then keep one of the serves it found.
function openConfirm(job) {
  showCheck({
    mode: "job", refId: "new", label: "新しいお手本", doc: job.doc, blob: job.blob, temp: true,
    video: job.video, frames: job.doc.frames, from: 0, step: 1 / job.doc.fps,
    serves: job.serves, sel: 0,
  });
}

function openCheck(r) {
  showCheck({
    mode: "ref", ref: r, refId: r.id, label: r.label, video: r.video || "",
    frames: r.frames, from: r.videoFrom ?? 0, step: r.videoStep ?? 0.1,
  });
}

function showCheck(state) {
  cf = { ...state, comments: 0 };
  cfStepIx = -1;
  cf.info = cf.mode === "job" ? `サーブが${cf.serves.length}本見つかったのだ` : `お手本：${cf.label}`;
  $("cfRate").value = cf.mode === "job" ? "0.5" : "1";
  $("cfPlayBtn").textContent = "再生";
  $("cfInfo").textContent = cf.info;
  $("cfSave").textContent = cf.mode === "job" ? "この区間をお手本にする" : "この向きで撮る";
  cfServes();
  const v = $("cfV");
  v.pause();
  if (cf.video) v.src = cf.video; else v.removeAttribute("src");
  show("confirm");
  const lid = ++cfLoop;
  drawConfirm();
  if (cf.video) {
    // A reference video comes over the network (a few MB): say it is on its way instead of showing a
    // black stage, and say so if it never arrives.
    $("cfInfo").textContent = "動画を読み込み中…";
    v.onerror = () => { $("cfInfo").textContent = "動画を読めなかったのだ。通信が弱いかもしれないから、もう一度開いてほしいのだ"; };
    v.onloadeddata = () => { cfPlay(); everyFrame(v, () => cfLoop === lid, drawConfirm); };
  }
}

function cfServes() {
  const box = $("cfServes"); box.innerHTML = "";
  if (cf.mode !== "job") return;
  cf.serves.forEach((w, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}本目`;
    b.className = i === cf.sel ? "primary" : "";
    b.onclick = () => { cf.sel = i; cfStepIx = -1; cfServes(); cfPlay(); };
    box.append(b);
  });
}

const cfWin = () => (cf.mode === "job" ? cf.serves[cf.sel] : null);

// Job mode loops the chosen serve; a reference plays once, as it is. Both at the speed picked below.
function cfPlay() {
  const v = $("cfV");
  if (!cf.video) return;
  v.playbackRate = +$("cfRate").value;
  cfStepIx = -1;
  $("cfPlayBtn").textContent = "一時停止";
  $("cfInfo").textContent = cf.info;
  if (cf.mode === "job") v.currentTime = Math.max(0, cfWin().from * cf.step - 0.7);
  else v.currentTime = 0;
  v.play().catch(() => {});
}

const cfFrame = () => {
  const v = $("cfV");
  if (!cf.video || !v.videoWidth) return cf.mode === "ref" ? Math.min(cf.frames.length - 1, cf.ref?.stance ?? 0) : 0;
  return Math.max(0, Math.min(cf.frames.length - 1, Math.round((v.currentTime - cf.from) / cf.step)));
};

function drawConfirm() {
  if (!cf?.frames) return;
  const v = $("cfV"), g = fitCanvas($("cfOv"));
  const w = cfWin();
  if (w && !v.paused && v.currentTime > w.to * cf.step + 0.4) cfPlay();
  const pose = cf.frames[cfFrame()];
  if (!pose) return;
  // Without a video (a reference added on the phone earlier) the skeleton gets the whole stage.
  const r = v.videoWidth ? rectOf(v, v.videoWidth, v.videoHeight)
    : { x: 0, y: 0, w: $("cfOv").clientWidth, h: $("cfOv").clientHeight };
  drawBones(g, toCanvas(pose, r), COL.you, 2);
}

$("cfV").onclick = () => {
  const v = $("cfV");
  if (!cf?.video) return;
  v.paused ? (v.play().catch(() => {}), $("cfPlayBtn").textContent = "一時停止", $("cfInfo").textContent = cf.info)
           : (v.pause(), $("cfPlayBtn").textContent = "再生");
};
$("cfBack").onclick = () => { closeConfirm(); addJob = null; $("addStatus").textContent = ""; show("home"); };

// One tap = one frame, holding keeps stepping. A lagging skeleton only shows when the frame stops.
function cfStepFrame(dir) {
  const v = $("cfV");
  if (!cf?.frames || !cf.video) return;
  v.pause();
  $("cfPlayBtn").textContent = "再生";
  cfStepIx = cfStepIx >= 0 ? cfStepIx : cfFrame();
  // Stepping past the last frame starts over: at the end of a clip the button would look dead.
  cfStepIx = cfStepIx + dir > cf.frames.length - 1 ? 0 : Math.max(0, cfStepIx + dir);
  v.currentTime = Math.max(0, Math.min(cf.from + cfStepIx * cf.step, (v.duration || Infinity) - 0.001));
  $("cfInfo").textContent = `コマ ${cfStepIx + 1}/${cf.frames.length}`;   // says the tap landed even if the video lags
  drawConfirm();
}
holdStep($("cfPrev"), () => cfStepFrame(-1));
holdStep($("cfNext"), () => cfStepFrame(1));
$("cfPlayBtn").onclick = () => {
  const v = $("cfV");
  if (!cf?.video) return;
  if (v.paused) { v.play().catch(() => {}); $("cfPlayBtn").textContent = "一時停止"; $("cfInfo").textContent = cf.info; }
  else { v.pause(); $("cfPlayBtn").textContent = "再生"; }
};
$("cfRate").onchange = () => { $("cfV").playbackRate = +$("cfRate").value; };

// "This bit is wrong": a note with the frame and the words, kept on the phone. The local server also
// gets a copy when it is there, for a later correction on the PC.
$("cfComment").onclick = () => {
  const what = prompt("どこが変？ 直してほしいところを書いてほしいのだ", "");
  if (!what) return;
  const v = $("cfV");
  const note = { refId: cf.refId, label: cf.label, frame: cfFrame(), time: +(v.currentTime || 0).toFixed(2), comment: what, at: new Date().toISOString() };
  store.set("fixes", [...store.get("fixes", []), note]);
  fetch("/fix", { method: "POST", body: JSON.stringify(note) }).catch(() => {});
  cf.comments++;
  $("cfInfo").textContent = `コメントを書いたのだ（${cf.comments}件）`;
};

$("cfSave").onclick = async () => {
  if (cf.mode === "ref") { const r = cf.ref; closeConfirm(); startShoot(r); return; }
  const label = prompt("お手本の名前は？", `サーブ${cf.sel + 1}本目`);
  if (label === null) return;
  const azimuth = await askAngle(addAz);              // どの角度から撮った動画？
  if (azimuth === null) return;
  const b = $("cfSave"); b.disabled = true;
  try {
    const id = `user_${Date.now()}`;
    const r = { ...reference(cf.doc, cf.serves[cf.sel], { id, label: label || `サーブ${cf.sel + 1}本目` }), azimuth, server: false };
    await putRef(r, cf.blob);                                     // 端末の中に、角度と動画ごと残す
    const entry = { ...r, video: URL.createObjectURL(cf.blob) };  // the video stays on the phone for "並べる"
    refs.push(entry);
    addAz = null;
    pick = { az: azimuth, ref: entry };                           // ホームのその角度に並べる
    renderEyes(); renderSheet();
    $("addStatus").textContent = "お手本を追加したのだ";
    closeConfirm(); show("home");
  } catch (err) { $("addStatus").textContent = String(err.message || err); }
  finally { b.disabled = false; }
};

// ---------- angle picker: which angle was the added video shot from? ----------
let apSel = 90, apDone = null;
function renderAp() {
  const box = $("apList"); box.innerHTML = "";
  for (const a of ANGLES) {
    const b = document.createElement("button");
    b.textContent = a.name;
    b.className = a.deg === apSel ? "on" : "";
    b.onclick = () => { apSel = a.deg; renderAp(); };
    box.append(b);
  }
}
function askAngle(initial) {
  apSel = initial || 90;
  renderAp();
  $("anglePick").classList.add("on");
  return new Promise(res => { apDone = res; });
}
function closeAngle(v) {
  $("anglePick").classList.remove("on");
  const done = apDone; apDone = null;
  done?.(v);                                          // null = やめる
}
$("apOk").onclick = () => closeAngle(apSel);
$("apCancel").onclick = () => closeAngle(null);

function closeConfirm() {
  cfLoop++;
  cfStepIx = -1;
  const v = $("cfV"); v.pause(); v.removeAttribute("src"); v.load();
  if (cf?.temp) URL.revokeObjectURL(cf.video);      // the blob is what gets saved, not this URL
  cf = null;
}

// ---------- shoot ----------
let shootLoop = 0, recorder = null, rec = null, coach = createCoach(), handsUp = createHandsUp();

// MediaPipe's VIDEO mode tracks the person from the previous frame. A new camera (other size or
// orientation) or a face filling the frame can leave it a zero-size region and every later call fails,
// so start each camera with a fresh landmarker and rebuild it if a frame throws.
let rebuilding = false;
function resetLive() { try { live?.close(); } catch { /* already broken */ } live = null; }
function liveDetect(src, ts) {
  if (!live) return null;
  try { return detect(live, src, ts); }
  catch (e) {
    if (!rebuilding) { rebuilding = true; resetLive(); landmarkers().finally(() => { rebuilding = false; }); }
    return null;
  }
}

async function startShoot(r) {
  ref = r; show("shoot");
  resetLive();
  $("angleOk").classList.remove("on");
  $("say").textContent = "カメラと骨格推定を準備中…";
  try {
    // ?src=<video url> feeds a video file instead of the camera (for testing on a PC); ?srcUser= for the front camera
    const q = new URLSearchParams(location.search);
    const src = q.get("srcUser") || q.get("src");
    if (src && !stream) {
      const fake = document.createElement("video"); fake.src = src; fake.muted = true; fake.loop = true; fake.playsInline = true;
      await fake.play(); stream = fake.captureStream();
    }
    stream ??= await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: "user" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    });
  } catch (err) { $("say").textContent = `カメラを使えなかったのだ（${err.name}）`; return; }
  const cam = $("cam"); cam.srcObject = stream; await cam.play();
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* screen may dim; not fatal */ }
  await landmarkers();
  coach = createCoach(); handsUp = createHandsUp();
  const id = ++shootLoop;
  everyFrame(cam, () => id === shootLoop, shootFrame);
}

// Run fn once per new video frame while alive() is true. Polls currentTime instead of
// requestVideoFrameCallback, which stops firing when the page is not being painted.
function everyFrame(video, alive, fn) {
  let last = -1;
  const step = () => {
    if (!alive()) return;
    try { if (video.currentTime !== last) { last = video.currentTime; fn(); } }
    catch (e) { showError(e); }                                   // keep the loop alive whatever happens
    setTimeout(step, 8);
  };
  step();
}

function shootFrame() {
  const cam = $("cam"), now = performance.now();
  if (!live) { setStatus(false, "骨格推定を準備中…"); return; }
  const pose = liveDetect(cam, now);
  const vw = cam.videoWidth, vh = cam.videoHeight, r = rectOf(cam, vw, vh);
  const g = fitCanvas($("camOv"));
  const camAsp = vw / vh, refAsp = ref.width / ref.height;
  const aspOff = Math.abs(camAsp / refAsp - 1) > 0.05;
  $("warn").style.display = aspOff ? "block" : "none";
  if (aspOff) $("warn").textContent = camAsp < 1 && refAsp > 1 ? "スマホを横向きにしてほしいのだ" : "お手本と画面の縦横比が違うので、重ね方がずれるのだ";

  if (rec) {                                   // recording: just keep the skeleton for the review
    if (pose) {
      rec.poses.push(pose); rec.times.push((now - rec.t0) / 1000);
      // Keep a small copy of this exact frame so the review can step frames without seeking the video.
      // ponytail: 640 px long side, ~0.7 GB at 30 fps x 25 s; go to 480 px if the phone runs out of memory
      const k = Math.min(1, 640 / Math.max(vw, vh));
      rec.frames.push(createImageBitmap(cam, { resizeWidth: Math.round(vw * k), resizeHeight: Math.round(vh * k), resizeQuality: "low" }).catch(() => null));
    }
    if (pose) drawBones(g, toCanvas(pose, r), COL.you);
    const t = (now - rec.t0) / 1000;
    $("recInfo").textContent = `録画中 ${t.toFixed(1)}秒`;
    // stop 2 s after a serve's contact, or after 25 s
    if (rec.poses.length > 30 && Math.floor(t * 4) !== rec.lastCheck) {
      rec.lastCheck = Math.floor(t * 4);
      const fps = rec.poses.length / Math.max(0.1, t);
      const sv = findServes(skipRaise(fixSwaps(rec.poses, camAsp)), fps).at(-1);
      if ((sv && t - rec.times[sv.contact] > 2) || t > 25) stopRecording();
    }
    return;
  }

  drawLines(g, ref.lines || [], r);
  drawBones(g, toCanvas(ref.frames[ref.stance], r), COL.ref, 3, 0.55);
  if (pose) drawBones(g, toCanvas(pose, r), COL.you);
  const c = coachStep(coach, { t: now / 1000, pose, ref, aspect: camAsp, refAspect: refAsp, front: true });
  // No number on screen: the small "✓ 角度OK" is the only verdict, and the words below say what to move.
  setStatus(c.ok, c.ok ? "OK。両手を上げると録画するのだ" : c.display.replace(/（\d+）$/, ""));
  if (handsUpStep(handsUp, now / 1000, pose, camAsp)) startRecording();
}

function setStatus(ok, text) {
  $("angleOk").classList.toggle("on", ok);
  $("say").textContent = text;
}

function startRecording() {
  if (rec) return;
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const r = { t0: performance.now(), date: new Date(), poses: [], times: [], frames: [], lastCheck: -1, mime: recorder.mimeType || mime, chunks: [], discard: false };
  recorder.ondataavailable = e => e.data.size && r.chunks.push(e.data);
  recorder.onstop = () => {
    if (r.discard) return closeFrames(r.frames);
    const blob = new Blob(r.chunks, { type: r.mime }), name = clipName(r.mime, ref.id, r.date);
    saveClip(blob, name);                                       // every serve is kept for Drive, reviewed or not
    // The review holds the upload so a favourite tapped there still names the Drive file.
    openReview(blob, r, name);
  };
  rec = r;
  recorder.start();
  $("rec").classList.add("on");
  $("say").textContent = "録画中。サーブを打ってほしいのだ";
}

function stopRecording(discard = false) {
  if (!rec) return;
  rec.discard = discard; rec = null;
  recorder.stop();
  $("rec").classList.remove("on"); $("recInfo").textContent = "";
}

// Keep the clip on the phone until Drive has it.
async function saveClip(blob, name) {
  handsUp = createHandsUp();
  await addClip({ name, blob });
}

$("rec").onclick = () => (rec ? stopRecording() : startRecording());
$("shootBack").onclick = () => leaveShoot();
// The end of practice: one note for the day, kept as a .txt in the same Drive folder as the clips.
$("finish").onclick = async () => {
  const memo = await askMemo("今日のメモ", "", "例：トスを前に出すのを意識した。打点はまだ後ろ");
  if (memo === null) return;                          // やめる: stay on the camera and keep practising
  if (memo) await addClip({ name: notesName(), blob: new Blob([memo], { type: "text/plain" }) });
  if ($("review").classList.contains("on") && rv) closeReview();   // finishing from the review
  leaveShoot();
};
function leaveShoot() { shootLoop++; stopRecording(true); stopCamera(); show("home"); updateClips(); uploadClips(); }

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  wakeLock?.release?.(); wakeLock = null;
}

// ---------- review ----------
let rv = null, rvLoop = 0;
let stepIdx = -1;   // >= 0: the review shows cached frame stepIdx instead of the video

const closeFrames = frames => Promise.all(frames).then(bs => bs.forEach(b => b?.close()));

async function openReview(blob, data, name) {
  shootLoop++;
  const url = URL.createObjectURL(blob);
  const poses = fixSwaps(data.poses, $("cam").videoWidth / $("cam").videoHeight);
  const fps = poses.length / Math.max(0.1, data.times.at(-1) ?? 1);
  const sv = findServes(skipRaise(poses), fps).at(-1);
  rv = { url, blob, poses, name, fav: false, memo: "", times: data.times, mime: data.mime, frames: await Promise.all(data.frames),
    you: sv ? { trophy: data.times[sv.trophy], contact: data.times[sv.contact] } : null,
    // stanceFrame is the last frame with both hands below the shoulders, i.e. the toss has already
    // started; step back 0.5 s so the slow motion begins just as the hands come together.
    toss: sv ? Math.max(0, data.times[stanceFrame(poses, sv.trophy)] - 0.5) : null };
  $("fav").textContent = "☆ お気に入り";
  $("rvMemo").textContent = "";
  $("rvTime").textContent = "0:00";
  setBar(0);
  stepIdx = -1;
  $("rvInfo").textContent = sv ? "" : "サーブを見つけられなかったので、お手本は重ねていないのだ";
  show("review");
  const v = $("rv"); v.src = url; v.playbackRate = rv.toss !== null ? 1 : +$("rate").value;
  const refV = $("refV");
  if (refV) {
    refV.src = ref.video || "";
    refV.load();
  }
  $("rvStage").classList.toggle("side", $("view").value === "side");
  syncView();
  const id = ++rvLoop;
  v.onloadeddata = () => { drawReview(); everyFrame(v, () => id === rvLoop, drawReview); };
}

function nearestIndex(t) {
  const { times } = rv;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; times[m] < t ? (lo = m + 1) : (hi = m); }
  return lo;
}

// A recorded clip often reports an Infinity duration until it is played through, so fall back to the
// time of the last recorded frame.
function rvDuration() {
  const d = $("rv").duration;
  return isFinite(d) && d > 0 ? d : Math.max(0.1, rv?.times?.at(-1) ?? 1);
}
function setBar(f) {
  const pct = `${Math.max(0, Math.min(1, f || 0)) * 100}%`;
  $("rvBar").style.width = pct;
  $("rvKnob").style.left = pct;
}

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function drawReview() {
  const v = $("rv"), g = fitCanvas($("rvOv"));
  if (!v.videoWidth) return;
  const isSide = $("view").value === "side";
  $("rvStage").classList.toggle("side", isSide);
  const refV = $("refV");
  const r = rectOf(v, v.videoWidth, v.videoHeight);
  // Nothing worth seeing happens before the toss: play that part at normal speed and slow down from the toss.
  const rate = rv.toss !== null && v.currentTime < rv.toss ? 1 : +$("rate").value;
  if (v.playbackRate !== rate) v.playbackRate = rate;
  const still = stepIdx >= 0 ? rv.frames[stepIdx] : null;
  if (still) g.drawImage(still, r.x, r.y, r.w, r.h);
  const i = still ? stepIdx : nearestIndex(v.currentTime);
  const t = still ? rv.times[i] : v.currentTime;
  // The time and the thin timeline at the top and bottom of the review.
  $("rvTime").textContent = clock(t);
  setBar(t / rvDuration());
  const you = rv.poses[i];
  if (you) drawBones(g, toCanvas(you, r), COL.you);
  if (!rv.you) return;
  const fi = warp(t, rv.you, ref);
  const rp = lerpPose(ref.frames, fi);

  // Sync reference video
  if (ref.video && refV) {
    const proTime = Math.max(0, Math.min(refV.duration || 10, videoTime(ref, fi)));
    if (v.paused) {
      if (!refV.paused) refV.pause();
      if (Math.abs(refV.currentTime - proTime) > 0.03) refV.currentTime = proTime;
    } else if (isSide) {
      const k = (ref.contact - ref.trophy) / (rv.you.contact - rv.you.trophy);
      const prRate = Math.max(0.05, Math.min(4, v.playbackRate * (k * (ref.videoStep ?? 0.1))));
      if (refV.playbackRate !== prRate) refV.playbackRate = prRate;
      if (refV.paused) refV.play().catch(() => {});
      if (Math.abs(refV.currentTime - proTime) > 0.15) refV.currentTime = proTime;
    } else {
      if (!refV.paused) refV.pause();
    }
  }

  if (!isSide && you) {
    // pro's skeleton scaled to your body and pinned at your hips (same as serve_compare.py)
    const px = (p, W, H) => p.map(q => [q[0] * W, q[1] * H]);
    const Y = px(you, r.w, r.h), R = px(rp, ref.width, ref.height);
    const hip = P => [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2];
    const tor = P => Math.hypot((P[11][0] + P[12][0]) / 2 - hip(P)[0], (P[11][1] + P[12][1]) / 2 - hip(P)[1]);
    const k = tor(Y) / tor(R), hy = hip(Y), hr = hip(R);
    drawBones(g, R.map((q, i) => [r.x + hy[0] + (q[0] - hr[0]) * k, r.y + hy[1] + (q[1] - hr[1]) * k, rp[i][3]]), COL.ref, 2, 0.9);
  } else if (isSide && refV) {
    const rr = rectOf(refV, refV.videoWidth || 640, refV.videoHeight || 360);
    g.fillStyle = COL.ref; g.font = "14px system-ui"; g.fillText(`お手本：${ref.label}`, rr.x + 8, rr.y + 20);
  }
}

$("play").onclick = () => {
  const v = $("rv"), refV = $("refV");
  if (v.ended) { v.currentTime = 0; if (refV) refV.currentTime = 0; }
  if (stepIdx >= 0) { v.currentTime = rv.times[stepIdx]; stepIdx = -1; }   // resume the video where stepping stopped
  if (v.paused) {
    const rate = rv?.toss !== null && v.currentTime < rv.toss ? 1 : +$("rate").value;
    if (v.playbackRate !== rate) v.playbackRate = rate;
    v.play();
    if ($("view").value === "side" && refV?.src) refV.play().catch(() => {});
  } else {
    v.pause();
    refV?.pause();
  }
  $("play").textContent = v.paused ? "再生" : "一時停止";
};
$("rv").onended = () => { $("play").textContent = "再生"; $("refV")?.pause(); };

// Frame stepping: draws the frames cached while recording, so there is no video seek
// (a seek decodes from the last keyframe, up to ~100 frames back in Chrome's recordings).
// One tap = one skeleton frame; holding the button keeps stepping.
function stepFrame(dir) {
  const v = $("rv");
  if (!rv.frames.length) return;
  v.pause(); $("play").textContent = "再生";
  if (stepIdx < 0) stepIdx = nearestIndex(v.currentTime);
  stepIdx = Math.max(0, Math.min(rv.frames.length - 1, stepIdx + dir));
  drawReview();
}
// One tap = one step, holding keeps stepping. The first step runs before the pointer capture: a
// browser that refuses the capture (no active pointer, odd touch stacks) must not swallow the tap.
function holdStep(button, fn) {
  let timer = 0;
  button.onpointerdown = e => {
    fn();
    try { button.setPointerCapture(e.pointerId); } catch { /* capture only makes the hold reliable */ }
    const go = wait => { timer = setTimeout(() => { fn(); go(60); }, wait); };
    go(350);
  };
  button.onpointerup = button.onpointercancel = button.onpointerleave = () => clearTimeout(timer);
  button.oncontextmenu = e => e.preventDefault();               // long press must not open a menu on Android
}
// The timeline, like a video player's: tap to jump there, drag to scrub. While the finger is down the
// review shows the frames cached while recording (no video seeks, so dragging stays smooth); on release a
// clip that was playing carries on from there, a paused one stays on that frame.
{
  const bar = $("scrub");
  let wasPlaying = false, dragging = false;
  const scrubTo = e => {
    if (!rv) return;
    const box = bar.querySelector(".bar").getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    const t = f * rvDuration();
    if (rv.frames.length) stepIdx = nearestIndex(t);
    else $("rv").currentTime = t;
    drawReview();
  };
  bar.onpointerdown = e => {
    if (!rv) return;
    const v = $("rv");
    dragging = true; wasPlaying = !v.paused && !v.ended;
    v.pause(); $("refV")?.pause();
    bar.classList.add("drag");
    try { bar.setPointerCapture(e.pointerId); } catch { /* capture only keeps the drag on the bar */ }
    scrubTo(e);
  };
  bar.onpointermove = e => { if (dragging) scrubTo(e); };
  const end = () => {
    if (!dragging) return;
    dragging = false; bar.classList.remove("drag");
    const v = $("rv");
    if (stepIdx >= 0) v.currentTime = rv.times[stepIdx];
    if (wasPlaying) { stepIdx = -1; $("play").onclick(); }
    else $("play").textContent = "再生";
  };
  bar.onpointerup = bar.onpointercancel = end;
}

holdStep($("back"), () => stepFrame(-1));
holdStep($("fwd"), () => stepFrame(1));
$("rate").onchange = () => {
  const v = $("rv");
  const rate = rv?.toss !== null && v.currentTime < rv.toss ? 1 : +$("rate").value;
  if (v.playbackRate !== rate) v.playbackRate = rate;
};
$("view").onchange = () => drawReview();
// 重ねる／並べる: the segmented control at the top of the review drives the select the rest of the code uses.
const syncView = () => { for (const b of $("viewSeg").children) b.classList.toggle("on", b.dataset.view === $("view").value); };
$("viewSeg").onclick = e => {
  const b = e.target.closest("[data-view]");
  if (!b || b.dataset.view === $("view").value) return;
  $("view").value = b.dataset.view;
  syncView(); drawReview();
};
function clipName(mime, refId, d) {
  return `serve_${refId}_${stamp(d)}.${mime.includes("mp4") ? "mp4" : "webm"}`;
}
// ---------- clips waiting for Drive ----------
// Each clip is posted to the Apps Script in drive.gs, which saves it in the "PJ_TennisServe" folder of
// My Drive. Failed clips stay on the phone and retry after the next serve, when the app opens, when
// the phone is back online, or from the button.
let uploading = null;
function uploadClips() {
  uploading ??= (async () => {
    const url = driveUrl(), tried = new Set();
    // Re-read the store each time so a serve recorded during the upload goes in the same run.
    for (let c; url && (c = (await allClips()).find(x => !tried.has(x.name)));) {
      tried.add(c.name);
      $("clipInfo").textContent = `Driveへ送信中…`;
      try {
        // A favourite goes up under its _fav name, then its memo and its figure beside it. If either
        // does not make it, the clip stays on the phone so the next try sends it again.
        const name = c.fav ? favName(c.name) : c.name;
        if (await postClip(url, name, c.blob)) {
          const memoOk = !c.fav || !c.memo || await postClip(url, memoName(c.name), new Blob([c.memo], { type: "text/plain" }));
          const figOk = !c.fav || !c.fig || await postClip(url, figName(c.name), c.fig);
          if (memoOk && figOk) await dropClip(c);
        }
      } catch { /* offline or a wrong URL: keep it for the next try */ }
    }
  })().finally(() => { uploading = null; updateClips(); });
  return uploading;
}
const postClip = async (url, name, blob) => {
  const body = JSON.stringify({ name, mime: blob.type.split(";")[0], data: await base64(blob) });
  return (await (await fetch(url, { method: "POST", body })).text()) === "ok";
};
const base64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.slice(r.result.indexOf(",") + 1));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
async function updateClips() {
  const n = (await allClips()).length;
  $("sendBtn").hidden = !n || !driveUrl();
  $("sendBtn").textContent = `Driveへ送る（${n}件）`;
  $("clipInfo").textContent = !n ? "" : driveUrl() ? `未送信 ${n}件` : `未送信 ${n}件。DriveのURLを入れると送るのだ`;
  if (rec === null && $("shoot").classList.contains("on")) $("recInfo").textContent = n ? `未送信 ${n}件` : "";
}
$("sendBtn").onclick = () => uploadClips();
addEventListener("online", () => uploadClips());
$("fav").onclick = async () => {
  if (rv.fav) {                                    // tap the star again: no longer a favourite
    rv.fav = false;
    $("fav").textContent = "☆ お気に入り";
    $("rvMemo").textContent = "";
    await setFav(rv.name, false, rv.memo);          // the words stay on the phone in case the star comes back
    return;
  }
  // "What were you watching for?" asked right there, so it is recorded while the serve is fresh.
  const memo = await askMemo("何を意識した？（お気に入り）", rv.memo, "例：トスを前に出す、打点を高く");
  if (memo === null) return;
  rv.fav = true; rv.memo = memo;
  $("fav").textContent = "★ お気に入り";
  $("rvMemo").textContent = memo ? `メモ：${memo}` : "";
  await setFav(rv.name, true, memo);
  makeFigure().catch(showError);          // the picture shows up a second later, over the review
};

const closeReview = () => { rvLoop++; $("refV")?.pause(); URL.revokeObjectURL(rv.url); closeFrames(rv.frames); rv.frames = []; stepIdx = -1; uploadClips(); };
$("again").onclick = () => { closeReview(); startShoot(ref); };

// ---------- start ----------
// Fixed: front camera, accurate (full) model, no voice, recording starts on hands-up, always review.
const builtIn = await getJson("refs.json").then(d => d.refs);
const onPc = await getJson("refs_user.json").then(d => d.refs).catch(() => []);
// References added on this phone, with their video files, straight from IndexedDB.
const mine = await allRefs().catch(() => []).then(rows => rows.map(({ video, ...r }) => ({ ...r, video: video ? URL.createObjectURL(video) : "" })));
refs = [...builtIn, ...onPc, ...store.get("userRefs", []), ...mine];
renderEyes();
renderSheet();
uploadClips();

// Keep the app on the phone so it opens with no connection (the reference videos still need one).
// A browser only allows this on https or localhost, so a plain http server just skips it.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
