#!/usr/bin/env node
/* 超时惩罚 · penalty.js（B2 / PROTOCOL §5: 弃单/超时扣押金 + 扣信誉）
 * 用法: node tools/penalty.js <taskId> [--force] [--repo <dir>] [--remote <name>]
 * 条件: 已认领(claimed 事件) + 无 submitted/settled + deadline 已过（--force 跳过时间检查）
 * 动作: 写 forfeited 事件 + 账本 deposit_forfeit(押金→TAXSINK) + 预算退回(escrow→publisher) + commit + push
 * 守恒: deposit_forfeit = budget×5%（押金托管）；refund = budget（任务未完成，发布者收回预算）
 * 声誉: forfeited 事件记录 rep_penalty（-5），供声誉子系统读取
 * 退出码: 0=已执行惩罚 1=不可惩罚 2=参数错误
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const argv = process.argv.slice(2);
const taskId = argv[0];
if (!taskId || taskId.startsWith("--")) {
  console.error("usage: node tools/penalty.js <taskId> [--force] [--repo <dir>] [--remote <name>]");
  process.exit(2);
}
const force = argv.includes("--force");
function opt(name) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; }
const ROOT = path.resolve(opt("--repo") || process.cwd());
const REMOTE = opt("--remote") || "origin";

const g = (c, opts) => execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe", cwd: ROOT }, opts || {})).trim();

function main() {
  const taskDir = path.join(ROOT, "tasks", taskId);
  const specPath = path.join(taskDir, "spec.md");
  if (!fs.existsSync(specPath)) { console.error(`[penalty] 任务不存在: ${taskId}`); process.exit(1); }
  const specRaw = fs.readFileSync(specPath, "utf-8");
  const fm = specRaw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) { console.error(`[penalty] spec 无 frontmatter: ${taskId}`); process.exit(1); }
  const kv = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  const budget = parseFloat(kv.budget);
  const publisher = kv.publisher;
  const deadlineStr = kv.deadline;
  if (!(budget > 0)) { console.error(`[penalty] budget 无效: ${taskId}`); process.exit(1); }
  if (!publisher) { console.error(`[penalty] publisher 缺失: ${taskId}`); process.exit(1); }

  const eventsDir = path.join(taskDir, "events");
  if (!fs.existsSync(eventsDir)) { console.error(`[penalty] events/ 缺失: ${taskId}`); process.exit(1); }
  const evs = fs.readdirSync(eventsDir).filter(f => /\.md$/.test(f));
  const hasSubmitted = evs.some(f => f.startsWith("submitted-"));
  const hasSettled = evs.some(f => f.startsWith("settled-"));
  const hasForfeited = evs.some(f => f.startsWith("forfeited-"));
  if (hasSubmitted) { console.error(`[penalty] 已提交，不可惩罚: ${taskId}`); process.exit(1); }
  if (hasSettled) { console.error(`[penalty] 已结算，不可惩罚: ${taskId}`); process.exit(1); }
  if (hasForfeited) { console.error(`[penalty] 已惩罚过: ${taskId}`); process.exit(1); }
  const claimed = evs.filter(f => f.startsWith("claimed-")).sort().pop();
  if (!claimed) { console.error(`[penalty] 未被认领，无需惩罚: ${taskId}`); process.exit(1); }
  const claimedBody = fs.readFileSync(path.join(eventsDir, claimed), "utf-8");
  const worker = (claimedBody.match(/^worker:\s*(\S+)/m) || [null, "unknown"])[1];

  if (!force && deadlineStr) {
    const dl = new Date(deadlineStr).getTime();
    if (!isNaN(dl) && dl > Date.now()) {
      console.error(`[penalty] 未超时（deadline=${deadlineStr}），跳过（--force 可强制）: ${taskId}`);
      process.exit(1);
    }
  } else if (!force && !deadlineStr) {
    console.error(`[penalty] spec 无 deadline，跳过（--force 可强制）: ${taskId}`);
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const iso = new Date().toISOString();
  const deposit = Math.round(budget * 0.05 * 100) / 100;
  const opId = `forfeited-${ts}-${worker}`;

  // 1. forfeited 事件
  const evFile = path.join(eventsDir, `${opId}.md`);
  fs.writeFileSync(evFile, `---\nevent: forfeited\ntask: ${taskId}\nworker: ${worker}\nop_id: ${opId}\nts: ${iso}\nreason: deadline_exceeded\npenalty_deposit: ${deposit}\nrep_penalty: -5\n---\n${worker} 超时未提交（deadline 已过），押金 ${deposit} 没收 + 信誉 -5，任务标记 failed。\n`);

  // 2. 账本：deposit_forfeit + 预算退回（append-only，seq = max+1）
  const ledgerDir = path.join(ROOT, "ledger");
  if (!fs.existsSync(ledgerDir)) fs.mkdirSync(ledgerDir, { recursive: true });
  const seqs = fs.readdirSync(ledgerDir).filter(f => /^L-\d+\.md$/.test(f))
    .map(f => parseInt(f.replace(/^L-|\.md$/g, ""), 10)).filter(n => !isNaN(n));
  const nextSeq = (seqs.length ? Math.max(...seqs) : 0) + 1;
  const mkLedger = (seq, kind, amount, from, to, note) =>
    `---\nseq: ${seq}\nts: ${iso}\nkind: ${kind}\namount: ${amount}\nfrom: ${from}\nto: ${to}\nnote: ${note}\nsig: \n---\n`;
  fs.writeFileSync(path.join(ledgerDir, `L-${String(nextSeq).padStart(4, "0")}.md`),
    mkLedger(nextSeq, "deposit_forfeit", deposit, `escrow-${taskId}-deposit`, "TAXSINK", `${taskId} 超时，${worker} 押金没收（budget×5%）`));
  fs.writeFileSync(path.join(ledgerDir, `L-${String(nextSeq + 1).padStart(4, "0")}.md`),
    mkLedger(nextSeq + 1, "refund", budget, `escrow-${taskId}`, publisher, `${taskId} 未完成，预算退回发布者`));

  // 3. commit + push（白名单：任务 events + ledger）
  try {
    g(`git add "${path.relative(ROOT, evFile).replace(/\\/g, "/")}" "${path.relative(ROOT, ledgerDir).replace(/\\/g, "/")}"`);
    g(`git -c user.email=market@agentbazaar -c user.name="penalty-bot" commit -qm "penalty(${taskId}): ${worker} 超时扣押金 ${deposit} + 预算退回"`);
    g(`git push ${REMOTE} HEAD:main`);
  } catch (e) {
    console.error(`[penalty] git 失败（事件/账本已落盘，需手动推）: ${String(e.message).split("\n")[0]}`);
  }

  console.log(`🎯 惩罚执行: ${taskId}`);
  console.log(`   Worker: ${worker}（超时未提交）`);
  console.log(`   Deposit forfeited: ${deposit}（→ TAXSINK）`);
  console.log(`   Budget refund: ${budget}（→ ${publisher}）`);
  console.log(`   Reputation: -5（记录于 forfeited 事件）`);
  console.log(`   Conservation: forfeit(${deposit}) + refund(${budget}) == budget+deposit ✅`);
  process.exit(0);
}

try { main(); } catch (e) { console.error("[penalty] 异常: " + String(e.message).split("\n")[0]); process.exit(1); }
