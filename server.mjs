// The app's server. It hands out the files and runs "add a reference video" jobs here on the PC, so
// the phone can be closed (or at the court on a dead battery) while the pose estimation finishes.
// node server.mjs [port]
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { serveWindows, reference } from "./refjob.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const WORK = join(ROOT, ".work", "refs");
const FIXES = join(WORK, "ref_fixes.json");
const PORT = +process.argv[2] || 8765;

const TYPE = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt",
};

const jobDir = id => join(WORK, String(id).replace(/[^\w-]/g, ""));
const send = (res, code, body, type = "text/plain; charset=utf-8") => {
  res.writeHead(code, { "content-type": type });
  res.end(body);
};

// One file, with the byte ranges a <video> asks for when it seeks.
async function sendFile(req, res, path, type) {
  let size;
  try { size = (await stat(path)).size; } catch { return send(res, 404, "not found"); }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  const from = m?.[1] ? +m[1] : 0;
  const to = m?.[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (m) res.writeHead(206, { "content-type": type, "content-length": to - from + 1, "accept-ranges": "bytes", "content-range": `bytes ${from}-${to}/${size}` });
  else res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(path, { start: from, end: to }).pipe(res);
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// The estimation itself: python (mediapipe) on every 1/30 s, then the same serve rules the app uses.
async function runJob(id) {
  const dir = jobDir(id);
  const result = async o => writeFile(join(dir, "result.json"), JSON.stringify(o));
  try {
    await new Promise((ok, fail) => {
      const p = spawn(process.env.PYTHON || "python", [join(ROOT, "pose_video.py"), join(dir, "video.mp4"), join(dir, "poses.json")], { cwd: ROOT });
      p.on("error", fail);
      p.on("close", code => (code === 0 ? ok() : fail(new Error(`骨格推定が途中で終わったのだ (exit ${code})`))));
    });
    const doc = JSON.parse(await readFile(join(dir, "poses.json"), "utf8"));
    const serves = serveWindows(doc);
    await result({ status: "done", fps: doc.fps, width: doc.width, height: doc.height, frames: doc.frames.length, serves });
  } catch (e) {
    await result({ status: "error", message: String(e?.message || e) });
  }
}

async function newRef(req, res) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dir = jobDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "video.mp4"), await body(req));
  await writeFile(join(dir, "result.json"), JSON.stringify({ status: "running" }));
  runJob(id);                                           // no await: the phone may close right after this
  send(res, 200, JSON.stringify({ id }), TYPE[".json"]);
}

async function acceptRef(req, res, id) {
  const { serve = 0, label = "" } = JSON.parse(String(await body(req)) || "{}");
  const dir = jobDir(id);
  const doc = JSON.parse(await readFile(join(dir, "poses.json"), "utf8"));
  const win = serveWindows(doc)[serve];
  if (!win) return send(res, 404, "no such serve");
  const entry = { ...reference(doc, win, { id: `user_${id}`, label: label || "自分のお手本" }), video: `/ref/${id}/video` };
  const file = join(WORK, "refs_user.json"), list = await readFile(file, "utf8").then(JSON.parse).catch(() => ({ refs: [] }));
  list.refs = list.refs.filter(r => r.id !== entry.id).concat(entry);
  await writeFile(file, JSON.stringify(list));
  send(res, 200, JSON.stringify(entry), TYPE[".json"]);
}

async function forgetRef(res, id) {
  const file = join(WORK, "refs_user.json"), list = await readFile(file, "utf8").then(JSON.parse).catch(() => ({ refs: [] }));
  list.refs = list.refs.filter(r => r.id !== `user_${id}`);
  await writeFile(file, JSON.stringify(list));
  send(res, 200, "ok");
}

// Notes from the check screen ("this bit looks wrong"), with the frame and the words, so a later pass
// on the PC can correct the estimation.
async function addFix(req, res) {
  const note = JSON.parse(String(await body(req)) || "{}");
  const list = await readFile(FIXES, "utf8").then(JSON.parse).catch(() => []);
  list.push({ ...note, at: new Date().toISOString() });
  await mkdir(WORK, { recursive: true });
  await writeFile(FIXES, JSON.stringify(list, null, 1));
  send(res, 200, "ok");
}

createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    if (req.method === "POST" && p === "/ref") return await newRef(req, res);
    if (req.method === "POST" && p === "/fix") return await addFix(req, res);
    if (req.method === "GET" && p === "/fix") return sendFile(req, res, FIXES, TYPE[".json"]);
    const job = /^\/ref\/([\w-]+)(?:\/(video|poses|accept|forget))?$/.exec(p);
    if (job) {
      const [, id, what] = job;
      if (what === "accept" && req.method === "POST") return await acceptRef(req, res, id);
      if (what === "forget" && req.method === "POST") return await forgetRef(res, id);
      if (what === "video" && req.method === "GET") return sendFile(req, res, join(jobDir(id), "video.mp4"), TYPE[".mp4"]);
      if (what === "poses" && req.method === "GET") return sendFile(req, res, join(jobDir(id), "poses.json"), TYPE[".json"]);
      if (req.method === "GET") return sendFile(req, res, join(jobDir(id), "result.json"), TYPE[".json"]);
    }
    if (p === "/refs_user.json") return sendFile(req, res, join(WORK, "refs_user.json"), TYPE[".json"]);
    const path = normalize(join(ROOT, p === "/" ? "index.html" : p.slice(1)));
    if (!path.startsWith(ROOT)) return send(res, 403, "no");
    return sendFile(req, res, path, TYPE[extname(path).toLowerCase()] || "application/octet-stream");
  } catch (e) {
    send(res, 500, String(e?.message || e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
