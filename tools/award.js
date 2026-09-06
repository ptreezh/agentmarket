#!/usr/bin/env node
/* 智能体协同市场 · 竞价选标工具 award.js（M4.1, D-57）
 * 用法: node tools/award.js <taskId>
 * 流程: 检查竞价任务→检查截止时间→读取报价→排序选标→ref原子锁→写award.json→未中标押金退还→commit→push
 * Vickrey 二价: 最低报价中标，报酬=第二低报价；单候选回退预算×85%；0候选流拍
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ledger = require("./ledger.js");

const [taskId] = process.argv.slice(2);
if (!taskId) {
  console.error("用法: node tools/award.js <taskId>");
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
if (!spec.bidding) {
  console.error(`❌ 任务 ${taskId} 不是竞价任务，请用 claim.js 流程`);
  process.exit(1);
}

// 1. 检查截止时间
const deadline = new Date(spec.bidding_deadline).getTime();
if (isNaN(deadline)) {
  console.error(`❌ 无效的 bidding_deadline: ${spec.bidding_deadline}`);
  process.exit(1);
}
if (Date.now() < deadline) {
  console.error(`❌ 竞价尚未截止（${spec.bidding_deadline}），请等待截止后选标`);
  process.exit(1);
}

// 2. 检查是否已选标
const awardPath = path.join(taskDir, "bids", "award.json");
if (fs.existsSync(awardPath)) {
  const existing = JSON.parse(fs.readFileSync(awardPath, "utf-8"));
  console.error(`❌ 任务 ${taskId} 已选标（winner=${existing.winner}, payment=${existing.payment}）`);
  process.exit(1);
}

// 3. 读取所有有效报价
const bidsDir = path.join(taskDir, "bids");
const bids = [];
if (fs.existsSync(bidsDir)) {
  for (const f of fs.readdirSync(bidsDir)) {
    if (!f.endsWith(".json") || f === "award.json") continue;
    try {
      const bid = JSON.parse(fs.readFileSync(path.join(bidsDir, f), "utf-8"));
      if (bid.worker && bid.amount && bid.deposit) {
        bids.push(bid);
      }
    } catch (e) { console.warn(`   [warn] 跳过无效报价文件: ${f}`); }
  }
}

// 3b. 能力预筛选（D-103）
const requiredCaps = spec.required_capabilities;
const validBids = [];
const rejectedBids = [];
let capThreshold = 50;
try {
  const config = JSON.parse(fs.readFileSync("market-config.json", "utf-8"));
  capThreshold = config.capability_threshold || 50;
} catch (e) {}

if (requiredCaps && Array.isArray(requiredCaps) && requiredCaps.length > 0) {
  console.log(`\n🔍 能力预筛选: required_capabilities=[${requiredCaps.join(", ")}], threshold=${capThreshold}`);
  for (const bid of bids) {
    // 读取投标者 rep_by_cap
    const agentPath = path.join("agents", bid.worker, "agent.md");
    let repByCap = {};
    if (fs.existsSync(agentPath)) {
      const agentContent = fs.readFileSync(agentPath, "utf-8");
      const repBlock = agentContent.match(/rep_by_cap:\n((?:  \w+:\s*\d+\n?)*)/);
      if (repBlock) {
        for (const line of repBlock[1].split("\n")) {
          const m = line.match(/^\s+(\w+):\s*(\d+)/);
          if (m) repByCap[m[1]] = parseInt(m[2]);
        }
      }
    }
    // 检查所有 required_capabilities
    let pass = true;
    const failCaps = [];
    for (const cap of requiredCaps) {
      const rep = repByCap[cap] || 50; // 缺失默认50
      if (rep < capThreshold) {
        pass = false;
        failCaps.push(`${cap}=${rep}(<${capThreshold})`);
      }
    }
    if (pass) {
      validBids.push(bid);
      console.log(`   ✅ ${bid.worker}: 通过 (${requiredCaps.map(c => `${c}=${repByCap[c]||50}`).join(", ")})`);
    } else {
      rejectedBids.push({ worker: bid.worker, amount: bid.amount, reason: `能力声誉不足: ${failCaps.join(", ")}` });
      console.log(`   ❌ ${bid.worker}: 被拒 (${failCaps.join(", ")})，押金退还`);
      // 立即退还押金
      try {
        ledger.writeEntry({
          kind: "deposit_refund",
          amount: bid.deposit,
          from: `escrow-${taskId}-deposit`,
          to: bid.worker,
          note: `任务 ${taskId} 能力预筛选未通过，押金退还`,
          signer: "operator",
          privKeyPath: path.join("keys", "operator", "private.pem")
        });
      } catch (e) { console.warn(`   [warn] 押金退还失败: ${e.message}`); }
    }
  }
} else {
  // 无 required_capabilities，所有报价有效
  for (const bid of bids) validBids.push(bid);
  console.log(`\nℹ️ 任务无 required_capabilities，跳过能力预筛选`);
}

// 4. 按报价升序排序，平局按能力匹配度→总声誉→提交时间→Worker ID
function getAgentRep(workerId) {
  const agentPath = path.join("agents", workerId, "agent.md");
  if (!fs.existsSync(agentPath)) return { total: 50, caps: {} };
  const content = fs.readFileSync(agentPath, "utf-8");
  const totalMatch = content.match(/^reputation:\s*(\d+)/m);
  const total = totalMatch ? parseInt(totalMatch[1]) : 50;
  const caps = {};
  const repBlock = content.match(/rep_by_cap:\n((?:  \w+:\s*\d+\n?)*)/);
  if (repBlock) {
    for (const line of repBlock[1].split("\n")) {
      const m = line.match(/^\s+(\w+):\s*(\d+)/);
      if (m) caps[m[1]] = parseInt(m[2]);
    }
  }
  return { total, caps };
}

validBids.sort((a, b) => {
  if (a.amount !== b.amount) return a.amount - b.amount;
  // 平局：能力匹配度高者优先（required_capabilities 对应标签声誉总和）
  if (requiredCaps && Array.isArray(requiredCaps) && requiredCaps.length > 0) {
    const repA = getAgentRep(a.worker);
    const repB = getAgentRep(b.worker);
    const capSumA = requiredCaps.reduce((s, c) => s + (repA.caps[c] || 50), 0);
    const capSumB = requiredCaps.reduce((s, c) => s + (repB.caps[c] || 50), 0);
    if (capSumA !== capSumB) return capSumB - capSumA;
    if (repA.total !== repB.total) return repB.total - repA.total;
  }
  if (a.submitted_at !== b.submitted_at) return a.submitted_at.localeCompare(b.submitted_at);
  return a.worker.localeCompare(b.worker);
});

console.log(`\n📋 有效报价（按金额升序，平局能力优先）:`);
for (const b of validBids) {
  console.log(`   ${b.worker}: ${b.amount}（押金 ${b.deposit}，提交 ${b.submitted_at}）`);
}
if (rejectedBids.length > 0) {
  console.log(`\n🚫 被拒报价（能力预筛选）:`);
  for (const r of rejectedBids) {
    console.log(`   ${r.worker}: ${r.amount} — ${r.reason}`);
  }
}

// 5. ref 原子锁（防止并发选标）
try {
  g(`git push origin HEAD:refs/awards/${taskId}`);
  console.log(`   [hca] ref 原子选标锁创建成功: refs/awards/${taskId}`);
} catch (e) {
  console.error(`❌ 选标锁创建失败（可能已被其他进程选标）: ${e.message}`);
  process.exit(1);
}

// 6. 选标逻辑
let awardObj;
const now = new Date().toISOString();

if (validBids.length === 0) {
  // 0 候选：流拍
  awardObj = {
    status: "no_bids",
    task_id: taskId,
    candidates: [],
    rejected_bids: rejectedBids,
    awarded_at: now,
    note: "竞价截止无有效报价（可能被能力预筛选全部拒绝），任务流拍，退还 Publisher 托管"
  };
  console.log(`⚠️  流拍：无有效报价，退还 Publisher 托管 ${spec.budget}`);

  // 退还 Publisher 托管
  ledger.writeEntry({
    kind: "refund",
    amount: spec.budget,
    from: `escrow-${taskId}`,
    to: spec.publisher,
    note: `竞价任务 ${taskId} 流拍，全额退还托管`,
    signer: "operator",
    privKeyPath: path.join("keys", "operator", "private.pem")
  });
} else if (validBids.length === 1) {
  // 1 候选：回退预算 × 85%
  const winner = validBids[0];
  const payment = Math.round(spec.budget * 0.85 * 100) / 100;
  awardObj = {
    status: "awarded",
    task_id: taskId,
    winner: winner.worker,
    payment: payment,
    second_bid: null,
    mode: "single_candidate_fallback",
    candidates: validBids.map(b => ({ worker: b.worker, amount: b.amount })),
    rejected_bids: rejectedBids,
    tie_break: validBids.length > 1 ? "amount→capability→reputation→submitted_at→worker_id" : null,
    awarded_at: now
  };
  console.log(`✅ 选标（单候选回退）: winner=${winner.worker}, payment=${payment}（预算×85%）`);
} else {
  // ≥2 候选：Vickrey 二价
  const winner = validBids[0];
  const second = validBids[1];
  const payment = second.amount;
  awardObj = {
    status: "awarded",
    task_id: taskId,
    winner: winner.worker,
    payment: payment,
    second_bid: second.amount,
    second_bidder: second.worker,
    mode: "vickrey_second_price",
    candidates: validBids.map(b => ({ worker: b.worker, amount: b.amount })),
    rejected_bids: rejectedBids,
    tie_break: "amount→capability→reputation→submitted_at→worker_id",
    awarded_at: now
  };
  console.log(`✅ 选标（Vickrey 二价）: winner=${winner.worker}（报价 ${winner.amount}）, payment=${payment}（第二价 ${second.worker}=${second.amount}）`);
}

// 7. 签名 award.json
const awardBody = JSON.stringify(awardObj, null, 2);
awardObj.sig = signOperator(awardBody);
fs.writeFileSync(awardPath, JSON.stringify(awardObj, null, 2) + "\n");

// 8. 未中标者押金退还
if (awardObj.status === "awarded") {
  for (const b of validBids) {
    if (b.worker !== awardObj.winner) {
      ledger.writeEntry({
        kind: "deposit_refund",
        amount: b.deposit,
        from: `escrow-${taskId}-deposit`,
        to: b.worker,
        note: `竞价任务 ${taskId} 未中标，押金退还`,
        signer: "operator",
        privKeyPath: path.join("keys", "operator", "private.pem")
      });
      console.log(`   💰 押金退还: ${b.worker} ${b.deposit}`);
    }
  }

  // 写 claimed 事件（中标即认领）
  const claimedPath = path.join(taskDir, "events", `claimed-${now.replace(/[:.]/g, "")}.md`);
  fs.writeFileSync(claimedPath, `---
task: ${taskId}
worker: ${awardObj.winner}
claimed_at: ${now}
mode: bidding_award
payment: ${awardObj.payment}
sig: ${awardObj.sig}
---
竞价选标中标，payment=${awardObj.payment}
`);
}

// 9. commit + push
try {
  g(`git add "${awardPath}" "${path.join(taskDir, "events")}" ledger/ && git commit -q -m "award: ${taskId} ${awardObj.status} winner=${awardObj.winner || "none"} payment=${awardObj.payment || 0}" && git push origin HEAD:main`);
} catch (e) {
  console.warn(`   [warn] git push 失败：${e.message}`);
}

console.log(``);
console.log(`🎉 选标完成: ${taskId}`);
if (awardObj.status === "awarded") {
  console.log(`   Winner: ${awardObj.winner}`);
  console.log(`   Payment: ${awardObj.payment}`);
  console.log(`   Mode: ${awardObj.mode}`);
  console.log(`   中标者请执行任务并提交结果到 tasks/${taskId}/result/`);
  console.log(`   验证通过后运行: node tools/settle.js ${taskId}`);
}
