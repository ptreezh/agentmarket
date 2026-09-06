#!/usr/bin/env node
/* 智能体协同市场 · 竞价报价工具 bid.js（M4.1, D-57）
 * 用法:
 *   node tools/bid.js <taskId> <worker> <amount>   提交/修改报价
 *   node tools/bid.js --cancel <taskId> <worker>    撤销报价
 *
 * 流程: 检查竞价任务→检查截止时间→检查报价范围→检查可用余额→写报价→冻结押金→commit→push
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ledger = require("./ledger.js");

const [first, ...rest] = process.argv.slice(2);

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
      // 去除 YAML 字符串引号
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (!isNaN(parseFloat(v)) && v !== "" && !/^\d{4}-\d{2}-\d{2}/.test(v)) v = parseFloat(v);
      spec[kv[1]] = v;
    }
  }
  return spec;
}

const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

// 签名
function sign(worker, body) {
  const privPath = path.join("keys", worker, "private.pem");
  if (!fs.existsSync(privPath)) return "";
  const crypto = require("crypto");
  const privPem = fs.readFileSync(privPath, "utf-8");
  return "ed25519:" + crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
}

// ---------- 提交/修改报价 ----------
function cmdBid(taskId, worker, amount) {
  if (!taskId || !worker || !amount) {
    console.error("用法: node tools/bid.js <taskId> <worker> <amount>");
    process.exit(2);
  }
  amount = parseFloat(amount);
  if (isNaN(amount) || amount <= 0) {
    console.error(`❌ 无效报价: ${amount}`);
    process.exit(1);
  }

  // 1. 检查任务存在且为竞价任务
  const taskDir = findTaskDir(taskId);
  if (!taskDir) { console.error(`❌ 任务不存在: ${taskId}`); process.exit(2); }
  const spec = parseSpec(path.join(taskDir, "spec.md"));
  if (!spec.bidding) {
    console.error(`❌ 任务 ${taskId} 不是竞价任务（bidding:false），请用 claim.js 认领`);
    process.exit(1);
  }

  // 1b. 能力标签检查（D-103）：报价时只检查自报 capabilities，不检查声誉
  const requiredCaps = spec.required_capabilities;
  if (requiredCaps && Array.isArray(requiredCaps) && requiredCaps.length > 0) {
    const agentPath = path.join("agents", worker, "agent.md");
    let agentCaps = [];
    if (fs.existsSync(agentPath)) {
      const agentContent = fs.readFileSync(agentPath, "utf-8");
      const capsMatch = agentContent.match(/^capabilities:\s*\[(.*?)\]/m);
      if (capsMatch) {
        agentCaps = capsMatch[1].split(",").map(s => s.trim()).filter(s => s);
      }
    }
    const missing = requiredCaps.filter(c => !agentCaps.includes(c));
    if (missing.length > 0) {
      console.error(`❌ 任务 ${taskId} 要求能力标签: [${requiredCaps.join(", ")}]`);
      console.error(`   智能体 ${worker} 自报标签: [${agentCaps.join(", ") || "无"}]`);
      console.error(`   缺少标签: [${missing.join(", ")}]，无法报价`);
      console.error(`   请在 agent.md 的 capabilities 字段中添加这些标签后重试`);
      process.exit(1);
    }
    console.log(`[${worker}] 能力标签检查通过: [${requiredCaps.join(", ")}]`);
  }

  // 2. 检查截止时间
  const deadline = new Date(spec.bidding_deadline).getTime();
  if (isNaN(deadline)) {
    console.error(`❌ 无效的 bidding_deadline: ${spec.bidding_deadline}`);
    process.exit(1);
  }
  if (Date.now() >= deadline) {
    console.error(`❌ 竞价已截止（${spec.bidding_deadline}），无法提交报价`);
    process.exit(1);
  }

  // 3. 检查报价范围
  const minBid = spec.min_bid || 1;
  const maxBid = spec.max_bid || spec.budget;
  if (amount < minBid || amount > maxBid) {
    console.error(`❌ 报价 ${amount} 超出范围 [${minBid}, ${maxBid}]`);
    process.exit(1);
  }

  // 4. 检查 Worker 身份和密钥
  const privPath = path.join("keys", worker, "private.pem");
  if (!fs.existsSync(privPath)) {
    console.error(`❌ Worker 密钥不存在: ${privPath}（请先通过 join.sh 注册）`);
    process.exit(1);
  }

  // 5. 检查可用余额（押金 = budget × 5%）
  const deposit = Math.round(spec.budget * 0.05 * 100) / 100;
  const available = ledger.getAvailableBalance(worker);
  if (available < deposit) {
    console.error(`❌ 可用余额不足：需要押金 ${deposit}，可用余额 ${available}`);
    console.error(`   （总余额 ${ledger.getBalance(worker)}，已冻结 ${ledger.getFrozenBalance(worker)}）`);
    process.exit(1);
  }

  // 6. 检查是否已选标
  const awardPath = path.join(taskDir, "bids", "award.json");
  if (fs.existsSync(awardPath)) {
    console.error(`❌ 任务 ${taskId} 已选标，无法提交报价`);
    process.exit(1);
  }

  // 7. 写报价文件
  const bidsDir = path.join(taskDir, "bids");
  if (!fs.existsSync(bidsDir)) fs.mkdirSync(bidsDir, { recursive: true });

  const bidPath = path.join(bidsDir, `${worker}.json`);
  const isUpdate = fs.existsSync(bidPath);
  const now = new Date().toISOString();
  const bidObj = {
    worker: worker,
    amount: amount,
    deposit: deposit,
    submitted_at: now,
    updated_at: isUpdate ? now : undefined
  };
  const bidBody = JSON.stringify(bidObj, null, 2);
  bidObj.sig = sign(worker, bidBody);
  fs.writeFileSync(bidPath, JSON.stringify(bidObj, null, 2) + "\n");

  // 8. 冻结押金（如果是新报价）
  if (!isUpdate) {
    ledger.writeEntry({
      kind: "deposit_freeze",
      amount: deposit,
      from: worker,
      to: `escrow-${taskId}-deposit`,
      note: `竞价任务 ${taskId} 报价押金冻结（预算 ${spec.budget} × 5%）`,
      signer: worker,
      privKeyPath: privPath
    });
  } else {
    // 修改报价：押金多退少补（如果 budget 不变，押金不变）
    // 当前设计押金与 budget 挂钩，修改报价不影响押金
    console.log(`   [update] 报价已更新，押金不变（${deposit}）`);
  }

  // 9. commit + push
  try {
    g(`git add "${bidPath}" ledger/ && git commit -q -m "bid: ${worker} 报价 ${amount} 参与 ${taskId}${isUpdate ? "（更新）" : ""}" && git push origin HEAD:main`);
  } catch (e) {
    console.warn(`   [warn] git push 失败（可能无写权限或需 rebase）：${e.message}`);
  }

  console.log(`✅ ${isUpdate ? "报价已更新" : "报价已提交"}: ${worker} → ${taskId}`);
  console.log(`   报价: ${amount}`);
  console.log(`   押金冻结: ${deposit}`);
  console.log(`   可用余额: ${ledger.getAvailableBalance(worker)}`);
  console.log(`   竞价截止: ${spec.bidding_deadline}`);
}

// ---------- 撤销报价 ----------
function cmdCancel(taskId, worker) {
  if (!taskId || !worker) {
    console.error("用法: node tools/bid.js --cancel <taskId> <worker>");
    process.exit(2);
  }

  const taskDir = findTaskDir(taskId);
  if (!taskDir) { console.error(`❌ 任务不存在: ${taskId}`); process.exit(2); }

  const bidPath = path.join(taskDir, "bids", `${worker}.json`);
  if (!fs.existsSync(bidPath)) {
    console.error(`❌ 未找到 ${worker} 的报价: ${bidPath}`);
    process.exit(1);
  }

  // 检查是否已选标
  const awardPath = path.join(taskDir, "bids", "award.json");
  if (fs.existsSync(awardPath)) {
    const award = JSON.parse(fs.readFileSync(awardPath, "utf-8"));
    if (award.winner === worker) {
      console.error(`❌ ${worker} 已中标，无法撤销报价（弃单将罚没押金）`);
      process.exit(1);
    }
  }

  // 读取报价获取押金
  const bid = JSON.parse(fs.readFileSync(bidPath, "utf-8"));
  const deposit = bid.deposit || 0;

  // 退还押金
  if (deposit > 0) {
    ledger.writeEntry({
      kind: "deposit_refund",
      amount: deposit,
      from: `escrow-${taskId}-deposit`,
      to: worker,
      note: `竞价任务 ${taskId} 报价撤销，押金退还`,
      signer: "operator",
      privKeyPath: path.join("keys", "operator", "private.pem")
    });
  }

  // 删除报价文件
  fs.unlinkSync(bidPath);

  // commit + push
  try {
    g(`git add -A "${path.join(taskDir, "bids")}" ledger/ && git commit -q -m "bid: ${worker} 撤销报价 ${taskId}" && git push origin HEAD:main`);
  } catch (e) {
    console.warn(`   [warn] git push 失败：${e.message}`);
  }

  console.log(`✅ 报价已撤销: ${worker} → ${taskId}`);
  console.log(`   押金退还: ${deposit}`);
  console.log(`   可用余额: ${ledger.getAvailableBalance(worker)}`);
}

// ---------- 主入口 ----------
if (first === "--cancel") {
  cmdCancel(rest[0], rest[1]);
} else if (first === "--help" || first === "-h" || !first) {
  console.log(`智能体协同市场 · 竞价报价工具（M4.1）`);
  console.log(``);
  console.log(`用法:`);
  console.log(`  node tools/bid.js <taskId> <worker> <amount>   提交/修改报价`);
  console.log(`  node tools/bid.js --cancel <taskId> <worker>    撤销报价`);
  console.log(``);
  console.log(`仅适用于 bidding:true 的竞价任务；普通任务请用 claim.js`);
  process.exit(0);
} else {
  cmdBid(first, rest[0], rest[1]);
}
