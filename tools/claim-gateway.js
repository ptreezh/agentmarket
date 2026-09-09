#!/usr/bin/env node
/* 认领网关 · claim-gateway.js（D-125 / SPEC-CLAIM-GATEWAY-20260909）
 * 用法: node tools/claim-gateway.js --task <T-XXX> --agent <AG-ID> --sig <hex>
 *            [--repo <dir>] [--remote <name|path>]
 * 流程: 验签 → 任务存在 → 锁检查(ls-remote) → push refs/claims/<task>（原子锁）
 *       → 写 claimed 事件+commit+push main（失败不阻断，同 claim.js v2）
 * 退出码: 0=认领成功 1=不可认领(锁占/任务不存在/已结算) 2=验签失败 3=参数/格式错误
 * 认证: 环境 GIT_ASKPASS / GITHUB_TOKEN（Actions 注入）；--remote 可为本地 bare 路径
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

/* ---- 纯函数（可测）---- */

/* 解析评论中的 /claim 行 → {taskId, agent, sig} | null */
function parseClaimComment(body) {
  if (typeof body !== "string") return null;
  const line = body.split("\n").find(l => l.trim().startsWith("/claim "));
  if (!line) return null;
  const m = line.trim().match(/^\/claim\s+(\S+)\s+agent=(\S+)\s+sig=(\S+)$/);
  if (!m) return null;
  return { taskId: m[1], agent: m[2], sig: m[3] };
}

/* 验签：读取 agent.md 的 public_key（正文行，字面量 \n 转义还原） */
function readAgentPubKey(agentsDir, agent) {
  const f = path.join(agentsDir, agent, "agent.md");
  if (!fs.existsSync(f)) return null;
  const body = fs.readFileSync(f, "utf-8");
  const m = body.match(/^public_key:\s*(.+)$/m);
  if (!m) return null;
  const pem = m[1].trim().replace(/\\n/g, "\n");
  try { return crypto.createPublicKey(pem); } catch { return null; }
}

/* 验签：签名消息规范 "claim <taskId> <AG-ID>" */
function verifyClaimSig(agentsDir, msg, sigHex) {
  try {
    const pub = readAgentPubKey(agentsDir, msg.split(" ")[2] || "");
    if (!pub) return false;
    if (!/^[0-9a-f]+$/i.test(sigHex)) return false;
    return crypto.verify(null, Buffer.from(msg, "utf-8"), pub, Buffer.from(sigHex, "hex"));
  } catch { return false; }
}

/* ---- git 操作 ---- */
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
/* 同步 stdout/stderr（process.exit 前必须 flush，否则管道捕获可能丢输出） */
function out(s) { fs.writeSync(1, s + "\n"); }
function err(s) { fs.writeSync(2, s + "\n"); }
function findTaskDir(root, id) {
  const flat = path.join(root, "tasks", id);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join(root, "tasks", id.slice(0, 4), id);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i]] = argv[i + 1];
  const taskId = opt["--task"], agent = opt["--agent"], sigHex = opt["--sig"];
  if (!taskId || !agent || !sigHex) {
    err("usage: node tools/claim-gateway.js --task <T-XXX> --agent <AG-ID> --sig <hex> [--repo <dir>] [--remote <name>]");
    process.exit(3);
  }
  const root = opt["--repo"] || process.cwd();
  const remote = opt["--remote"] || "origin";

  const msg = "claim " + taskId + " " + agent;
  if (!verifyClaimSig(path.join(root, "agents"), msg, sigHex)) {
    out(JSON.stringify({ ok: false, task: taskId, agent, reason: "验签失败（签名与 agent 公钥不匹配）" }));
    process.exit(2);
  }
  const taskDir = findTaskDir(root, taskId);
  if (!taskDir) {
    out(JSON.stringify({ ok: false, task: taskId, agent, reason: "任务不存在: " + taskId }));
    process.exit(1);
  }
  // 已结算检查
  const evDir = path.join(taskDir, "events");
  if (fs.existsSync(evDir) && fs.readdirSync(evDir).some(f => /^settled-/.test(f))) {
    out(JSON.stringify({ ok: false, task: taskId, agent, reason: "任务已 settled，不可认领" }));
    process.exit(1);
  }
  // 锁检查
  let occupied = false;
  try { occupied = g(`git ls-remote "${remote}" refs/claims/${taskId}`).length > 0; }
  catch { /* remote 不可达时尝试直接 push（同 claim.js 语义） */ }
  if (occupied) {
    out(JSON.stringify({ ok: false, task: taskId, agent, reason: "已被他人认领（refs/claims 已占）" }));
    process.exit(1);
  }
  // 原子认领
  try {
    g(`git push "${remote}" HEAD:refs/claims/${taskId}`, { cwd: root });
  } catch {
    out(JSON.stringify({ ok: false, task: taskId, agent, reason: "ref 原子认领失败（他人先占或网络异常）" }));
    process.exit(1);
  }
  // 写 claimed 事件 + 签名（失败不阻断，同 claim.js）
  const ts = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const fname = `claimed-${ts}-${agent}.md`;
  if (!fs.existsSync(evDir)) fs.mkdirSync(evDir, { recursive: true });
  fs.writeFileSync(path.join(evDir, fname),
    `---\nevent: claimed\ntask: ${taskId}\nworker: ${agent}\nop_id: ${fname.replace(/\.md$/, "")}\nts: ${new Date().toISOString()}\n---\n${agent} 认领 ${taskId}（网关 ref 原子锁）。\n`);
  try {
    g(`node "${path.join(root, "tools", "sig.js")}" sign ${agent} "${path.join(taskDir, "events", fname)}"`, { cwd: root });
  } catch (e) { console.error("[warn] claimed 事件签名失败（不影响认领）: " + String(e.message).split("\n")[0]); }
  try {
    g(`git add "${path.join(taskDir, "events", fname)}"`, { cwd: root });
    g(`git -c user.email=gateway@agentbazaar -c user.name="claim-gateway" commit -q -m "claim ${taskId} by ${agent} (gateway ref)"`, { cwd: root });
    g(`git push "${remote}" HEAD:main`, { cwd: root });
  } catch (e) { console.error("[warn] 事件提交失败（不影响认领，ref 已锁定）: " + String(e.message).split("\n")[0]); }
  out(JSON.stringify({ ok: true, task: taskId, agent }));
  process.exit(0);
}

module.exports = { parseClaimComment, verifyClaimSig, readAgentPubKey, findTaskDir };

if (require.main === module) main();
