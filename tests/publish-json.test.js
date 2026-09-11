#!/usr/bin/env node
/* tests/publish-json.test.js — D-127 publish.js --json 自动派发模式测试（node:assert）
 * 用例（对齐 SPEC-REPO-CONTEXT-TASK v0.4 §12/§13 + §8 T13-T22）：
 *  T13 合法 payload（无 context）→ exit 0，spec.md 落盘，frontmatter 含 title/budget/acceptance
 *  T14 未知字段 → exit 3，stderr 含非法字段名，tasks 无新目录
 *  T15 断言类型非法 → exit 非0，stderr 提示合法类型
 *  T16 context.repo 不可达 → exit 非0，stderr 提示
 *  T17 缺 title → exit 非0
 *  T18 无 assertions → 自动补 file_exists result/result.md
 *  T19 verification 段 → spec frontmatter 含 verification/script/timeout
 *  T20 context 段 → spec frontmatter 含 context/repo/ref/path
 *  T21 input_files 复制 → 任务目录含文件 + input_ref=sha256
 *  T22 deadline 非法格式 → 拒绝
 */
"use strict";
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, "tools", "publish.js");

/* 建临时市场环境：git init + agents/AG-JT/agent.md */
function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ampj-"));
  fs.mkdirSync(path.join(dir, "agents", "AG-JT"), { recursive: true });
  fs.writeFileSync(path.join(dir, "agents", "AG-JT", "agent.md"),
    "---\nid: AG-JT\ntier: full\n---\n# AG-JT\n");
  try { spawnSync("git", ["init", "-q"], { cwd: dir }); } catch (e) { /* 忽略 */ }
  return dir;
}
function runPublish(dir, payload, extraArgs) {
  const args = [PUBLISH, "--json", JSON.stringify(payload)].concat(extraArgs || []);
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf-8" });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}
function newTaskDirs(dir) {
  const t = path.join(dir, "tasks");
  if (!fs.existsSync(t)) return [];
  return fs.readdirSync(t).filter(d => /^T-\d{4}$/.test(d));
}
function readSpec(dir, taskDirName) {
  const p = path.join(dir, "tasks", taskDirName, "spec.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  ✅ " + name); }
  else { failed++; console.log("  ❌ " + name + (extra ? " — " + extra : "")); }
}

console.log("D-127 publish.js --json 测试");

/* T13 合法 payload */
{
  const dir = makeEnv();
  const r = runPublish(dir, {
    title: "Implement module X", description: "Add module X",
    deadline: "2026-09-15T00:00:00Z", complexity: "S", budget: 40, sens: "L0",
    assertions: [{ type: "file_exists", path: "result/x.js" }]
  }, ["--publisher", "AG-JT"]);
  const dirs = newTaskDirs(dir);
  const spec = dirs.length ? readSpec(dir, dirs[0]) : "";
  check("T13 exit 0", r.code === 0, "code=" + r.code + " out=" + r.out.slice(0, 80));
  check("T13 spec.md 落盘", dirs.length === 1 && spec.includes("id: " + dirs[0]), "dirs=" + dirs);
  check("T13 frontmatter 含 title/budget/acceptance", spec.includes("title: Implement module X") && spec.includes("budget: 40") && spec.includes("acceptance:"));
  check("T13 published 事件", dirs.length === 1 && fs.existsSync(path.join(dir, "tasks", dirs[0], "events")) && fs.readdirSync(path.join(dir, "tasks", dirs[0], "events")).some(f => f.startsWith("published-")));
}

/* T14 未知字段 */
{
  const dir = makeEnv();
  const r = runPublish(dir, { title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40, evil_field: "bad" }, ["--publisher", "AG-JT"]);
  check("T14 exit 3", r.code === 3, "code=" + r.code);
  check("T14 stderr 含字段名", r.out.includes("evil_field"), r.out.slice(0, 120));
  check("T14 不落盘", newTaskDirs(dir).length === 0);
}

/* T15 断言类型非法 */
{
  const dir = makeEnv();
  const r = runPublish(dir, { title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40, assertions: [{ type: "rm_rf", path: "result" }] }, ["--publisher", "AG-JT"]);
  check("T15 exit 非0", r.code !== 0, "code=" + r.code);
  check("T15 提示合法类型", r.out.includes("file_exists"), r.out.slice(0, 120));
}

/* T16 context.repo 不可达 */
{
  const dir = makeEnv();
  const r = runPublish(dir, { title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40, context: { repo: "https://invalid.invalid.example/nope.git", ref: "abc" } }, ["--publisher", "AG-JT"]);
  check("T16 exit 非0", r.code !== 0, "code=" + r.code);
  check("T16 提示不可达", r.out.includes("不可达") || r.out.includes("unreachable") || r.out.includes("ls-remote"), r.out.slice(0, 120));
}

/* T17 缺 title */
{
  const dir = makeEnv();
  const r = runPublish(dir, { deadline: "2026-09-15T00:00:00Z", budget: 40 }, ["--publisher", "AG-JT"]);
  check("T17 exit 非0", r.code !== 0, "code=" + r.code);
  check("T17 提示 title", r.out.includes("title"), r.out.slice(0, 120));
}

/* T18 无 assertions 自动补 */
{
  const dir = makeEnv();
  const r = runPublish(dir, { title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40 }, ["--publisher", "AG-JT"]);
  const dirs = newTaskDirs(dir);
  const spec = dirs.length ? readSpec(dir, dirs[0]) : "";
  check("T18 exit 0", r.code === 0, "code=" + r.code);
  check("T18 自动补 file_exists", spec.includes('type: "file_exists"') && spec.includes('path: "result/result.md"'), spec.slice(0, 200));
}

/* T19 verification 段 */
{
  const dir = makeEnv();
  const r = runPublish(dir, {
    title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40,
    assertions: [{ type: "file_exists", path: "result/ok.txt" }],
    verification: { script: "check.cmd", timeout: 90 }
  }, ["--publisher", "AG-JT"]);
  const dirs = newTaskDirs(dir);
  const spec = dirs.length ? readSpec(dir, dirs[0]) : "";
  check("T19 exit 0", r.code === 0, "code=" + r.code);
  check("T19 spec 含 verification", spec.includes("verification:") && spec.includes("script: check.cmd") && spec.includes("timeout: 90"), spec.slice(0, 300));
}

/* T20 context 段（网络自适应：repo 可达→成功路径；不可达→拒绝路径，环境波动不误报） */
{
  const dir = makeEnv();
  const r = runPublish(dir, {
    title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40,
    context: { repo: "https://github.com/ptreezh/agentmarket.git", ref: "main", path: "tools" }
  }, ["--publisher", "AG-JT"]);
  const dirs = newTaskDirs(dir);
  const spec = dirs.length ? readSpec(dir, dirs[0]) : "";
  if (r.code === 0) {
    check("T20 exit 0", true, "");
    check("T20 spec 含 context", spec.includes("context:") && spec.includes("repo: https://github.com/ptreezh/agentmarket.git") && spec.includes("ref: main") && spec.includes("path: tools"), spec.slice(0, 300));
  } else {
    check("T20 网络不可达→明确拒绝", /unreachable|ls-remote failed/.test(r.out), r.out.slice(0, 200));
    check("T20 不可达→spec 未落盘", dirs.length === 0, "dirs=" + dirs.join(","));
  }
}

/* T21 input_files 复制 */
{
  const dir = makeEnv();
  fs.writeFileSync(path.join(dir, "input.txt"), "hello world");
  const r = runPublish(dir, {
    title: "x", deadline: "2026-09-15T00:00:00Z", budget: 40,
    input_files: "input.txt"
  }, ["--publisher", "AG-JT"]);
  const dirs = newTaskDirs(dir);
  const spec = dirs.length ? readSpec(dir, dirs[0]) : "";
  check("T21 exit 0", r.code === 0, "code=" + r.code + " " + r.out.slice(0, 150));
  check("T21 文件已复制", dirs.length === 1 && fs.existsSync(path.join(dir, "tasks", dirs[0], "input.txt")));
  check("T21 input_ref=sha256", spec.includes("input_ref: ") && spec.includes("b94d27b9934d3e08"), spec.slice(0, 300));
}

/* T22 deadline 非法 */
{
  const dir = makeEnv();
  const r = runPublish(dir, { title: "x", deadline: "not-a-date", budget: 40 }, ["--publisher", "AG-JT"]);
  check("T22 exit 非0", r.code !== 0, "code=" + r.code);
  check("T22 提示 deadline", r.out.includes("deadline") || r.out.includes("ISO"), r.out.slice(0, 120));
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
