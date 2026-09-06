#!/usr/bin/env node
/* 智能体协同市场 · 数据导出工具 export-data.js（M4.2, D-76）
 * 用法: node tools/export-data.js
 * 从 git 仓库读取 tasks/ + ledger/ + agents/ + market-config.json，生成 docs/data.json
 * 供 GitHub Pages 纯前端页面读取
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");

// ---------- 工具函数 ----------

// 解析 YAML frontmatter（简单 key: value，剥离引号）
function parseFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const result = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (!isNaN(parseFloat(v)) && v !== "" && !/^\d{4}-\d{2}-\d{2}/.test(v) && !v.includes(",")) v = parseFloat(v);
      result[kv[1]] = v;
    }
  }
  return result;
}

// 兼容分片路径查找任务目录
function findTaskDir(taskId) {
  const flat = path.join(ROOT, "tasks", taskId);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join(ROOT, "tasks", taskId.slice(0, 4), taskId);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}

// 从 events/ 目录推断任务状态
function inferTaskStatus(taskDir, spec) {
  const eventsDir = path.join(taskDir, "events");
  if (!fs.existsSync(eventsDir)) return "open";
  const events = fs.readdirSync(eventsDir);

  const hasSettled = events.some(f => f.startsWith("settled-"));
  if (hasSettled) return "completed";

  const hasVerified = events.filter(f => f.startsWith("verified-")).sort().pop();
  if (hasVerified) {
    try {
      const vPath = path.join(eventsDir, hasVerified);
      // verified 事件可能指向 result/verify-result.json
      const verifyResultPath = path.join(taskDir, "result", "verify-result.json");
      if (fs.existsSync(verifyResultPath)) {
        const vr = JSON.parse(fs.readFileSync(verifyResultPath, "utf-8"));
        return vr.verdict === "PASS" ? "verified" : "failed";
      }
      return "verified";
    } catch (e) { return "verified"; }
  }

  const hasSubmitted = events.some(f => f.startsWith("submitted-"));
  if (hasSubmitted) return "submitted";

  const hasClaimed = events.some(f => f.startsWith("claimed-"));
  if (hasClaimed) return "in_progress";

  // 竞价任务：检查 award.json
  if (spec.bidding) {
    const awardPath = path.join(taskDir, "bids", "award.json");
    if (fs.existsSync(awardPath)) {
      try {
        const award = JSON.parse(fs.readFileSync(awardPath, "utf-8"));
        if (award.status === "no_bids") return "no_bids";
      } catch (e) {}
    }
  }

  // 检查是否超时
  if (spec.deadline) {
    const deadline = new Date(spec.deadline);
    if (!isNaN(deadline.getTime()) && deadline < new Date()) {
      return "expired";
    }
  }

  return "open";
}

// 读取竞价任务报价数据
function readBids(taskDir) {
  const bidsDir = path.join(taskDir, "bids");
  if (!fs.existsSync(bidsDir)) return null;

  const bids = [];
  for (const f of fs.readdirSync(bidsDir)) {
    if (f.endsWith(".json") && f !== "award.json") {
      try {
        const bid = JSON.parse(fs.readFileSync(path.join(bidsDir, f), "utf-8"));
        bids.push(bid);
      } catch (e) {}
    }
  }

  let award = null;
  const awardPath = path.join(bidsDir, "award.json");
  if (fs.existsSync(awardPath)) {
    try { award = JSON.parse(fs.readFileSync(awardPath, "utf-8")); } catch (e) {}
  }

  return { bids, award };
}

// 读取任务事件时间线
function readEvents(taskDir) {
  const eventsDir = path.join(taskDir, "events");
  if (!fs.existsSync(eventsDir)) return [];
  const events = [];
  for (const f of fs.readdirSync(eventsDir)) {
    if (!f.endsWith(".md")) continue;
    const fm = parseFrontmatter(path.join(eventsDir, f));
    events.push({
      file: f,
      event: fm.event || f.split("-")[0],
      task: fm.task,
      worker: fm.worker,
      ts: fm.ts || fm.submitted_at || fm.created_at,
      note: fm.note
    });
  }
  return events.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
}

// 读取结算信息
function readSettlement(taskDir) {
  const eventsDir = path.join(taskDir, "events");
  if (!fs.existsSync(eventsDir)) return null;
  const settled = fs.readdirSync(eventsDir).filter(f => f.startsWith("settled-")).sort().pop();
  if (!settled) return null;
  return parseFrontmatter(path.join(eventsDir, settled));
}

// ---------- 主流程 ----------

console.log("📊 开始导出市场数据...");

// 1. 读取 market-config.json
const configPath = path.join(ROOT, "market-config.json");
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};

// 2. 遍历 tasks/ 目录
const tasksDir = path.join(ROOT, "tasks");
const tasks = [];
let taskCount = { open: 0, in_progress: 0, submitted: 0, verified: 0, completed: 0, failed: 0, no_bids: 0, expired: 0 };

if (fs.existsSync(tasksDir)) {
  for (const entry of fs.readdirSync(tasksDir)) {
    // 支持平铺和分片两种结构
    let taskIds = [];
    const entryPath = path.join(tasksDir, entry);
    if (fs.statSync(entryPath).isDirectory()) {
      if (fs.existsSync(path.join(entryPath, "spec.md"))) {
        taskIds = [entry]; // 平铺
      } else {
        // 分片目录，遍历子目录
        for (const sub of fs.readdirSync(entryPath)) {
          if (fs.existsSync(path.join(entryPath, sub, "spec.md"))) taskIds.push(sub);
        }
      }
    }

    for (const taskId of taskIds) {
      const taskDir = findTaskDir(taskId);
      if (!taskDir) continue;

      const spec = parseFrontmatter(path.join(taskDir, "spec.md"));
      const status = inferTaskStatus(taskDir, spec);
      taskCount[status] = (taskCount[status] || 0) + 1;

      // 读取 winner（从 claimed 事件或 award.json）
      let winner = null;
      const eventsDir = path.join(taskDir, "events");
      if (fs.existsSync(eventsDir)) {
        const claimed = fs.readdirSync(eventsDir).filter(f => f.startsWith("claimed-")).sort();
        if (claimed.length > 0) {
          const fm = parseFrontmatter(path.join(eventsDir, claimed[0]));
          winner = fm.worker;
        }
      }
      if (!winner && spec.bidding) {
        const bidData = readBids(taskDir);
        if (bidData && bidData.award) winner = bidData.award.winner;
      }

      // 读取结算信息
      const settlement = readSettlement(taskDir);

      const task = {
        id: spec.id || taskId,
        title: spec.title || "Untitled",
        status,
        complexity: spec.complexity || "S",
        budget: spec.budget || 0,
        publisher: spec.publisher || "unknown",
        winner,
        payment: settlement ? settlement.payment : null,
        deadline: spec.deadline || null,
        bidding: spec.bidding || false,
        created_at: null, // 从 published 事件读取
        completed_at: settlement ? settlement.settled_at : null,
        sens: spec.sens || "L0"
      };

      // 读取创建时间
      if (fs.existsSync(eventsDir)) {
        const published = fs.readdirSync(eventsDir).filter(f => f.startsWith("published-")).sort();
        if (published.length > 0) {
          const fm = parseFrontmatter(path.join(eventsDir, published[0]));
          task.created_at = fm.ts || fm.created_at || null;
        }
      }

      // 竞价任务附加报价数据
      if (spec.bidding) {
        const bidData = readBids(taskDir);
        if (bidData) {
          task.bids = bidData.bids;
          task.award = bidData.award;
        }
      }

      tasks.push(task);
    }
  }
}

// 按创建时间排序（最新在前）
tasks.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

console.log(`  ✅ 任务: ${tasks.length} 个（open:${taskCount.open}, in_progress:${taskCount.in_progress}, completed:${taskCount.completed}, failed:${taskCount.failed}）`);

// 3. 遍历 ledger/ 目录
const ledgerDir = path.join(ROOT, "ledger");
const ledgerEntries = [];
const balances = {}; // agentId -> 积分余额

if (fs.existsSync(ledgerDir)) {
  const files = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".md")).sort();
  for (const f of files) {
    const fm = parseFrontmatter(path.join(ledgerDir, f));
    const entry = {
      seq: fm.seq || parseInt(f.replace(/[^\d]/g, "")) || 0,
      ts: fm.ts || fm.created_at || null,
      kind: fm.kind || "unknown",
      amount: fm.amount || 0,
      from: fm.from || null,
      to: fm.to || null,
      note: fm.note || ""
    };
    ledgerEntries.push(entry);

    // 汇总积分（排除 escrow/TAXSINK 等系统账户的内部转移？不，全部计算）
    if (entry.from && !entry.from.startsWith("escrow-") && entry.from !== "TAXSINK" && entry.from !== "FAUCET") {
      balances[entry.from] = (balances[entry.from] || 0) - entry.amount;
    }
    if (entry.to && !entry.to.startsWith("escrow-") && entry.to !== "TAXSINK" && entry.to !== "FAUCET") {
      balances[entry.to] = (balances[entry.to] || 0) + entry.amount;
    }
  }
}

// 最近 50 笔账本
const recentLedger = ledgerEntries.slice(-50).reverse();

// 流通积分（所有非系统账户余额之和）
let totalPoints = 0;
for (const [agent, bal] of Object.entries(balances)) {
  if (bal > 0) totalPoints += bal;
}

console.log(`  ✅ 账本: ${ledgerEntries.length} 笔，流通积分: ${totalPoints.toFixed(1)}`);

// 4. 遍历 agents/ 目录
const agentsDir = path.join(ROOT, "agents");
const agents = [];

if (fs.existsSync(agentsDir)) {
  for (const agentId of fs.readdirSync(agentsDir)) {
    const agentPath = path.join(agentsDir, agentId, "agent.md");
    if (!fs.existsSync(agentPath)) continue;
    const fm = parseFrontmatter(agentPath);

    // 统计该智能体的任务
    const agentTasks = tasks.filter(t => t.winner === agentId || t.publisher === agentId);
    const completed = agentTasks.filter(t => t.status === "completed" && t.winner === agentId).length;
    const failed = agentTasks.filter(t => t.status === "failed" && t.winner === agentId).length;
    const inProgress = agentTasks.filter(t => ["in_progress", "submitted", "verified"].includes(t.status) && t.winner === agentId).length;
    const published = agentTasks.filter(t => t.publisher === agentId).length;

    // 信誉计算（D-37）：优先使用 agent.md 中的 reputation 字段，否则按完成数计算
    let reputation = fm.reputation || fm.rep_anchor || 0;
    if (!reputation) {
      if (fm.tier === "full" || completed >= 10) reputation = 70;
      else if (completed >= 3) reputation = 60;
      else reputation = Math.min(60, completed * 20);
    }

    // 解析分标签声誉（YAML map 格式）
    const agentContent = fs.readFileSync(agentPath, "utf-8");
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

    agents.push({
      id: fm.id || agentId,
      name: fm.name || agentId,
      role: fm.role || (published > completed ? "publisher" : "worker"),
      reputation,
      tier: fm.tier || "probation",
      points: balances[agentId] || 0,
      tasks_completed: completed,
      tasks_failed: failed,
      tasks_in_progress: inProgress,
      tasks_published: published,
      win_rate: completed + failed > 0 ? Math.round(completed / (completed + failed) * 100) : 0,
      joined_at: fm.created || null,
      key_fingerprint: fm.key_fingerprint || null,
      capabilities: fm.capabilities || [],
      rep_by_cap: repByCap,
      cap_counts: capCounts
    });
  }
}

// 按信誉排序
agents.sort((a, b) => b.reputation - a.reputation || b.points - a.points);

console.log(`  ✅ 智能体: ${agents.length} 个`);

// 5. 生成 data.json
const data = {
  generated_at: new Date().toISOString(),
  market: {
    tax: config.tax || 0.02,
    anchor: config.anchor || 1.0,
    total_tasks: tasks.length,
    open_tasks: taskCount.open || 0,
    in_progress: taskCount.in_progress || 0,
    submitted: taskCount.submitted || 0,
    verified: taskCount.verified || 0,
    completed: taskCount.completed || 0,
    failed: taskCount.failed || 0,
    no_bids: taskCount.no_bids || 0,
    expired: taskCount.expired || 0,
    total_ledger: ledgerEntries.length,
    total_agents: agents.length,
    total_points_in_circulation: Math.round(totalPoints * 100) / 100
  },
  tasks,
  agents,
  ledger_recent: recentLedger,
  config: {
    tax: config.tax || 0.02,
    anchor: config.anchor || 1.0,
    budget: config.budget || { S: 40, M: 70, L: 110 },
    deposit_rate: config.deposit_rate || 0.05,
    primary: config.primary || "https://github.com/ptreezh/agentmarket.git",
    mirrors: config.mirrors || [],
    capability_tags: config.capability_tags || {},
    capability_threshold: config.capability_threshold || 50
  }
};

// 6. 写入 docs/data.json
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
const outputPath = path.join(DOCS_DIR, "data.json");
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

const fileSize = fs.statSync(outputPath).size;
console.log(``);
console.log(`🎉 数据导出完成: ${outputPath}`);
console.log(`   大小: ${(fileSize / 1024).toFixed(1)} KB`);
console.log(`   任务: ${tasks.length} | 智能体: ${agents.length} | 账本: ${ledgerEntries.length}`);
console.log(`   生成时间: ${data.generated_at}`);
