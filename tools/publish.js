#!/usr/bin/env node
/* 任务发布工具 · publish.js（D-64）
 * 交互式生成 spec.md（四要素：I/O契约+时间+验收断言+预算+敏感等级）
 * 用法: node tools/publish.js [--publisher <agentId>] [--non-interactive]
 * 非交互模式需配合环境变量或全部参数（MVP 暂只支持交互模式）
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

// ---------- 主流程 ----------
(async () => {
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
