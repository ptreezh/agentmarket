#!/usr/bin/env node
/* 并发安全认领 · claim.js v2.0 — Git refs 原子锁（D-84/D-85）
 * 用法: node tools/claim.js <taskId> <worker>
 * 流程: refCheck(只读)→refClaim(原子push)→写事件→commit→push
 * 退出码: 0=认领成功 1=已被他人认领 2=用法错误
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const [taskId, worker] = process.argv.slice(2);
if (!taskId || !worker) { console.error("usage: node tools/claim.js <taskId> <worker>"); process.exit(2); }

// 兼容分片路径
function findTaskDir(id) {
  const flat = path.join("tasks", id);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join("tasks", id.slice(0, 4), id);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}
const taskDir = findTaskDir(taskId);
if (!taskDir) { console.error("任务不存在: " + taskId); process.exit(2); }

// 0. 竞价任务检测：bidding:true 的任务不能用 claim.js，必须用 bid.js 报价
const specContent = fs.readFileSync(path.join(taskDir, "spec.md"), "utf-8");
const specMatch = specContent.match(/^bidding:\s*(true|false)/m);
if (specMatch && specMatch[1] === "true") {
  console.error(`❌ 任务 ${taskId} 是竞价任务（bidding:true），不能用 claim.js 认领`);
  console.error(`   请使用 bid.js 提交报价: node tools/bid.js ${taskId} <worker> <amount>`);
  console.error(`   竞价截止后运行 award.js 选标`);
  process.exit(1);
}

const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

// 1. ref 检查（只读，~103字节）
try {
  const out = g(`git ls-remote origin refs/claims/${taskId}`);
  if (out.length > 0) {
    console.log(`[${worker}] ref 检查：${taskId} 已被认领 → 放弃`);
    process.exit(1);
  }
} catch (e) { /* ls-remote 失败时继续尝试 refClaim */ }

// 2. ref 原子认领（push ref，成功=认领，失败=已被认领）
try {
  g(`git push origin HEAD:refs/claims/${taskId}`);
  console.log(`[${worker}] [hca] ref 原子认领成功 ${taskId}`);
} catch (e) {
  console.log(`[${worker}] ref 原子认领失败（他人先占）→ 放弃`);
  process.exit(1);
}

// 3. 写 claimed 事件（冗余审计，异步可重试）
const evDir = path.join(taskDir, "events");
if (!fs.existsSync(evDir)) fs.mkdirSync(evDir, { recursive: true });
const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const fname = `claimed-${ts}-${worker}.md`;
fs.writeFileSync(path.join(evDir, fname),
  `---\nevent: claimed\ntask: ${taskId}\nworker: ${worker}\nop_id: ${fname.replace(/\.md$/, "")}\nts: ${new Date().toISOString()}\n---\n${worker} 认领 ${taskId}（ref 原子锁）。\n`);

// 4. 提交事件（审计用，失败不影响认领有效性——ref 已证明）
try {
  g(`git add "${taskDir}/events/${fname}"`);
  g(`git commit -q -m "claim ${taskId} by ${worker} (hca ref)"`);
  g("git push origin HEAD:main");
  console.log(`[${worker}] ✅ 认领事件已提交 ${taskId}`);
} catch (e) {
  console.log(`[${worker}] ⚠️  事件提交失败（不影响认领，ref 已锁定）: ${e.message}`);
}
process.exit(0);
