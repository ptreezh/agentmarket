#!/usr/bin/env node
/* L0 断言校验器 · v1.1 — 确定性验收 + D-122 可执行验证规则（verification）
 * 用法: node tools/verify.js <taskDir>
 * 退出码: 0=PASS 1=FAIL
 * 只读不写任务目录；结果写 <taskDir>/result/verify-result.json
 *
 * v1.1 新增（D-122）: spec.md 可选 verification 段（script/timeout）→ L0 全过后在沙箱执行
 *   约定: exit 0=通过 非0=不通过; 超时=不通过(kill 进程树)
 *   安全: 环境白名单(PATH+TASK_DIR) + 超时进程树 kill + 路径穿越拒绝 + 醒目警告
 *   诚实边界: 无法阻止脚本访问文件系统——运行者必须在无敏感数据/密钥的隔离环境执行
 *             （SPEC-VERIFICATION-SCRIPT-20260908.md §3.3）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execSync } = require("child_process");

const taskDir = process.argv[2];
if (!taskDir) { console.error("usage: node tools/verify.js <taskDir>"); process.exit(2); }
const specPath = path.join(taskDir, "spec.md");
const specText = fs.readFileSync(specPath, "utf-8");
const fm = specText.match(/^---\n([\s\S]*?)\n---/);
if (!fm) { console.error("spec.md 缺少 frontmatter"); process.exit(2); }
/* 极简 frontmatter 解析：仅读取 acceptance（YAML 数组缩进结构） */
function parseAcceptance(body){
  const lines = body.split("\n");
  const items = []; let cur = null;
  for (const raw of lines){
    const m = raw.match(/^\s*-\s*\{?(.*?)\}?\s*$/);
    if (m && raw.trim().startsWith("- ")){
      if (cur) items.push(cur);
      cur = {};
      const kv = raw.replace(/^\s*-\s*/, "").replace(/^\{|\}$/g, "");
      for (const pair of kv.split(",")){
        const [k, v] = pair.split(":").map(s=>s.trim());
        if (k) cur[k] = v.replace(/^["']|["']$/g, "");
      }
    } else if (cur){
      const kv = raw.trim().split(":").map(s=>s.trim());
      if (kv.length===2 && kv[0]) cur[kv[0]] = kv[1].replace(/^["']|["']$/g, "");
    }
  }
  if (cur) items.push(cur);
  return items;
}
const acceptance = parseAcceptance(fm[1]);

/* D-122: 解析 verification 段（极简，嵌套对象：script/timeout） */
function parseVerification(body){
  const m = body.match(/^\s*verification:\s*$/m);
  if (!m) return null;
  const seg = body.slice(m.index + m[0].length);
  const end = seg.search(/\n\s*\n/);
  const block = (end === -1 ? seg : seg.slice(0, end));
  const v = {};
  const s = block.match(/^\s*script:\s*(\S+)\s*$/m);
  const t = block.match(/^\s*timeout:\s*(\d+)\s*$/m);
  if (s) v.script = s[1];
  if (t) v.timeout = parseInt(t[1], 10);
  return v.script ? v : null;
}
const verification = parseVerification(fm[1]);

const num = v => { const n = Number(v); if (v === "" || isNaN(n)) throw new Error("非数值 "+v); return n; };
const sha256 = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const csvRows = p => fs.readFileSync(p,"utf-8").trim().split("\n").slice(1).map(r => r.split(","));
const jsonGet = (obj, expr) => expr.replace(/^\$\.?/,"").split(".").reduce((o,k)=>{
  const m = k.match(/^(\w+)\[(\d+)\]$/);
  return m ? (o||{})[m[1]][+m[2]] : (o||{})[k];
}, obj);

function cmp(a, op, b){
  const isNum = x => x !== "" && x !== null && x !== undefined && !isNaN(Number(x));
  switch(op){
    case "eq": return isNum(a) && isNum(b) ? Number(a) === Number(b) : String(a) === String(b);
    case "ne": return isNum(a) && isNum(b) ? Number(a) !== Number(b) : String(a) !== String(b);
    case "gt": return num(a) >  num(b);
    case "ge": return num(a) >= num(b);
    case "lt": return num(a) <  num(b);
    case "le": return num(a) <= num(b);
    default: throw new Error("非法 op: "+op);
  }
}

const results = [];
function run(a){
  const p = path.join(taskDir, a.path);
  let ok = false, detail = "";
  try {
    switch(a.type){
      case "file_exists":
        ok = fs.existsSync(p); detail = p + (ok ? " 存在" : " 缺失"); break;
      case "row_count": {
        const rows = csvRows(p); ok = cmp(rows.length, a.op, a.value);
        detail = `rows=${rows.length} ${a.op} ${a.value}`; break;
      }
      case "col_check": {
        const rows = csvRows(p);
        // 用表头定位列
        const head = fs.readFileSync(p,"utf-8").trim().split("\n")[0].split(",");
        const ci = head.indexOf(a.col);
        const nums = rows.map(r => num(r[ci]));
        ok = nums.every(v => cmp(v, a.op, a.value));
        detail = `col=${a.col} 全部 ${a.op} ${a.value} (n=${nums.length})`; break;
      }
      case "json_path": {
        const j = JSON.parse(fs.readFileSync(p,"utf-8"));
        const v = jsonGet(j, a.path_expr);
        ok = cmp(v, a.op, a.value);
        detail = `${a.path_expr}=${v} ${a.op} ${a.value}`; break;
      }
      case "hash_match": {
        const got = sha256(p); ok = got === a.sha256;
        detail = `sha256 ${ok ? "匹配" : "不匹配(独立重算: "+got.slice(0,16)+"…)"}`; break;
      }
      default: throw new Error("未知断言类型: "+a.type);
    }
  } catch(e){ ok = false; detail = "ERR: "+e.message; }
  results.push({ type:a.type, passed:ok, detail });
  return ok;
}

/* D-122: 沙箱执行 verification 脚本（环境白名单 + 超时进程树 kill + 路径穿越拒绝） */
function runVerification(v){
  const rec = { script: v.script, timeout: v.timeout || 60, verdict: "fail" };
  try {
    const base = taskDir.endsWith(path.sep) ? taskDir : taskDir + path.sep;
    const abs = path.resolve(taskDir, v.script);
    if (!abs.startsWith(base)) { rec.output = "拒绝: script 路径穿越任务目录"; return rec; }
    if (!fs.existsSync(abs)) { rec.output = `脚本缺失: ${v.script} (not found)`; return rec; }
    let cmd, args;
    const ext = path.extname(v.script).toLowerCase();
    if (ext === ".cmd" || ext === ".bat") { cmd = "cmd"; args = ["/c", abs]; }
    else if (ext === ".js") { cmd = process.execPath; args = [abs]; }
    else { cmd = "sh"; args = [abs]; }
    /* 环境白名单：PATH + TASK_DIR（剥离 HOME 等一切敏感变量，白名单制最安全） */
    const env = { PATH: process.env.PATH || "", TASK_DIR: taskDir };
    const timeoutMs = (v.timeout || 60) * 1000;
    console.warn(`⚠️  将运行发布者脚本 ${v.script}（任意代码执行）——确保在无敏感数据/密钥的隔离环境`);
    const useDetached = process.platform !== "win32";
    const r = spawnSync(cmd, args, {
      cwd: taskDir, env, input: "",
      timeout: timeoutMs, detached: useDetached,
      encoding: "utf-8", maxBuffer: 64 * 1024,
    });
    let timedOut = !!(r.error && r.error.killed) || r.signal === "SIGTERM";
    if (timedOut) {
      /* 补杀进程树：Windows taskkill /T，Unix 杀进程组 */
      try {
        if (process.platform === "win32" && r.pid) execSync(`taskkill /pid ${r.pid} /T /F`, { stdio: "ignore" });
        else if (r.pid) { try { process.kill(-r.pid, "SIGKILL"); } catch {} }
      } catch {}
    }
    rec.exit_code = r.status;
    rec.timed_out = timedOut;
    rec.output = ((r.stdout || "") + (r.stderr || "")).slice(0, 2048);
    rec.verdict = (r.status === 0 && !timedOut) ? "pass" : "fail";
  } catch(e){
    rec.output = "ERR: " + e.message;
  }
  return rec;
}

const total = acceptance.length;
const passed = acceptance.map(run).filter(Boolean).length;
const out = { task: path.basename(taskDir), ts: new Date().toISOString(),
  total, passed, assertions: results };

let verdict;
if (passed !== total) {
  if (verification) out.verification = { script: verification.script, skipped: true, verdict: "fail", output: "L0 未全过，跳过 verification" };
  verdict = "FAIL";
} else if (verification) {
  out.verification = runVerification(verification);
  verdict = out.verification.verdict === "pass" ? "PASS" : "FAIL";
} else {
  verdict = "PASS";
}
out.verdict = verdict;

const resDir = path.join(taskDir, "result");
if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, "verify-result.json"), JSON.stringify(out, null, 2));
console.log(`L0 校验: ${passed}/${total} PASS=${verdict==="PASS"}${verification ? " + verification" : ""}`);
results.forEach(r => console.log(`  [${r.passed?"✓":"✗"}] ${r.type}: ${r.detail}`));
if (out.verification) {
  const v = out.verification;
  console.log(`  verification: ${v.script} → ${v.verdict}${v.skipped ? " (skipped)" : ""}${v.timed_out ? " (timeout)" : ""}${v.exit_code !== undefined ? " exit=" + v.exit_code : ""}`);
}
process.exit(verdict === "PASS" ? 0 : 1);
