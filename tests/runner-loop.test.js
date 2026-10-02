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
/* 动态测试身份：仓库 keys/ 为 gitignored，CI checkout 无私钥；
 * 固定身份会撞上本地真实密钥（覆盖即破坏身份），故按次生成并清理。 */
const PUB = "AG-LOOP-PUB-" + Date.now().toString(36).toUpperCase();
const WORKER = "AG-LOOP-WK-" + Date.now().toString(36).toUpperCase();

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
  // 0.0 记录仓库级 git 身份（0.2b 会覆盖，清理段需还原，防污染本地仓库配置）
  const origGitName = (() => { try { return g("git config --local user.name"); } catch (e) { return ""; } })();
  const origGitEmail = (() => { try { return g("git config --local user.email"); } catch (e) { return ""; } })();
  // 0.1 保护（D-122 补充）：工作区必须干净——清理段 git reset --hard 会清掉外部未提交改动
  // 过滤测试副产品：loop 认领历史任务（T-3012/3013…）产生的未跟踪 result/ 不视为 dirty（测试隔离副作用）
  const dirty = g("git status --porcelain").split("\n").map(l => l.trim()).filter(l => l && !/^\?\?\s+tasks\/[^/]+\/result\/?$/.test(l)).join("\n");
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

  // 0.2 测试身份准备：动态 agents/<id>/agent.md + keys/<id>（keygen 要求 agent.md 已存在）
  const mkAgent = (id, role) => {
    const d = path.join("agents", id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "agent.md"), `---\nname: ${id}\nrole: ${role}\n---\n`, "utf-8");
    g(`node tools/keygen.js ${id}`);
  };
  mkAgent(PUB, "publisher"); mkAgent(WORKER, "worker");
  // 0.2b 仓库级 git 身份：对齐 join.sh 真实流程（CI 无全局 git 身份，claim/submit 的 commit 会失败）
  g(`git config user.name ${WORKER}`);
  g(`git config user.email ${WORKER.toLowerCase()}@agentmarket.local`);

  // 0.3 临时 operator 密钥：结算由 operator 签名（keys/operator/private.pem gitignored，CI 缺失）。
  //     备份现有密钥 → 生成临时 operator 密钥 → 临时覆盖 OPERATOR_PUBKEY（tracked，清理段 git reset 恢复）。
  const opKey = path.join("keys", "operator", "private.pem");
  const opKeyBak = opKey + ".bak-loop-test";
  let hadOpKey = fs.existsSync(opKey);
  if (hadOpKey) fs.renameSync(opKey, opKeyBak);
  const { publicKey: tmpOpPub, privateKey: tmpOpPriv } = require("crypto").generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(opKey), { recursive: true });
  fs.writeFileSync(opKey, tmpOpPriv.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync("OPERATOR_PUBKEY", tmpOpPub.export({ type: "spki", format: "pem" }));
  // 0.3b 临时公钥提交进 HEAD：loop 的 fetchWithFailover 会 git reset --hard origin/main，
  //     工作区未提交的临时公钥会被清除→恢复为真实公钥，与临时私钥失配（settled 验签失败根因，D-132）
  g(`git add OPERATOR_PUBKEY && git commit -q -m "test(runner-loop): temp operator pubkey (0.3b)"`);
  // 0.3c 立即校验临时私钥写入成功（防静默失败→settled 用旧私钥签名导致验签失败）
  const fpOf = (pem) => "SHA256:" + require("crypto").createHash("sha256").update(require("crypto").createPublicKey(require("crypto").createPrivateKey(pem)).export({ type: "spki", format: "der" })).digest("base64");
  const tmpPrivFp = fpOf(fs.readFileSync(opKey, "utf-8"));
  const tmpPubFp = "SHA256:" + require("crypto").createHash("sha256").update(require("crypto").createPublicKey(fs.readFileSync("OPERATOR_PUBKEY", "utf-8")).export({ type: "spki", format: "der" })).digest("base64");
  console.log(`[diag-0.3c] opKey fp=${tmpPrivFp} pubFp=${tmpPubFp} match=${tmpPrivFp === tmpPubFp} bakExists=${fs.existsSync(opKeyBak)}`);

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
    } catch (e) { check("settled 事件签名有效（operator）", false, "verify 输出: " + (e.stderr || e.stdout || "") + " | " + e.message); }
  } else {
    check("settled 事件存在", false, "loop 未完成结算");
  }
  check("闭环完成", done, "45s 内未闭环");

  // 6. 清理：恢复 origin、删 bare、杀 mock、精确回退（幂等）
  runner.kill(); mock.kill();
  try { g(`git remote set-url origin https://github.com/ptreezh/agentmarket.git`); } catch (e) {}
  try { g("git reset --hard " + headBefore); } catch (e) { console.error("清理 reset 失败: " + e.message); }
  try { g("git clean -fdx " + path.join("tasks", TASK)); } catch (e) {}
  /* 恢复 git 身份（0.2b 覆盖的仓库级配置；原值缺失则 unset 让全局/默认生效） */
  const setOrUnset = (k, v) => { if (v) { try { g(`git config --local ${k} ${v}`); } catch (e) {} } else { try { g(`git config --local --unset-all ${k}`); } catch (e) {} } };
  setOrUnset("user.name", origGitName); setOrUnset("user.email", origGitEmail);
  /* 恢复 operator 密钥与动态身份目录（OPERATOR_PUBKEY 为 tracked，reset 已恢复） */
  try { fs.rmSync(opKey, { force: true }); } catch (e) {}
  if (hadOpKey) { try { fs.renameSync(opKeyBak, opKey); } catch (e) { console.error("恢复 operator 密钥失败: " + e.message); } }
  for (const id of [PUB, WORKER]) {
    try { fs.rmSync(path.join("keys", id), { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(path.join("agents", id), { recursive: true, force: true }); } catch (e) {}
  }
  fs.rmSync(BARE, { recursive: true, force: true });
  fs.rmSync(taskDir, { recursive: true, force: true });
  /* 恢复 tracked 的历史任务目录（T-3003 为真实平台任务，测试发布后需还原 HEAD 版本，避免工作区 dirty 导致后续本地 SKIP） */
  try { g("git checkout -- " + path.join("tasks", TASK)); } catch (e) {}

  console.log(failed === 0 ? "\n✅ 全部通过" : `\n❌ ${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
