#!/usr/bin/env node
/* TDD 测试：sign.html 浏览器签名与网关兼容性（D-128 / SPEC-COMMENT-PUBLISH-20260909）
 * 用 node WebCrypto 复刻 sign.html 的核心逻辑，证明：
 *   S1 PKCS#8 PEM 私钥可被 node crypto（claim-sign.js 同款）读取
 *   S2 sign.html 签出的 publish 签名可被 publish-gateway 验签
 *   S3 sign.html 签出的 claim 签名可被 claim 网关验签（同消息规范）
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readAgentPubKey, verifyPublishSig } = require("../tools/publish-gateway.js");

/* sign.html 核心函数复刻 */
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function pemEncode(der, label) {
  const b64 = Buffer.from(new Uint8Array(der)).toString("base64");
  const lines = b64.match(/.{1,64}/g).join("\n");
  return "-----BEGIN " + label + "-----\n" + lines + "\n-----END " + label + "-----";
}
async function genIdentity() {
  const kp = await crypto.webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pkcs8 = await crypto.webcrypto.subtle.exportKey("pkcs8", kp.privateKey);
  const spki = await crypto.webcrypto.subtle.exportKey("spki", kp.publicKey);
  return { kp, privPem: pemEncode(pkcs8, "PRIVATE KEY"), pubPem: pemEncode(spki, "PUBLIC KEY") };
}
async function signMsg(kpPriv, msg) {
  const sig = await crypto.webcrypto.subtle.sign({ name: "Ed25519" }, kpPriv, new TextEncoder().encode(msg));
  return toHex(sig);
}
/* 模拟 claim 网关验签（claim-gateway.js 同款逻辑） */
function verifyClaimLike(agentsDir, msg, agent, sigHex) {
  const pub = readAgentPubKey(agentsDir, agent);
  if (!pub) return false;
  try { return crypto.verify(null, Buffer.from(msg, "utf-8"), pub, Buffer.from(sigHex, "hex")); }
  catch { return false; }
}

test("[S1] sign.html PKCS#8 PEM 可被 node crypto 读取（claim-sign.js 兼容）", async () => {
  const { privPem } = await genIdentity();
  const priv = crypto.createPrivateKey(privPem);
  assert.ok(priv.asymmetricKeyType === "ed25519", "私钥类型 ed25519");
});

test("[S2] sign.html 生成的公钥可被网关读取（agent.md 字面量 \\n 格式）", async () => {
  const { pubPem } = await genIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-"));
  const agentDir = path.join(dir, "agents", "AG-WEB");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"), "---\nid: AG-WEB\n---\npublic_key: " + pubPem.replace(/\n/g, "\\n") + "\n");
  const pub = readAgentPubKey(path.join(dir, "agents"), "AG-WEB");
  assert.ok(pub, "网关可读取并创建公钥");
});

test("[S3] sign.html publish 签名可通过 publish-gateway 验签", async () => {
  const { kp, pubPem } = await genIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-"));
  const agentDir = path.join(dir, "agents", "AG-WEB");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"), "public_key: " + pubPem.replace(/\n/g, "\\n") + "\n");
  const json = '{"title":"WebSign","deadline":"2026-10-01T00:00:00Z","complexity":"S","budget":40,"assertions":[{"type":"file_exists","path":"r/out.md"}]}';
  const sig = await signMsg(kp.privateKey, "publish " + json);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), json, "AG-WEB", sig), true);
});

test("[S4] sign.html claim 签名可通过 claim 网关验签（同消息规范）", async () => {
  const { kp, pubPem } = await genIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-"));
  const agentDir = path.join(dir, "agents", "AG-WEB");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"), "public_key: " + pubPem.replace(/\n/g, "\\n") + "\n");
  const msg = "claim T-5000 AG-WEB";
  const sig = await signMsg(kp.privateKey, msg);
  assert.strictEqual(verifyClaimLike(path.join(dir, "agents"), msg, "AG-WEB", sig), true);
});

test("[S5] sign.html 篡改 payload 验签拒绝", async () => {
  const { kp, pubPem } = await genIdentity();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-"));
  const agentDir = path.join(dir, "agents", "AG-WEB");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"), "public_key: " + pubPem.replace(/\n/g, "\\n") + "\n");
  const json = '{"title":"A"}';
  const sig = await signMsg(kp.privateKey, "publish " + json);
  assert.strictEqual(verifyPublishSig(path.join(dir, "agents"), '{"title":"B"}', "AG-WEB", sig), false);
});

test("[S6] sign.html 导出的私钥 PEM 与 claim-sign.js 同路径可互换（往返）", async () => {
  const { kp, privPem, pubPem } = await genIdentity();
  // 模拟 join 生成的 keys/<AG>/private.pem：claim-sign.js 直接读此文件签名
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sig-"));
  fs.mkdirSync(path.join(dir, "keys", "AG-WEB"), { recursive: true });
  fs.writeFileSync(path.join(dir, "keys", "AG-WEB", "private.pem"), privPem);
  const priv = crypto.createPrivateKey(fs.readFileSync(path.join(dir, "keys", "AG-WEB", "private.pem"), "utf-8"));
  const msg = "claim T-5000 AG-WEB";
  const sig = crypto.sign(null, Buffer.from(msg, "utf-8"), priv).toString("hex");
  // 网关验签（agent.md 用 sign.html 导出的公钥）
  const agentDir = path.join(dir, "agents", "AG-WEB");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.md"), "public_key: " + pubPem.replace(/\n/g, "\\n") + "\n");
  assert.strictEqual(verifyClaimLike(path.join(dir, "agents"), msg, "AG-WEB", sig), true);
});
