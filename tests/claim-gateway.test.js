#!/usr/bin/env node
/* tests/claim-gateway.test.js — 认领网关 TDD（SPEC-CLAIM-GATEWAY-20260909）
 * 测: parseClaimComment / verifyClaimSig / 锁操作 / claim-sign 闭环
 * 风格对齐 keepalive.test.js：node:assert + execSync + check + 临时夹具 + cleanup
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = process.cwd();
const GATEWAY = path.join(ROOT, "tools", "claim-gateway.js");
const SIGTOOL = path.join(ROOT, "tools", "claim-sign.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }

/* 夹具：临时市场（任务 + agent 密钥 + bare remote） */
function makeFixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "amcg-"));
  const market = path.join(d, "market");
  const bare = path.join(d, "bare.git");
  fs.mkdirSync(path.join(market, "tasks", "T-2000", "events"), { recursive: true });
  fs.writeFileSync(path.join(market, "tasks", "T-2000", "spec.md"),
    "---\nid: T-2000\ncomplexity: S\npublisher: AG-P01\n---\n");
  // 生成测试 agent 密钥（ed25519）
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" });
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" });
  fs.mkdirSync(path.join(market, "agents", "AG-TEST"), { recursive: true });
  fs.writeFileSync(path.join(market, "agents", "AG-TEST", "agent.md"),
    "---\nid: AG-TEST\n---\nkey_fingerprint: test\npublic_key: " +
    pubPem.trim().split("\n").join("\\n") + "\n");
  fs.mkdirSync(path.join(market, "keys", "AG-TEST"), { recursive: true });
  fs.writeFileSync(path.join(market, "keys", "AG-TEST", "private.pem"), privPem);
  // 初始化市场仓库 + bare remote
  for (const c of ["git init -q", "git add -A", `git -c user.email=t@t -c user.name=t commit -qm init`]) {
    try { g(c, { cwd: market }); } catch (e) { console.error("夹具失败: " + e.message); process.exit(1); }
  }
  g(`git init -q --bare "${bare}"`);
  g(`git remote add origin "${bare}"`, { cwd: market });
  g(`git push -q origin HEAD:main`, { cwd: market });
  return { d, market, bare, privPem, pubPem };
}
function signMsg(privPem, msg) {
  return crypto.sign(null, Buffer.from(msg, "utf-8"), privPem).toString("hex");
}
function runGateway(args, cwd) {
  try {
    const out = g(`node "${GATEWAY}" ${args.join(" ")}`, { cwd });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() }; }
}

console.log("D-125 claim-gateway.test.js (SPEC-CLAIM-GATEWAY-20260909)");
let fx = null;
try {
  fx = makeFixture();

  /* T1-T3: parseClaimComment（直接 require gateway 的纯函数） */
  const gwMod = require(GATEWAY);
  const p1 = gwMod.parseClaimComment("/claim T-2000 agent=AG-TEST sig=abc123");
  check("T1 正常格式解析", p1 && p1.taskId === "T-2000" && p1.agent === "AG-TEST" && p1.sig === "abc123",
    JSON.stringify(p1));
  check("T2 缺 sig 返回 null", gwMod.parseClaimComment("/claim T-2000 agent=AG-TEST") === null, "非 null");
  check("T2 前缀错返回 null", gwMod.parseClaimComment("claim T-2000 agent=AG-TEST sig=x") === null, "非 null");
  const p3 = gwMod.parseClaimComment("hello\n/claim T-3000 agent=AG-A sig=s1\nworld");
  check("T3 多行提取 /claim 行", p3 && p3.taskId === "T-3000" && p3.sig === "s1", JSON.stringify(p3));

  /* T4-T7: verifyClaimSig */
  const msg = "claim T-2000 AG-TEST";
  const goodSig = signMsg(fx.privPem, msg);
  const badSig = "deadbeef";
  const tamperedMsg = "claim T-2000 AG-EVIL";
  const tamperedSig = signMsg(fx.privPem, tamperedMsg);
  const agentDir = path.join(fx.market, "agents", "AG-TEST");
  check("T4 正确签名验签 true", gwMod.verifyClaimSig(path.join(fx.market, "agents"), msg, goodSig) === true, "false");
  check("T5 错误签名 false", gwMod.verifyClaimSig(path.join(fx.market, "agents"), msg, badSig) === false, "true");
  check("T6 篡改消息 false", gwMod.verifyClaimSig(path.join(fx.market, "agents"), msg, tamperedSig) === false, "true");
  check("T7 档案不存在 false 不崩溃",
    gwMod.verifyClaimSig(path.join(fx.market, "agents"), "claim T-2000 AG-NOPE", goodSig) === false, "异常");

  /* T8: 未占用可认领 */
  const r8 = runGateway([`--task`, "T-2000", `--agent`, "AG-TEST", `--sig`, goodSig,
    `--repo`, fx.market, `--remote`, "origin"], fx.market);
  const j8 = JSON.parse(r8.out.split("\n").pop());
  check("T8 认领成功 exit 0", r8.code === 0 && j8.ok === true, `code=${r8.code} out=${r8.out.slice(0, 120)}`);
  const lock8 = g(`git ls-remote "${fx.bare}" refs/claims/T-2000`);
  check("T8 锁已推 bare", lock8.trim().length > 0, lock8.slice(0, 60));

  /* T9: 已被占用拒绝 */
  const r9 = runGateway([`--task`, "T-2000", `--agent`, "AG-TEST", `--sig`, goodSig,
    `--repo`, fx.market, `--remote`, "origin"], fx.market);
  const j9 = JSON.parse(r9.out.split("\n").pop());
  check("T9 锁已占 exit 1", r9.code === 1 && j9.ok === false && /已认领|已占/.test(j9.reason || ""),
    `code=${r9.code} ${JSON.stringify(j9)}`);

  /* T10: 任务不存在 */
  const sigNope = signMsg(fx.privPem, "claim T-NOPE AG-TEST");
  const r10 = runGateway([`--task`, "T-NOPE", `--agent`, "AG-TEST", `--sig`, sigNope,
    `--repo`, fx.market, `--remote`, "origin"], fx.market);
  const j10 = JSON.parse(r10.out.split("\n").pop());
  check("T10 任务不存在 exit 1", r10.code === 1 && j10.ok === false, JSON.stringify(j10));

  /* T11: 已 settled 拒绝 */
  fs.writeFileSync(path.join(fx.market, "tasks", "T-2000", "events", "settled-x.md"), "---\nevent: settled\n---\n");
  const r11 = runGateway([`--task`, "T-2000", `--agent`, "AG-TEST", `--sig`, goodSig,
    `--repo`, fx.market, `--remote`, "origin"], fx.market);
  const j11 = JSON.parse(r11.out.split("\n").pop());
  check("T11 已 settled 拒绝", r11.code === 1 && /settled|结算/.test(j11.reason || ""), JSON.stringify(j11));

  /* T12: claim-sign → gateway 闭环 */
  fs.unlinkSync(path.join(fx.market, "tasks", "T-2000", "events", "settled-x.md"));
  // 造一个新任务 T-3000（未占用）
  fs.mkdirSync(path.join(fx.market, "tasks", "T-3000"), { recursive: true });
  fs.writeFileSync(path.join(fx.market, "tasks", "T-3000", "spec.md"),
    "---\nid: T-3000\ncomplexity: S\npublisher: AG-P01\n---\n");
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm add-t3000`]) g(c, { cwd: fx.market });
  g(`git push -q origin HEAD:main`, { cwd: fx.market });
  const sigOut = g(`node "${SIGTOOL}" T-3000 AG-TEST`, { cwd: fx.market }).trim();
  const r12 = runGateway([`--task`, "T-3000", `--agent`, "AG-TEST", `--sig`, sigOut,
    `--repo`, fx.market, `--remote`, "origin"], fx.market);
  const j12 = JSON.parse(r12.out.split("\n").pop());
  check("T12 闭环认领成功", r12.code === 0 && j12.ok === true, `code=${r12.code} ${r12.out.slice(0, 120)}`);

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { if (fx) fs.rmSync(fx.d, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
