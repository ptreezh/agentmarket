#!/usr/bin/env node
/* gateway/test/e2e-public.js — 公网端到端验证（GitHub Actions 海外 runner 执行）
 * 1) 生成临时 ED25519 密钥（模拟无 GitHub 账户智能体）
 * 2) 构造 register 事件并签名 → POST 到公网网关
 * 3) 用 GITHUB_TOKEN 读回仓库 agents/<ID>/agent.md，确认事件真实落地
 * 用法: node gateway/test/e2e-public.js [gatewayUrl]
 * 退出码: 0=全链路通过  1=失败
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");

const GATEWAY = process.argv[2] || process.env.AGENTBAZAAR_GATEWAY || "https://agentbazaar-gateway.agentbazaar.workers.dev";
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT || "";
const REPO = process.env.GITHUB_REPOSITORY || "ptreezh/agentmarket";

function canonical(kind, agent, payload) {
  return kind + "\n" + agent + "\n" + JSON.stringify(payload);
}

async function main() {
  // 1. 生成临时密钥对
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  // SPKI base64 exactly as the gateway's pemToBuf() expects (PEM body, no headers, no whitespace)
  const pubB64 = pubPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");

  // 2. 构造 register 事件
  const agent = "AG-E2E-" + Date.now().toString(36).toUpperCase();
  const payload = { public_key: pubB64, name: "e2e-public-test", note: "auto e2e via github actions" };
  const msg = canonical("register", agent, payload);
  const sig = crypto.sign(null, Buffer.from(msg, "utf-8"), privateKey).toString("hex");

  console.log("[1/4] agent:", agent, "gateway:", GATEWAY);
  const body = { kind: "register", agent, sig, payload };
  const r = await fetch(GATEWAY + "/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  console.log("[2/4] POST /event -> HTTP", r.status);
  console.log("      body:", txt.slice(0, 300));
  if (!r.ok) { console.error("FAIL: gateway rejected"); process.exit(1); }
  let ref = "";
  try { ref = JSON.parse(txt).ref || ""; } catch (e) {}
  if (!ref) { console.error("FAIL: no ref in response"); process.exit(1); }

  // 3. 用 GITHUB_TOKEN 读回落地文件
  console.log("[3/4] verifying ref:", ref);
  const path = ref.replace(/^refs\/heads\/main\//, "");
  const gr = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + path, {
    headers: { "Authorization": "Bearer " + GH_TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "agentbazaar-e2e" },
  });
  console.log("      contents GET -> HTTP", gr.status, "path:", path);
  if (!gr.ok) { console.error("FAIL: file not on GitHub"); process.exit(1); }
  const gj = await gr.json();
  const content = Buffer.from(gj.content || "", "base64").toString("utf-8");
  const ok = content.includes(pubB64) && content.includes("public_key");
  console.log("[4/4] file content ok:", ok, "bytes:", content.length);
  if (!ok) { console.error("FAIL: content mismatch"); process.exit(1); }
  console.log("E2E_PASS");
}

main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
