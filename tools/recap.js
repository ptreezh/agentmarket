#!/usr/bin/env node
/* 结算后复核工具 · recap.js（T3，2026-09-08）
 * 用法: node tools/recap.js <taskId|路径>
 * 自动检查（替代人工复核清单）：
 *  ① L0 验证全过（result/verify-result.json: passed==total）
 *  ② 四事件签名链（published/claimed/submitted/settled 各取最新，sig.js 验签）
 *  ③ 账本守恒（settled 事件内 payment+tax+refund == budget）
 *  ④ settled 事件存在 + deposit_refund 字段
 * 边界：纯本地检查；不强制 signer 身份（验签有效即可）；不检查公网同步
 * 退出码: 0=全过 1=有失败项
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

const arg = process.argv[2];
if (!arg) { console.error("usage: node tools/recap.js <taskId|路径>"); process.exit(2); }

// 参数：已存在路径 → 直接用；否则按 taskId 找（兼容分片）
function findTaskDir(id) {
  const flat = path.join("tasks", id);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join("tasks", id.slice(0, 4), id);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}
const taskDir = fs.existsSync(arg) ? arg : findTaskDir(arg);
if (!taskDir) { console.error(`❌ 任务不存在: ${arg}`); process.exit(2); }

const fails = [];
const warns = [];
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => { fails.push(msg); console.log(`  ❌ ${msg}`); };

console.log(`[recap] 复核 ${taskDir}`);

// ---------- ① L0 验证 ----------
const vrPath = path.join(taskDir, "result", "verify-result.json");
if (!fs.existsSync(vrPath)) {
  bad("L0 verify-result.json 缺失");
} else {
  try {
    const vr = JSON.parse(fs.readFileSync(vrPath, "utf-8"));
    if (vr.total > 0 && vr.passed === vr.total) ok(`L0 ${vr.passed}/${vr.total} 全过`);
    else bad(`L0 ${vr.passed}/${vr.total} 未全过`);
  } catch (e) { bad("L0 verify-result.json 解析失败"); }
}

// ---------- ② 四事件签名链 ----------
const evDir = path.join(taskDir, "events");
const TYPES = ["published", "claimed", "submitted", "settled"];
if (!fs.existsSync(evDir)) {
  bad("events/ 目录缺失");
} else {
  const files = fs.readdirSync(evDir).filter((f) => f.endsWith(".md"));
  for (const t of TYPES) {
    const group = files.filter((f) => f.startsWith(t + "-")).sort();
    if (group.length === 0) { bad(`事件 ${t} 缺失`); continue; }
    if (group.length > 1) warns.push(`${t} 事件 ${group.length} 个（取最新 ${group[group.length - 1]}）`);
    const latest = group[group.length - 1];
    try {
      const out = g(`node tools/sig.js verify "${path.join(evDir, latest).replace(/\\/g, "/")}"`);
      ok(`${t} 签名有效（${latest}）`);
    } catch (e) {
      bad(`${t} 签名无效/未签名（${latest}）`);
    }
  }
}

// ---------- ③ 账本守恒 + ④ settled 字段 ----------
const settledFiles = fs.existsSync(evDir)
  ? fs.readdirSync(evDir).filter((f) => f.startsWith("settled-")).sort()
  : [];
if (settledFiles.length > 0) {
  const settled = path.join(evDir, settledFiles[settledFiles.length - 1]);
  const body = fs.readFileSync(settled, "utf-8");
  const fm = body.split("---")[1] || "";
  const num = (k) => { const m = fm.match(new RegExp(`^${k}:\\s*([\\d.]+)`, "m")); return m ? parseFloat(m[1]) : null; };
  const payment = num("payment"), tax = num("tax"), refund = num("refund"), budget = num("budget");
  const deposit = num("deposit_refund");
  if (payment === null || tax === null || refund === null || budget === null) {
    bad("settled 事件缺 payment/tax/refund/budget 字段");
  } else {
    const sum = payment + tax + refund;
    if (Math.abs(sum - budget) < 1e-9) ok(`守恒 payment(${payment})+tax(${tax})+refund(${refund})=${sum}=budget(${budget})`);
    else bad(`守恒失败 payment(${payment})+tax(${tax})+refund(${refund})=${sum} != budget(${budget})`);
  }
  if (deposit !== null && deposit >= 0) ok(`deposit_refund=${deposit}`);
  else bad("deposit_refund 缺失或为负");
} else {
  bad("settled 事件缺失");
}

// ---------- 汇总 ----------
for (const w of warns) console.log(`  ⚠️  ${w}`);
if (fails.length === 0) {
  console.log("[recap] ✅ 复核全过");
  process.exit(0);
} else {
  console.log(`[recap] ❌ 复核失败 ${fails.length} 项`);
  process.exit(1);
}
