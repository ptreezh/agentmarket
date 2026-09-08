#!/usr/bin/env node
/* tests/runner-loop.test.js — T2b agent-runner loop 集成测试（离线 bare 模拟 origin）
 * v3（D-113）：0 环境记录 headBefore + 清理 T-3003 残留（防 hasActiveClaim 误触发）
 *             清理段精确 reset 回 headBefore，保证测试幂等、不留污染。
 * 流程：离线 bare → 发布 T-3003（CSV 聚合）→ mock-llm → agent-runner loop（--llm mock）
 *       → 验证闭环：claim 事件签名 / result/result.json / submitted 事件签名
 * T1 后：loop 自动 settle 完整结算（operator 签名）→ settled 事件验签通过
 */
"use strict";
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const g = (c) => execSync(c, { encoding: "utf-8", stdio: "pipe" }).trim();

const ROOT = process.cwd();
const BARE = path.join(process.env.TEMP || "/tmp", "agentmarket-loop-test.git");
const TASK = "T-3003";
const PUB = "AG-DOUBAO01";
const WORKER = "AG-LOCAL01";

let failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name} — ${detail}`); failed++; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log("T2b runner-loop.test.js (v3)");

  // 0. 环境：记录 headBefore、清理残留、离线 bare + origin 指向
  const headBefore = g("git rev-parse HEAD");
  // 0.1 保护（D-122 补充）：工作区必须干净——清理段 git reset --hard 会清掉外部未提交改动
  const dirty = g("git status --porcelain");
  if (dirty) {
    console.error("⚠️ 工作区有未提交改动，跳过 runner-loop 测试（避免清理段误伤外部改动）：\n" + dirty);
    process.exit(0);
  }
  fs.rmSync(taskDirFor(BARE), { recursive: true, force: true });
  fs.rmSync(BARE, { recursive: true, force: true });
  g(`git init --bare "${BARE}"`);
  g(`git push "${BARE}" main`);
  g(`git remote set-url origin "${BARE}"`);
  function taskDirFor() { return path.join("tasks", TASK); }

  // 1. 发布 T-3003（CSV 聚合，断言 file_exists result/result.json）
  const taskDir = taskDirFor();
  const evDir = path.join(taskDir, "events");
  fs.rmSync(taskDir, { recursive: true, force: true }); // 确保 events 纯净
  fs.mkdirSync(evDir, { recursive: true });
  const ts = new Date().toISOString();
  const tsName = ts.replace(/[-:.]/g, "").slice(0, 15);
  fs.writeFileSync(path.join(taskDir, "spec.md"), `---
id: ${TASK}
title: CSV 销售数据聚合（T2b loop 集成测试）
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-08T16:00:00Z"
timeout_penalty: 0.05
publisher: ${PUB}
output_schema: |
  result/result.json: mock LLM 聚合输出
acceptance:
  - {type: file_exists, path: result/result.json}
---
# ${TASK} · CSV 销售数据聚合（loop 集成测试）
`, "utf-8");
  const pubFile = `published-${tsName}.md`;
  fs.writeFileSync(path.join(evDir, pubFile),
    `---\nevent: published\ntask: ${TASK}\npublisher: ${PUB}\nop_id: published-${tsName}\nts: ${ts}\n---\n${PUB} 发布 ${TASK}。\n`, "utf-8");
  g(`node tools/sig.js sign ${PUB} "${taskDir}/events/${pubFile}"`);
  const ledger = require(path.join(ROOT, "tools", "ledger.js"));
  ledger.writeEntry({ kind: "escrow", amount: 40, from: PUB, to: `escrow-${TASK}`,
    note: `任务 ${TASK} escrow 冻结`, signer: PUB, privKeyPath: `keys/${PUB}/private.pem` });
  g(`git add "${taskDir}"`);
  g(`git -c user.name="${PUB}" -c user.email="${PUB.toLowerCase()}@agentmarket.local" commit -q -m "feat: ${TASK} 发布（${PUB}）"`);
  g(`git push "${BARE}" main`);
  console.log("  T-3003 已发布到离线 bare");

  // 2. 启动 mock-llm（后台）
  const mock = spawn("node", [path.join(ROOT, "tools", "mock-llm.js"), "--port=3999"], { stdio: "ignore" });
  await sleep(1200);

  // 3. 跑 agent-runner loop（mock 模式，最多 3 轮）
  const env = { ...process.env, LLM_BASE_URL: "http://127.0.0.1:3999/v1", LLM_API_KEY: "test", LLM_MODEL: "mock" };
  const runner = spawn("node", [path.join(ROOT, "tools", "agent-runner.js"), "loop",
    "--agent", WORKER, "--llm", "mock", "--max-rounds", "3", "--interval", "1"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  runner.stdout.on("data", (d) => out += d.toString());
  runner.stderr.on("data", (d) => out += d.toString());

  // 4. 轮询闭环产物（≤45s）
  const deadline = Date.now() + 45000;
  let done = false;
  while (Date.now() < deadline) {
    const hasResult = fs.existsSync(path.join(taskDir, "result", "result.json"));
    const submitted = fs.existsSync(evDir) && fs.readdirSync(evDir).some((f) => f.startsWith("submitted-"));
    const runnerDone = runner.exitCode !== null;
    if (hasResult && submitted && runnerDone) { done = true; break; }
    if (runnerDone && runner.exitCode !== 0) break;
    await sleep(1500);
  }

  // 5. 断言
  console.log("=== loop 输出（关键行）===");
  console.log(out.split("\n").filter((l) => /认领|执行|验证|提交|结算|签名|发现/.test(l)).slice(0, 20).join("\n"));
  check("result/result.json 已产出", fs.existsSync(path.join(taskDir, "result", "result.json")), "loop 未产出 result");
  const submittedFile = fs.existsSync(evDir) ? fs.readdirSync(evDir).find((f) => f.startsWith("submitted-")) : null;
  check("submitted 事件存在", !!submittedFile, "无 submitted 事件");
  if (submittedFile) {
    try {
      g(`node tools/sig.js verify "${path.join(evDir, submittedFile).replace(/\\/g, "/")}"`);
      check("submitted 签名有效", true, "");
    } catch (e) { check("submitted 签名有效", false, e.message); }
  }
  const settledOk = /结算: ✅/.test(out);
  check("loop 自动结算成功（operator 签名，T1）", settledOk, "loop 未显示 结算: ✅");
  const settledFile = fs.existsSync(evDir) ? fs.readdirSync(evDir).find((f) => f.startsWith("settled-")) : null;
  if (settledFile) {
    try {
      g(`node tools/sig.js verify "${path.join(evDir, settledFile).replace(/\\/g, "/")}"`);
      check("settled 事件签名有效（operator）", true, "");
    } catch (e) { check("settled 事件签名有效（operator）", false, e.message); }
  } else {
    check("settled 事件存在", false, "loop 未完成结算");
  }
  check("闭环完成", done, "45s 内未闭环");

  // 6. 清理：恢复 origin、删 bare、杀 mock、精确回退（幂等）
  runner.kill(); mock.kill();
  try { g(`git remote set-url origin https://github.com/ptreezh/agentmarket.git`); } catch (e) {}
  try { g("git reset --hard " + headBefore); } catch (e) { console.error("清理 reset 失败: " + e.message); }
  try { g("git clean -fdx " + path.join("tasks", TASK)); } catch (e) {}
  fs.rmSync(BARE, { recursive: true, force: true });
  fs.rmSync(taskDir, { recursive: true, force: true });

  console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
