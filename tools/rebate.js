#!/usr/bin/env node
/* tools/rebate.js — 创始合伙人税额分红（D-130d / docs/partner-program/v3-final.md）
 * 机制：合伙人引入的结算流水，其市场税额按期返还合伙人（不铸造、自筹资、守恒）。
 * 归属来源：docs/partner-program/referrals.yml（运营者维护，格式见文件头注释）
 * 幂等：已写过的 (task, partner) tax_rebate 分录不再重复。
 * 用法：
 *   node tools/rebate.js scan                     # dry-run，打印应返金额
 *   node tools/rebate.js write                    # 写账本（运营者签名）+ commit
 *   node tools/rebate.js write --allow-unsigned   # 测试环境降级
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const ledger = require("./ledger.js");

const ROOT = process.cwd();
const REF_FILE = path.join(ROOT, "docs", "partner-program", "referrals.yml");
const opPriv = path.join(ROOT, "keys", "operator", "private.pem");
const allowUnsigned = process.argv.includes("--allow-unsigned");
const doWrite = process.argv[2] === "write";

if (!fs.existsSync(REF_FILE)) { console.error("无 referrals.yml（暂无合伙人引荐记录）"); process.exit(0); }
if (doWrite && !fs.existsSync(opPriv) && !allowUnsigned) {
  console.error("❌ write 需要运营者私钥（或 --allow-unsigned）"); process.exit(1);
}

// 极简 yml：每行 "  <partner>: [AG-XX, T-XXXX]"（引荐的 agent / 任务号）
function parseReferrals() {
  const out = {};
  for (const line of fs.readFileSync(REF_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s{2}(\S+):\s*\[(.*)\]\s*$/);
    if (m) out[m[1]] = m[2].split(",").map(s => s.trim()).filter(Boolean);
  }
  return out;
}
const referrals = parseReferrals();

// 已返利集合（幂等键 = note 中 "rebate:<task>@<partner>"）
const done = new Set();
for (const f of fs.readdirSync(path.join(ROOT, "ledger")).filter(x => /^L-\d{4}\.md$/.test(x))) {
  const c = fs.readFileSync(path.join(ROOT, "ledger", f), "utf8");
  if (/^kind:\s*tax_rebate/m.test(c)) {
    const m = c.match(/rebate:(\S+)@(\S+)/);
    if (m) done.add(m[1] + "@" + m[2]);
  }
}

// 合伙人入伙日期（从 T-3018 partner 文件 DATE 行）
function partnerSince(ag) {
  const p = path.join(ROOT, "tasks", "T-3018", "result", "partner-" + ag + ".md");
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").match(/^DATE:\s*(\S+)/m);
  return m ? new Date(m[1]) : null;
}

// 扫描已结算任务的税额与归属
const results = [];
for (const t of fs.readdirSync(path.join(ROOT, "tasks")).filter(x => /^T-\d+$/.test(x))) {
  const evDir = path.join(ROOT, "tasks", t, "events");
  if (!fs.existsSync(evDir)) continue;
  const settled = fs.readdirSync(evDir).filter(f => f.startsWith("settled-"));
  if (!settled.length) continue;
  for (const partner of Object.keys(referrals)) {
    if (!referrals[partner].some(r => r === t || r.startsWith("AG-") && false)) {
      // 任务号直接命中
    }
    const referredTask = referrals[partner].includes(t);
    const referredAgentInvolved = false; // agent 引荐的流水归属 = 其 as publisher/winner 的任务，由 referrals 里任务号显式登记
    if (!referredTask) continue;
    if (done.has(t + "@" + partner)) continue;
    // 税额：取该任务 settled 事件里的 tax 字段
    for (const s of settled) {
      const c = fs.readFileSync(path.join(evDir, s), "utf8");
      const tax = Number((c.match(/^tax:\s*([\d.]+)/m) || [])[1]);
      if (!tax) continue;
      const since = partnerSince(partner);
      const settledAt = new Date((c.match(/^settled_at:\s*(\S+)/m) || [])[1] || 0);
      const rate = since && (settledAt - since) <= 90 * 864e5 ? 1.0 : 0.5;
      results.push({ task: t, partner, tax, rate, amount: Math.round(tax * rate * 100) / 100 });
    }
  }
}

if (!results.length) { console.log("scan：当前无可返税流水。"); process.exit(0); }
for (const r of results) console.log(`  ${r.task} → ${r.partner}: tax ${r.tax} × ${r.rate} = ${r.amount}`);
const total = results.reduce((a, b) => a + b.amount, 0);
console.log(`  合计: ${total}`);

if (doWrite && results.length) {
  for (const r of results) {
    ledger.writeEntry({
      kind: "tax_rebate", amount: r.amount, from: "TAXSINK", to: r.partner,
      note: `合伙人税额分红 rebate:${r.task}@${r.partner}（税 ${r.tax} × ${r.rate}，D-130d）`,
      signer: fs.existsSync(opPriv) ? "operator" : "unsigned",
      privKeyPath: fs.existsSync(opPriv) ? opPriv : undefined
    });
  }
  try { execSync('git add ledger/ && git commit -q -m "rebate: 合伙人税额分红 ' + total + '"', { cwd: ROOT, stdio: "pipe" }); } catch (e) {}
  console.log("✅ 分红已写入账本");
}
