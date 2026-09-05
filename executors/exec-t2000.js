#!/usr/bin/env node
/* 确定性执行器 · T-2000（示例）— 按 spec.input_ref 拉取输入工件，聚合并输出
 * 用法: node executors/exec-t2000.js <taskDir> <inputHash>
 * 输出: <taskDir>/result/out.csv + summary.json + result.md（确定性，可复现）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const taskDir = process.argv[2];
const inputHash = process.argv[3];
if (!taskDir || !inputHash) { console.error("usage: node executors/exec-t2000.js <taskDir> <inputHash>"); process.exit(2); }

const repo = path.resolve(__dirname, "..");
const inputPath = path.join(repo, "artifacts", inputHash + ".csv");
if (!fs.existsSync(inputPath)) { console.error("输入工件缺失: " + inputPath); process.exit(2); }
const got = crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex");
if (got !== inputHash) { console.error("输入工件哈希校验失败（防伪）"); process.exit(2); }
console.log("输入哈希校验通过: " + got.slice(0, 16) + "…");

// 读取并聚合：region -> {rev, orders}
const rows = fs.readFileSync(inputPath, "utf-8").trim().split("\n").slice(1);
const agg = {};
for (const r of rows) {
  const [region, month, rev, ord] = r.split(",");
  agg[region] = agg[region] || { rev: 0, ord: 0 };
  agg[region].rev += parseFloat(rev);
  agg[region].ord += parseInt(ord, 10);
}
// 输出 out.csv（region 按输入首现顺序，确定性）
const order = [];
for (const r of rows) { const reg = r.split(",")[0]; if (!order.includes(reg)) order.push(reg); }
let csv = "region,total_revenue,total_orders\n";
for (const reg of order) {
  const a = agg[reg];
  csv += `${reg},${a.rev.toFixed(1)},${a.ord}\n`;
}
const totalRev = Object.values(agg).reduce((s, a) => s + a.rev, 0);
const totalOrd = Object.values(agg).reduce((s, a) => s + a.ord, 0);
const summary = { period: "2026Q3", regions: order.length, total_revenue: +totalRev.toFixed(1), total_orders: totalOrd };

const resDir = path.join(taskDir, "result");
if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, "out.csv"), csv);
fs.writeFileSync(path.join(resDir, "summary.json"), JSON.stringify(summary, null, 2));
const outHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(resDir, "out.csv"))).digest("hex");
fs.writeFileSync(path.join(resDir, "result.md"), [
  "---", "task: T-2000", "worker: AG-W01", "ts: " + new Date().toISOString(),
  "input_ref: " + inputHash, "out_hash: " + outHash, "---",
  "结果：按 region 聚合 2026Q3 收入/订单。out.csv + summary.json。",
  "out.csv sha256: `" + outHash + "`"
].join("\n") + "\n");
console.log("out.csv sha256: " + outHash);
console.log("summary: " + JSON.stringify(summary));
console.log("执行完成 → " + path.join(resDir));
