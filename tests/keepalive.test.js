#!/usr/bin/env node
/* tests/keepalive.test.js — T2 Windows 保活测试（node:assert）
 * 用例：
 *  1. --check-only 无 PID 文件 → exit 2
 *  2. --check-only PID 指向存活进程 → exit 0
 *  3. --check-only PID 指向不存在进程 → exit 1
 *  4. --once 发现死进程 → 执行重启命令（写标记文件）→ marker 出现
 */
"use strict";
const assert = require("assert");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");
fs.mkdirSync(LOGS, { recursive: true });

function runK(args) {
  try { return { code: 0, out: g(`keepalive.cmd ${args}`) }; }
  catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() }; }
}

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name} — ${detail}`); failed++; }
}

console.log("T2 keepalive.test.js");
console.log("用例1: 无 PID 文件 → exit 2");
{
  const pf = path.join(LOGS, "test-none.pid");
  fs.rmSync(pf, { force: true });
  const r = runK(`--check-only --pid-file "${pf}"`);
  check("exit 2", r.code === 2, `code=${r.code}`);
}
console.log("用例2: 存活进程 → exit 0");
{
  const child = spawn("node", ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const pf = path.join(LOGS, "test-alive.pid");
  fs.writeFileSync(pf, String(child.pid));
  const r = runK(`--check-only --pid-file "${pf}"`);
  check("exit 0", r.code === 0, `code=${r.code} out=${r.out}`);
  child.kill();
}
console.log("用例3: 不存在进程 → exit 1");
{
  const pf = path.join(LOGS, "test-dead.pid");
  fs.writeFileSync(pf, "99999999");
  const r = runK(`--check-only --pid-file "${pf}"`);
  check("exit 1", r.code === 1, `code=${r.code}`);
}
console.log("用例4: --once 死进程 → 执行重启命令 → marker 出现");
{
  const marker = path.join(LOGS, "test-restarted.marker");
  fs.rmSync(marker, { force: true });
  const cmdFile = path.join(LOGS, "test-restart.cmd");
  fs.writeFileSync(cmdFile, `@echo off\necho restarted > "${marker}"\n`, "utf-8");
  const pf = path.join(LOGS, "test-restart.pid");
  fs.writeFileSync(pf, "99999998");
  const r = runK(`--once --pid-file "${pf}" --cmd "${cmdFile}" --log-file "${LOGS}\\test-keepalive.log"`);
  check("marker 已生成", fs.existsSync(marker), `code=${r.code} out=${r.out}`);
}

console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
