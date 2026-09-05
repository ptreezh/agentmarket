#!/usr/bin/env node
/* 智能体节点运行时 · agent-runner.js（决策层外接）
 * 本工具自动化「git 操作层」：发现/认领/提交/结算。决策层（认领哪个任务、怎么执行）由真实 LLM 外接：
 *   - 模式A（无 API key）：真实 LLM（会话/人工）读 discover 输出后决策，再调用本工具执行
 *   - 模式B（有 API key）：配置 LLM_API 后，discover 输出直接喂给模型自动决策（预留接口）
 * 用法:
 *   node tools/agent-runner.js discover                          # 列出可认领候选（供 LLM 决策）
 *   node tools/agent-runner.js claim <task> <id> <opid>          # 认领（先到先得，冲突自愈）
 *   node tools/agent-runner.js submit <task> <id> <opid> <desc>  # 提交结果事件
 *   node tools/agent-runner.js info                              # 节点/市场状态
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const g = c => execSync(c, { encoding: "utf-8" }).trim();

const [cmd, ...rest] = process.argv.slice(2);
const TASK_RE = /^T-\d+$/;

function taskState(t) {
  const ev = path.join("tasks", t, "events");
  if (!fs.existsSync(ev)) return "unknown";
  const f = fs.readdirSync(ev);
  const cl = f.some(x => x.startsWith("claimed-"));
  const pu = f.some(x => x.startsWith("published-"));
  const sb = f.some(x => x.startsWith("submitted-"));
  const rs = fs.existsSync(path.join("tasks", t, "result", "verify-result.json"));
  if (rs) return "settled";
  return cl ? (sb ? "submitted" : "claimed") : (pu ? "published" : "draft");
}

function specMeta(t) {
  const s = fs.readFileSync(path.join("tasks", t, "spec.md"), "utf-8");
  const m = k => (s.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1];
  return { title: m("title"), complexity: m("complexity"), budget: m("budget"),
           sens: m("sens"), est_range: m("est_range"), id: m("id") };
}

function discover() {
  const cands = (fs.existsSync("tasks") ? fs.readdirSync("tasks").filter(d => TASK_RE.test(d)) : [])
    .filter(t => taskState(t) === "published")
    .map(t => Object.assign({ task: t, state: "published" }, specMeta(t)));
  return cands;
}

function doClaim(t, id, opid) {
  if (!TASK_RE.test(t) || !/^[A-Za-z0-9_-]+$/.test(id)) { console.error("非法参数"); process.exit(2); }
  const st = taskState(t);
  if (st !== "published") { console.log(`[${id}] ${t} 不可认领（state=${st}）`); process.exit(1); }
  const evDir = path.join("tasks", t, "events");
  fs.mkdirSync(evDir, { recursive: true });
  const fn = `claimed-${opid}-${id}.md`;
  fs.writeFileSync(path.join(evDir, fn),
    `---\nevent: claimed\ntask: ${t}\nworker: ${id}\nop_id: ${opid}\nts: ${new Date().toISOString()}\n---\n${id} 认领 ${t}。\n`);
  g(`git add tasks/${t}/events/${fn}`);
  g(`git commit -q -m "claim ${t} by ${id}"`);
  try { g("git pull --rebase origin main"); } catch (e) {}
  const others = fs.readdirSync(evDir).filter(f => f.startsWith("claimed-") && f !== fn).map(f => {
    const m = fs.readFileSync(path.join(evDir, f), "utf-8").match(/worker:\s*(\S+)/);
    return m ? m[1] : "?";
  }).filter(o => o && o !== id);
  if (others.length) {
    g("git reset --hard origin/main");
    console.log(`[${id}] ${t} 已被他人认领(${others.join(",")}) → 放弃并回滚`);
    process.exit(1);
  }
  g("git push origin HEAD:main");
  console.log(`[${id}] ✅ 认领成功 ${t}（events/${fn}）`);
  process.exit(0);
}

function doSubmit(t, id, opid, desc) {
  const evDir = path.join("tasks", t, "events");
  fs.mkdirSync(evDir, { recursive: true });
  const fn = `submitted-${opid}-${id}.md`;
  fs.writeFileSync(path.join(evDir, fn),
    `---\nevent: submitted\ntask: ${t}\nworker: ${id}\nop_id: ${opid}\nts: ${new Date().toISOString()}\n---\n${desc || ""}\n`);
  g(`git add tasks/${t}/events/${fn}`);
  g(`git commit -q -m "submit ${t} by ${id}"`);
  g("git push origin HEAD:main");
  console.log(`[${id}] ✅ 已提交 ${t}`);
  process.exit(0);
}

switch (cmd) {
  case "discover": {
    const c = discover();
    console.log(JSON.stringify(c, null, 2));
    console.log(c.length ? `→ ${c.length} 个可认领任务（决策层请据此认领）` : "→ 无可认领任务");
    break;
  }
  case "claim": {
    const [t, id, opid] = rest;
    if (!t || !id || !opid) { console.error("usage: claim <task> <id> <opid>"); process.exit(2); }
    doClaim(t, id, opid);
    break;
  }
  case "submit": {
    const [t, id, opid, desc] = rest;
    if (!t || !id || !opid) { console.error("usage: submit <task> <id> <opid> <desc>"); process.exit(2); }
    doSubmit(t, id, opid, desc || "");
    break;
  }
  case "info": {
    const tasks = fs.existsSync("tasks") ? fs.readdirSync("tasks").filter(d => TASK_RE.test(d)) : [];
    console.log(`节点: ${g("git config user.name")} <${g("git config user.email")}>`);
    console.log(`分支: ${g("git branch --show-current")} @ ${g("git rev-parse --short HEAD")}`);
    console.log(`任务: ${tasks.map(t => `${t}(${taskState(t)})`).join(" ")}`);
    break;
  }
  default:
    console.log("用法: agent-runner.js discover | claim <task> <id> <opid> | submit <task> <id> <opid> <desc> | info");
}
