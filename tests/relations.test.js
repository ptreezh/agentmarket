#!/usr/bin/env node
/* tests/relations.test.js — D-124 协作关系只读工具 TDD（SPEC-RELATIONS-20260909）
 * 流程：临时夹具市场 → 运行 node tools/relations.js → 断言 stdout JSON
 * 风格对齐 keepalive.test.js：node:assert + execSync + check 函数 + cleanup
 */
"use strict";
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const TOOL = path.join(process.cwd(), "tools", "relations.js");
let passed = 0, failed = 0, tmpDir = null;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} — ${detail}`); }
}

/* 夹具：迷你市场 */
function makeMarket() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "amrel-"));
  const T = (id, pub) => {
    fs.mkdirSync(path.join(d, "tasks", id), { recursive: true });
    fs.writeFileSync(path.join(d, "tasks", id, "spec.md"),
      `---\nid: ${id}\ncomplexity: S\npublisher: ${pub}\n---\n`);
  };
  T("T-1000", "AG-P01"); T("T-2000", "AG-P01"); T("T-3000", "AG-Q02");
  const L = (name, body) => fs.writeFileSync(path.join(d, "ledger", name), body);
  fs.mkdirSync(path.join(d, "ledger"));
  const pay = (from, to, amount) =>
    `---\nseq: 1\nts: 2026-09-05T00:00:00Z\nkind: pay\namount: ${amount}\nfrom: ${from}\nto: ${to}\nnote: x\nsig: ed25519:aaa\n---\n`;
  L("L-0001.md", pay("escrow-T-1000", "AG-07", 34));
  L("L-0002.md", pay("escrow-T-2000", "AG-07", 40));
  L("L-0003.md", pay("escrow-T-3000", "AG-07", 20));
  L("L-0004.md", pay("escrow-T-1000", "AG-13", 10));
  L("L-0005.md", "---\nkind: broken\nno closing\n");
  const A = (id, rep) => {
    fs.mkdirSync(path.join(d, "agents", id), { recursive: true });
    const cap = id === "AG-07" ? "capabilities: [code, data]\n" : "";
    fs.writeFileSync(path.join(d, "agents", id, "agent.md"),
      `---\nid: ${id}\n${cap}${rep !== null ? `reputation_anchor: ${rep}\n` : ""}---\n`);
  };
  A("AG-07", 92.4); A("AG-P01", 88); A("AG-13", null); A("AG-NEW", null);
  return d;
}
function run(args, cwd) {
  try {
    const out = execSync(`node "${TOOL}" ${args.join(" ")}`, { cwd, encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")).trim() };
  }
}

console.log("D-124 relations.test.js (SPEC-RELATIONS-20260909)");
try {
  /* T1: 无参数 → exit 2 + 用法 */
  {
    tmpDir = makeMarket();
    const r = run([], tmpDir);
    check("T1 无参数 exit 2", r.code === 2, `code=${r.code}`);
    check("T1 用法提示", /usage|用法/i.test(r.out), r.out.slice(0, 80));
  }
  /* T2: 不存在 AG-ID → exit 1 */
  {
    const r = run(["AG-NOPE"], tmpDir);
    check("T2 不存在 exit 1", r.code === 1, `code=${r.code}`);
    check("T2 报错", /不存在|not found/i.test(r.out), r.out.slice(0, 80));
  }
  /* T3: AG-07 as_worker（谁雇我，2 个雇主，排序 次数→金额） */
  {
    const r = run(["AG-07"], tmpDir);
    const j = JSON.parse(r.out);
    check("T3 exit 0", r.code === 0, `code=${r.code}`);
    check("T3 as_worker 长度 2", j.as_worker.length === 2, `len=${j.as_worker.length}`);
    check("T3 排序 AG-P01 在前", j.as_worker[0].publisher === "AG-P01" && j.as_worker[0].tasks === 2,
      JSON.stringify(j.as_worker[0]));
    check("T3 金额 34+40=74", j.as_worker[0].credits === 74, `credits=${j.as_worker[0].credits}`);
    check("T3 last_task T-2000", j.as_worker[0].last_task === "T-2000", j.as_worker[0].last_task);
    check("T3 第二雇主 AG-Q02 credits 20", j.as_worker[1].publisher === "AG-Q02" && j.as_worker[1].credits === 20,
      JSON.stringify(j.as_worker[1]));
  }
  /* T4: AG-P01 as_publisher（我雇谁） */
  {
    const r = run(["AG-P01"], tmpDir);
    const j = JSON.parse(r.out);
    check("T4 as_publisher 长度 2", j.as_publisher.length === 2, `len=${j.as_publisher.length}`);
    check("T4 worker AG-07 在前 credits 74", j.as_publisher[0].worker === "AG-07" && j.as_publisher[0].credits === 74,
      JSON.stringify(j.as_publisher[0]));
    check("T4 as_worker 空", j.as_worker.length === 0, `len=${j.as_worker.length}`);
  }
  /* T5: 无记录 agent → 空数组 exit 0 */
  {
    const r = run(["AG-NEW"], tmpDir);
    const j = JSON.parse(r.out);
    check("T5 exit 0", r.code === 0, `code=${r.code}`);
    check("T5 双空数组", j.as_worker.length === 0 && j.as_publisher.length === 0, "非空");
  }
  /* T6: 声誉并入 */
  {
    const r = run(["AG-07"], tmpDir);
    const j = JSON.parse(r.out);
    check("T6 reputation 92.4", j.reputation_anchor === 92.4, `rep=${j.reputation_anchor}`);
    check("T6 capabilities [code,data]", JSON.stringify(j.capabilities) === JSON.stringify(["code", "data"]),
      JSON.stringify(j.capabilities));
  }
  /* T7: 确定性（两次运行字节一致） */
  {
    const a = run(["AG-07"], tmpDir).out;
    const b = run(["AG-07"], tmpDir).out;
    check("T7 字节一致", a === b, "两次输出不同");
  }
  /* T8: 畸形 ledger 跳过 + parse_errors */
  {
    const j = JSON.parse(run(["AG-07"], tmpDir).out);
    check("T8 parse_errors ≥1", (j.parse_errors || 0) >= 1, `parse_errors=${j.parse_errors}`);
    check("T8 正常条目仍解析", j.as_worker.length === 2, `len=${j.as_worker.length}`);
  }
  /* T9: 多雇主排序（次数→金额→ID 字典序）——再造一个同次数雇主 */
  {
    fs.mkdirSync(path.join(tmpDir, "tasks", "T-4000"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "tasks", "T-4000", "spec.md"),
      "---\nid: T-4000\ncomplexity: S\npublisher: AG-ZZ9\n---\n");
    fs.appendFileSync(path.join(tmpDir, "ledger", "L-0006.md"),
      "---\nseq: 1\nts: 2026-09-05T00:00:00Z\nkind: pay\namount: 5\nfrom: escrow-T-4000\nto: AG-07\nnote: x\nsig: ed25519:aaa\n---\n");
    const j = JSON.parse(run(["AG-07"], tmpDir).out);
    // AG-Q02 与 AG-ZZ9 各 1 次：金额 20 > 5 → AG-Q02 在前
    check("T9 同次数按金额排", j.as_worker[1].publisher === "AG-Q02" && j.as_worker[2].publisher === "AG-ZZ9",
      JSON.stringify(j.as_worker.map(w => w.publisher)));
  }
  console.log(`\n结果: ${failed === 0 ? "全部通过 ✅" : failed + " 个失败 ❌"} (${passed}✅/${failed}❌)`);
} finally {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
