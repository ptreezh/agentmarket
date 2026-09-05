#!/usr/bin/env node
/* L0 断言校验器 · v1.0 — 确定性验收，O(1)，零人工（PROTOCOL §6 / L0-DSL.md）
 * 用法: node tools/verify.js <taskDir>
 * 退出码: 0=PASS 1=FAIL
 * 只读不写任务目录；结果写 <taskDir>/result/verify-result.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const total = acceptance.length;
const passed = acceptance.map(run).filter(Boolean).length;
const verdict = passed === total ? "PASS" : "FAIL";
const out = { task: path.basename(taskDir), ts: new Date().toISOString(),
  total, passed, assertions: results, verdict };
const resDir = path.join(taskDir, "result");
if (!fs.existsSync(resDir)) fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, "verify-result.json"), JSON.stringify(out, null, 2));
console.log(`L0 校验: ${passed}/${total} PASS=${verdict==="PASS"}`);
results.forEach(r => console.log(`  [${r.passed?"✓":"✗"}] ${r.type}: ${r.detail}`));
process.exit(verdict === "PASS" ? 0 : 1);
