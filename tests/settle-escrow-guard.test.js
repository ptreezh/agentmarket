#!/usr/bin/env node
/* tests/settle-escrow-guard.test.js — SPEC-SETTLE-ESCROW-GUARD-20260925
 * Case 1: escrow-less task → settle.js must REFUSE (exit != 0, escrow hint, no ledger write)
 * Case 2: task with G5 backfilled escrow → guard passes (flow may proceed)
 * Fixture style aligned with settle-reputation.test.js (temp bare repo + execSync).
 */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();
const SETTLE = path.join(ROOT, "tools", "settle.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
function runSettle(cwd, taskId) {
  let out = "";
  let code = 0;
  try { out = execSync(`node "${SETTLE}" ${taskId} --allow-unsigned`, { cwd, encoding: "utf-8", stdio: "pipe" }); }
  catch (e) { code = e.status || 1; out = (e.stdout || "") + (e.stderr || ""); }
  return { code, out };
}

console.log("settle-escrow-guard.test.js (SPEC-SETTLE-ESCROW-GUARD-20260925)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "amguard-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(path.join(market, "tools"), { recursive: true });
  fs.copyFileSync(SETTLE, path.join(market, "tools", "settle.js"));

  // 任务 T-GUARD1 夹具：spec(budget 40, publisher AG-TEST) + claimed + verify PASS
  const taskDir = path.join(market, "tasks", "T-GUARD1");
  fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
  fs.mkdirSync(path.join(taskDir, "result"), { recursive: true });
  fs.mkdirSync(path.join(market, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(taskDir, "spec.md"),
    "---\ntitle: \"guard test\"\ndescription: \"x\"\ndeadline: 2026-12-31T00:00:00Z\ncomplexity: S\nbudget: 40\nsens: L0\npublisher: AG-TEST\n---\n");
  fs.writeFileSync(path.join(taskDir, "events", "published-x.md"),
    "---\nevent: published\ntask: T-GUARD1\npublisher: AG-TEST\nts: 20260901000000\n---\npublished\n");
  fs.writeFileSync(path.join(taskDir, "events", "claimed-x.md"),
    "---\nevent: claimed\ntask: T-GUARD1\nworker: AG-TEST\nop_id: claimed-x\nts: 2026-09-01T00:00:00.000Z\n---\nclaimed\n");
  fs.writeFileSync(path.join(taskDir, "result", "verify-result.json"),
    JSON.stringify({ task: "T-GUARD1", ts: "2026-09-01T02:00:00.000Z", total: 1, passed: 1,
      assertions: [{ type: "file_exists", passed: true }], verdict: "PASS" }));
  for (const c of ["git init -q", "git add -A", `git -c user.email=t@t -c user.name=t commit -qm init`]) {
    g(c, { cwd: market });
  }
  g(`git init -q --bare "${bare}"`);
  g(`git remote add origin "${bare}"`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });

  /* Case 1: 无 escrow → 必须拒绝 + 提示 + 不写账本 */
  const r1 = runSettle(market, "T-GUARD1");
  const ledgerBefore = fs.existsSync(path.join(market, "ledger")) ? fs.readdirSync(path.join(market, "ledger")).filter(f => f.endsWith(".md")).length : 0;
  check("Case1 退出码非0（拒绝无托管结算）", r1.code !== 0, "code=" + r1.code);
  check("Case1 输出提示 escrow/G5", /escrow/i.test(r1.out) && /backfill|G5|补记/i.test(r1.out), r1.out.split("\n").slice(-4).join("|"));
  check("Case1 未写入账本", ledgerBefore === 0, "ledger files=" + ledgerBefore);
  check("Case1 未生成 settled 事件", !fs.existsSync(path.join(taskDir, "events")) || !fs.readdirSync(path.join(taskDir, "events")).some(f => f.startsWith("settled-")), "");

  /* Case 2: 补记 escrow（G5：AG-TEST → escrow-T-GUARD1 40）→ guard 通过 */
  fs.writeFileSync(path.join(market, "ledger", "L-9000.md"),
    "---\nseq: 9000\nts: 2026-09-25T00:00:00.000Z\nkind: escrow\namount: 40\nfrom: AG-TEST\nto: escrow-T-GUARD1\nnote: 测试补记 (SPEC G5)\n---\n");
  g(`git add -A && git -c user.email=t@t -c user.name=t commit -qm backfill`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });
  const r2 = runSettle(market, "T-GUARD1");
  const ledgerAfter = fs.readdirSync(path.join(market, "ledger")).filter(f => f.endsWith(".md")).length;
  check("Case2 通过 escrow 检查（继续流程）", r2.out.includes("守恒验证通过") || /conservation|守恒/.test(r2.out), "code=" + r2.code + " tail=" + r2.out.split("\n").slice(-5).join("|"));
  check("Case2 账本新增结算记录（证明 guard 放行后流程继续）", ledgerAfter >= 2, "ledger=" + ledgerAfter);

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  if (fx) { try { fs.rmSync(fx, { recursive: true, force: true }); } catch (e) {} }
}
if (failed > 0) process.exit(1);
