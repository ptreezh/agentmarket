#!/usr/bin/env node
/* 智能体协同市场 · 统一账本工具库 ledger.js（M4.1）
 * 提供：nextSeq / writeEntry / getBalance / getFrozenBalance
 * 用法（作为库）: const ledger = require('./ledger.js');
 * 用法（CLI）: node tools/ledger.js balance <agentId>
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LEDGER_DIR = "ledger";

// 获取下一个账本序号
function nextSeq() {
  if (!fs.existsSync(LEDGER_DIR)) return 1;
  const files = fs.readdirSync(LEDGER_DIR).filter(f => /^L-\d+\.md$/.test(f));
  if (files.length === 0) return 1;
  const maxSeq = Math.max(...files.map(f => parseInt(f.match(/L-(\d+)/)[1], 10)));
  return maxSeq + 1;
}

// 解析账本条目 frontmatter
function parseEntry(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const entry = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) entry[kv[1]] = kv[2];
  }
  return entry;
}

// 写账本条目
function writeEntry({ kind, amount, from, to, note, signer, privKeyPath }) {
  const seq = nextSeq();
  const ts = new Date().toISOString();
  const body = `${note || ""}`;

  // 签名
  let sig = "";
  if (privKeyPath && fs.existsSync(privKeyPath)) {
    const privPem = fs.readFileSync(privKeyPath, "utf-8");
    const sigHex = crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
    sig = `ed25519:${sigHex}`;
  } else if (signer) {
    console.warn(`⚠️ ledger 签名跳过（signer=${signer}）：${privKeyPath || "未指定"} 不存在`);
  }

  const content = `---
seq: ${seq}
ts: ${ts}
kind: ${kind}
amount: ${amount}
from: ${from}
to: ${to}
note: ${note || ""}
sig: ${sig}
---
`;

  const fileName = `L-${String(seq).padStart(4, "0")}.md`;
  const filePath = path.join(LEDGER_DIR, fileName);
  fs.writeFileSync(filePath, content);
  return { seq, fileName, filePath };
}

// 计算账户余额（从账本汇总）
function getBalance(accountId) {
  if (!fs.existsSync(LEDGER_DIR)) return 0;
  const files = fs.readdirSync(LEDGER_DIR).filter(f => /^L-\d+\.md$/.test(f)).sort();
  let balance = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(LEDGER_DIR, f), "utf-8");
    const entry = parseEntry(content);
    if (!entry) continue;
    const amount = parseFloat(entry.amount) || 0;
    if (entry.to === accountId) balance += amount;
    if (entry.from === accountId) balance -= amount;
  }
  return Math.round(balance * 100) / 100;
}

// 计算冻结余额（押金冻结）
function getFrozenBalance(accountId) {
  if (!fs.existsSync(LEDGER_DIR)) return 0;
  const files = fs.readdirSync(LEDGER_DIR).filter(f => /^L-\d+\.md$/.test(f)).sort();
  let frozen = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(LEDGER_DIR, f), "utf-8");
    const entry = parseEntry(content);
    if (!entry) continue;
    const amount = parseFloat(entry.amount) || 0;
    // deposit_freeze: from worker to escrow-deposit
    if (entry.kind === "deposit_freeze" && entry.from === accountId) frozen += amount;
    // deposit_refund: from escrow-deposit to worker
    if (entry.kind === "deposit_refund" && entry.to === accountId) frozen -= amount;
    // deposit_forfeit: from escrow-deposit to TAXSINK (worker 失去押金)
    if (entry.kind === "deposit_forfeit" && entry.note && entry.note.includes(accountId)) frozen -= amount;
  }
  return Math.round(frozen * 100) / 100;
}

// 可用余额 = 总余额 - 冻结
function getAvailableBalance(accountId) {
  return Math.round((getBalance(accountId) - getFrozenBalance(accountId)) * 100) / 100;
}

// CLI 入口
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "balance") {
    const id = args[0];
    if (!id) { console.error("用法: node tools/ledger.js balance <agentId>"); process.exit(2); }
    console.log(`账户: ${id}`);
    console.log(`总余额: ${getBalance(id)}`);
    console.log(`冻结: ${getFrozenBalance(id)}`);
    console.log(`可用: ${getAvailableBalance(id)}`);
  } else if (cmd === "nextseq") {
    console.log(nextSeq());
  } else {
    console.log("用法: node tools/ledger.js balance <agentId> | nextseq");
  }
}

module.exports = { nextSeq, writeEntry, parseEntry, getBalance, getFrozenBalance, getAvailableBalance };
