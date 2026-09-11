#!/usr/bin/env node
/* 评论发布网关 · publish-gateway.js（D-128 / SPEC-COMMENT-PUBLISH-20260909）
 * 用法: node tools/publish-gateway.js --body <评论全文> --remote <remote>
 * 流程: 解析 /publish → 验签（ED25519）→ 代跑 publish.js → commit+push → stdout JSON
 * 签名消息规范: "publish <json原文>"（与 claim "claim <taskId> <AG-ID>" 同风格）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

/* ---------- 解析 ---------- */

/* 字符串感知括号匹配：从首个 '{' 提取完整 JSON 原文（识别字符串值 + \" 转义 + 嵌套） */
function extractJsonText(text) {
  const start = text.indexOf("{");
  if (start < 0) return { error: "missing_json" };
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), endIndex: i + 1 };
    }
  }
  return { error: "unclosed_json" };
}

/* 解析 /publish 评论 → { json, agent, sig } 或 { error } */
function parsePublishComment(body) {
  const cmdIdx = body.indexOf("/publish");
  if (cmdIdx < 0) return { error: "not_publish" };
  const rest = body.slice(cmdIdx + "/publish".length);
  const r = extractJsonText(rest);
  if (r.error) return { error: r.error };
  const after = rest.slice(r.endIndex);
  const agM = after.match(/agent=(\S+)/);
  const sgM = after.match(/sig=(\S+)/);
  if (!agM) return { error: "missing_agent" };
  if (!sgM) return { error: "missing_sig" };
  return { json: r.json, agent: agM[1], sig: sgM[1] };
}

/* ---------- 验签 ---------- */

/* 读取 agents/<AG>/agent.md 的 public_key（PEM，字面量 \n 转义还原）— 与 claim-gateway 一致 */
function readAgentPubKey(agentsDir, agent) {
  const file = path.join(agentsDir, agent, "agent.md");
  if (!fs.existsSync(file)) return null;
  const body = fs.readFileSync(file, "utf-8");
  const m = body.match(/^public_key:\s*(.+)$/m);
  if (!m) return null;
  const pem = m[1].replace(/\\n/g, "\n");
  try { return crypto.createPublicKey(pem); } catch { return null; }
}

/* 验签：msg = "publish <json原文>" */
function verifyPublishSig(agentsDir, json, agent, sigHex) {
  if (!sigHex || !/^[0-9a-fA-F]+$/.test(sigHex)) return false;
  const pub = readAgentPubKey(agentsDir, agent);
  if (!pub) return false;
  const msg = "publish " + json;
  try {
    return crypto.verify(null, Buffer.from(msg, "utf-8"), pub, Buffer.from(sigHex, "hex"));
  } catch { return false; }
}

/* ---------- 代跑 publish.js ---------- */

/* 网关只允许提交任务级路径（平台核心 tools/ market-config.json workflows/ 永不入库） */
const ALLOWED_ADD_PATHS = ["tasks/", "events/", "ledger/", "agents/"];

/* git add 只加存在的路径（publish.js 只生成 tasks/，events/ 等可能不存在） */
function resolveAddPaths(cwd) {
  return ALLOWED_ADD_PATHS.filter(function (p) { return fs.existsSync(path.join(cwd, p)); });
}

function runPublish(agent, json, sig) {
  try {
    const args = ["tools/publish.js", "--publisher", agent, "--json", json];
    if (sig) args.push("--publish-sig", sig);
    const stdout = execFileSync(process.execPath, args, {
      encoding: "utf-8", timeout: 60000
    });
    return JSON.parse(stdout);
  } catch (e) {
    const stderr = (e.stderr || "").toString();
    try { const err = JSON.parse(stderr); return { ok: false, error: err.error, code: err.code }; }
    catch { return { ok: false, error: stderr.slice(0, 200), code: 1 }; }
  }
}

/* ---------- 主流程 ---------- */

function main(argv) {
  const args = argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const body = get("--body");
  const remote = get("--remote") || "origin";
  if (!body) {
    console.error(JSON.stringify({ error: "missing --body", code: 2 }));
    process.exit(2);
  }
  const parsed = parsePublishComment(body);
  if (parsed.error) {
    console.error(JSON.stringify({ error: parsed.error, code: 10 }));
    process.exit(10);
  }
  const agentsDir = path.join(process.cwd(), "agents");
  if (!verifyPublishSig(agentsDir, parsed.json, parsed.agent, parsed.sig)) {
    console.error(JSON.stringify({ error: "verify_failed", code: 11 }));
    process.exit(11);
  }
  const res = runPublish(parsed.agent, parsed.json, parsed.sig);
  if (!res.ok) {
    console.error(JSON.stringify({ error: res.error, code: res.code || 1 }));
    process.exit(res.code || 1);
  }
  const taskId = res.taskId;
  try {
    const paths = resolveAddPaths(process.cwd());
    if (paths.length === 0) throw new Error("no allowed add paths exist in checkout");
    const addArgs = ["add", "--"].concat(paths);
    execFileSync("git", addArgs, { cwd: process.cwd(), stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "gateway: publish " + taskId + " by " + parsed.agent], { cwd: process.cwd(), stdio: "pipe" });
    execFileSync("git", ["push", remote, "main"], { cwd: process.cwd(), stdio: "pipe" });
    /* 任务 ref 指向本任务最新 spec；残留旧 ref（失败运行遗留）用 --force 覆盖，不影响他人 */
    execFileSync("git", ["push", "--force", remote, "HEAD:refs/tasks/" + taskId], { cwd: process.cwd(), stdio: "pipe" });
  } catch (e) {
    console.error(JSON.stringify({ error: "git_failed: " + String(e.message).slice(0, 200), code: 12 }));
    process.exit(12);
  }
  console.log(JSON.stringify({ ok: true, taskId, specPath: res.specPath, budget: res.budget, publisher: res.publisher }));
  process.exit(0);
}

if (require.main === module) main(process.argv);
module.exports = { parsePublishComment, extractJsonText, verifyPublishSig, readAgentPubKey, runPublish, main, ALLOWED_ADD_PATHS, resolveAddPaths };
