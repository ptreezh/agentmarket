#!/usr/bin/env node
/* tests/verification.test.js — D-122 可执行验证规则测试（node:assert）
 * 用例：
 *  T1 无 verification 段 → 老行为（verdict 由 L0 决定，无 verification 字段）
 *  T2 script exit 0 → PASS，verification.verdict=pass
 *  T3 script exit 1 → FAIL，verification.verdict=fail
 *  T4 script 不存在 → FAIL（脚本缺失）
 *  T5 超时 → FAIL，timed_out=true（进程被 kill）
 *  T6 环境净化 → 脚本内 HOME/TOKEN 为空，TASK_DIR 存在
 *  T7 L0 失败 + verification → 短路：不执行脚本（副作用标记不存在），FAIL
 *  T8 输出记录 → verify-result.json 含 verification.output
 *  T9 exit 0 空输出 → PASS
 *  T10 路径穿越（script: ../../evil）→ 拒绝，FAIL
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = process.cwd();
const VERIFY = path.join(ROOT, "tools", "verify.js");

function runVerify(taskDir) {
  try { return { code: 0, out: execSync(`node "${VERIFY}" "${taskDir}"`, { encoding: "utf-8", stdio: "pipe" }).trim() }; }
  catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() }; }
}
function readVResult(dir) {
  const p = path.join(dir, "result", "verify-result.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}
function makeTask(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amvf-"));
  let fm = "---\nid: T-TEST\ncomplexity: S\nbudget: 40\nsens: L0\n";
  fm += "acceptance:\n" + opts.acceptance.map(a => "  - {type: " + a + "}").join("\n") + "\n";
  if (opts.verification) fm += "verification:\n" + opts.verification + "\n";
  fm += "---\n# T-TEST\n";
  fs.writeFileSync(path.join(dir, "spec.md"), fm);
  if (opts.files) for (const f of opts.files) {
    const p = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  return dir;
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name} — ${detail}`); failed++; }
}

console.log("D-122 verification.test.js");

console.log("T1: 无 verification 段 → 老行为");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    files: [{ path: "result/ok.txt", content: "x" }],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 0", r.code === 0, `code=${r.code} out=${r.out.slice(0, 80)}`);
  check("verdict PASS", vr && vr.verdict === "PASS", `verdict=${vr && vr.verdict}`);
  check("无 verification 字段", vr && vr.verification === undefined, `has=${!!(vr && vr.verification)}`);
  cleanup(dir);
}

console.log("T2: script exit 0 → PASS");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: v.cmd\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "v.cmd", content: "@exit /b 0\r\n" },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 0", r.code === 0, `code=${r.code}`);
  check("verdict PASS", vr && vr.verdict === "PASS", `verdict=${vr && vr.verdict}`);
  check("verification.verdict=pass", vr && vr.verification && vr.verification.verdict === "pass",
    `v=${JSON.stringify(vr && vr.verification)}`);
  check("exit_code 0", vr && vr.verification && vr.verification.exit_code === 0, `ec=${vr && vr.verification && vr.verification.exit_code}`);
  cleanup(dir);
}

console.log("T3: script exit 1 → FAIL");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: v.cmd\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "v.cmd", content: "@exit /b 1\r\n" },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 1", r.code === 1, `code=${r.code}`);
  check("verdict FAIL", vr && vr.verdict === "FAIL", `verdict=${vr && vr.verdict}`);
  check("verification.verdict=fail", vr && vr.verification && vr.verification.verdict === "fail",
    `v=${JSON.stringify(vr && vr.verification)}`);
  cleanup(dir);
}

console.log("T4: script 不存在 → FAIL");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: missing.cmd\n  timeout: 30",
    files: [{ path: "result/ok.txt", content: "x" }],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 1", r.code === 1, `code=${r.code}`);
  check("verdict FAIL", vr && vr.verdict === "FAIL", `verdict=${vr && vr.verdict}`);
  check("verification.verdict=fail", vr && vr.verification && vr.verification.verdict === "fail",
    `v=${JSON.stringify(vr && vr.verification)}`);
  check("缺脚本原因", vr && vr.verification && /缺失|missing|not found/i.test(vr.verification.output || ""), `out=${vr && vr.verification && vr.verification.output}`);
  cleanup(dir);
}

console.log("T5: 超时 → FAIL, timed_out=true");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: slow.js\n  timeout: 1",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "slow.js", content: "setTimeout(() => {}, 30000);\n" },
    ],
  });
  const t0 = Date.now();
  const r = runVerify(dir);
  const dt = Date.now() - t0;
  const vr = readVResult(dir);
  check("exit 1", r.code === 1, `code=${r.code}`);
  check("verdict FAIL", vr && vr.verdict === "FAIL", `verdict=${vr && vr.verdict}`);
  check("timed_out=true", vr && vr.verification && vr.verification.timed_out === true,
    `t=${vr && vr.verification && vr.verification.timed_out}`);
  check("快速返回(<15s)", dt < 15000, `dt=${dt}ms`);
  cleanup(dir);
}

console.log("T6: 环境净化 → HOME/TOKEN 剥离, TASK_DIR 存在");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: env.js\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "env.js", content:
        'console.log("HOME=" + (process.env.HOME === undefined ? "" : "SET"));\n' +
        'console.log("TOKEN=" + (process.env.TOKEN === undefined ? "" : "SET"));\n' +
        'console.log("TASK_DIR=" + (process.env.TASK_DIR || ""));\n' },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  const out = vr && vr.verification ? vr.verification.output : "";
  check("verdict PASS", vr && vr.verdict === "PASS", `verdict=${vr && vr.verdict}`);
  check("HOME 已剥离", /HOME=\s*(\r?\n|$)/.test(out), `out=${out}`);
  check("TOKEN 已剥离", /TOKEN=\s*(\r?\n|$)/.test(out), `out=${out}`);
  check("TASK_DIR 注入", /TASK_DIR=.+/.test(out), `out=${out}`);
  cleanup(dir);
}

console.log("T7: L0 失败 → 短路不执行 verification");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/missing.txt"],
    verification: "  script: marker.cmd\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "marker.cmd", content: "@echo boom > marker.txt\r\n" },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 1", r.code === 1, `code=${r.code}`);
  check("verdict FAIL", vr && vr.verdict === "FAIL", `verdict=${vr && vr.verdict}`);
  check("脚本未执行(无 marker.txt)", !fs.existsSync(path.join(dir, "marker.txt")), "marker 存在");
  check("verification.skipped=true", vr && vr.verification && vr.verification.skipped === true,
    `v=${JSON.stringify(vr && vr.verification)}`);
  cleanup(dir);
}

console.log("T8: 输出记录（截断 2KB）");
{
  const big = "y".repeat(5000);
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: out.js\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "out.js", content: `console.log("hdr-${big}");\n` },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  const out = vr && vr.verification ? vr.verification.output : "";
  check("verdict PASS", vr && vr.verdict === "PASS", `verdict=${vr && vr.verdict}`);
  check("输出含内容", /hdr-/.test(out), "无 hdr-");
  check("截断 ≤2048", out.length <= 2048, `len=${out.length}`);
  cleanup(dir);
}

console.log("T9: exit 0 空输出 → PASS");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: quiet.cmd\n  timeout: 30",
    files: [
      { path: "result/ok.txt", content: "x" },
      { path: "quiet.cmd", content: "@exit /b 0\r\n" },
    ],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 0", r.code === 0, `code=${r.code}`);
  check("verdict PASS", vr && vr.verdict === "PASS", `verdict=${vr && vr.verdict}`);
  cleanup(dir);
}

console.log("T10: 路径穿越 → 拒绝");
{
  const dir = makeTask({
    acceptance: ["file_exists, path: result/ok.txt"],
    verification: "  script: ../../evil.cmd\n  timeout: 30",
    files: [{ path: "result/ok.txt", content: "x" }],
  });
  const r = runVerify(dir);
  const vr = readVResult(dir);
  check("exit 1", r.code === 1, `code=${r.code}`);
  check("verdict FAIL", vr && vr.verdict === "FAIL", `verdict=${vr && vr.verdict}`);
  check("拒绝原因含穿越", vr && vr.verification && /穿越|escape|outside|invalid/i.test(vr.verification.output || ""),
    `out=${vr && vr.verification && vr.verification.output}`);
  cleanup(dir);
}

console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"}`);
process.exit(failed === 0 ? 0 : 1);
