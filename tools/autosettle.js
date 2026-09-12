#!/usr/bin/env node
/* autosettle.js — 验证超时自动结算 + 死任务清理 + 发布者押金（SPEC-AUTOSETTLE-20260912）
 * 用法:
 *   node tools/autosettle.js scan [--task T-XXXX]          dry-run 报告，不写盘
 *   node tools/autosettle.js run  [--task T-XXXX]          执行全部到期动作（提醒→裁决→清理）
 *   node tools/autosettle.js archive T-XXXX                归档占位/遗留任务（写 forfeited 事件）
 * 动作:
 *   G1 submitted 超 review_window 未手动 review → verify: PASS→settle(+pubdep没收) / FAIL→failed(+押金没收+预算退回)
 *   G2 submitted 超 reminder_at 未 review 且未提醒 → review-reminder 事件（一次）
 *   G3 open 超 deadline+cleanup_window → expired+预算退回；claimed 超 deadline+submit_grace → penalty.js
 *   G4 发布押金 pub_escrow 在手动 review 时返还、auto 时没收（有托管才动账，防空扣）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const ledger = require("./ledger.js");

const ROOT = process.cwd();
const ARGV = process.argv.slice(2);
const CMD = ARGV[0] || "scan";
const TASK = ARGV.includes("--task") ? ARGV[ARGV.indexOf("--task") + 1] : null;
const REMOTE = ARGV.includes("--remote") ? ARGV[ARGV.indexOf("--remote") + 1] : "origin";
const allowUnsigned = ARGV.includes("--allow-unsigned");

let CFG = { review_window_h: 72, cleanup_window_d: 7, submit_grace_h: 72, reminder_at_h: 36, pub_deposit_rate: 0.05 };
try {
  const mc = JSON.parse(fs.readFileSync(path.join(ROOT, "market-config.json"), "utf-8"));
  CFG = Object.assign(CFG, mc.autosettle || {});
} catch (e) {}

const g = c => execSync(c, { encoding: "utf-8", stdio: "pipe", cwd: ROOT }).trim();
const H = 3600 * 1000, D = 24 * H;

function findTaskDir(id) {
  const flat = path.join(ROOT, "tasks", id);
  if (fs.existsSync(path.join(flat, "spec.md"))) return flat;
  const sharded = path.join(ROOT, "tasks", id.slice(0, 4), id);
  if (fs.existsSync(path.join(sharded, "spec.md"))) return sharded;
  return null;
}
function listTasks() {
  const td = path.join(ROOT, "tasks");
  if (!fs.existsSync(td)) return [];
  return fs.readdirSync(td).filter(f => fs.existsSync(path.join(td, f, "spec.md")));
}
function parseSpec(taskDir) {
  const content = fs.readFileSync(path.join(taskDir, "spec.md"), "utf-8");
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const spec = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
      else if (v === "true") v = true;
      else if (v === "false") v = false;
      spec[kv[1]] = v;
    }
  }
  return spec;
}
function eventsDir(taskDir) { return path.join(taskDir, "events"); }
function listEvents(taskDir) {
  const d = eventsDir(taskDir);
  return fs.existsSync(d) ? fs.readdirSync(d) : [];
}
// 兼容 ts: 20260905T053113 与 ISO
function parseTs(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{8}T\d{6}/.test(s)) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), dd = +s.slice(6, 8);
    const h = +s.slice(9, 11), mi = +s.slice(11, 13), se = +s.slice(13, 15);
    return new Date(Date.UTC(y, mo - 1, dd, h, mi, se));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function eventTs(fname) {
  // 优先紧凑时间戳 submitted-20260905T053113.md；回退 ISO / unix 毫秒
  const m1 = fname.match(/(\d{8}T\d{6})/);
  if (m1) return parseTs(m1[1]);
  const m2 = fname.match(/(\d{4}-\d{2}-\d{2}[T_][\d:.]+Z?)/);
  if (m2) return parseTs(m2[1].replace(/_/g, "T"));
  const m3 = fname.match(/(\d{13})/);
  if (m3) { const d = new Date(Number(m3[1])); return isNaN(d.getTime()) ? null : d; }
  return null;
}
function eventTsFromFile(taskDir, fname) {
  const ts = eventTs(fname);
  if (ts) return ts;
  try {
    const c = fs.readFileSync(path.join(eventsDir(taskDir), fname), "utf-8");
    const m = c.match(/^ts:\s*(\S+)/m);
    if (m) return parseTs(m[1]);
  } catch (e) {}
  return null;
}
function statusOf(spec, events, taskDir) {
  if (events.some(f => f.startsWith("settled-"))) return "completed";
  if (events.some(f => f.startsWith("forfeited-"))) return "failed";
  const vf = events.filter(f => f.startsWith("verified-")).sort().pop();
  if (vf) {
    const vrPath = path.join(taskDir, "result", "verify-result.json");
    if (fs.existsSync(vrPath)) {
      try { return JSON.parse(fs.readFileSync(vrPath, "utf-8")).verdict === "PASS" ? "verified" : "failed"; } catch (e) {}
    }
    return "verified";
  }
  if (events.some(f => f.startsWith("submitted-"))) return "submitted";
  if (events.some(f => f.startsWith("claimed-"))) return "in_progress";
  if (spec.deadline) {
    const dl = parseTs(spec.deadline);
    if (dl && dl < new Date()) return "expired";
  }
  return "open";
}
function latestTs(taskDir, events, prefix) {
  const fs_ = events.filter(f => f.startsWith(prefix)).sort();
  if (!fs_.length) return null;
  return eventTsFromFile(taskDir, fs_[fs_.length - 1]);
}
function opPrivPath() { return path.join(ROOT, "keys", "operator", "private.pem"); }
function signOperator(body) {
  const p = opPrivPath();
  if (!fs.existsSync(p)) return { sig: "", fp: "" };
  const privPem = fs.readFileSync(p, "utf-8");
  const sigHex = crypto.sign(null, Buffer.from(body, "utf-8"), crypto.createPrivateKey(privPem)).toString("hex");
  let fp = "";
  const opPub = path.join(ROOT, "OPERATOR_PUBKEY");
  if (fs.existsSync(opPub)) {
    try {
      const pub = fs.readFileSync(opPub, "utf-8");
      fp = "SHA256:" + crypto.createHash("sha256").update(crypto.createPublicKey(pub).export({ type: "spki", format: "der" })).digest("base64");
    } catch (e) {}
  }
  return { sig: sigHex, fp };
}
function writeEvent(taskDir, fileName, fmLines, body) {
  const d = eventsDir(taskDir);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, fileName);
  fs.writeFileSync(p, `---\n${fmLines.join("\n")}\n---\n${body}\n`);
  return p;
}
// 账本扫描：是否存在指定 from→to 的托管/转账记录
function ledgerHas(fn) {
  const ld = path.join(ROOT, "ledger");
  if (!fs.existsSync(ld)) return false;
  for (const f of fs.readdirSync(ld)) {
    if (!/^L-\d{4}\.md$/.test(f)) continue;
    const c = fs.readFileSync(path.join(ld, f), "utf-8");
    if (fn(c)) return true;
  }
  return false;
}
function escrowFunded(taskId) {
  return ledgerHas(c => /^kind:\s*escrow/m.test(c) && new RegExp("^to:\\s*escrow-" + taskId + "\\s*$", "m").test(c));
}
function pubDepFunded(taskId) {
  return ledgerHas(c => /^kind:\s*pub_escrow/m.test(c) && new RegExp("^to:\\s*escrow-" + taskId + "-pubdep\\s*$", "m").test(c));
}
function depositFunded(taskId) {
  return ledgerHas(c => new RegExp("^to:\\s*escrow-" + taskId + "-deposit\\s*$", "m").test(c));
}
function commitPush(msg) {
  try { g(`git add tasks/ ledger/ && git commit -q -m "${msg}"`); } catch (e) { console.warn("  [warn] commit: " + e.message); }
  try { g(`git push ${REMOTE} HEAD:main`); } catch (e) { console.warn("  [warn] push: " + e.message); }
}
function nowTag() { return new Date().toISOString().replace(/[:.]/g, ""); }

// ---------- 动作 ----------
function actReminder(taskId, taskDir, submittedTs) {
  const f = `review-reminder-${nowTag()}.md`;
  writeEvent(taskDir, f,
    ["event: review-reminder", `task: ${taskId}`, `submitted_at: ${submittedTs}`, `note: publisher review window ${CFG.review_window_h}h — please review task ${taskId}`],
    `${taskId} 已提交待核验，请发布者在 ${CFG.review_window_h}h 窗口内 review，逾期自动结算。`);
  commitPush(`autosettle: ${taskId} review-reminder`);
  console.log(`  📨 ${taskId}: review-reminder 已发送`);
}

function actAutoReview(taskId, taskDir, spec) {
  const budget = spec.budget || 40;
  const publisher = spec.publisher || "unknown";
  // 1. 跑 verify（若尚无结果）
  const vrPath = path.join(taskDir, "result", "verify-result.json");
  if (!fs.existsSync(vrPath)) {
    try { execSync(`node tools/verify.js "${taskDir}"`, { encoding: "utf-8", stdio: "pipe", cwd: ROOT }); }
    catch (e) { /* exit!=0 → FAIL */ }
  }
  let verdict = "FAIL";
  if (fs.existsSync(vrPath)) {
    try { verdict = JSON.parse(fs.readFileSync(vrPath, "utf-8")).verdict === "PASS" ? "PASS" : "FAIL"; } catch (e) {}
  }
  const { sig, fp } = signOperator(`auto-review ${taskId} ${verdict}`);
  const opNote = `自动核验 ${taskId}: ${verdict}（发布者 ${CFG.review_window_h}h 未 review）`;
  const eSigLine = fp ? `signer: ${fp}\nsignature: ${sig}` : "signature: (unsigned)";

  if (verdict === "PASS") {
    // 预算托管检查（防空 escrow 结算）
    if (!escrowFunded(taskId)) {
      console.warn(`  ⚠️ ${taskId}: 无预算托管记录（escrow-${taskId}），跳过自动结算，需人工补记托管`);
      return { skipped: true };
    }
    // 写 auto-settled 记录
    writeEvent(taskDir, `auto-settled-${nowTag()}.md`,
      ["event: auto-settled", `task: ${taskId}`, `trigger: review_window_expired`, `note: ${opNote}`, eSigLine], opNote);
    commitPush(`autosettle: ${taskId} auto-settled`);
    // 结算
    try {
      execSync(`node tools/settle.js "${taskId}"`, { encoding: "utf-8", stdio: "pipe", cwd: ROOT });
    } catch (e) { console.warn(`  [warn] settle ${taskId}: ${e.message}`); }
    // 发布押金没收（G4：有托管才动账）
    if (pubDepFunded(taskId)) {
      const amt = Math.round(budget * (CFG.pub_deposit_rate || 0.05) * 100) / 100;
      ledger.writeEntry({ kind: "pub_deposit_forfeit", amount: amt, from: `escrow-${taskId}-pubdep`, to: "TAXSINK",
        note: `任务 ${taskId} 发布者未在 ${CFG.review_window_h}h 内 review，发布押金没收`, signer: "operator", privKeyPath: opPrivPath() });
      commitPush(`autosettle: ${taskId} pub_deposit_forfeit ${amt}`);
      console.log(`  💰 ${taskId}: 发布押金没收 ${amt} → TAXSINK`);
    } else {
      console.log(`  ℹ️ ${taskId}: 无发布押金托管（存量任务不追溯）`);
    }
    console.log(`  ✅ ${taskId}: 自动结算完成（PASS）`);
    return { ok: true, verdict: "PASS" };
  }

  // FAIL
  writeEvent(taskDir, `auto-failed-${nowTag()}.md`,
    ["event: auto-failed", `task: ${taskId}`, `trigger: review_window_expired`, `note: ${opNote}`, eSigLine], opNote);
  // worker 押金没收（有托管才动账）
  if (depositFunded(taskId)) {
    const dep = Math.round(budget * 0.05 * 100) / 100;
    ledger.writeEntry({ kind: "deposit_forfeit", amount: dep, from: `escrow-${taskId}-deposit`, to: "TAXSINK",
      note: `任务 ${taskId} 自动核验 FAIL，Worker 押金没收`, signer: "operator", privKeyPath: opPrivPath() });
  } else {
    console.log(`  ℹ️ ${taskId}: 无 Worker 押金托管（试水豁免/存量），跳过没收`);
  }
  // 预算退回（有托管才动账）
  if (escrowFunded(taskId)) {
    ledger.writeEntry({ kind: "refund", amount: budget, from: `escrow-${taskId}`, to: publisher,
      note: `任务 ${taskId} 自动核验 FAIL，预算退回发布者`, signer: "operator", privKeyPath: opPrivPath() });
  }
  // 发布押金没收
  if (pubDepFunded(taskId)) {
    const amt = Math.round(budget * (CFG.pub_deposit_rate || 0.05) * 100) / 100;
    ledger.writeEntry({ kind: "pub_deposit_forfeit", amount: amt, from: `escrow-${taskId}-pubdep`, to: "TAXSINK",
      note: `任务 ${taskId} 发布者未 review 且结果 FAIL，发布押金没收`, signer: "operator", privKeyPath: opPrivPath() });
  }
  commitPush(`autosettle: ${taskId} auto-failed`);
  console.log(`  ❌ ${taskId}: 自动核验 FAIL → failed（押金没收/预算退回按托管情况）`);
  return { ok: true, verdict: "FAIL" };
}

function actExpire(taskId, taskDir, spec) {
  const budget = spec.budget || 40;
  const publisher = spec.publisher || "unknown";
  const { sig, fp } = signOperator(`expire ${taskId}`);
  const note = `${taskId} 超 ${CFG.cleanup_window_d}d 无人认领，归档为 expired`;
  const eSigLine = fp ? `signer: ${fp}\nsignature: ${sig}` : "signature: (unsigned)";
  writeEvent(taskDir, `expired-${nowTag()}.md`,
    ["event: expired", `task: ${taskId}`, `trigger: cleanup_window`, `note: ${note}`, eSigLine], note);
  if (escrowFunded(taskId)) {
    ledger.writeEntry({ kind: "refund", amount: budget, from: `escrow-${taskId}`, to: publisher,
      note: `任务 ${taskId} 过期清理，预算退回发布者`, signer: "operator", privKeyPath: opPrivPath() });
  } else {
    console.log(`  ℹ️ ${taskId}: 无预算托管（存量），仅归档`);
  }
  commitPush(`autosettle: ${taskId} expired`);
  console.log(`  🗑️ ${taskId}: 过期清理完成`);
}

function actPenalty(taskId) {
  try {
    execSync(`node tools/penalty.js "${taskId}"`, { encoding: "utf-8", stdio: "pipe", cwd: ROOT });
    console.log(`  ⚖️ ${taskId}: 弃单惩罚执行`);
  } catch (e) { console.warn(`  ⚠️ ${taskId}: penalty 未执行：${e.message}`); }
}

function actArchive(taskId) {
  const taskDir = findTaskDir(taskId);
  if (!taskDir) { console.error(`任务不存在: ${taskId}`); process.exit(2); }
  const { sig, fp } = signOperator(`archive ${taskId}`);
  const note = `${taskId} 占位/遗留任务归档（manual）`;
  const eSigLine = fp ? `signer: ${fp}\nsignature: ${sig}` : "signature: (unsigned)";
  writeEvent(taskDir, `forfeited-${nowTag()}.md`,
    ["event: forfeited", `task: ${taskId}`, `trigger: manual_archive`, `note: ${note}`, eSigLine], note);
  commitPush(`autosettle: ${taskId} archived`);
  console.log(`  🗂️ ${taskId}: 已归档（failed）`);
}

// ---------- 扫描/执行 ----------
function analyze(taskId) {
  const taskDir = findTaskDir(taskId);
  if (!taskDir) return null;
  const spec = parseSpec(taskDir);
  const events = listEvents(taskDir);
  const status = statusOf(spec, events, taskDir);
  const r = { id: taskId, dir: taskDir, spec, events, status };
  if (status === "submitted") {
    const submittedTs = latestTs(taskDir, events, "submitted-");
    const now = new Date();
    r.submitted_ts = submittedTs ? submittedTs.toISOString() : null;
    r.over_reminder = submittedTs && (now - submittedTs) >= CFG.reminder_at_h * H && !events.some(f => f.startsWith("review-reminder-"));
    r.over_window = submittedTs && (now - submittedTs) >= CFG.review_window_h * H;
    r.escrow_funded = escrowFunded(taskId);
  }
  if (status === "open" && spec.deadline) {
    const dl = parseTs(spec.deadline);
    r.over_cleanup = dl && (new Date() - dl) >= CFG.cleanup_window_d * D;
  }
  if (status === "in_progress" && spec.deadline) {
    const dl = parseTs(spec.deadline);
    r.over_submit_grace = dl && (new Date() - dl) >= CFG.submit_grace_h * H;
  }
  return r;
}

function main() {
  const ids = TASK ? [TASK] : listTasks();
  const rows = ids.map(analyze).filter(Boolean);
  if (CMD === "scan") {
    console.log(`autosettle scan（dry-run，不写盘） · 配置: review_window=${CFG.review_window_h}h reminder=${CFG.reminder_at_h}h cleanup=${CFG.cleanup_window_d}d submit_grace=${CFG.submit_grace_h}h pub_deposit=${CFG.pub_deposit_rate}`);
    console.log("─".repeat(78));
    for (const r of rows) {
      let act = [];
      if (r.status === "submitted") {
        if (r.over_reminder) act.push("reminder");
        if (r.over_window) act.push("AUTO-REVIEW");
        if (!r.escrow_funded && r.over_window) act.push("⚠️无预算托管→skip");
      }
      if (r.status === "open" && r.over_cleanup) act.push("EXPIRE");
      if (r.status === "in_progress" && r.over_submit_grace) act.push("PENALTY");
      console.log(`  ${r.id.padEnd(9)} ${r.status.padEnd(11)} ${act.length ? act.join(",") : "-"}`);
    }
    const c = rows.filter(r => r.status === "submitted").length;
    console.log("─".repeat(78));
    console.log(`共 ${rows.length} 任务；submitted ${c} 个。超窗将自动结算的见 AUTO-REVIEW 标记。`);
    return;
  }
  if (CMD === "archive") {
    if (!TASK && ARGV[1]) { actArchive(ARGV[1]); return; }
    console.error("usage: autosettle archive <T-XXXX>"); process.exit(2);
  }
  if (CMD === "run") {
    console.log(`autosettle run · ${TASK ? "task=" + TASK : "全部任务"}`);
    console.log("─".repeat(78));
    for (const r of rows) {
      if (r.status === "submitted") {
        if (r.over_reminder) actReminder(r.id, r.dir, r.submitted_ts);
        if (r.over_window) actAutoReview(r.id, r.dir, r.spec);
      } else if (r.status === "open" && r.over_cleanup) {
        actExpire(r.id, r.dir, r.spec);
      } else if (r.status === "in_progress" && r.over_submit_grace) {
        actPenalty(r.id);
      }
    }
    console.log("─".repeat(78));
    console.log("run 完成。");
    return;
  }
  console.error(`未知命令: ${CMD}（scan | run | archive）`); process.exit(2);
}

main();
