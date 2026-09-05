#!/usr/bin/env node
/* D-19 全仓签名检查 · sigcheck.js
 * 用法: node tools/sigcheck.js [--strict]
 * 扫描: 各任务目录下 events 目录的全部 md 与 result 目录的 result.md
 * 通过条件: 事件文件必须已签名且验签有效；result.md 建议签名（strict 时必签）
 * 退出码: 0=全过 1=有未签/无效
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const __file = path.join(__dirname, "sig.js");

const strict = process.argv.includes("--strict");
let total = 0, passed = 0, unsigned = 0, invalid = 0, skipped = 0;

function filesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir)) {
    const p = path.join(dir, d);
    if (fs.statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

const evFiles = [];
if (fs.existsSync("tasks")) {
  for (const t of fs.readdirSync("tasks")) {
    if (!/^T-\d+$/.test(t)) continue;
    evFiles.push(...filesUnder(path.join("tasks", t, "events")).filter(f => f.endsWith(".md")));
    const rm = path.join("tasks", t, "result", "result.md");
    if (fs.existsSync(rm)) evFiles.push(rm);
  }
}

for (const f of evFiles.sort()) {
  const s = fs.readFileSync(f, "utf-8");
  const hasSig = /^signer:\s*\S+/m.test(s) && /^signature:\s*\S+/m.test(s);
  if (!hasSig) {
    if (f.includes("result.md") && !strict) { skipped++; continue; }
    unsigned++; console.log(`  [未签名] ${f}`); continue;
  }
  total++;
  const r = spawnSync(process.execPath, [__file, "verify", f], { encoding: "utf-8" });
  if (r.status === 0) { passed++; }
  else { invalid++; console.log(`  [签名无效] ${f}`); }
}

console.log(`\nsigcheck: ${passed}/${total} 已签名事件验签有效${unsigned ? `；${unsigned} 未签名` : ""}${skipped ? `；${skipped} result.md 未签名(非strict，跳过)` : ""}`);
if (unsigned > 0 && !strict) console.log("提示: 未签名文件可跑 `node tools/sig.js sign <agentId> <file>` 补齐");
process.exit(invalid > 0 ? 1 : (strict && unsigned > 0 ? 1 : 0));
