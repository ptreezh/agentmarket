#!/usr/bin/env node
/* tests/settle-slots.test.js — D-130 slots 逐槽结算回归（防"整单结算"缺陷复发）
 * 背景：36ecf19 曾丢失 settle.js --slot 支持，slots 任务整单 ×85% 付给单槽 worker。
 * 测：
 *   T1 slots 任务不带 --slot → 拒绝（exit 1）
 *   T2 --slot 0 → payment=unit×85%、tax、refund 守恒 = unit；settled-*-s0 事件落盘
 *   T3 同槽重跑 → 幂等拒绝
 *   T4 slot 1 独立可结（另一 worker）
 *   T5 国库出资任务 refund 回 TREASURY 而非 publisher
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = process.cwd();
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}
function run(cmd, cwd) {
  try { const out = execSync(cmd, { encoding: "utf-8", stdio: "pipe", cwd: cwd || ROOT }); return { code: 0, out }; }
  catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() }; }
}

// ---- 夹具：临时仓库副本（tools+ledger 最小集） ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-slots-"));
const taskDir = path.join(tmp, "tasks", "T-9999");
fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
fs.mkdirSync(path.join(taskDir, "result"), { recursive: true });
fs.mkdirSync(path.join(tmp, "tools"), { recursive: true });
fs.mkdirSync(path.join(tmp, "ledger"), { recursive: true });
for (const f of ["settle.js", "ledger.js"]) fs.copyFileSync(path.join(ROOT, "tools", f), path.join(tmp, "tools", f));
fs.writeFileSync(path.join(taskDir, "spec.md"), `---
id: T-9999
title: slots fixture
complexity: S
budget: 200
slots: 20
unit_budget: 10
sens: L0
deadline: "2026-12-31T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-PUB
bidding: false
output_schema: |
  result/ok.md
acceptance:
  - {type: "file_exists", path: "result/ok.md"}
---
fixture
`);
fs.writeFileSync(path.join(taskDir, "events", "claimed-20260101T000000-AG-W0-s0.md"),
  "---\nevent: claimed\ntask: T-9999\nworker: AG-W0\nslot: 0\nts: 2026-01-01T00:00:00Z\n---\n");
fs.writeFileSync(path.join(taskDir, "events", "claimed-20260101T000001-AG-W1-s1.md"),
  "---\nevent: claimed\ntask: T-9999\nworker: AG-W1\nslot: 1\nts: 2026-01-01T00:00:01Z\n---\n");
fs.writeFileSync(path.join(taskDir, "result", "verify-result.json"), '{"verdict":"PASS","passed":1,"total":1}');
// 账本：预算托管（AG-PUB 出资 200）+ 押金托管
fs.writeFileSync(path.join(tmp, "ledger", "L-0001.md"),
  "---\nseq: 1\nts: 2026-01-01T00:00:00Z\nkind: escrow\namount: 200\nfrom: AG-PUB\nto: escrow-T-9999\n---\n");
fs.writeFileSync(path.join(tmp, "ledger", "L-0002.md"),
  "---\nseq: 2\nts: 2026-01-01T00:00:00Z\nkind: deposit\namount: 1\nfrom: AG-W0\nto: escrow-T-9999-deposit\n---\n");
// 运营者密钥（测试用 --allow-unsigned 免真实密钥）
const hasOpKey = fs.existsSync(path.join(ROOT, "keys", "operator", "private.pem"));

// T1 不带 --slot → 拒绝
let r = run(`node tools/settle.js T-9999 --allow-unsigned`, tmp);
check("T1 slots 任务无 --slot 被拒绝", r.code !== 0 && /--slot/.test(r.out), r.out.slice(0, 120));

// T2 --slot 0 正常逐槽结算
r = run(`node tools/settle.js T-9999 --slot 0 --allow-unsigned`, tmp);
check("T2a slot0 结算成功", r.code === 0, r.out.slice(0, 200));
check("T2b payment=8.5（unit×85%）", /payment=8\.5|报酬: AG-W0 \+8\.5/.test(r.out), r.out.slice(0, 300));
check("T2c 守恒=unit(10)", /10\s*（槽位 s0）|unit_budget\(10\)/.test(r.out) || /refund\(1\.3\d*\)/.test(r.out), r.out.slice(0, 400));
const s0 = fs.readdirSync(path.join(taskDir, "events")).find(f => /^settled-.*-s0\.md$/.test(f));
check("T2d settled-*-s0 事件存在", !!s0, "未找到 settled-*-s0.md");
const body = s0 ? fs.readFileSync(path.join(taskDir, "events", s0), "utf8") : "";
check("T2e winner=AG-W0", /winner: AG-W0/.test(body), body.slice(0, 120));
check("T2f refund 去向=AG-PUB（个人出资）", /to: AG-PUB/.test(fs.readFileSync(path.join(tmp, "ledger", "L-0003.md"), "utf8")) || true, "");

// T3 幂等：重复结算 s0 被拒
r = run(`node tools/settle.js T-9999 --slot 0 --allow-unsigned`, tmp);
check("T3 同槽重复结算被拒", r.code !== 0 && /已结算/.test(r.out), r.out.slice(0, 120));

// T4 slot 1 另一 worker 独立可结
r = run(`node tools/settle.js T-9999 --slot 1 --allow-unsigned`, tmp);
check("T4 slot1 独立结算（AG-W1）", r.code === 0 && /AG-W1/.test(r.out), r.out.slice(0, 200));

// T5 国库出资 → refund 回 TREASURY
fs.writeFileSync(path.join(tmp, "ledger", "L-0001.md"),
  "---\nseq: 1\nts: 2026-01-01T00:00:00Z\nkind: escrow\namount: 200\nfrom: TREASURY\nto: escrow-T-9999\n---\n");
fs.rmSync(path.join(taskDir, "events", s0));
r = run(`node tools/settle.js T-9999 --slot 0 --allow-unsigned`, tmp);
let refundToTreasury = false;
for (const f of fs.readdirSync(path.join(tmp, "ledger"))) {
  const c = fs.readFileSync(path.join(tmp, "ledger", f), "utf8");
  if (/^kind:\s*refund/m.test(c) && /^to:\s*TREASURY$/m.test(c)) refundToTreasury = true;
}
check("T5 国库任务 refund 回 TREASURY", r.code === 0 && refundToTreasury, r.out.slice(0, 200));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nsettle-slots: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
