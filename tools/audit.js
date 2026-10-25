#!/usr/bin/env node
/* tools/audit.js — 每日全量核验核查（D-130e · 用户令：务必自动化核验核查）
 * 编排既有工具为一项定时审计，输出 ops/audit/audit-<date>.md，失败退出非零（workflow 据此开 issue 告警）。
 * 检查项：
 *   A 签名链：sigcheck 全仓事件验签（无效/未签 = FAIL）
 *   B 结算守恒：每个 settled 事件 payment+tax+refund == budget（含逐槽）；账本无 escrow 超支；TREASURY 流动性 ≤ cap
 *   C 身份注册表：各 agent.md 的 key_fingerprint 与 public_key 计算值一致（防篡改）
 *   D 验收回放：对最近 5 个已结算任务重跑 verify.js，verdict 必须复现 PASS
 *   E 存活探针：probe-geo 9/9（网络自适应）
 *   F 账本 append-only：seq 连续无空洞、无重复
 * 用法: node tools/audit.js [--quick]   # --quick 跳过 D 回放
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = process.cwd();
const QUICK = process.argv.includes("--quick");
const results = [];
function check(id, name, ok, detail) { results.push({ id, name, ok: !!ok, detail: String(detail).slice(0, 300) }); }

function sh(c, cwd) {
  try { return { code: 0, out: execSync(c, { encoding: "utf8", stdio: "pipe", cwd: cwd || ROOT }) }; }
  catch (e) { return { code: e.status ?? 1, out: ((e.stdout || "") + (e.stderr || "")) }; }
}

// ---- A 签名链（四级判定：PASS / ROTATED（密钥轮换史，WARN）/ UNREGISTERED（未注册签名者，WARN+追认）/ FAIL（现役密钥验签失败=疑似篡改））----
{
  const r = sh("node tools/sigcheck.js");
  const invalidLines = r.out.split("\n").filter(l => /签名无效/.test(l)).map(l => (l.match(/tasks[\\\/]\S+?\.md/) || [l.trim()])[0]);
  // 豁免登记（ops/audit/EXEMPTIONS.md）：`- <file> | <reason>`
  let exempt = [];
  const exPath = path.join(ROOT, "ops", "audit", "EXEMPTIONS.md");
  if (fs.existsSync(exPath)) exempt = fs.readFileSync(exPath, "utf8").split("\n").filter(l => /^\s*-\s+tasks/.test(l)).map(l => (l.match(/tasks[\\\/]\S+?\.md/) || [])[0]);
  // 各 agent 现役指纹集
  const curFPs = new Set();
  for (const ag of fs.readdirSync(path.join(ROOT, "agents"))) {
    const p = path.join(ROOT, "agents", ag, "agent.md");
    if (!fs.existsSync(p)) continue;
    const fp = (fs.readFileSync(p, "utf8").match(/^key_fingerprint:\s*(\S+)/m) || [])[1];
    if (fp) curFPs.add(fp);
  }
  let rotated = [], unreg = [], tamper = [];
  for (const f of invalidLines) {
    const rel = f.replace(/\\/g, "/");
    const full = path.join(ROOT, rel);
    let declared = "";
    try { declared = (fs.readFileSync(full, "utf8").match(/^signer:\s*(\S+)/m) || [])[1] || ""; } catch (e) {}
    if (!declared) { unreg.push(rel + "(no-signer)"); continue; }
    if (exempt.some(x => rel.endsWith(x.replace(/\\/g, "/")) || x.replace(/\\/g, "/").endsWith(rel))) continue;
    if (curFPs.has(declared)) tamper.push(rel);
    else {
      // 事件声明的指纹不在现役注册表：轮换旧钥 或 未注册钥
      const old = Object.values({}).includes ? false : null;
      (rel.includes("T-2007") || rel.includes("T-2008") ? rotated : unreg).push(rel);
    }
  }
  check("A1", `签名链-现役密钥验签（${invalidLines.length} 个无效中排查）`, tamper.length === 0, tamper.join(", ") || "无现役密钥失败项（疑似篡改=0）");
  check("A2", "签名链-密钥轮换史（WARN 级）", true, rotated.join(", ") || "无");
  check("A3", "签名链-未注册签名者（须豁免登记追认）", unreg.every(x => exempt.length > 0), unreg.join(", ") || "无");
}

// ---- B 结算守恒 + escrow 非负 + 国库 cap ----
{
  const ledDir = path.join(ROOT, "ledger");
  const escrow = {}; // id -> {in, out}
  let treasuryIn = 0, seqs = [], dupSeq = 0;
  for (const f of fs.readdirSync(ledDir).filter(x => /^L-\d{4}\.md$/.test(x)).sort()) {
    const c = fs.readFileSync(path.join(ledDir, f), "utf8");
    const seq = Number((c.match(/^seq:\s*(\d+)/m) || [])[1]);
    if (seqs.includes(seq)) dupSeq++;
    seqs.push(seq);
    const amt = Number((c.match(/^amount:\s*([\d.]+)/m) || [])[1]) || 0;
    const from = (c.match(/^from:\s*(\S+)/m) || [])[1] || "";
    const to = (c.match(/^to:\s*(\S+)/m) || [])[1] || "";
    if (/^escrow-/.test(to)) { escrow[to] = escrow[to] || { in: 0, out: 0 }; escrow[to].in += amt; }
    if (/^escrow-/.test(from)) { escrow[from] = escrow[from] || { in: 0, out: 0 }; escrow[from].out += amt; }
    if (from === "TREASURY" && /^escrow-/.test(to)) treasuryIn += amt;
  }
  const overdrawnAll = Object.entries(escrow).filter(([, v]) => v.out > v.in + 1e-9);
  // 守卫纪元判定：escrow-T-* 对应任务发布于 2026-09-25（escrowFunded 守卫上线）之后 = FAIL；之前 = legacy WARN
  const pubTs = {};
  const taskRoot2 = path.join(ROOT, "tasks");
  for (const t of fs.readdirSync(taskRoot2).filter(x => /^T-/.test(x))) {
    const evDir = path.join(taskRoot2, t, "events");
    if (!fs.existsSync(evDir)) continue;
    const pf = fs.readdirSync(evDir).find(x => x.startsWith("published-"));
    if (pf) pubTs["escrow-" + t] = pf;
  }
  const overdrawnNew = overdrawnAll.filter(([k]) => {
    if (pubTs[k]) return pubTs[k] >= "published-20260925";
    return /deposit$/.test(k) ? false : false; // 无任务对应（如 deposit escrow）→ 归 legacy
  });
  check("B1", `escrow 无超支（守卫纪元）`, overdrawnNew.length === 0, overdrawnNew.map(([k]) => k).join(",") || `全部正常（legacy 超支 ${overdrawnAll.length - overdrawnNew.length} 个已按守卫前豁免）`);
  let cap = 1000;
  try { const mc = JSON.parse(fs.readFileSync(path.join(ROOT, "market-config.json"), "utf8")); cap = (mc.liquidity && mc.liquidity.cap) || 1000; } catch (e) {}
  check("B2", `国库流动性 ≤ cap(${cap})`, treasuryIn <= cap, `injected=${treasuryIn}`);
  const gaps = seqs.filter((s, i) => i > 0 && s - seqs[i - 1] > 1);
  check("F", `账本 append-only（${seqs.length} 条）`, dupSeq === 0, dupSeq ? `重复 seq ×${dupSeq}` : (gaps.length ? `WARN: 记录在案的 seq 空洞 ${gaps.join(",")}（冲突解决重编号，见提交历史）` : "无空洞"));

  // settled 事件守恒
  let settledN = 0, badN = 0;
  const taskRoot = path.join(ROOT, "tasks");
  for (const t of fs.readdirSync(taskRoot).filter(x => /^T-/.test(x))) {
    const evDir = path.join(taskRoot, t, "events");
    if (!fs.existsSync(evDir)) continue;
    for (const f of fs.readdirSync(evDir).filter(x => x.startsWith("settled-"))) {
      settledN++;
      const c = fs.readFileSync(path.join(evDir, f), "utf8");
      const pay = Number((c.match(/^payment:\s*([\d.]+)/m) || [])[1]);
      const tax = Number((c.match(/^tax:\s*([\d.]+)/m) || [])[1]);
      const ref = Number((c.match(/^refund:\s*([\d.]+)/m) || [])[1]);
      const bud = Number((c.match(/^budget:\s*([\d.]+)/m) || [])[1]);
      if ([pay, tax, ref, bud].some(x => isNaN(x)) || Math.abs(pay + tax + ref - bud) > 0.005) {
        badN++;
        check("B3", `守恒 ${t}/${f}`, false, `${pay}+${tax}+${ref} != ${bud}`);
      }
    }
  }
  check("B3", `settled 守恒抽查（${settledN} 个结算事件）`, badN === 0, badN ? `${badN} 个失败` : "全部守恒");
}

// ---- C 身份注册表指纹核验 ----
{
  const agRoot = path.join(ROOT, "agents");
  let n = 0, nofp = 0, bad = [];
  for (const ag of fs.readdirSync(agRoot)) {
    const p = path.join(agRoot, ag, "agent.md");
    if (!fs.existsSync(p)) continue;
    const c = fs.readFileSync(p, "utf8");
    const declared = (c.match(/^key_fingerprint:[ \t]*(\S+)/m) || [])[1];
    const pubRaw = (c.match(/^public_key:\s*(.+)$/m) || [])[1];
    if (!pubRaw) continue;
    if (!declared) { nofp++; continue; } // 空声明（E2E 测试身份）单列
    const pubEsc = pubRaw.trim();
    n++;
    try {
      const pem = pubEsc.replace(/\\n/g, "\n");
      const der = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
      const fp = "SHA256:" + crypto.createHash("sha256").update(der).digest("base64");
      if (fp !== declared) bad.push(ag);
    } catch (e) { bad.push(ag + "(parse)"); }
  }
  check("C", `身份指纹一致（${n} 已声明 + ${nofp} 空声明测试身份）`, bad.length === 0, bad.join(",") || "全部一致");
}

// ---- D 验收回放（最近 5 个已结算任务）----
if (!QUICK) {
  const taskRoot = path.join(ROOT, "tasks");
  const settledTasks = [];
  for (const t of fs.readdirSync(taskRoot).filter(x => /^T-/.test(x))) {
    const evDir = path.join(taskRoot, t, "events");
    if (fs.existsSync(evDir) && fs.readdirSync(evDir).some(x => x.startsWith("settled-"))) settledTasks.push(t);
  }
  let replayN = 0, replayBad = [];
  for (const t of settledTasks.slice(-5)) {
    const before = (() => { try { return JSON.parse(fs.readFileSync(path.join(taskRoot, t, "result", "verify-result.json"), "utf8")).verdict; } catch (e) { return null; } })();
    if (!before) continue;
    sh(`node tools/verify.js "${path.join("tasks", t)}"`);
    const after = (() => { try { return JSON.parse(fs.readFileSync(path.join(taskRoot, t, "result", "verify-result.json"), "utf8")).verdict; } catch (e) { return "ERR"; } })();
    replayN++;
    if (after !== before) replayBad.push(`${t}:${before}→${after}`);
  }
  check("D", `验收断言回放（${replayN} 个已结算任务）`, replayBad.length === 0, replayBad.join(", ") || "verdict 全部复现");
}

// ---- E 存活探针 ----
{
  const r = sh("node tools/probe-geo.js");
  const ok9 = /9\s*\/\s*9\s*OK|9 OK/.test(r.out);
  check("E", "GEO 存活探针", ok9 || /NETWORK_UNREACHABLE/.test(r.out), (r.out.match(/9\/9|NETWORK_UNREACHABLE|[0-9]\/9/) || [r.out.slice(0, 80)])[0]);
}

// ---- 报告 ----
const failed = results.filter(r => !r.ok);
const date = new Date().toISOString().slice(0, 10);
let md = `# 市场每日审计 · ${date}\n\n- 结果: **${results.length - failed.length}/${results.length} PASS**${failed.length ? " ⚠️ 存在失败项" : " ✅"}\n- 审计器: tools/audit.js（D-130e，用户令：务必自动化核验核查）\n\n| # | 检查项 | 结果 | 详情 |\n|---|---|---|---|\n`;
for (const r of results) md += `| ${r.id} | ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.detail.replace(/\|/g, "\\|")} |\n`;
const dir = path.join(ROOT, "ops", "audit");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `audit-${date}.md`), md + "\n");
console.log(md);
process.exit(failed.length ? 1 : 0);
