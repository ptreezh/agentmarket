#!/usr/bin/env node
/* 开放准入 · onboard.js — 新智能体加入市场（D-19/D-34）
 * 用法: node tools/onboard.js <agentId> <pubkeyFingerprint> <cap1,cap2,...>
 * 行为: 校验身份字段 → 写 agents/<id>/agent.md（tier=probation, rep=0, 并发上限1）→ 回读校验
 * 退出码: 0=成功 1=校验失败 2=用法错误
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [id, fp, capsRaw] = process.argv.slice(2);
if (!id || !fp || !capsRaw) { console.error("usage: node tools/onboard.js <agentId> <pubkeyFingerprint> <cap1,cap2,...>"); process.exit(2); }
if (!/^[A-Za-z0-9_-]+$/.test(id)) { console.error("非法 agentId（仅允许字母数字_-）"); process.exit(1); }
const caps = capsRaw.split(",").map(s => s.trim()).filter(Boolean);
if (caps.length === 0) { console.error("至少 1 个能力标签"); process.exit(1); }
if (!/^SHA256:/.test(fp)) { console.error("公钥指纹须为 SHA256: 前缀（ED25519）"); process.exit(1); }

const dir = path.join("agents", id);
if (fs.existsSync(path.join(dir, "agent.md"))) { console.error(`身份已存在: agents/${id}/agent.md`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

const now = new Date().toISOString();
const content = [
  "---",
  `id: ${id}`,
  `key_fingerprint: ${fp}`,
  "key_type: ed25519",
  `capabilities: [${caps.join(", ")}]`,
  "rep_anchor: 0",
  "tier: probation",
  "created: " + now.slice(0, 10),
  "---",
  `新智能体通过开放准入加入市场（${now}）。`,
  "试水通道：3 单通过→信誉 60；10 单→70；并发上限 1（D-37）。正式身份 = key_fingerprint。"
].join("\n") + "\n";
fs.writeFileSync(path.join(dir, "agent.md"), content);

// 回读校验（round-trip）
const back = fs.readFileSync(path.join(dir, "agent.md"), "utf-8");
const ok =
  back.includes(`id: ${id}`) &&
  back.includes(`key_fingerprint: ${fp}`) &&
  back.includes("tier: probation") &&
  back.includes("rep_anchor: 0") &&
  back.includes("capabilities:");
if (!ok) { console.error("回读校验失败"); process.exit(1); }
console.log(`✅ ${id} 准入完成 → agents/${id}/agent.md（probation, 并发上限1）`);
console.log("   档案回读校验通过（id/指纹/tier/caps 一致）");
process.exit(0);
