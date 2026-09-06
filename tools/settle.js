#!/usr/bin/env node
/* 智能体协同市场 · 自动结算工具 settle.js（M4.1, D-09/D-57）
 * 用法: node tools/settle.js <taskId>
 * 流程: 检查任务→检查验证通过→检查未结算→确定报酬(竞价读award.json/普通85%)→计算守恒→写账本(pay/tax/refund/deposit_refund)→写settled事件→commit→push
 * 守恒: payment + tax + refund = budget（Publisher escrow）；deposit_refund = deposit（Worker 押金 escrow）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ledger = require("./ledger.js");

const [taskId] = process.argv.slice(2);
if (!taskId) {
  console.error("用法: node tools/settle.js <taskId>");
  process.exit(2);
}

// 兼容分片路径
function findTaskDir(id) {
  const flat = path.join("tasks", id);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join("tasks", id.slice(0, 4), id);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}

// 解析 spec.md frontmatter
function parseSpec(specPath) {
  const content = fs.readFileSync(specPath, "utf-8");
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const spec = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (!isNaN(parseFloat(v)) && v !== "" && !/^\d{4}-\d{2}-\d{2}/.test(v)) v = parseFloat(v);
      spec[kv[1]] = v;
    }
  }
  return spec;
}

const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

// 运营者签名
function signOperator(body) {
  const privPath = path.join("keys", "operator", "private.pem");
  if (!fs.existsSync(privPath)) return "";
  const crypto = require("crypto");
  const privPem = fs.readFileSync(privPath, "utf-8");
  return "ed25519:" + crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
}

// ---------- 主流程 ----------
const taskDir = findTaskDir(taskId);
if (!taskDir) { console.error(`❌ 任务不存在: ${taskId}`); process.exit(2); }

const spec = parseSpec(path.join(taskDir, "spec.md"));
const budget = spec.budget;
const publisher = spec.publisher;
const taxRate = 0.02; // 从 market-config.json 读取，当前 2%

// 1. 检查验证通过
const verifyPath = path.join(taskDir, "result", "verify-result.json");
if (!fs.existsSync(verifyPath)) {
  console.error(`❌ 任务未验证：${verifyPath} 不存在，请先运行 verify.js`);
  process.exit(1);
}
const verifyResult = JSON.parse(fs.readFileSync(verifyPath, "utf-8"));
if (!verifyResult.verdict || verifyResult.verdict !== "PASS") {
  console.error(`❌ 任务验证未通过：verdict=${verifyResult.verdict}`);
  process.exit(1);
}
console.log(`✅ 验证通过：${verifyResult.passed}/${verifyResult.total} 断言通过`);

// 2. 检查是否已结算
const eventsDir = path.join(taskDir, "events");
if (fs.existsSync(eventsDir)) {
  const settled = fs.readdirSync(eventsDir).filter(f => f.startsWith("settled-"));
  if (settled.length > 0) {
    console.error(`❌ 任务已结算：${settled[0]}`);
    process.exit(1);
  }
}

// 3. 确定中标者和报酬
let winner, payment, mode;
const awardPath = path.join(taskDir, "bids", "award.json");
if (spec.bidding && fs.existsSync(awardPath)) {
  // 竞价任务：从 award.json 读取
  const award = JSON.parse(fs.readFileSync(awardPath, "utf-8"));
  if (award.status !== "awarded") {
    console.error(`❌ 竞价任务未选标或流拍：status=${award.status}`);
    process.exit(1);
  }
  winner = award.winner;
  payment = award.payment;
  mode = award.mode || "vickrey";
  console.log(`📋 竞价任务：winner=${winner}, payment=${payment}（${mode}）`);
} else {
  // 普通任务：预算 × 85%
  // 从 claimed 事件读取 worker
  let claimedWorker = null;
  if (fs.existsSync(eventsDir)) {
    const claimed = fs.readdirSync(eventsDir).filter(f => f.startsWith("claimed-")).sort();
    if (claimed.length > 0) {
      const content = fs.readFileSync(path.join(eventsDir, claimed[0]), "utf-8");
      const m = content.match(/worker:\s*(\S+)/);
      if (m) claimedWorker = m[1];
    }
  }
  if (!claimedWorker) {
    console.error(`❌ 无法确定中标者：未找到 claimed 事件`);
    process.exit(1);
  }
  winner = claimedWorker;
  payment = Math.round(budget * 0.85 * 100) / 100;
  mode = "fixed_85_percent";
  console.log(`📋 普通任务：winner=${winner}, payment=${payment}（预算×85%）`);
}

// 4. 计算各项
const tax = Math.round(payment * taxRate * 100) / 100;
const refund = Math.round((budget - payment - tax) * 100) / 100;
const deposit = Math.round(budget * 0.05 * 100) / 100;

// 5. 守恒验证
const escrowTotal = Math.round((payment + tax + refund) * 100) / 100;
if (escrowTotal !== budget) {
  console.error(`❌ 守恒验证失败：payment(${payment}) + tax(${tax}) + refund(${refund}) = ${escrowTotal} ≠ budget(${budget})`);
  process.exit(1);
}
console.log(`✅ 守恒验证通过：payment(${payment}) + tax(${tax}) + refund(${refund}) = budget(${budget})`);

// 6. 写账本
const now = new Date().toISOString();
const operatorPriv = path.join("keys", "operator", "private.pem");

// 6a. 报酬（pay）
ledger.writeEntry({
  kind: "pay",
  amount: payment,
  from: `escrow-${taskId}`,
  to: winner,
  note: `任务 ${taskId} 报酬（${mode}）`,
  signer: "operator",
  privKeyPath: operatorPriv
});
console.log(`   💰 报酬: ${winner} +${payment}`);

// 6b. 税（tax）
ledger.writeEntry({
  kind: "tax",
  amount: tax,
  from: `escrow-${taskId}`,
  to: "TAXSINK",
  note: `任务 ${taskId} 市场税（报酬×${taxRate*100}%）`,
  signer: "operator",
  privKeyPath: operatorPriv
});
console.log(`   💰 税: TAXSINK +${tax}`);

// 6c. 退款（refund）
if (refund > 0) {
  ledger.writeEntry({
    kind: "refund",
    amount: refund,
    from: `escrow-${taskId}`,
    to: publisher,
    note: `任务 ${taskId} 未花费托管退还`,
    signer: "operator",
    privKeyPath: operatorPriv
  });
  console.log(`   💰 退款: ${publisher} +${refund}`);
}

// 6d. 押金返还（deposit_refund）
ledger.writeEntry({
  kind: "deposit_refund",
  amount: deposit,
  from: `escrow-${taskId}-deposit`,
  to: winner,
  note: `任务 ${taskId} 验证通过，押金返还`,
  signer: "operator",
  privKeyPath: operatorPriv
});
console.log(`   💰 押金返还: ${winner} +${deposit}`);

// 7. 写 settled 事件
const settledPath = path.join(eventsDir, `settled-${now.replace(/[:.]/g, "")}.md`);
const settledBody = `task: ${taskId}
winner: ${winner}
payment: ${payment}
tax: ${tax}
refund: ${refund}
deposit_refund: ${deposit}
mode: ${mode}
settled_at: ${now}
budget: ${budget}
conservation: payment+tax+refund=${escrowTotal}=budget
`;
const settledSig = signOperator(settledBody);
fs.writeFileSync(settledPath, `---\n${settledBody}sig: ${settledSig}\n---\n任务结算完成，守恒验证通过。\n`);

// 8. commit + push
try {
  g(`git add ledger/ "${settledPath}" && git commit -q -m "settle: ${taskId} 结算完成 winner=${winner} payment=${payment} tax=${tax} refund=${refund}" && git push origin HEAD:main`);
} catch (e) {
  console.warn(`   [warn] git push 失败：${e.message}`);
}

console.log(``);
console.log(`🎉 结算完成: ${taskId}`);
console.log(`   Winner: ${winner}`);
console.log(`   Payment: ${payment}`);
console.log(`   Tax: ${tax}（→ TAXSINK）`);
console.log(`   Refund: ${refund}（→ ${publisher}）`);
console.log(`   Deposit refund: ${deposit}（→ ${winner}）`);
console.log(`   Mode: ${mode}`);
console.log(`   Conservation: payment+tax+refund = ${escrowTotal} = budget(${budget}) ✅`);
