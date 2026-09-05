#!/usr/bin/env node
/* 运营指标 · metrics.js — 从真实仓库计算先行指标（D-51/D-53）
 * 用法: node tools/metrics.js
 * 输出: ops/metrics-<ts>.json（append-only）
 */
"use strict";
const fs = require("fs");
const path = require("path");

const tasksDir = "tasks";
const ledgerDir = "ledger";
const tasks = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).filter(d => /^T-\d+$/.test(d)) : [];
let open = 0, active = 0, settled = 0, claimed = 0, budgetOk = 0, budgetBad = 0;
const specBudget = { S: 40, M: 70, L: 110 };
const budgets = [];

for (const t of tasks) {
  const evDir = path.join(tasksDir, t, "events");
  const evs = fs.existsSync(evDir) ? fs.readdirSync(evDir) : [];
  const hasClaimed = evs.some(f => f.startsWith("claimed-"));
  const hasPublished = evs.some(f => f.startsWith("published-"));
  const hasResult = fs.existsSync(path.join(tasksDir, t, "result", "verify-result.json"));
  if (hasClaimed) { active++; claimed++; }
  else if (hasPublished) open++;
  if (hasResult) settled++;
  // 预算合规：spec 中 complexity 与 budget 匹配
  const specPath = path.join(tasksDir, t, "spec.md");
  if (fs.existsSync(specPath)) {
    const s = fs.readFileSync(specPath, "utf-8");
    const cx = (s.match(/complexity:\s*(\w+)/) || [])[1];
    const bd = (s.match(/budget:\s*(\d+)/) || [])[1];
    if (cx && bd && specBudget[cx] === Number(bd)) budgetOk++; else budgetBad++;
    budgets.push({ task: t, cx, budget: Number(bd) });
  }
}
const total = tasks.length;
const turnover = (open + active) > 0 ? +(open / (open + active)).toFixed(3) : 0;
const completion = claimed > 0 ? +((settled / claimed) * 100).toFixed(1) : 0;

// 从 ledger 抽结算守恒抽查（取最新 3 条）
const ledgers = fs.existsSync(ledgerDir)
  ? fs.readdirSync(ledgerDir).filter(f => /^L-\d+\.md$/.test(f)).sort()
  : [];
const settleInfo = ledgers.map(f => {
  const s = fs.readFileSync(path.join(ledgerDir, f), "utf-8");
  const esc = (s.match(/escrow:\s*(\d+)/) || [])[1];
  const rw = (s.match(/reward:\s*(\d+)/) || [])[1];
  return { seq: f, escrow: Number(esc || 0), reward: Number(rw || 0) };
}).filter(x => x.escrow > 0);
const drift = settleInfo.length
  ? settleInfo.reduce((a, b) => a + (b.reward / b.escrow), 0) / settleInfo.length
  : 0; // 实际报酬/托管均值，基准 0.85（Vickrey 二价）

const out = {
  ts: new Date().toISOString(),
  tasks: { total, open, active, settled, claimed },
  turnover,
  completion_rate: completion,
  reward_ratio_avg: +drift.toFixed(4),
  budget_compliance: { ok: budgetOk, bad: budgetBad },
  probation_count: (fs.existsSync("agents")
    ? fs.readdirSync("agents").filter(d => {
        const p = path.join("agents", d, "agent.md");
        return fs.existsSync(p) && fs.readFileSync(p, "utf-8").includes("tier: probation");
      }).length : 0)
};
const opsDir = "ops";
if (!fs.existsSync(opsDir)) fs.mkdirSync(opsDir, { recursive: true });
const fname = `metrics-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}.json`;
fs.writeFileSync(path.join(opsDir, fname), JSON.stringify(out, null, 2));
console.log(`✅ 运营指标已落盘 ops/${fname}`);
console.log(`   任务: 总${total} 开放${open} 活跃${active} 已结算${settled}`);
console.log(`   空转率=${turnover} 完成率=${completion}% 报酬比=${out.reward_ratio_avg.toFixed(3)}(基准0.85)`);
console.log(`   预算合规 ${budgetOk}/${budgetOk + budgetBad}  试水Agent=${out.probation_count}`);
