// One command that says whether the goal in harness/goal.md is met.
// Usage: node harness/check.mjs
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const run = cmd => {
  try { return { ok: true, out: execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}` }; }
};

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// 1. No conflict markers left in the files we ship.
const files = readdirSync(root).filter(f => /\.(js|mjs|html|json|css|webmanifest)$/.test(f));
const marked = files.filter(f => /^(<<<<<<<|=======|>>>>>>>)/m.test(readFileSync(root + "/" + f, "utf8")));
check("no conflict markers", marked.length === 0, marked.join(", "));

// 2. No whitespace errors in the diff.
const diff = run("git diff --check");
check("git diff --check is silent", diff.ok && !diff.out.trim(), diff.out.trim());

// 3. The unit tests, including the pause test.
const tests = run("npm test");
const pass = /(^|\n)ℹ pass (\d+)/.exec(tests.out)?.[2];
const fail = /(^|\n)ℹ fail (\d+)/.exec(tests.out)?.[2];
check("npm test", tests.ok && fail === "0", `pass ${pass ?? "?"} / fail ${fail ?? "?"}`);

// 4. The estimation is paused while recording.
const app = readFileSync(root + "/app.js", "utf8");
const call = /poseFrames\([^;]*?\}\)/.exec(app)?.[0] ?? app.slice(app.indexOf("poseFrames("), app.indexOf("poseFrames(") + 600);
check("poseFrames gets paused: with the recording state", /paused:\s*\(\)\s*=>[^,\n]*rec/.test(app), call.slice(0, 200));

// 5. Finishing the estimation does not switch screens by itself.
const finished = /const serves = serveWindows\(doc\)[\s\S]{0,700}?\n\s*\}\s*catch/.exec(app)?.[0] ?? "";
check("estimation does not jump to the check screen", finished.length > 0 && !/show\(\s*"confirm"\s*\)|openConfirm\(/.test(finished));

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  —  ${r.detail}` : ""}`);
const failed = results.filter(r => !r.ok).length;
console.log(failed ? `\n${failed} 件が未達。` : "\n全部 PASS。");
process.exit(failed ? 1 : 0);
