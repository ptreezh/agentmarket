#!/usr/bin/env node
/* tests/freeze.test.js — SPEC-PUBLISH-FREEZE-20260925 发布即托管
 * Case A: 余额充足 → freeze 写 escrow + pub_escrow 两条账本，余额正确扣减
 * Case B: 余额不足 → exit 1 + 不写账本
 * Case C: 幂等 → 重复 freeze 不重复扣款
 * Fixture 风格对齐 settle-reputation.test.js（临时 bare repo + execSync）。
 */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();
const FREEZE = path.join(ROOT, "tools", "freeze.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
function runFreeze(cwd, agent, task) {
  let out = "", code = 0;
  try { out = execSync(`node "${FREEZE}" ${agent} ${task} --allow-unsigned`, { cwd, encoding: "utf-8", stdio: "pipe" }); }
  catch (e) { code = e.status || 1; out = (e.stdout || "") + (e.stderr || ""); }
  return { code, out };
}
function ledgerEntries(market) {
  const ld = path.join(market, "ledger");
  if (!fs.existsSync(ld)) return [];
  return fs.readdirSync(ld).filter(f => /^L-\d{4}\.md$/.test(f)).sort();
}

console.log("freeze.test.js (SPEC-PUBLISH-FREEZE-20260925)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "amfz-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(path.join(market, "tools"), { recursive: true });
  fs.mkdirSync(path.join(market, "ledger"), { recursive: true });
  fs.copyFileSync(FREEZE, path.join(market, "tools", "freeze.js"));
  fs.copyFileSync(path.join(ROOT, "tools", "ledger.js"), path.join(market, "tools", "ledger.js"));

  // agent AG-TEST：初始 100（faucet）
  fs.writeFileSync(path.join(market, "ledger", "L-0001.md"),
    "---\nseq: 1\nts: 2026-09-25T00:00:00.000Z\nkind: faucet\namount: 100\nfrom: FAUCET_POOL\nto: AG-TEST\nnote: test faucet\n---\n");
  // agent AG-POOR：0 余额
  // 任务 T-FZ1：budget 40
  const taskDir = path.join(market, "tasks", "T-FZ1");
  fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
  fs.writeFileSync(path.join(taskDir, "spec.md"),
    "---\ntitle: \"freeze test\"\ndescription: \"x\"\ndeadline: 2026-12-31T00:00:00Z\ncomplexity: S\nbudget: 40\nsens: L0\npublisher: AG-TEST\n---\n");
  for (const c of ["git init -q", "git add -A", `git -c user.email=t@t -c user.name=t commit -qm init`]) {
    g(c, { cwd: market });
  }
  g(`git init -q --bare "${bare}"`);
  g(`git remote add origin "${bare}"`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });

  /* Case A: 余额充足 → 冻结成功 */
  const rA = runFreeze(market, "AG-TEST", "T-FZ1");
  const entriesA = ledgerEntries(market);
  const escrowText = fs.readFileSync(path.join(market, "ledger", entriesA.find(f => { const t = fs.readFileSync(path.join(market, "ledger", f), "utf-8"); return /^kind:\s*escrow/m.test(t) && /escrow-T-FZ1$/m.test(t); }) || ""), "utf-8");
  const pubdepText = fs.readFileSync(path.join(market, "ledger", entriesA.find(f => { const t = fs.readFileSync(path.join(market, "ledger", f), "utf-8"); return /^kind:\s*pub_escrow/m.test(t) && /escrow-T-FZ1-pubdep$/m.test(t); }) || ""), "utf-8");
  check("CaseA 冻结成功 exit0", rA.code === 0, "code=" + rA.code + " " + rA.out.split("\n")[0]);
  check("CaseA 写入 2 条账本", entriesA.length === 3, "entries=" + entriesA.join(","));
  check("CaseA escrow=40", /^amount:\s*40$/m.test(escrowText), escrowText.split("\n").filter(l => /kind|amount|to/.test(l)).join("|"));
  check("CaseA pubdep=2", /^amount:\s*2$/m.test(pubdepText) && /escrow-T-FZ1-pubdep$/m.test(pubdepText), pubdepText.split("\n").filter(l => /kind|amount|to/.test(l)).join("|"));
  const balEscrow = g(`node "${path.join(market, "tools", "ledger.js")}" balance escrow-T-FZ1`, { cwd: market });
  const balAgent = g(`node "${path.join(market, "tools", "ledger.js")}" balance AG-TEST`, { cwd: market });
  check("CaseA escrow 账户余额=40", /总余额:\s*40/.test(balEscrow), balEscrow.split("\n").join("|"));
  check("CaseA 发布者余额扣减 42", /总余额:\s*58/.test(balAgent), balAgent.split("\n").join("|"));

  /* Case B: 余额不足 → 拒绝 + 不写账本（用独立任务 T-FZ2，避免命中幂等分支） */
  const taskDir2 = path.join(market, "tasks", "T-FZ2");
  fs.mkdirSync(path.join(taskDir2, "events"), { recursive: true });
  fs.writeFileSync(path.join(taskDir2, "spec.md"),
    "---\ntitle: \"freeze poor test\"\ndescription: \"x\"\ndeadline: 2026-12-31T00:00:00Z\ncomplexity: S\nbudget: 40\nsens: L0\npublisher: AG-POOR\n---\n");
  g(`git add -A && git -c user.email=t@t -c user.name=t commit -qm add-T-FZ2`, { cwd: market });
  const beforeB = ledgerEntries(market).length;
  const rB = runFreeze(market, "AG-POOR", "T-FZ2");
  check("CaseB 余额不足 exit1", rB.code === 1, "code=" + rB.code);
  check("CaseB 提示余额不足", /可用余额不足|insufficient/i.test(rB.out), rB.out.split("\n")[0]);
  check("CaseB 未写入新账本", ledgerEntries(market).length === beforeB, "entries=" + ledgerEntries(market).join(","));

  /* Case C: 幂等 → 重复 freeze 不重复扣款 */
  const beforeC = ledgerEntries(market).length;
  const rC = runFreeze(market, "AG-TEST", "T-FZ1");
  const balAgentC = g(`node "${path.join(market, "tools", "ledger.js")}" balance AG-TEST`, { cwd: market });
  check("CaseC 幂等 exit0 + 提示已存在", rC.code === 0 && /已存在托管/.test(rC.out), "code=" + rC.code + " " + rC.out.split("\n")[0]);
  check("CaseC 账本数不变", ledgerEntries(market).length === beforeC, "entries=" + ledgerEntries(market).join(","));
  check("CaseC 余额未再扣减（仍 58）", /总余额:\s*58/.test(balAgentC), balAgentC.split("\n").join("|"));

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  if (fx) { try { fs.rmSync(fx, { recursive: true, force: true }); } catch (e) {} }
}
if (failed > 0) process.exit(1);
