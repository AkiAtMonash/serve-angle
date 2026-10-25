import { createCoach, createHandsUp, handsUpStep, step as coachStep } from "./coach.js";
import { findServes, fixSwaps, stanceFrame, warp } from "./serve.js";
import { addClip, allClips, dropClip } from "./clips.js";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
const MODEL = n => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${n}/float16/latest/pose_landmarker_${n}.task`;
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
const COL = { you: "#ffd60a", ref: "#5ce1e6", line: "#ff453a" };
const $ = id => document.getElementById(id);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: settings just don't stick */ } },
};

// Show any crash on screen: on a phone at the court there is no console to look at.
const showError = e => { const w = $("warn"); w.style.display = "block"; w.textContent = `エラー: ${e?.message || e}`; };
addEventListener("error", e => showError(e.error || e.message));
addEventListener("unhandledrejection", e => showError(e.reason));

let refs = [], ref = null;
let vision = null, live = null, still = null, Pose = null;   // MediaPipe fileset, VIDEO/IMAGE-mode landmarkers, class
let stream = null, wakeLock = null;

// ---------- small helpers ----------
function show(id) { for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id); }

function say(text) {
  if (!$("voice").checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  speechSynthesis.speak(u);
}

// Where a video is actually drawn inside its element (object-fit: contain).
function rectOf(el, vw, vh) {
  const W = el.clientWidth, H = el.clientHeight, k = Math.min(W / vw, H / vh);
  return { x: (W - vw * k) / 2, y: (H - vh * k) / 2, w: vw * k, h: vh * k };
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
function drawBones(g, pts, color, width = 4, alpha = 1) {
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
    baseOptions: { modelAssetPath: MODEL($("model").value), delegate }, runningMode: mode, numPoses: 1,
  });
  try { live = await make("VIDEO", "GPU"); } catch { live = await make("VIDEO", "CPU"); }
}
async function stillLandmarker() {
  await landmarkers();
  if (!still) {
    const opts = { baseOptions: { modelAssetPath: MODEL($("model").value), delegate: "GPU" }, runningMode: "IMAGE", numPoses: 1 };
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

// ---------- home ----------
function thumb(cv, r) {
  const g = cv.getContext("2d"); cv.width = 320; cv.height = 180;
  g.fillStyle = "#000"; g.fillRect(0, 0, 320, 180);
  const k = Math.min(320 / r.width, 180 / r.height), rr = { w: r.width * k, h: r.height * k };
  rr.x = (320 - rr.w) / 2; rr.y = (180 - rr.h) / 2;
  drawLines(g, r.lines || [], rr, 1);
  drawBones(g, toCanvas(r.frames[r.stance], rr), COL.ref, 2);
}

function renderHome() {
  const box = $("refs"); box.innerHTML = "";
  for (const r of refs) {
    const b = document.createElement("button"); b.className = "card";
    const cv = document.createElement("canvas"); thumb(cv, r);
    const t = document.createElement("b"); t.textContent = r.label;
    const s = document.createElement("small"); s.textContent = r.user ? "自分で追加" : `動画の${r.at}から`;
    b.append(cv, t, s);
    b.onclick = () => startShoot(r);
    box.append(b);
    if (r.user) {
      const del = document.createElement("small"); del.textContent = "長押しで削除";
      b.append(del);
      b.oncontextmenu = e => {
        e.preventDefault();
        if (!confirm(`「${r.label}」を削除するのだ？`)) return;
        store.set("userRefs", store.get("userRefs", []).filter(x => x.id !== r.id));
        refs = refs.filter(x => x !== r); renderHome();
      };
    }
  }
}

// Add a reference from a video file on the phone: pose on every frame, find the serve, keep a trimmed window.
$("addBtn").onclick = () => $("addFile").click();
$("addFile").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  const st = $("addStatus");
  try {
    st.textContent = "骨格推定を準備中…";
    const lm = await stillLandmarker();
    const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("動画を読めなかったのだ")); });
    const fps = 30, n = Math.floor(v.duration * fps), frames = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => { v.onseeked = r; v.currentTime = i / fps; });
      frames.push(detect(lm, v));
      if (i % 10 === 0) st.textContent = `骨格推定中… ${Math.round((i / n) * 100)}%`;
    }
    const fixed = fixSwaps(frames, v.videoWidth / v.videoHeight);
    const sv = findServes(fixed, fps)[0];
    if (!sv) throw new Error("サーブが見つからなかったのだ。1本のサーブが全身で映っている動画にしてほしいのだ");
    const stance = stanceFrame(fixed, sv.trophy);
    const a = Math.max(0, stance - 10), b = Math.min(fixed.length - 1, sv.contact + Math.round(0.7 * fps));
    const win = fixed.slice(a, b + 1);
    // fill gaps so every frame has a pose
    for (let i = 0; i < win.length; i++) win[i] ??= win[i - 1] ?? win.find(Boolean);
    const label = prompt("お手本の名前は？", file.name.replace(/\.[^.]+$/, "")) || "自分のお手本";
    const r = { id: `user_${Date.now()}`, user: true, label, at: "", width: v.videoWidth, height: v.videoHeight,
      trophy: sv.trophy - a, contact: sv.contact - a, stance: stance - a, lines: [],
      frames: win.map(p => p.map(q => q.map(x => Math.round(x * 1e4) / 1e4))) };
    store.set("userRefs", [...store.get("userRefs", []), r]);
    refs.push(r); renderHome();
    st.textContent = `「${label}」を追加したのだ`;
    URL.revokeObjectURL(v.src);
  } catch (err) { st.textContent = String(err.message || err); }
};

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
  $("say").textContent = "カメラと骨格推定を準備中…";
  try {
    // ?src=<video url> feeds a video file instead of the camera (for testing on a PC); ?srcUser= for the front camera
    const q = new URLSearchParams(location.search);
    const src = ($("facing").value === "user" && q.get("srcUser")) || q.get("src");
    if (src && !stream) {
      const fake = document.createElement("video"); fake.src = src; fake.muted = true; fake.loop = true; fake.playsInline = true;
      await fake.play(); stream = fake.captureStream();
    }
    stream ??= await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: $("facing").value }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
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
  if (!live) { setStatus("--", false, "骨格推定を準備中…"); return; }
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
      const sv = findServes(fixSwaps(rec.poses, camAsp), fps).at(-1);
      if ((sv && t - rec.times[sv.contact] > 2) || t > 25) stopRecording();
    }
    return;
  }

  drawLines(g, ref.lines || [], r);
  drawBones(g, toCanvas(ref.frames[ref.stance], r), COL.ref, 6, 0.55);
  if (pose) drawBones(g, toCanvas(pose, r), COL.you);
  const c = coachStep(coach, { t: now / 1000, pose, ref, aspect: camAsp, refAspect: refAsp, front: $("facing").value === "user" });
  const start = $("start").value;
  setStatus(c.score ?? "--", c.display.startsWith("OK"), start === "handsUp" && c.ok ? "OK。両手を上げると録画するのだ" : c.display);
  if (c.say) say(c.say);
  if (handsUpStep(handsUp, now / 1000, pose, camAsp) && start === "handsUp") startRecording();
  else if (c.ok && start === "aligned") startRecording();
}

function setStatus(score, ok, text) {
  $("score").textContent = score; $("score").classList.toggle("ok", ok); $("say").textContent = text;
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
    const blob = new Blob(r.chunks, { type: r.mime });
    saveClip(blob, r);                                          // every serve goes to Drive, reviewed or not
    $("cont").checked ? closeFrames(r.frames) : openReview(blob, r);
  };
  rec = r;
  recorder.start();
  $("rec").classList.add("on");
  say("録画開始。サーブを打ってほしいのだ");
  $("say").textContent = "録画中。サーブを打ってほしいのだ";
}

function stopRecording(discard = false) {
  if (!rec) return;
  rec.discard = discard; rec = null;
  recorder.stop();
  $("rec").classList.remove("on"); $("recInfo").textContent = "";
}

// Keep the clip on the phone until Drive has it.
async function saveClip(blob, r) {
  handsUp = createHandsUp();
  await addClip({ name: clipName(r.mime, ref.id, r.date), blob });
  say(store.get("driveUrl", "") ? "保存してDriveへ送るのだ" : "スマホに保存したのだ");
  uploadClips();
}

$("rec").onclick = () => (rec ? stopRecording() : startRecording());
$("flip").onclick = () => {
  if (rec) return;
  $("facing").value = $("facing").value === "user" ? "environment" : "user";
  store.set("facing", $("facing").value);
  stopCamera(); startShoot(ref);
};
$("shootBack").onclick = () => { shootLoop++; stopRecording(true); stopCamera(); show("home"); updateClips(); };

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  wakeLock?.release?.(); wakeLock = null;
}

// ---------- review ----------
let rv = null, rvLoop = 0;
let stepIdx = -1;   // >= 0: the review shows cached frame stepIdx instead of the video

const closeFrames = frames => Promise.all(frames).then(bs => bs.forEach(b => b?.close()));

async function openReview(blob, data) {
  shootLoop++;
  const url = URL.createObjectURL(blob);
  const poses = fixSwaps(data.poses, $("cam").videoWidth / $("cam").videoHeight);
  const fps = poses.length / Math.max(0.1, data.times.at(-1) ?? 1);
  const sv = findServes(poses, fps).at(-1);
  rv = { url, blob, poses, times: data.times, mime: data.mime, frames: await Promise.all(data.frames),
    you: sv ? { trophy: data.times[sv.trophy], contact: data.times[sv.contact] } : null };
  stepIdx = -1;
  $("rvInfo").textContent = sv ? "トスが一番高い瞬間と打点でお手本に合わせてあるのだ" : "サーブを見つけられなかったので、お手本は重ねていないのだ";
  show("review");
  const v = $("rv"); v.src = url; v.playbackRate = +$("rate").value;
  const id = ++rvLoop;
  v.onloadeddata = () => { drawReview(); everyFrame(v, () => id === rvLoop, drawReview); };
}

function nearestIndex(t) {
  const { times } = rv;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; times[m] < t ? (lo = m + 1) : (hi = m); }
  return lo;
}

function drawReview() {
  const v = $("rv"), g = fitCanvas($("rvOv"));
  if (!v.videoWidth) return;
  const r = rectOf(v, v.videoWidth, v.videoHeight);
  const still = stepIdx >= 0 ? rv.frames[stepIdx] : null;
  if (still) g.drawImage(still, r.x, r.y, r.w, r.h);
  const i = still ? stepIdx : nearestIndex(v.currentTime);
  const t = still ? rv.times[i] : v.currentTime;
  const you = rv.poses[i];
  if (you) drawBones(g, toCanvas(you, r), COL.you);
  if (!rv.you) return;
  const fi = warp(t + +$("offset").value, rv.you, ref);
  const rp = lerpPose(ref.frames, fi);
  if ($("view").value === "overlay" && you) {
    // pro's skeleton scaled to your body and pinned at your hips (same as serve_compare.py)
    const px = (p, W, H) => p.map(q => [q[0] * W, q[1] * H]);
    const Y = px(you, r.w, r.h), R = px(rp, ref.width, ref.height);
    const hip = P => [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2];
    const tor = P => Math.hypot((P[11][0] + P[12][0]) / 2 - hip(P)[0], (P[11][1] + P[12][1]) / 2 - hip(P)[1]);
    const k = tor(Y) / tor(R), hy = hip(Y), hr = hip(R);
    drawBones(g, R.map((q, i) => [r.x + hy[0] + (q[0] - hr[0]) * k, r.y + hy[1] + (q[1] - hr[1]) * k, rp[i][3]]), COL.ref, 4, 0.9);
  } else {
    // side by side: the pro's skeleton in a panel on the right
    const W = r.w * 0.38, H = r.h * 0.9, bx = r.x + r.w - W - 8, by = r.y + (r.h - H) / 2;
    g.fillStyle = "#000c"; g.fillRect(bx, by, W, H);
    const xs = rp.map(p => p[0] * ref.width), ys = rp.map(p => p[1] * ref.height);
    const all = ref.frames.flat(), minY = Math.min(...all.map(p => p[1])) * ref.height, maxY = Math.max(...all.map(p => p[1])) * ref.height;
    const k = (H * 0.9) / (maxY - minY), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    drawBones(g, xs.map((x, i) => [bx + W / 2 + (x - cx) * k, by + H * 0.05 + (ys[i] - minY) * k, rp[i][3]]), COL.ref, 4);
    g.fillStyle = COL.ref; g.font = "14px system-ui"; g.fillText(`お手本：${ref.label}`, bx + 8, by + 20);
  }
}

$("play").onclick = () => {
  const v = $("rv");
  if (stepIdx >= 0) { v.currentTime = rv.times[stepIdx]; stepIdx = -1; }   // resume the video where stepping stopped
  v.paused ? v.play() : v.pause(); $("play").textContent = v.paused ? "再生" : "一時停止";
};
$("rv").onended = () => { $("play").textContent = "再生"; };

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
for (const [id, dir] of [["back", -1], ["fwd", 1]]) {
  let timer = 0;
  const b = $(id);
  b.onpointerdown = e => {
    b.setPointerCapture(e.pointerId);
    stepFrame(dir);
    const go = wait => { timer = setTimeout(() => { stepFrame(dir); go(60); }, wait); };
    go(350);
  };
  b.onpointerup = b.onpointercancel = () => clearTimeout(timer);
  b.oncontextmenu = e => e.preventDefault();                   // long press must not open a menu on Android
}
$("rate").onchange = () => { $("rv").playbackRate = +$("rate").value; };
$("view").onchange = $("offset").oninput = () => drawReview();
function clipName(mime, refId, d) {
  const pad = n => String(n).padStart(2, "0");
  return `serve_${refId}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${mime.includes("mp4") ? "mp4" : "webm"}`;
}
// ---------- clips waiting for Drive ----------
// Each clip is posted to the Apps Script in drive.gs, which saves it in the "PJ_TennisServe" folder of
// My Drive. Failed clips stay on the phone and retry after the next serve, when the app opens, when
// the phone is back online, or from the button.
let uploading = null;
function uploadClips() {
  uploading ??= (async () => {
    const url = store.get("driveUrl", ""), tried = new Set();
    // Re-read the store each time so a serve recorded during the upload goes in the same run.
    for (let c; url && (c = (await allClips()).find(x => !tried.has(x.name)));) {
      tried.add(c.name);
      $("clipInfo").textContent = `Driveへ送信中…`;
      try {
        const body = JSON.stringify({ name: c.name, mime: c.blob.type.split(";")[0], data: await base64(c.blob) });
        if (await (await fetch(url, { method: "POST", body })).text() === "ok") await dropClip(c);
      } catch { /* offline or a wrong URL: keep it for the next try */ }
    }
  })().finally(() => { uploading = null; updateClips(); });
  return uploading;
}
const base64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.slice(r.result.indexOf(",") + 1));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
async function updateClips() {
  const n = (await allClips()).length;
  $("sendBtn").hidden = !n || !store.get("driveUrl", "");
  $("sendBtn").textContent = `Driveへ送る（${n}本）`;
  $("clipInfo").textContent = !n ? "" : store.get("driveUrl", "") ? `未送信 ${n}本` : `未送信 ${n}本。DriveのURLを入れると送るのだ`;
  if (rec === null && $("shoot").classList.contains("on")) $("recInfo").textContent = n ? `未送信 ${n}本` : "";
}
$("sendBtn").onclick = () => uploadClips();
$("driveUrl").value = store.get("driveUrl", "");
$("driveUrl").onchange = () => { store.set("driveUrl", $("driveUrl").value.trim()); uploadClips(); };
addEventListener("online", () => uploadClips());
const closeReview = () => { rvLoop++; URL.revokeObjectURL(rv.url); closeFrames(rv.frames); rv.frames = []; stepIdx = -1; };
$("again").onclick = () => { closeReview(); startShoot(ref); };
$("reviewBack").onclick = () => { closeReview(); stopCamera(); show("home"); };

// ---------- settings + start ----------
$("voice").checked = store.get("voice", true); $("voice").onchange = () => store.set("voice", $("voice").checked);
$("cont").checked = store.get("cont", false); $("cont").onchange = () => store.set("cont", $("cont").checked);
$("start").value = store.get("start", "handsUp");
if (!$("start").value) $("start").value = "handsUp";      // a stored choice that no longer exists ("wave")
$("start").onchange = () => store.set("start", $("start").value);
$("model").value = store.get("model", "lite");
$("facing").value = store.get("facing", "environment");
$("facing").onchange = () => store.set("facing", $("facing").value);
$("model").onchange = () => { store.set("model", $("model").value); live?.close(); still?.close(); live = still = null; };

const builtIn = await fetch("refs.json").then(r => r.json()).then(d => d.refs);
refs = [...builtIn, ...store.get("userRefs", [])];
renderHome();
uploadClips();
