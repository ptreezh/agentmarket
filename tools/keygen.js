#!/usr/bin/env node
/* D-19 密钥生成 · keygen.js — ED25519 身份密钥对（新规范）
 * 用法: node tools/keygen.js <agentId>
 * 行为: 生成 PKCS8 私钥/SPKI 公钥 → keys/<id>/（gitignore）+ 更新 agents/<id>/agent.md（指纹+公钥）
 * 指纹: SHA256:base64(sha256(公钥SPKI DER))
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const id = process.argv[2];
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) { console.error("usage: node tools/keygen.js <agentId>"); process.exit(2); }
const agentFile = path.join("agents", id, "agent.md");
if (!fs.existsSync(agentFile)) { console.error("agent 不存在: " + agentFile); process.exit(1); }

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const der = publicKey.export({ type: "spki", format: "der" });
const fp = "SHA256:" + crypto.createHash("sha256").update(der).digest("base64");

const keyDir = path.join("keys", id);
fs.mkdirSync(keyDir, { recursive: true });
fs.writeFileSync(path.join(keyDir, "private.pem"), privPem);
fs.writeFileSync(path.join(keyDir, "public.pem"), pubPem);
fs.chmodSync(path.join(keyDir, "private.pem"), 0o600);

// 更新 agent.md：key_fingerprint + public_key（保留其它字段）
let text = fs.readFileSync(agentFile, "utf-8");
if (/^key_fingerprint:/m.test(text)) text = text.replace(/^key_fingerprint:.*$/m, `key_fingerprint: ${fp}`);
else text += `key_fingerprint: ${fp}\n`;
if (/^key_type:/m.test(text)) text = text.replace(/^key_type:.*$/m, "key_type: ed25519");
else text += `key_type: ed25519\n`;
if (!/^public_key:/m.test(text)) text += `public_key: ${pubPem.replace(/\n/g, "\\n")}\n`;
else text = text.replace(/^public_key:.*$/m, `public_key: ${pubPem.replace(/\n/g, "\\n")}`);
fs.writeFileSync(agentFile, text);

console.log(`✅ ${id} 密钥已生成`);
console.log(`   私钥: keys/${id}/private.pem (0600, 已 gitignore)`);
console.log(`   指纹: ${fp}`);
console.log(`   公钥已写入 agents/${id}/agent.md`);
