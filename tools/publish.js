#!/usr/bin/env node
/* 任务发布工具 · publish.js（D-64 + D-127）
 * 交互式生成 spec.md（四要素：I/O契约+时间+验收断言+预算+敏感等级）
 * D-127: --json '<payload>' 非交互自动派发模式（agent 一行命令发包）
 * 用法:
 *   交互: node tools/publish.js [--publisher <agentId>]
 *   自动: node tools/publish.js --publisher <agentId> --json '<JSON payload>'
 * 字段白名单（未知字段 exit 3）: title/description/deadline/complexity/budget/sens/
 *   timeout_penalty/est_range/use_bidding/bidding_deadline/min_bid/max_bid/
 *   input_files/output_schema/assertions/verification/context
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { execSync } = require("child_process");

// 输入抽象：TTY 用 readline，非 TTY 用预读取行数组（支持管道/文件输入）
const IS_TTY = process.stdin.isTTY;
let _lines = [];
let _lineIdx = 0;
if (!IS_TTY) {
  _lines = fs.readFileSync(0, "utf-8").split("\n");
}
const rl = IS_TTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
function _nextLine() {
  if (_lineIdx < _lines.length) return _lines[_lineIdx++];
  return "";
}
const ask = (q, def) => {
  if (IS_TTY) {
    return new Promise(res => rl.question(def ? `${q} [${def}]: ` : `${q}: `, a => res(a.trim() || def || "")));
  }
  const val = _nextLine();
  if (q) console.log(`${q}${def ? ` [${def}]` : ""}: ${val}`);
  return Promise.resolve(val.trim() || def || "");
};
const askChoice = (q, choices, def) => {
  if (IS_TTY) {
    return new Promise(res => {
      rl.question(`${q} (${choices.join("/")}) [${def}]: `, a => {
        a = a.trim().toLowerCase();
        res(choices.includes(a) ? a : def);
      });
    });
  }
  let val = _nextLine().trim().toLowerCase();
  if (!choices.includes(val)) val = def;
  console.log(`${q} (${choices.join("/")}) [${def}]: ${val}`);
  return Promise.resolve(val);
};

// ---------- 工具 ----------
function nextTaskId() {
  let max = 2000;
  if (fs.existsSync("tasks")) {
    for (const d of fs.readdirSync("tasks")) {
      const m = d.match(/^T-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `T-${String(max + 1).padStart(4, "0")}`;
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function isoDeadline(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const BUDGET_BY_COMPLEXITY = { S: 40, M: 70, L: 110, XL: 200 };

// ---------- D-127 JSON 自动派发模式（SPEC-REPO-CONTEXT-TASK v0.4 §12）----------
const SPEC_FIELDS = ["title", "description", "deadline", "complexity", "budget", "sens", "timeout_penalty", "est_range", "use_bidding", "bidding_deadline", "min_bid", "max_bid", "input_files", "output_schema", "assertions", "verification", "context"];
const ASSERT_TYPES = ["file_exists", "row_count", "col_check", "json_path", "hash_match"];

function parseJsonArg() {
  const i = process.argv.indexOf("--json");
  if (i < 0) return null;
  const raw = process.argv[i + 1];
  if (!raw) return { error: "missing --json payload (JSON string)" };
  try { return { payload: JSON.parse(raw) }; }
  catch (e) { return { error: "JSON parse failed: " + e.message }; }
}

function validateJsonPayload(p) {
  const unknown = Object.keys(p).filter(k => !SPEC_FIELDS.includes(k));
  if (unknown.length) return { error: "unknown field(s): " + unknown.join(",") + " (allowed: " + SPEC_FIELDS.join("/") + ")", code: 3 };
  if (!p.title || !String(p.title).trim()) return { error: "title required" };
  if (!p.deadline || isNaN(Date.parse(p.deadline))) return { error: "deadline required and must be ISO 8601 (e.g. 2026-09-15T00:00:00Z)" };
  const budget = p.budget == null ? null : Number(p.budget);
  if (budget == null || isNaN(budget) || budget <= 0) return { error: "budget required and > 0" };
  if (p.complexity && !["S", "M", "L", "XL"].includes(String(p.complexity).toUpperCase())) return { error: "complexity must be S/M/L/XL" };
  if (p.sens && !["L0", "L1", "L2"].includes(String(p.sens).toUpperCase())) return { error: "sens must be L0/L1/L2" };
  if (p.timeout_penalty != null && (isNaN(Number(p.timeout_penalty)) || Number(p.timeout_penalty) < 0)) return { error: "timeout_penalty must be >= 0" };
  if (p.est_range != null && (!Array.isArray(p.est_range) || p.est_range.length !== 2 || p.est_range.some(v => isNaN(Number(v))))) return { error: "est_range must be [min, max]" };
  if (p.use_bidding != null && typeof p.use_bidding !== "boolean") return { error: "use_bidding must be boolean" };
  if (p.assertions != null) {
    if (!Array.isArray(p.assertions)) return { error: "assertions must be an array" };
    for (const a of p.assertions) {
      if (!ASSERT_TYPES.includes(a && a.type)) return { error: "invalid assertion type: " + (a && a.type) + " (allowed: " + ASSERT_TYPES.join("/") + ")" };
      if (!a.path) return { error: "assertion missing path: " + JSON.stringify(a) };
    }
  }
  if (p.verification != null) {
    if (typeof p.verification !== "object" || !p.verification.script) return { error: "verification.script required" };
    if (typeof p.verification.script !== "string") return { error: "verification.script must be a string" };
    if (p.verification.timeout != null && (isNaN(Number(p.verification.timeout)) || Number(p.verification.timeout) <= 0)) return { error: "verification.timeout must be > 0" };
  }
  if (p.context != null) {
    if (typeof p.context !== "object" || !p.context.repo || !/^https:\/\//.test(p.context.repo)) return { error: "context.repo must be an https URL" };
    try {
      execSync('git ls-remote "' + p.context.repo + '" HEAD', { timeout: 15000, stdio: "pipe", encoding: "utf-8" });
    } catch (e) {
      return { error: "context.repo unreachable: " + p.context.repo + " (git ls-remote failed)" };
    }
  }
  return { ok: true };
}

function buildSpecContent(o) {
  const acceptanceYaml = o.assertions.map(a => {
    const parts = Object.entries(a).map(([k, v]) => {
      if (typeof v === "string") return k + ': "' + v + '"';
      return k + ": " + v;
    }).join(", ");
    return "  - {" + parts + "}";
  }).join("\n");
  let extra = "";
  if (o.verification) extra += "verification:\n  script: " + o.verification.script + "\n  timeout: " + (o.verification.timeout || 60) + "\n";
  if (o.context) extra += "context:\n  repo: " + o.context.repo + "\n  ref: " + (o.context.ref || "HEAD") + "\n  path: " + (o.context.path || ".") + "\n";
  return "---\n" +
    "id: " + o.taskId + "\n" +
    "title: " + o.title + "\n" +
    "complexity: " + o.complexity + "\n" +
    "budget: " + o.budget + "\n" +
    "sens: " + o.sens + "\n" +
    "est_range: [" + o.estMin + ", " + o.estMax + "]\n" +
    'deadline: "' + o.deadline + '"\n' +
    "timeout_penalty: " + o.timeoutPenalty + "\n" +
    "publisher: " + o.publisher + "\n" +
    "input_ref: " + o.inputRef + "\n" +
    (o.useBidding
      ? 'bidding: true\nbidding_deadline: "' + o.biddingDeadline + '"\nmin_bid: ' + o.minBid + "\nmax_bid: " + o.maxBid + "\n"
      : "bidding: false\n") +
    extra +
    "output_schema: |\n" + o.outputSchema + "\n" +
    "acceptance:\n" + acceptanceYaml + "\n" +
    "---\n# " + o.taskId + " · " + o.title + "\n\n" + o.description + "\n";
}

function runJsonMode(arg, publisher) {
  if (arg.error) { console.error(JSON.stringify({ error: arg.error, code: 2 })); process.exit(2); }
  const p = arg.payload;
  const v = validateJsonPayload(p);
  if (v.error) { console.error(JSON.stringify({ error: v.error, code: v.code || 1 })); process.exit(v.code || 1); }
  if (!publisher) { console.error(JSON.stringify({ error: "missing --publisher <AgentID>", code: 2 })); process.exit(2); }
  if (!fs.existsSync(path.join("agents", publisher, "agent.md"))) {
    console.error(JSON.stringify({ error: "agent not found: agents/" + publisher + "/agent.md (run join.sh first)", code: 1 }));
    process.exit(1);
  }
  const taskId = nextTaskId();
  const taskDir = path.join("tasks", taskId);
  fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
  fs.mkdirSync(path.join(taskDir, "result"), { recursive: true });
  let inputRef = "none";
  if (p.input_files) {
    const files = Array.isArray(p.input_files) ? p.input_files : [p.input_files];
    const hashes = [];
    for (const f of files) {
      if (fs.existsSync(f)) {
        const dest = path.join(taskDir, path.basename(f));
        fs.copyFileSync(f, dest);
        hashes.push(sha256File(dest));
      } else {
        console.error(JSON.stringify({ error: "input file not found: " + f, code: 1 }));
        process.exit(1);
      }
    }
    inputRef = hashes.join(",");
  }
  const complexity = String(p.complexity || "S").toUpperCase();
  const sens = String(p.sens || "L0").toUpperCase();
  const assertions = p.assertions && p.assertions.length ? p.assertions : [{ type: "file_exists", path: "result/result.md" }];
  const outputSchema = p.output_schema || "  result/result.md: result summary file";
  const specContent = buildSpecContent({
    taskId, title: p.title, complexity, budget: Number(p.budget), sens,
    estMin: p.est_range ? p.est_range[0] : 1, estMax: p.est_range ? p.est_range[1] : 3,
    deadline: p.deadline, timeoutPenalty: p.timeout_penalty == null ? 0.05 : Number(p.timeout_penalty),
    publisher, inputRef,
    useBidding: !!p.use_bidding, biddingDeadline: p.bidding_deadline, minBid: p.min_bid, maxBid: p.max_bid,
    outputSchema, assertions,
    description: p.description || p.title + ".",
    verification: p.verification, context: p.context
  });
  const specPath = path.join(taskDir, "spec.md");
  fs.writeFileSync(specPath, specContent);
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const eventContent = "---\nevent: published\ntask: " + taskId + "\npublisher: " + publisher + "\nts: " + ts + "\n---\n" + taskId + " published (" + complexity + ", budget " + Number(p.budget) + ", " + sens + "). via publish.js --json auto-dispatch.\n";
  fs.writeFileSync(path.join(taskDir, "events", "published-" + ts + ".md"), eventContent);
  try {
    execSync("git push origin HEAD:refs/tasks/" + taskId, { encoding: "utf-8", stdio: "pipe" });
  } catch (e) { /* 忽略：无 origin 或权限时不影响本地发布 */ }
  console.log(JSON.stringify({ ok: true, taskId, specPath, budget: Number(p.budget), publisher }));
  process.exit(0);
}

// ---------- 主流程 ----------
(async () => {
  // D-127: --json 自动派发模式（agent 可程序化调用，跳过全部交互）
  const jsonArg = parseJsonArg();
  if (jsonArg) {
    const pubArg = process.argv.includes("--publisher") ? process.argv[process.argv.indexOf("--publisher") + 1] : "";
    runJsonMode(jsonArg, pubArg);
    return;
  }

  console.log("═══════════════════════════════════════════");
  console.log("  智能体协同市场 · 任务发布工具");
  console.log("═══════════════════════════════════════════\n");

  // 1. Publisher
  let publisher = process.argv.includes("--publisher") ? process.argv[process.argv.indexOf("--publisher") + 1] : "";
  if (!publisher) publisher = await ask("发布者 Agent ID（需已注册）");
  if (!fs.existsSync(path.join("agents", publisher, "agent.md"))) {
    console.error(`❌ Agent 不存在: agents/${publisher}/agent.md（请先运行 join.sh 注册）`);
    process.exit(1);
  }

  // 2. 任务 ID
  const taskId = nextTaskId();
  console.log(`\n📋 任务 ID: ${taskId}\n`);

  // 3. 基本信息
  const title = await ask("任务标题");
  if (!title) { console.error("❌ 标题不能为空"); process.exit(1); }

  const complexity = await askChoice("复杂度", ["s", "m", "l", "xl"], "s");
  const defaultBudget = BUDGET_BY_COMPLEXITY[complexity.toUpperCase()];
  const budget = parseInt(await ask("预算（积分）", String(defaultBudget)), 10) || defaultBudget;

  const sens = await askChoice("敏感等级", ["l0", "l1", "l2"], "l0");
  const deadline = await ask("截止时间（ISO 8601，留空=24h后）", isoDeadline(24));
  const timeoutPenalty = parseFloat(await ask("超时罚扣比例", "0.05")) || 0.05;
  const estMin = parseInt(await ask("预估最短时间（分钟）", "1"), 10) || 1;
  const estMax = parseInt(await ask("预估最长时间（分钟）", "3"), 10) || 3;

  // 3b. 竞价模式（M4.1 Vickrey 二价，opt-in）
  const useBidding = (await askChoice("是否启用 Vickrey 竞价（最低报价中标，按第二价结算）", ["n", "y"], "n")).toLowerCase() === "y";
  let biddingDeadline = "", minBid = 0, maxBid = 0;
  if (useBidding) {
    biddingDeadline = await ask("竞价截止时间（ISO 8601，必须早于任务截止时间，留空=12h后）", isoDeadline(12));
    minBid = parseInt(await ask("最低报价（积分）", "1"), 10) || 1;
    maxBid = parseInt(await ask(`最高报价（积分，默认=预算 ${budget}）`, String(budget)), 10) || budget;
    if (maxBid > budget) { console.warn(`  ⚠️  最高报价 ${maxBid} > 预算 ${budget}，已调整为 ${budget}`); maxBid = budget; }
  }

  // 4. 输入文件
  const inputFile = await ask("输入文件路径（留空=无输入文件）");
  let inputRef = "none";
  const taskDir = path.join("tasks", taskId);
  fs.mkdirSync(path.join(taskDir, "events"), { recursive: true });
  fs.mkdirSync(path.join(taskDir, "result"), { recursive: true });

  if (inputFile && fs.existsSync(inputFile)) {
    const dest = path.join(taskDir, path.basename(inputFile));
    fs.copyFileSync(inputFile, dest);
    inputRef = sha256File(dest);
    console.log(`  ✅ 输入文件已复制: ${dest}（sha256: ${inputRef.slice(0, 16)}…）`);
  } else if (inputFile) {
    console.warn(`  ⚠️  文件不存在: ${inputFile}（input_ref 设为 none）`);
  }

  // 5. 输出 schema
  console.log("\n--- 输出 Schema（描述 worker 应产出的文件）---");
  const outputLines = [];
  while (true) {
    const outFile = await ask("输出文件路径（如 result/out.csv，留空=结束）");
    if (!outFile) break;
    const outDesc = await ask(`  ${outFile} 的描述`);
    outputLines.push(`  ${outFile}: ${outDesc}`);
  }
  if (outputLines.length === 0) {
    outputLines.push("  result/result.md: 结果说明文件");
  }
  const outputSchema = outputLines.join("\n");

  // 6. 验收断言
  console.log("\n--- 验收断言（至少 1 个，L0 DSL）---");
  console.log("  类型: file_exists / row_count / col_check / json_path / hash_match");
  const assertions = [];
  while (true) {
    const type = await ask("断言类型（留空=结束）");
    if (!type) break;
    if (!["file_exists", "row_count", "col_check", "json_path", "hash_match"].includes(type)) {
      console.log("  ❌ 未知类型，跳过");
      continue;
    }
    const apath = await ask("  文件路径（相对任务目录）");
    if (type === "file_exists") {
      assertions.push({ type, path: apath });
    } else if (type === "hash_match") {
      const sha = await ask("  期望 SHA-256（留空=发布后手动计算填入）");
      assertions.push({ type, path: apath, sha256: sha || "TODO_AFTER_KNOWN_OUTPUT" });
    } else if (type === "json_path") {
      const pe = await ask("  JSON 路径（如 $.total）");
      const op = await askChoice("  比较符", ["eq", "ne", "gt", "ge", "lt", "le"], "eq");
      const val = await ask("  期望值");
      assertions.push({ type, path: apath, path_expr: pe, op, value: isNaN(Number(val)) ? val : Number(val) });
    } else {
      // row_count / col_check
      const op = await askChoice("  比较符", ["eq", "ne", "gt", "ge", "lt", "le"], "ge");
      const val = await ask("  期望值");
      const assertion = { type, path: apath, op, value: Number(val) };
      if (type === "col_check") assertion.col = await ask("  列名");
      assertions.push(assertion);
    }
    console.log(`  ✅ 已添加: ${JSON.stringify(assertions[assertions.length - 1])}`);
  }
  if (assertions.length === 0) {
    assertions.push({ type: "file_exists", path: "result/result.md" });
    console.log("  ⚠️  未添加断言，自动添加: file_exists result/result.md");
  }

  // 7. 任务描述
  console.log("\n--- 任务描述（多行，空行结束）---");
  const descLines = [];
  while (true) {
    const line = await ask("");
    if (line === "") break;
    descLines.push(line);
  }
  const description = descLines.length > 0 ? descLines.join("\n") : `${title}。`;

  // 8. 生成 spec.md
  const acceptanceYaml = assertions.map(a => {
    const parts = Object.entries(a).map(([k, v]) => {
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    }).join(", ");
    return `  - {${parts}}`;
  }).join("\n");

  const specContent = `---
id: ${taskId}
title: ${title}
complexity: ${complexity.toUpperCase()}
budget: ${budget}
sens: ${sens.toUpperCase()}
est_range: [${estMin}, ${estMax}]
deadline: "${deadline}"
timeout_penalty: ${timeoutPenalty}
publisher: ${publisher}
input_ref: ${inputRef}
${useBidding ? `bidding: true
bidding_deadline: "${biddingDeadline}"
min_bid: ${minBid}
max_bid: ${maxBid}` : "bidding: false"}
output_schema: |
${outputSchema}
acceptance:
${acceptanceYaml}
---
# ${taskId} · ${title}

${description}
`;

  const specPath = path.join(taskDir, "spec.md");
  fs.writeFileSync(specPath, specContent);
  console.log(`\n✅ spec.md 已生成: ${specPath}`);

  // 9. 生成 published 事件
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const eventContent = `---
event: published
task: ${taskId}
publisher: ${publisher}
ts: ${ts}
---
${taskId} 发布（${complexity.toUpperCase()}，预算 ${budget}，${sens.toUpperCase()}）。由 publish.js 交互式生成。
`;
  const eventPath = path.join(taskDir, "events", `published-${ts}.md`);
  fs.writeFileSync(eventPath, eventContent);
  console.log(`✅ published 事件已生成: ${eventPath}`);

  // 9b. HCA: 创建任务索引 ref refs/tasks/<id>（供 ls-remote 发现用）
  try {
    execSync(`git push origin HEAD:refs/tasks/${taskId}`, { encoding: "utf-8", stdio: "pipe" });
    console.log(`✅ 任务索引 ref 已创建: refs/tasks/${taskId}`);
  } catch (e) {
    console.log(`⚠️  任务索引 ref 创建失败（不影响发布，可手动补）: ${e.message}`);
  }

  // 10. 完成提示
  console.log("\n═══════════════════════════════════════════");
  console.log(`  ✅ 任务 ${taskId} 已创建（本地，未提交）`);
  console.log("═══════════════════════════════════════════");
  console.log(`  目录: ${taskDir}/`);
  console.log(`  spec: ${specPath}`);
  console.log(`  预算: ${budget} 积分（将从 ${publisher} 余额扣除）`);
  console.log("");
  console.log("  提交到市场:");
  console.log("    bash publish.sh");
  console.log("");
  console.log("  预览 spec:");
  console.log(`    cat ${specPath}`);
  console.log("═══════════════════════════════════════════");

  if (rl) rl.close();
})().catch(e => { console.error(e); process.exit(1); });
