#!/usr/bin/env node
/* tests/probe-mirrors.test.js — 镜像探活 A4（D-92~D-96 验证面）
 * 测: probe-mirrors.js 对 primary/mirror 可达性判定 + 退出码
 * 风格对齐 keepalive.test.js：node:assert + execSync + check + 临时夹具 + cleanup
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();
const PROBE = path.join(ROOT, "tools", "probe-mirrors.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
function runProbe(repo) {
  try {
    const out = g(`node "${PROBE}" --repo "${repo}" --json`);
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() };
  }
}

console.log("probe-mirrors.test.js (A4 镜像探活)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "amprobe-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(market);
  for (const c of ["git init -q", "git -c user.email=t@t -c user.name=t commit -qm init --allow-empty",
    `git remote add origin "${bare}"`]) g(c, { cwd: market });
  g(`git init -q --bare "${bare}"`);
  g(`git push -q origin HEAD:main`, { cwd: market });

  /* T1: primary 可达 → exit 0，origin.reachable=true */
  const r1 = runProbe(market);
  const j1 = JSON.parse(r1.out);
  check("T1 primary 可达 exit 0", r1.code === 0 && j1.origin && j1.origin.reachable === true,
    `code=${r1.code} out=${r1.out.slice(0, 120)}`);

  /* T2: 无 mirror → 只有 origin，不崩溃 */
  check("T2 无 mirror 结构", j1.origin && !j1.mirror, `keys=${Object.keys(j1).join(",")}`);

  /* T3: mirror 不可达 → primary 仍 0；加坏 mirror remote */
  g(`git remote add mirror "file:///nonexistent/mirror.git"`, { cwd: market });
  const r3 = runProbe(market);
  const j3 = JSON.parse(r3.out);
  check("T3 坏 mirror 不影响 primary exit 0", r3.code === 0 && j3.mirror && j3.mirror.reachable === false,
    `code=${r3.code} mirror=${JSON.stringify(j3.mirror)}`);

  /* T4: primary 不可达 + mirror 不可达 → exit 2 */
  g(`git remote set-url origin "file:///nonexistent/primary.git"`, { cwd: market });
  const r4 = runProbe(market);
  check("T4 双不可达 exit 2", r4.code === 2, `code=${r4.code} out=${r4.out.slice(0, 100)}`);

  /* T5: 恢复 primary，mirror 指向有效 bare → 双可达 + mirror_lag 计算 */
  g(`git remote set-url origin "${bare}"`, { cwd: market });
  g(`git remote set-url mirror "${bare}"`, { cwd: market });
  const r5 = runProbe(market);
  const j5 = JSON.parse(r5.out);
  check("T5 双可达 exit 0 + lag 0", r5.code === 0 && j5.mirror && j5.mirror.reachable === true &&
    j5.mirror_lag === 0, `code=${r5.code} mirror_lag=${j5.mirror_lag}`);

  /* T6: 非 git 目录 → 不崩溃，exit 非 0 且有 ts 输出 */
  const plain = path.join(fx, "plain"); fs.mkdirSync(plain);
  const r6 = runProbe(plain);
  const j6 = JSON.parse(r6.out);
  check("T6 非 git 目录不崩溃", j6 && j6.ts, `code=${r6.code} out=${r6.out.slice(0, 100)}`);

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { if (fx) fs.rmSync(fx.d || fx, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
