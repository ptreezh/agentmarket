#!/usr/bin/env node
/* tests/penalty.test.js — 超时/押金惩罚 B2（PROTOCOL §5）
 * 测: penalty.js 对超时任务执行 forfeited 事件 + deposit_forfeit 账本 + 预算退回 + 退出码
 * 风格对齐 keepalive.test.js：node:assert + execSync + check + 临时夹具 + cleanup
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();
const PENALTY = path.join(ROOT, "tools", "penalty.js");
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function g(c, opts) { return execSync(c, Object.assign({ encoding: "utf-8", stdio: "pipe" }, opts || {})).trim(); }
function runPenalty(args, cwd) {
  try {
    const out = g(`node "${PENALTY}" ${args.join(" ")}`, { cwd });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() }; }
}

function makeTask(market, id, deadline, opts = {}) {
  const td = path.join(market, "tasks", id, "events");
  fs.mkdirSync(td, { recursive: true });
  const budget = opts.budget || 40;
  fs.writeFileSync(path.join(market, "tasks", id, "spec.md"),
    `---\nid: ${id}\ncomplexity: S\npublisher: ${opts.publisher || "AG-P01"}\nbudget: ${budget}\ndeadline: ${deadline}\n---\n`);
  if (opts.claimed) {
    fs.writeFileSync(path.join(td, `claimed-20260910T000000-${opts.claimed}.md`),
      `---\nevent: claimed\ntask: ${id}\nworker: ${opts.claimed}\nop_id: claimed-x\nts: 2026-09-10T00:00:00.000Z\n---\n${opts.claimed} 认领 ${id}\n`);
  }
  if (opts.submitted) {
    fs.writeFileSync(path.join(td, "submitted-x.md"),
      "---\nevent: submitted\ntask: " + id + "\nworker: " + (opts.claimed || "AG-X") + "\n---\nsubmitted\n");
  }
  if (opts.settled) {
    fs.writeFileSync(path.join(td, "settled-x.md"),
      "---\nevent: settled\ntask: " + id + "\nwinner: " + (opts.claimed || "AG-X") + "\n---\nsettled\n");
  }
}

console.log("penalty.test.js (B2 超时/押金惩罚)");
let fx = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), "ampen-"));
  const market = path.join(fx, "market");
  const bare = path.join(fx, "bare.git");
  fs.mkdirSync(market);
  for (const c of ["git init -q", "git -c user.email=t@t -c user.name=t commit -qm init --allow-empty",
    `git remote add origin "${bare}"`]) g(c, { cwd: market });
  g(`git init -q --bare "${bare}"`);
  g(`git push -q origin HEAD:main`, { cwd: market });

  /* T1: 超时 + 已认领 → 执行惩罚（exit 0 + 事件 + 账本 + 守恒） */
  makeTask(market, "T-9001", "2026-01-01T00:00:00Z", { claimed: "AG-W1" });
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm t1`]) g(c, { cwd: market });
  const r1 = runPenalty(["T-9001"], market);
  const ev1 = path.join(market, "tasks", "T-9001", "events");
  const hasForfeit = fs.readdirSync(ev1).some(f => f.startsWith("forfeited-"));
  const ledgers = fs.readdirSync(path.join(market, "ledger")).filter(f => /^L-/.test(f));
  let depositForfeit = null, refund = null;
  for (const f of ledgers) {
    const c = fs.readFileSync(path.join(market, "ledger", f), "utf-8");
    if (/kind: deposit_forfeit/.test(c)) depositForfeit = (c.match(/amount: ([\d.]+)/) || [])[1];
    if (/kind: refund/.test(c) && /预算退回/.test(c)) refund = (c.match(/amount: ([\d.]+)/) || [])[1];
  }
  check("T1 惩罚 exit 0", r1.code === 0, `code=${r1.code} out=${r1.out.slice(0, 100)}`);
  check("T1 forfeited 事件已写", hasForfeit, fs.readdirSync(ev1).join(","));
  check("T1 押金没收 = budget×5% (2)", depositForfeit === "2", `got=${depositForfeit}`);
  check("T1 预算退回 = budget (40)", refund === "40", `got=${refund}`);

  /* T2: 未超时 → 不惩罚 exit 1 */
  makeTask(market, "T-9002", "2099-01-01T00:00:00Z", { claimed: "AG-W2" });
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm t2`]) g(c, { cwd: market });
  const r2 = runPenalty(["T-9002"], market);
  check("T2 未超时 exit 1", r2.code === 1 && /未超时|deadline/.test(r2.out), `code=${r2.code} out=${r2.out.slice(0, 80)}`);

  /* T3: --force 可强制惩罚未超时任务 */
  const r3 = runPenalty(["T-9002", "--force"], market);
  const ev2 = path.join(market, "tasks", "T-9002", "events");
  check("T3 --force 强制惩罚 exit 0", r3.code === 0 && fs.readdirSync(ev2).some(f => f.startsWith("forfeited-")),
    `code=${r3.code} out=${r3.out.slice(0, 80)}`);

  /* T4: 已提交 → 不可惩罚 exit 1 */
  makeTask(market, "T-9003", "2026-01-01T00:00:00Z", { claimed: "AG-W3", submitted: true });
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm t4`]) g(c, { cwd: market });
  const r4 = runPenalty(["T-9003"], market);
  check("T4 已提交 exit 1", r4.code === 1 && /已提交/.test(r4.out), `code=${r4.code} out=${r4.out.slice(0, 80)}`);

  /* T5: 已结算 → 不可惩罚 exit 1 */
  makeTask(market, "T-9004", "2026-01-01T00:00:00Z", { claimed: "AG-W4", settled: true });
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm t5`]) g(c, { cwd: market });
  const r5 = runPenalty(["T-9004"], market);
  check("T5 已结算 exit 1", r5.code === 1 && /已结算/.test(r5.out), `code=${r5.code} out=${r5.out.slice(0, 80)}`);

  /* T6: 未认领 → 无需惩罚 exit 1 */
  makeTask(market, "T-9005", "2026-01-01T00:00:00Z");
  for (const c of ["git add -A", `git -c user.email=t@t -c user.name=t commit -qm t6`]) g(c, { cwd: market });
  const r6 = runPenalty(["T-9005"], market);
  check("T6 未认领 exit 1", r6.code === 1 && /未被认领/.test(r6.out), `code=${r6.code} out=${r6.out.slice(0, 80)}`);

  /* T7: 重复惩罚 → exit 1 */
  const r7 = runPenalty(["T-9001"], market);
  check("T7 已惩罚过 exit 1", r7.code === 1 && /已惩罚/.test(r7.out), `code=${r7.code} out=${r7.out.slice(0, 80)}`);

  /* T8: 惩罚后任务被 push（bare main 含 forfeited 事件） */
  let remoteHas = "";
  try { remoteHas = g(`git ls-tree -r --name-only origin/main tasks/T-9001/events`, { cwd: market }); } catch {}
  check("T8 forfeited 事件已推远端", /forfeited-/.test(remoteHas), remoteHas.slice(0, 80));

  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { if (fx) fs.rmSync(fx, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
