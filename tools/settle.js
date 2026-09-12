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
      // 数组解析：[item1, item2]
      if (v.startsWith("[") && v.endsWith("]")) {
        v = v.slice(1, -1).split(",").map(s => s.trim()).filter(s => s);
      } else if (v === "true") v = true;
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

// 6-pre. 运营者私钥前置检查：结算为权威操作，账本+settled 事件必须签名（D-108）
const allowUnsigned = process.argv.includes("--allow-unsigned");
if (!fs.existsSync(operatorPriv)) {
  if (!allowUnsigned) {
    console.error("❌ 拒绝结算：缺运营者私钥 " + operatorPriv);
    console.error("   结算会写入账本与 settled 事件，属权威操作，必须由运营者签名。");
    console.error("   测试环境可用 --allow-unsigned 显式降级（账本/事件无签名，勿用于生产）。");
    process.exit(1);
  }
  console.warn("⚠️ 运营者私钥缺失——--allow-unsigned 显式降级：账本与 settled 事件将无签名（仅限测试）");
}

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

// 6e. 发布押金返还（pub_deposit_refund）——发布者按时手动核验，押金返还（SPEC-AUTOSETTLE-20260912 G4）
try {
  const pubDep = Math.round(budget * 0.05 * 100) / 100;
  let hasPubDep = false;
  const ld = path.join("ledger");
  if (fs.existsSync(ld)) {
    for (const f of fs.readdirSync(ld)) {
      if (!/^L-\d{4}\.md$/.test(f)) continue;
      const c = fs.readFileSync(path.join(ld, f), "utf-8");
      if (/^kind:\s*pub_escrow/m.test(c) && new RegExp(`^to:\\s*escrow-${taskId}-pubdep\\s*$`, "m").test(c)) { hasPubDep = true; break; }
    }
  }
  if (hasPubDep) {
    ledger.writeEntry({
      kind: "pub_deposit_refund",
      amount: pubDep,
      from: `escrow-${taskId}-pubdep`,
      to: publisher,
      note: `任务 ${taskId} 发布者已核验，发布押金返还`,
      signer: "operator",
      privKeyPath: operatorPriv
    });
    console.log(`   💰 发布押金返还: ${publisher} +${pubDep}`);
  }
} catch (e) {
  console.warn(`   [warn] 发布押金返还跳过: ${e.message}`);
}

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
const settledNote = "任务结算完成，守恒验证通过。\n"; // 含尾部换行，与 sig.js splitFile body 一致（D-112 v2）
const settledSig = signOperator(settledNote).replace(/^ed25519:/, ""); // 事件签名纯 hex，覆盖正文（D-112）
const crypto2 = require("crypto");
const opPubPem = fs.existsSync("OPERATOR_PUBKEY") ? fs.readFileSync("OPERATOR_PUBKEY", "utf-8") : "";
const opFp = opPubPem ? "SHA256:" + crypto2.createHash("sha256").update(crypto2.createPublicKey(opPubPem).export({ type: "spki", format: "der" })).digest("base64") : "";
fs.writeFileSync(settledPath, `---\n${settledBody}signer: ${opFp}\nsignature: ${settledSig}\n---\n${settledNote}`);

// 7b. 声誉更新（分标签能力声誉，D-103）
function updateReputation(taskId, winner, spec, verifyResult) {
  const requiredCaps = spec.required_capabilities;
  if (!requiredCaps || !Array.isArray(requiredCaps) || requiredCaps.length === 0) {
    console.log(`   📊 声誉: 任务无 required_capabilities，跳过声誉更新`);
    return;
  }

  // 读取 market-config.json
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync("market-config.json", "utf-8"));
  } catch (e) {
    config = { rep_delta: { S: 2, M: 3, L: 5, XL: 8 }, probation: { unlock_done: 3, unlock_rep: 60, full_rep: 70 } };
  }
  const repDelta = config.rep_delta || { S: 2, M: 3, L: 5, XL: 8 };
  const probation = config.probation || { unlock_done: 3, unlock_rep: 60, full_rep: 70 };
  const complexity = spec.complexity || "M";
  const delta = repDelta[complexity] || 3;

  // 确定 verdict
  const passed = verifyResult.passed || 0;
  const total = verifyResult.total || 1;
  const ratio = passed / total;
  let verdict, repChange;
  if (ratio >= 0.8) { verdict = "pass"; repChange = delta; }
  else if (ratio < 0.3) { verdict = "fail"; repChange = -delta; }
  else { verdict = "partial"; repChange = Math.round(delta / 2); }

  // 读取中标者 agent.md
  const agentPath = path.join("agents", winner, "agent.md");
  if (!fs.existsSync(agentPath)) {
    console.warn(`   [warn] 声誉更新: agent.md 不存在: ${agentPath}`);
    return;
  }
  const agentContent = fs.readFileSync(agentPath, "utf-8");
  const fmMatch = agentContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    console.warn(`   [warn] 声誉更新: agent.md 无 frontmatter`);
    return;
  }

  // 解析现有 frontmatter
  const fm = {};
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (!isNaN(parseFloat(v)) && v !== "" && !/^\d{4}-\d{2}-\d{2}/.test(v)) v = parseFloat(v);
      fm[kv[1]] = v;
    }
  }

  // 解析 rep_by_cap（YAML map 格式）
  let repByCap = {};
  let capCounts = {};
  const repBlock = agentContent.match(/rep_by_cap:\n((?:  \w+:\s*\d+\n?)*)/);
  if (repBlock) {
    for (const line of repBlock[1].split("\n")) {
      const m = line.match(/^\s+(\w+):\s*(\d+)/);
      if (m) repByCap[m[1]] = parseInt(m[2]);
    }
  }
  const countBlock = agentContent.match(/cap_counts:\n((?:  \w+:\s*\d+\n?)*)/);
  if (countBlock) {
    for (const line of countBlock[1].split("\n")) {
      const m = line.match(/^\s+(\w+):\s*(\d+)/);
      if (m) capCounts[m[1]] = parseInt(m[2]);
    }
  }

  // 更新每个 required_capability
  const changes = [];
  for (const cap of requiredCaps) {
    const oldRep = repByCap[cap] || 50;
    const newRep = Math.max(0, Math.min(100, oldRep + repChange));
    repByCap[cap] = newRep;
    capCounts[cap] = (capCounts[cap] || 0) + 1;
    changes.push(`${cap}: ${oldRep}→${newRep} (${repChange >= 0 ? "+" : ""}${repChange})`);
  }

  // 重新计算总声誉（加权平均与最高标签取较高者）
  let totalCount = 0;
  let weightedSum = 0;
  let maxRep = 0;
  for (const cap of Object.keys(repByCap)) {
    const count = capCounts[cap] || 0;
    const rep = repByCap[cap];
    if (count > 0) {
      totalCount += count;
      weightedSum += rep * count;
    }
    if (rep > maxRep) maxRep = rep;
  }
  const weightedAvg = totalCount > 0 ? Math.round(weightedSum / totalCount) : 50;
  let totalRep = Math.max(weightedAvg, maxRep);

  // probation 升级（保底声誉）
  let tier = fm.tier || "probation";
  if (tier === "probation" && totalCount >= probation.unlock_done) {
    tier = "normal";
    if (totalRep < probation.unlock_rep) totalRep = probation.unlock_rep;
    console.log(`   🎖️ probation 升级: normal (保底声誉 ${probation.unlock_rep})`);
  } else if (tier === "normal" && totalCount >= 10) {
    tier = "full";
    if (totalRep < probation.full_rep) totalRep = probation.full_rep;
    console.log(`   🎖️ probation 升级: full (保底声誉 ${probation.full_rep})`);
  }

  // 构建新的 frontmatter
  const newFmLines = [];
  const existingKeys = new Set();
  for (const line of fmMatch[1].split("\n")) {
    const kv = line.match(/^(\w+):/);
    if (kv) {
      const key = kv[1];
      if (key === "rep_by_cap" || key === "cap_counts" || key === "reputation" || key === "tier") {
        continue; // 这些字段重新生成
      }
      existingKeys.add(key);
      newFmLines.push(line);
    }
  }
  // 添加 reputation
  newFmLines.push(`reputation: ${totalRep}`);
  // 添加 tier
  newFmLines.push(`tier: ${tier}`);
  // 添加 rep_by_cap
  newFmLines.push(`rep_by_cap:`);
  for (const cap of Object.keys(repByCap).sort()) {
    newFmLines.push(`  ${cap}: ${repByCap[cap]}`);
  }
  // 添加 cap_counts
  newFmLines.push(`cap_counts:`);
  for (const cap of Object.keys(capCounts).sort()) {
    newFmLines.push(`  ${cap}: ${capCounts[cap]}`);
  }

  // 写回 agent.md
  const newFm = newFmLines.join("\n");
  const newAgentContent = agentContent.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  fs.writeFileSync(agentPath, newAgentContent);

  // 写声誉变动事件
  const repEventPath = path.join(eventsDir, `rep-update-${new Date().toISOString().replace(/[:.]/g, "")}.md`);
  const repEventBody = `task: ${taskId}
agent: ${winner}
verdict: ${verdict}
complexity: ${complexity}
delta: ${repChange}
required_capabilities: [${requiredCaps.join(", ")}]
changes:
${changes.map(c => `  - ${c}`).join("\n")}
total_reputation: ${totalRep}
tier: ${tier}
updated_at: ${new Date().toISOString()}
`;
  fs.writeFileSync(repEventPath, `---\n${repEventBody}---\n声誉更新完成。\n`);

  console.log(`   📊 声誉更新: verdict=${verdict}, delta=${repChange >= 0 ? "+" : ""}${repChange}`);
  console.log(`   📊 分标签: ${changes.join(", ")}`);
  console.log(`   📊 总声誉: ${totalRep} (tier=${tier})`);
}

try {
  updateReputation(taskId, winner, spec, verifyResult);
} catch (e) {
  console.warn(`   [warn] 声誉更新失败: ${e.message}`);
}

// 8. commit + push
try {
  g(`git add ledger/ "${settledPath}" "agents/${winner}/agent.md" && git commit -q -m "settle: ${taskId} 结算完成 winner=${winner} payment=${payment} tax=${tax} refund=${refund} rep_update" && git push origin HEAD:main`);
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
