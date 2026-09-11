#!/usr/bin/env node
/* tests/settle-reputation.test.js — B3 结算后声誉更新验证（D-103 updateReputation 端到端）
 * 场景: 带 required_capabilities 的任务 → 认领→提交→L0验证→结算 → agent.md 声誉字段更新 + rep-update 事件
 * 风格对齐 auth-sig.test.js / penalty.test.js：临时夹具 bare repo + execFileSync/execSync + check
 */
"use strict";
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = process.cwd();
const SETTLE = path.join(ROOT, "tools", "settle.js");
const SIGTOOL = path.join(ROOT, "tools", "sig.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }

console.log("settle-reputation.test.js (B3 结算后声誉更新)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "amrep-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(market);
  // agent AG-REP 夹具（ed25519 密钥 + 档案）
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.join(market, "agents", "AG-REP"), { recursive: true });
  fs.mkdirSync(path.join(market, "keys", "AG-REP"), { recursive: true });
  fs.mkdirSync(path.join(market, "tools"), { recursive: true });
  fs.writeFileSync(path.join(market, "keys", "AG-REP", "private.pem"), privPem);
  fs.writeFileSync(path.join(market, "agents", "AG-REP", "agent.md"),
    "---\nid: AG-REP\n---\nkey_fingerprint: " +
    "SHA256:" + crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64") +
    "\npublic_key: " + pubPem.trim().split("\n").join("\\n") + "\n");
  fs.copyFileSync(path.join(ROOT, "tools", "settle.js"), path.join(market, "tools", "settle.js"));
  // 任务 T-REP（required_capabilities: [code]）
  const taskDir = path.join(market, "tasks", "T-REP");
  fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
  fs.mkdirSync(path.join(taskDir, "result"), { recursive: true });
  fs.mkdirSync(path.join(market, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(taskDir, "spec.md"),
    "---\ntitle: \"rep settle test\"\ndescription: \"x\"\ndeadline: 2026-12-31T00:00:00Z\ncomplexity: S\nbudget: 40\nsens: L0\npublisher: AG-REP\nrequired_capabilities: [code]\n---\n");
  fs.writeFileSync(path.join(taskDir, "events", "published-x.md"),
    "---\nevent: published\ntask: T-REP\npublisher: AG-REP\nts: 20260901000000\n---\nT-REP published\n");
  fs.writeFileSync(path.join(taskDir, "events", "claimed-x.md"),
    "---\nevent: claimed\ntask: T-REP\nworker: AG-REP\nop_id: claimed-x\nts: 2026-09-01T00:00:00.000Z\n---\nAG-REP 认领 T-REP\n");
  const subFile = path.join(taskDir, "events", "submitted-x.md");
  fs.writeFileSync(subFile, "---\nevent: submitted\ntask: T-REP\nworker: AG-REP\nts: 2026-09-01T01:00:00.000Z\n---\nresult ok\n");
  fs.writeFileSync(path.join(taskDir, "result", "verify-result.json"),
    JSON.stringify({ task: "T-REP", ts: "2026-09-01T02:00:00.000Z", total: 1, passed: 1,
      assertions: [{ type: "file_exists", passed: true }], verdict: "PASS" }));
  for (const c of ["git init -q", "git add -A", `git -c user.email=t@t -c user.name=t commit -qm init`]) {
    g(c, { cwd: market });
  }
  g(`git init -q --bare "${bare}"`);
  g(`git remote add origin "${bare}"`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });
  // 事件签名（submitted 用 AG-REP 私钥；published/claimed 本地签名路径）
  g(`node "${SIGTOOL}" sign AG-REP "${path.join(market, "tools", "..", "tasks", "T-REP", "events", "published-x.md").replace(/\\/g, "/")}"`, { cwd: market });
  g(`node "${SIGTOOL}" sign AG-REP "${path.join(market, "tools", "..", "tasks", "T-REP", "events", "claimed-x.md").replace(/\\/g, "/")}"`, { cwd: market });
  g(`node "${SIGTOOL}" sign AG-REP "${path.join(market, "tools", "..", "tasks", "T-REP", "events", "submitted-x.md").replace(/\\/g, "/")}"`, { cwd: market });
  g(`git add -A`, { cwd: market });
  g(`git -c user.email=t@t -c user.name=t commit -qm events`, { cwd: market });

  /* T1: 结算成功（exit 0 + settled 事件） */
  let settleOut = "";
  try { settleOut = g(`node "${SETTLE}" T-REP --allow-unsigned`, { cwd: market }); }
  catch (e) { settleOut = (e.stdout || "") + (e.stderr || ""); }
  const settledEv = fs.readdirSync(path.join(taskDir, "events")).find(f => f.startsWith("settled-"));
  check("T1 结算成功 + settled 事件", !!settledEv && /结算|settle|✅/.test(settleOut), settleOut.split("\n").slice(-6).join(" | "));
  if (!settledEv) { console.log("—— settle 失败输出 ——\n" + settleOut); process.exit(1); }

  /* T2: rep-update 声誉事件生成 */
  const repEv = fs.readdirSync(path.join(taskDir, "events")).find(f => f.startsWith("rep-update-"));
  check("T2 rep-update 事件生成", !!repEv, "events=" + fs.readdirSync(path.join(taskDir, "events")).join(","));
  if (repEv) {
    const repText = fs.readFileSync(path.join(taskDir, "events", repEv), "utf-8");
    check("T2 事件含 agent/task", /agent: AG-REP/.test(repText) && /task: T-REP/.test(repText), repText.split("\n").slice(0, 4).join("|"));
  }

  /* T3: agent.md 声誉字段更新（结算前无 rep_by_cap → 结算后有） */
  const agentText = fs.readFileSync(path.join(market, "agents", "AG-REP", "agent.md"), "utf-8");
  check("T3 agent.md 含 rep_by_cap", /^rep_by_cap:/m.test(agentText), agentText);
  check("T3 agent.md 含 code 能力声誉", /^\s+code:\s*\d+$/m.test(agentText), agentText.split("\n").filter(l => /code|rep_|tier/.test(l)).join("|"));
  check("T3 agent.md 含 reputation + tier", /^reputation:\s*\d+$/m.test(agentText) && /^tier:\s*\w+$/m.test(agentText), agentText.split("\n").filter(l => /^reputation:|^tier:/.test(l)).join("|"));

  /* T4: 结算守恒（账本 L-* 生成 + payment/tax/refund） */
  const ledgerFiles = fs.existsSync(path.join(market, "ledger")) ? fs.readdirSync(path.join(market, "ledger")).filter(f => f.endsWith(".md")) : [];
  check("T4 账本写入", ledgerFiles.length >= 3, "ledger=" + ledgerFiles.join(","));
  const settledText = fs.readFileSync(path.join(taskDir, "events", settledEv), "utf-8");
  check("T4 settled 含 payment 34", /payment: 34/.test(settledText), settledText.split("\n").filter(l => /payment|tax|refund/.test(l)).join("|"));

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { if (fx) fs.rmSync(fx, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
