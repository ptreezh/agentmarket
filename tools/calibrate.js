#!/usr/bin/env node
/* 双旋钮真实调参 · calibrate.js（D-51~D-55）
 * 用法: node tools/calibrate.js            # 自动取最新 metrics + 当前 config，按规则调节
 * 行为: 空转率>0.65 → 税+1%·锚×0.9；空转率<0.30 → 税-1%·锚×1.1；档位±1；边界税[1%,10%]、锚[0.5,2]
 *       写 ops/audit-<ts>.md + ops/configs/config-vN.json（新版本）+ 指针 market-config.json 原子切换
 *       可回滚 = 将指针指回旧版本文件（不覆盖历史）
 */
"use strict";
const fs = require("fs");
const path = require("path");

// 1. 读当前指针 config
const cfg = JSON.parse(fs.readFileSync("market-config.json", "utf-8"));
// 2. 取最新 metrics
const mets = fs.readdirSync("ops").filter(f => f.startsWith("metrics-")).sort().pop();
const m = JSON.parse(fs.readFileSync(path.join("ops", mets), "utf-8"));
// 3. 找最新 config 版本号
const vs = fs.readdirSync("ops/configs").filter(f => /^config-v\d+\.json$/.test(f))
  .map(f => Number(f.match(/config-v(\d+)\.json/)[1]));
const nextV = (vs.length ? Math.max(...vs) : 2) + 1;

const turnover = m.turnover;
const TAX_MIN = 0.01, TAX_MAX = 0.10, ANCH_MIN = 0.5, ANCH_MAX = 2.0;
let newTax = cfg.tax, newAnchor = cfg.anchor, action = "不变（水位在目标带内）";
const round2 = x => Math.round(x * 100) / 100;

if (turnover > 0.65 && cfg.tax < TAX_MAX) {
  newTax = round2(Math.min(cfg.tax + 0.01, TAX_MAX));
  newAnchor = round2(Math.min(cfg.anchor * 0.9, ANCH_MAX));
  action = `空转率${turnover}偏高 → 税↑${(newTax*100).toFixed(0)}% 锚↓×${newAnchor}`;
} else if (turnover < 0.30 && cfg.tax > TAX_MIN) {
  newTax = round2(Math.max(cfg.tax - 0.01, TAX_MIN));
  newAnchor = round2(Math.max(cfg.anchor * 1.1, ANCH_MIN));
  action = `空转率${turnover}偏低 → 税↓${(newTax*100).toFixed(0)}% 锚↑×${newAnchor}`;
} else if (turnover >= 0.30 && turnover <= 0.65) {
  action = `空转率${turnover}在目标带[0.30,0.65]内 → 参数保持`;
} else {
  action = `触发但已达边界（税=${cfg.tax} 锚=${cfg.anchor}）→ 保持（防抖动 D-54）`;
}

// 4. 写审计事件（append-only）
const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
const audit = [
  "---",
  `seq: audit-${ts}`,
  `ts: ${new Date().toISOString()}`,
  "kind: calibrate",
  `task: ${m.tasks.total} 开放${m.tasks.open} 活跃${m.tasks.active}`,
  `turnover: ${turnover}`,
  `action: ${action}`,
  `from: {tax: ${cfg.tax}, anchor: ${cfg.anchor}}`,
  `to: {tax: ${newTax}, anchor: ${newAnchor}}`,
  `config_version: ${nextV}`,
  `metrics_ref: ${mets}`,
  `rollback: 将 market-config.json 指回 ops/configs/config-v${vs.length ? Math.max(...vs) : 2}.json`,
  "---"
].join("\n") + "\n";
fs.writeFileSync(path.join("ops", `audit-${ts}.md`), audit);

// 5. 新 config 版本 + 指针切换（原子：先写新版本文件，再覆盖指针）
const newCfg = Object.assign({}, cfg, { version: nextV, updated: new Date().toISOString(), tax: newTax, anchor: newAnchor, note: action });
fs.writeFileSync(path.join("ops/configs", `config-v${nextV}.json`), JSON.stringify(newCfg, null, 2));
fs.writeFileSync("market-config.json", JSON.stringify(newCfg, null, 2));

console.log(`✅ 调参执行: ${action}`);
console.log(`   新版本 config-v${nextV}.json 已写；market-config.json 指针已切换`);
console.log(`   审计: ops/audit-${ts}.md（append-only）`);
console.log(`   回滚: market-config.json 指向 config-v${vs.length ? Math.max(...vs) : 2}.json 即回滚`);
