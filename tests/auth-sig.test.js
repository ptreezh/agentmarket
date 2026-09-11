#!/usr/bin/env node
/* tests/auth-sig.test.js — 签名链修复 B3（零 node 通道 auth_sig）
 * 测: publish.js --publish-sig 写 auth_sig+json 正文 → sig.js verify 通过
 *     claim-gateway claimed 事件带 auth_sig → sig.js verify 通过
 *     篡改 body → auth_sig 验签失败；普通 sig.js sign 事件不回归
 * 风格对齐 keepalive.test.js：node:assert + execSync + check + 临时夹具 + cleanup
 */
"use strict";
const assert = require("assert");
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, "tools", "publish.js");
const GATEWAY = path.join(ROOT, "tools", "claim-gateway.js");
const SIGTOOL = path.join(ROOT, "tools", "sig.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
function signMsg(privPem, msg) {
  return crypto.sign(null, Buffer.from(msg, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
}

console.log("auth-sig.test.js (B3 签名链修复)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "amasig-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(market);
  // agent 夹具
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.join(market, "agents", "AG-TEST"), { recursive: true });
  fs.mkdirSync(path.join(market, "keys", "AG-TEST"), { recursive: true });
  fs.mkdirSync(path.join(market, "tools"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "tools", "publish.js"), path.join(market, "tools", "publish.js"));
  fs.writeFileSync(path.join(market, "keys", "AG-TEST", "private.pem"), privPem);
  fs.writeFileSync(path.join(market, "agents", "AG-TEST", "agent.md"),
    "---\nid: AG-TEST\n---\nkey_fingerprint: " +
    "SHA256:" + crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64") +
    "\npublic_key: " + pubPem.trim().split("\n").join("\\n") + "\n");
  for (const c of ["git init -q", "git add -A", `git -c user.email=t@t -c user.name=t commit -qm init`]) {
    try { g(c, { cwd: market }); } catch (e) { console.error("夹具失败: " + e.message); process.exit(1); }
  }
  g(`git init -q --bare "${bare}"`);
  g(`git remote add origin "${bare}"`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });

  /* T1: publish.js --publish-sig → published 事件含 auth_sig + body=json → sig.js verify 通过 */
  const json = JSON.stringify({ title: "auth sig test", deadline: "2026-12-31T00:00:00Z", budget: 40, complexity: "S" });
  const pubSig = signMsg(privPem, "publish " + json);
  const pubOut = execFileSync(process.execPath, [PUBLISH, "--publisher", "AG-TEST", "--json", json, "--publish-sig", pubSig],
    { cwd: market, encoding: "utf-8" }).trim();
  const pubRes = JSON.parse(pubOut.split("\n").pop());
  const taskId = pubRes.taskId;
  const evDir = path.join(market, "tasks", taskId, "events");
  const pubEvent = fs.readdirSync(evDir).find(f => f.startsWith("published-"));
  const pubText = fs.readFileSync(path.join(evDir, pubEvent), "utf-8");
  check("T1 published 事件含 auth_sig", /^auth_sig:\s*[0-9a-f]{128}/m.test(pubText), pubText.split("\n").slice(0, 6).join(" | "));
  check("T1 published 正文 = json 原文", pubText.split("---")[2].trim() === json, "body=" + pubText.split("---")[2].trim().slice(0, 60));
  const v1 = g(`node "${SIGTOOL}" verify "${path.join(evDir, pubEvent).replace(/\\/g, "/")}"`, { cwd: market });
  check("T1 sig.js verify auth_sig 通过", /签名有效/.test(v1), v1);

  /* T2: claim-gateway → claimed 事件含 auth_sig → sig.js verify 通过 */
  const claimSig = signMsg(privPem, "claim " + taskId + " AG-TEST");
  const clOut = g(`node "${GATEWAY}" --task ${taskId} --agent AG-TEST --sig ${claimSig} --repo "${market}" --remote origin`, { cwd: market });
  const clEvent = fs.readdirSync(evDir).find(f => f.startsWith("claimed-"));
  const clText = fs.readFileSync(path.join(evDir, clEvent), "utf-8");
  check("T2 claimed 事件含 auth_sig", /^auth_sig:\s*[0-9a-f]{128}/m.test(clText), clText.split("\n").slice(0, 7).join(" | "));
  const v2 = g(`node "${SIGTOOL}" verify "${path.join(evDir, clEvent).replace(/\\/g, "/")}"`, { cwd: market });
  check("T2 sig.js verify claimed auth_sig 通过", /签名有效/.test(v2), v2);

  /* T3: 篡改 published body → auth_sig 验签失败 */
  const tampered = pubText.replace(json, json.replace("auth sig test", "EVIL"));
  const tFile = path.join(evDir, "published-tampered.md");
  fs.writeFileSync(tFile, tampered);
  let t3 = null;
  try { g(`node "${SIGTOOL}" verify "${tFile.replace(/\\/g, "/")}"`, { cwd: market }); t3 = "unexpected pass"; }
  catch (e) { t3 = (e.status === 1) ? "rejected" : "other:" + e.status; }
  check("T3 篡改 body 被 auth_sig 检出", t3 === "rejected", "got=" + t3);

  /* T4: 普通 sig.js sign 事件不回归（signer/signature 路径） */
  const plainEv = path.join(evDir, "submitted-x.md");
  fs.writeFileSync(plainEv, "---\nevent: submitted\ntask: " + taskId + "\nworker: AG-TEST\n---\nresult ok\n");
  g(`node "${SIGTOOL}" sign AG-TEST "${plainEv}"`, { cwd: market });
  const v4 = g(`node "${SIGTOOL}" verify "${plainEv.replace(/\\/g, "/")}"`, { cwd: market });
  check("T4 普通签名路径不回归", /签名有效/.test(v4), v4);

  /* T5: 未知 event 类型带 auth_sig → 回退 signer 路径（缺 signer → 报未签名，不崩溃） */
  const oddEv = path.join(evDir, "odd-x.md");
  fs.writeFileSync(oddEv, "---\nevent: weird\ntask: " + taskId + "\nauth_sig: deadbeef\n---\nbody\n");
  let t5 = null;
  try { g(`node "${SIGTOOL}" verify "${oddEv.replace(/\\/g, "/")}"`, { cwd: market }); t5 = "unexpected pass"; }
  catch (e) { t5 = "rejected-or-failed"; }
  check("T5 未知事件类型不崩溃", t5 !== "unexpected pass", "got=" + t5);

  /* T6: publish-gateway.runPublish(agent, json, sig) → 新任务 published 事件含 auth_sig */
  const pgw = require(path.join(ROOT, "tools", "publish-gateway.js"));
  const prevCwd = process.cwd();
  process.chdir(market);
  let t6 = "not-run";
  try {
    const res6 = pgw.runPublish("AG-TEST", json, pubSig);
    const t6dir = path.join(market, "tasks", res6.taskId, "events");
    const t6ev = fs.readdirSync(t6dir).find(f => f.startsWith("published-"));
    const t6Text = fs.readFileSync(path.join(t6dir, t6ev), "utf-8");
    t6 = (/^auth_sig:\s*[0-9a-f]{128}/m.test(t6Text) && /^event: published/m.test(t6Text)) ? "ok" : "no-auth-sig";
  } catch (e) { t6 = "err:" + e.message; }
  finally { process.chdir(prevCwd); }
  check("T6 publish-gateway 传递 --publish-sig", t6 === "ok", t6);

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { if (fx) fs.rmSync(fx, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
