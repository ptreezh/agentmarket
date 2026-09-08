#!/usr/bin/env node
/* tools/interop.js — 跨市场互认（D-110 INTEROP 设计，T4 骨架实现）
 * 机制：信任列表（trusted-markets.json）+ 提现凭证（operator 签名）+ 入账（验证+防重）+ 对账
 * 默认关闭安全：只有信任列表中的市场才能入账；凭证唯一 seq 防重复兑换。
 * 用法:
 *   node tools/interop.js trust <marketId> <pubkeyPemFile>
 *   node tools/interop.js untrust <marketId>
 *   node tools/interop.js list
 *   node tools/interop.js withdraw <amount> <targetMarketId> <operator私钥>
 *   node tools/interop.js deposit <voucherFile>
 *   node tools/interop.js reconcile
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CONFIG = "trusted-markets.json";
const WDIR = path.join("interop", "withdrawals");
const LDIR = path.join("interop", "ledger");

function loadTrust() { try { return JSON.parse(fs.readFileSync(CONFIG, "utf-8")); } catch { return { markets: {} }; } }
function saveTrust(t) { fs.writeFileSync(CONFIG, JSON.stringify(t, null, 2), "utf-8"); }
function fpOf(pem) { return "SHA256:" + crypto.createHash("sha256").update(crypto.createPublicKey(pem).export({ type: "spki", format: "der" })).digest("base64"); }
function signBody(priv, body) { return crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(priv)).toString("hex"); }
function verifyBody(pub, body, sig) { try { return crypto.verify(null, Buffer.from(body, "utf-8"), crypto.createPublicKey(pub), Buffer.from(sig, "hex")); } catch { return false; } }
function canonical(v) { const c = Object.assign({}, v); delete c.signer; delete c.signature; return JSON.stringify(c); }
function nextSeq(target) { const dir = path.join(WDIR, target); if (!fs.existsSync(dir)) return 1; return fs.readdirSync(dir).length + 1; }

const cmd = process.argv[2];
switch (cmd) {
  case "trust": {
    const [id, pubPemFile] = process.argv.slice(3);
    if (!id || !pubPemFile) { console.error("用法: trust <marketId> <pubkeyPem 文件>"); process.exit(2); }
    if (!fs.existsSync(pubPemFile)) { console.error(`❌ 公钥文件不存在: ${pubPemFile}`); process.exit(1); }
    const pub = fs.readFileSync(pubPemFile, "utf-8");
    const t = loadTrust();
    t.markets[id] = { pubkey: pub, fp: fpOf(pub), trusted_at: new Date().toISOString() };
    saveTrust(t);
    console.log(`✅ 信任市场 ${id}（指纹 ${t.markets[id].fp.slice(0, 20)}…）`);
    break;
  }
  case "untrust": {
    const [id] = process.argv.slice(3);
    if (!id) { console.error("用法: untrust <marketId>"); process.exit(2); }
    const t = loadTrust();
    if (!t.markets[id]) { console.error(`❌ 市场 ${id} 不在信任列表`); process.exit(1); }
    delete t.markets[id]; saveTrust(t);
    console.log(`✅ 已移除信任 ${id}`);
    break;
  }
  case "list": {
    const t = loadTrust();
    console.log("=== 信任市场 ===");
    const ms = Object.entries(t.markets);
    if (ms.length === 0) console.log("  （空）");
    for (const [id, m] of ms) console.log(`  ${id}  ${m.fp.slice(0, 20)}…  信任于 ${m.trusted_at}`);
    console.log("=== 入账记录 ===");
    const files = fs.existsSync(LDIR) ? fs.readdirSync(LDIR) : [];
    if (files.length === 0) console.log("  （空）");
    for (const f of files) {
      const v = JSON.parse(fs.readFileSync(path.join(LDIR, f), "utf-8"));
      console.log(`  ${f}  +${v.amount} 点  ${v.market} → ${v.target_market}`);
    }
    break;
  }
  case "withdraw": {
    const [amount, target, keyFile] = process.argv.slice(3);
    if (!amount || !target || !keyFile) { console.error("用法: withdraw <amount> <targetMarketId> <operator私钥>"); process.exit(2); }
    if (!fs.existsSync(keyFile)) { console.error(`❌ 私钥不存在: ${keyFile}`); process.exit(1); }
    const priv = fs.readFileSync(keyFile, "utf-8");
    const pub = crypto.createPublicKey(crypto.createPrivateKey(priv)).export({ type: "spki", format: "pem" }).toString();
    const seq = nextSeq(target);
    const v = { type: "withdrawal", market: "this", target_market: target, seq, amount: Number(amount), agent: process.env.AGENT_ID || "operator", ts: new Date().toISOString() };
    v.signer = fpOf(pub);
    v.signature = signBody(priv, canonical(v));
    fs.mkdirSync(path.join(WDIR, target), { recursive: true });
    const f = path.join(WDIR, target, `voucher-${String(seq).padStart(4, "0")}.json`);
    fs.writeFileSync(f, JSON.stringify(v, null, 2), "utf-8");
    console.log(`✅ 提现凭证 ${f}（${amount} 点 → ${target}，seq=${seq}，signer=${v.signer.slice(0, 20)}…）`);
    break;
  }
  case "deposit": {
    const [voucherFile] = process.argv.slice(3);
    if (!voucherFile) { console.error("用法: deposit <voucherFile>"); process.exit(2); }
    if (!fs.existsSync(voucherFile)) { console.error(`❌ 凭证不存在: ${voucherFile}`); process.exit(1); }
    const v = JSON.parse(fs.readFileSync(voucherFile, "utf-8"));
    const t = loadTrust();
    const m = t.markets[v.target_market] || t.markets[v.market];
    if (!m) { console.error(`❌ 市场 ${v.target_market || v.market} 不在信任列表，拒绝入账（D-110 默认关闭）`); process.exit(1); }
    if (!verifyBody(m.pubkey, canonical(v), v.signature)) { console.error("❌ 凭证签名无效（签名被篡改或公钥不匹配）"); process.exit(1); }
    const dir = path.join(LDIR, v.target_market || "default");
    if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.includes(`-seq${v.seq}-`))) {
      console.error(`❌ 重复入账 seq=${v.seq}（凭证唯一性，防双花）`); process.exit(1);
    }
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `deposit-${v.market}-seq${v.seq}-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(v, null, 2), "utf-8");
    console.log(`✅ 入账 +${v.amount} 点（来自 ${v.market}，seq=${v.seq}）`);
    break;
  }
  case "reconcile": {
    const t = loadTrust();
    let total = 0;
    for (const mid of Object.keys(t.markets)) {
      const dir = path.join(LDIR, mid);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const v = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        total += v.amount;
      }
    }
    console.log(`对账: 来自信任市场的累计入账 = ${total} 点`);
    break;
  }
  default:
    console.log("用法: interop.js trust|untrust|list|withdraw|deposit|reconcile");
    process.exit(2);
}
