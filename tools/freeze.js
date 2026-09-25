#!/usr/bin/env node
/* tools/freeze.js — 发布即托管（SPEC-PUBLISH-FREEZE-20260925）
 * 用法: node tools/freeze.js <agentId> <taskId> [--allow-unsigned]
 * 从 tasks/<taskId>/spec.md 读取 budget；校验发布者可用余额 ≥ budget + pubdep(5%)；
 * 写入两条签名账本：kind escrow → escrow-<T>；kind pub_escrow → escrow-<T>-pubdep。
 * 幂等：escrow-<T> 已存在则跳过并提示（不重复扣款）。
 * Exit: 0 ok · 1 余额不足/冻结失败 · 2 用法/缺 spec/无密钥
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ledger = require("./ledger.js");

let agentId = null, taskId = null, allowUnsigned = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--allow-unsigned") allowUnsigned = true;
  else if (a.startsWith("--")) { console.error(`未知参数: ${a}`); process.exit(2); }
  else if (!agentId) agentId = a;
  else if (!taskId) taskId = a;
  else { console.error(`多余参数: ${a}`); process.exit(2); }
}
if (!agentId || !taskId) {
  console.error("用法: node tools/freeze.js <agentId> <taskId> [--allow-unsigned]");
  process.exit(2);
}

const PUB_DEPOSIT_RATE = 0.05; // 对齐 autosettle.js CFG.pub_deposit_rate / publish.js

// spec budget
const specPath = path.join("tasks", taskId, "spec.md");
if (!fs.existsSync(specPath)) { console.error(`❌ spec 不存在: ${specPath}`); process.exit(2); }
const specText = fs.readFileSync(specPath, "utf-8");
const bm = specText.match(/^budget:\s*(\d+(?:\.\d+)?)/m);
if (!bm) { console.error(`❌ spec 缺少 budget: ${specPath}`); process.exit(2); }
const budget = parseFloat(bm[1]);
const pubDep = Math.round(budget * PUB_DEPOSIT_RATE * 100) / 100;

// 幂等：escrow-<T> 已存在 → 跳过
function ledgerHas(needle) {
  const ld = path.join("ledger");
  if (!fs.existsSync(ld)) return false;
  for (const f of fs.readdirSync(ld)) {
    if (!/^L-\d{4}\.md$/.test(f)) continue;
    const c = fs.readFileSync(path.join(ld, f), "utf-8");
    if (needle(c)) return true;
  }
  return false;
}
const escrowKey = `escrow-${taskId}`;
if (ledgerHas(c => /^kind:\s*escrow/m.test(c) && new RegExp(`^to:\\s*${escrowKey}\\s*$`, "m").test(c))) {
  console.log(`ℹ️  ${escrowKey} 已存在托管，跳过冻结（幂等，不重复扣款）`);
  process.exit(0);
}

// 余额校验
const avail = ledger.getAvailableBalance(agentId);
const needed = budget + pubDep;
if (avail < needed) {
  console.error(`❌ 发布者 ${agentId} 可用余额不足: 可用 ${avail} < 需要 ${needed}（budget ${budget} + pubdep ${pubDep}）`);
  console.error(`   请先充值（FAUCET/积分转入）后重试。`);
  process.exit(1);
}

// 密钥
const privKeyPath = path.join("keys", agentId, "private.pem");
if (!fs.existsSync(privKeyPath) && !allowUnsigned) {
  console.error(`❌ 无发布者私钥: ${privKeyPath}（先运行 ab-register.sh，或 --allow-unsigned 仅限测试）`);
  process.exit(2);
}
const signer = allowUnsigned ? undefined : agentId;

// 冻结 escrow + pub_escrow
try {
  ledger.writeEntry({ kind: "escrow", amount: budget, from: agentId, to: escrowKey,
    note: `任务 ${taskId} 预算托管冻结（${budget}）`, signer, privKeyPath: allowUnsigned ? null : privKeyPath });
  if (pubDep > 0) {
    ledger.writeEntry({ kind: "pub_escrow", amount: pubDep, from: agentId, to: `${escrowKey}-pubdep`,
      note: `任务 ${taskId} 发布押金托管冻结（${pubDep}）`, signer, privKeyPath: allowUnsigned ? null : privKeyPath });
  }
} catch (e) {
  console.error(`❌ 托管冻结失败: ${e.message}`);
  process.exit(1);
}

console.log(`✅ 托管冻结完成: ${agentId} → ${escrowKey}=${budget} + ${escrowKey}-pubdep=${pubDep}（可用余额 ${avail} → ${Math.round((avail - needed) * 100) / 100}）`);
