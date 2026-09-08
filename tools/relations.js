#!/usr/bin/env node
/* tools/relations.js — 协作关系只读工具（D-124 / SPEC-RELATIONS-20260909）
 * 用法: node tools/relations.js <AG-ID>
 * 输出: stdout JSON（确定性），不写任何文件
 * 数据源: tasks 下各 spec.md(publisher) + ledger 各条(kind=pay) + agents 下 agent.md
 * 退出码: 0=成功 1=AG-ID 不存在 2=参数错误
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const AGENTS_DIR = path.join(ROOT, "agents");
const TASKS_DIR = path.join(ROOT, "tasks");
const LEDGER_DIR = path.join(ROOT, "ledger");

/* 解析 ledger 单文件：返回 {kind, from, to, amount} 或 null（畸形跳过） */
function parseLedgerFile(file) {
  const body = fs.readFileSync(file, "utf-8");
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const kind = (fm.match(/^kind:\s*(\S+)/m) || [])[1];
  if (!kind) return null;
  const rec = { kind };
  const from = (fm.match(/^from:\s*(\S+)/m) || [])[1];
  const to = (fm.match(/^to:\s*(\S+)/m) || [])[1];
  const amount = (fm.match(/^amount:\s*([\d.]+)/m) || [])[1];
  if (from) rec.from = from;
  if (to) rec.to = to;
  if (amount) rec.amount = Number(amount);
  return rec;
}

/* 加载 任务ID → publisher 映射 */
function loadPublishers() {
  const map = {};
  if (!fs.existsSync(TASKS_DIR)) return map;
  for (const t of fs.readdirSync(TASKS_DIR)) {
    const spec = path.join(TASKS_DIR, t, "spec.md");
    if (!fs.existsSync(spec)) continue;
    const body = fs.readFileSync(spec, "utf-8");
    const m = body.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const pub = (m[1].match(/^publisher:\s*(\S+)/m) || [])[1];
    if (pub) map[t] = pub;
  }
  return map;
}

/* 加载 agent 档案：{reputation_anchor, capabilities} | null */
function loadAgent(id) {
  const f = path.join(AGENTS_DIR, id, "agent.md");
  if (!fs.existsSync(f)) return null;
  const body = fs.readFileSync(f, "utf-8");
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  const repRaw = m ? (m[1].match(/^reputation_anchor:\s*([\d.]+)/m) || [])[1] : undefined;
  const capRaw = m ? (m[1].match(/^capabilities:\s*\[(.*?)\]/m) || [])[1] : undefined;
  return {
    reputation_anchor: repRaw !== undefined ? Number(repRaw) : null,
    capabilities: capRaw ? capRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
  };
}

/* 聚合协作对：只统计与目标 agent 相关的边（as_worker=被雇，as_publisher=我雇） */
function aggregate(pays, publishers, id) {
  const asWorker = {};   // employer -> {tasks, credits, last_task, lastSeq}
  const asPublisher = {}; // worker -> 同上
  let unlinked = 0;
  for (const rec of pays) {
    if (rec.kind !== "pay" || !rec.to || !rec.from) continue;
    const tm = rec.from.match(/^escrow-(.+)$/);
    if (!tm) { unlinked++; continue; }
    const taskId = tm[1];
    const employer = publishers[taskId];
    if (!employer) { unlinked++; continue; }
    const seq = rec.seq || 0;
    if (rec.to === id) {
      const w = asWorker[employer] || (asWorker[employer] = { tasks: 0, credits: 0, last_task: null, lastSeq: -1 });
      w.tasks++; w.credits += rec.amount || 0;
      if (seq > w.lastSeq) { w.lastSeq = seq; w.last_task = taskId; }
    }
    if (employer === id) {
      const p = asPublisher[rec.to] || (asPublisher[rec.to] = { tasks: 0, credits: 0, last_task: null, lastSeq: -1 });
      p.tasks++; p.credits += rec.amount || 0;
      if (seq > p.lastSeq) { p.lastSeq = seq; p.last_task = taskId; }
    }
  }
  return { asWorker, asPublisher, unlinked };
}

/* 确定性排序：tasks desc → credits desc → ID 字典序（ASCII） */
function toSortedList(map, key) {
  return Object.keys(map)
    .map(id => ({ [key]: id, tasks: map[id].tasks, credits: map[id].credits, last_task: map[id].last_task }))
    .sort((a, b) =>
      b.tasks - a.tasks ||
      b.credits - a.credits ||
      (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

function main() {
  const id = process.argv[2];
  if (!id || process.argv[3]) {
    console.error("usage: node tools/relations.js <AG-ID>");
    process.exit(2);
  }
  const agent = loadAgent(id);
  if (!agent) {
    console.error(`AG-ID 不存在: ${id}（agents/${id}/agent.md 未找到）`);
    process.exit(1);
  }

  /* 读 ledger（文件名序 = 时间序，零填充保证字典序=序号序） */
  const pays = [];
  let parseErrors = 0;
  if (fs.existsSync(LEDGER_DIR)) {
    const files = fs.readdirSync(LEDGER_DIR).filter(f => f.endsWith(".md")).sort();
    files.forEach((f, i) => {
      const rec = parseLedgerFile(path.join(LEDGER_DIR, f));
      if (!rec) { parseErrors++; return; }
      rec.seq = i; /* 用文件序号代替解析序号，保证 last_task 取最近 */
      pays.push(rec);
    });
  }
  const publishers = loadPublishers();
  const { asWorker, asPublisher, unlinked } = aggregate(pays, publishers, id);

  const out = {
    agent: id,
    reputation_anchor: agent.reputation_anchor,
    capabilities: agent.capabilities,
    as_worker: toSortedList(asWorker, "publisher"),
    as_publisher: toSortedList(asPublisher, "worker"),
  };
  if (parseErrors > 0) out.parse_errors = parseErrors;
  if (unlinked > 0) out.unlinked_escrows = unlinked;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main();
