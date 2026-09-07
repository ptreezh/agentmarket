#!/usr/bin/env node
/* 核心文件签名清单 · sign-manifest.js（D-105 层1：协议内防篡改）
 * 用法:
 *   node tools/sign-manifest.js --list              # 列出待签核心文件
 *   node tools/sign-manifest.js --sign <privKeyPem> # 生成/更新 tools/SIGNATURES.md
 *   node tools/sign-manifest.js --verify [--strict] # 校验（strict=同时验签）
 * 退出码: 0=通过 1=不通过 2=用法错误
 * 原理: 运营者私钥对每个核心文件发布 sha256+ED25519 签名清单；
 *       任何运行者（agent-runner/人工）在跑市场工具前先 --verify，
 *       仓库被篡改时哈希不匹配 → 拒跑。--strict 额外验签（防清单本身被改）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MANIFEST = path.join("tools", "SIGNATURES.md");
const OP_PUBKEY_FILE = "OPERATOR_PUBKEY";

// 核心文件（篡改可劫持市场逻辑；与 CODEOWNERS 一致）
const CORE_FILES = [
  "tools/settle.js", "tools/claim.js", "tools/verify.js",
  "tools/award.js", "tools/bid.js", "tools/ledger.js",
  "tools/keygen.js", "tools/sig.js", "tools/sigcheck.js",
  "tools/sign-script.js", "tools/keybackup.js", "tools/crypt.js",
  "tools/sign-manifest.js", "tools/agent-runner.js",
  "tools/export-data.js", "tools/metrics.js", "tools/calibrate.js",
  "tools/onboard.js", "tools/publish.js",
  "market-config.json", "OPERATOR_PUBKEY", "AGENTS.md",
  "join.sh", "faucet.sh", "publish.sh", "keepalive.sh", "update-data.sh",
];

const [cmd, ...rest] = process.argv.slice(2);
const argSet = new Set(rest);

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function parseManifest(text) {
  const entries = {};
  const blocks = text.split(/^## file: /m).slice(1);
  for (const b of blocks) {
    const file = b.split("\n")[0].trim();
    const sha = (b.match(/^sha256: (\w+)/m) || [])[1];
    const sig = (b.match(/^sig: ed25519:(\w+)/m) || [])[1];
    if (file && sha) entries[file] = { sha256: sha, sig: sig || "" };
  }
  return entries;
}
function getOpPub() {
  if (!fs.existsSync(OP_PUBKEY_FILE)) throw new Error("缺 OPERATOR_PUBKEY");
  return fs.readFileSync(OP_PUBKEY_FILE, "utf-8");
}

if (cmd === "--list") {
  console.log("待签核心文件 (" + CORE_FILES.length + "):");
  for (const f of CORE_FILES) console.log("  " + f + (fs.existsSync(f) ? "" : "  [缺失]"));
  process.exit(0);
}

if (cmd === "--sign") {
  const keyPath = rest[0];
  if (!keyPath || !fs.existsSync(keyPath)) { console.error("用法: --sign <privKeyPem>"); process.exit(2); }
  const privPem = fs.readFileSync(keyPath, "utf-8");
  const pubPem = crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: "spki", format: "pem" }).toString();
  const opPub = getOpPub();
  if (pubPem.trim() !== opPub.trim()) { console.error("❌ 私钥与 OPERATOR_PUBKEY 不匹配——拒绝签名"); process.exit(1); }
  let out = "# AgentMarket 核心文件签名清单（运营者 ED25519）\n";
  out += "# 生成: node tools/sign-manifest.js --sign <privKeyPem>\n";
  out += "# 校验: node tools/sign-manifest.js --verify --strict\n\n";
  let n = 0;
  for (const f of CORE_FILES) {
    if (!fs.existsSync(f)) { console.warn("跳过（缺失）: " + f); continue; }
    const sha = sha256File(f);
    const sig = crypto.sign(null, Buffer.from(f + "\n" + sha, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
    out += `## file: ${f}\nsha256: ${sha}\nsig: ed25519:${sig}\n\n`;
    n++;
  }
  fs.writeFileSync(MANIFEST, out, "utf-8");
  console.log(`✅ ${MANIFEST} 已生成（${n} 个文件，运营者签名）`);
  process.exit(0);
}

if (cmd === "--verify") {
  if (!fs.existsSync(MANIFEST)) { console.error(`❌ ${MANIFEST} 不存在——请运营者先签名（层1未启用）`); process.exit(1); }
  const entries = parseManifest(fs.readFileSync(MANIFEST, "utf-8"));
  const strict = argSet.has("--strict");
  let fail = 0, checked = 0;
  for (const f of CORE_FILES) {
    const e = entries[f];
    if (!e) { console.log(`  [未收录] ${f}`); continue; }
    checked++;
    const sha = sha256File(f);
    if (sha !== e.sha256) { console.log(`  [✗ 篡改] ${f}`); fail++; continue; }
    if (strict) {
      const ok = crypto.verify(null, Buffer.from(f + "\n" + sha, "utf-8"),
        crypto.createPublicKey(getOpPub()), Buffer.from(e.sig, "hex"));
      if (!ok) { console.log(`  [✗ 签名无效] ${f}`); fail++; continue; }
    }
  }
  console.log(`清单校验: ${checked} 个文件，${fail} 个失败`);
  if (fail > 0) { console.error("❌ 核心文件被篡改或清单不一致——拒绝继续"); process.exit(1); }
  console.log(strict ? "✅ 全部通过（含验签）" : "✅ 全部通过（哈希一致；--strict 可加验签）");
  process.exit(0);
}

console.error("用法: --list | --sign <privKeyPem> | --verify [--strict]");
process.exit(2);
