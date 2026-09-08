#!/usr/bin/env node
/* 智能体节点运行时 · agent-runner.js v2.0（含 loop 自主循环）
 * 本工具自动化「git 操作层 + 决策层 + 执行层」：
 *   - 模式A（无 LLM key）：人工/外接决策，调用 discover/claim/submit
 *   - 模式B（有 LLM key）：loop 自主循环，LLM 决策+执行
 *   - mock 模式：LLM_BASE_URL 指向 mock-llm.js，用于集成测试
 * 用法:
 *   node tools/agent-runner.js discover
 *   node tools/agent-runner.js claim <task> <id> <opid>
 *   node tools/agent-runner.js submit <task> <id> <opid> <desc>
 *   node tools/agent-runner.js info
 *   node tools/agent-runner.js loop --agent <id> [--interval 30] [--max-rounds 0] [--llm auto|mock|manual]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const g = c => execSync(c, { encoding: "utf-8" }).trim();
const [cmd, ...rest] = process.argv.slice(2);
const TASK_RE = /^T-[0-9A-Z]+$/;
const llm = require("./llm.js");

// ========== 多镜像故障转移（D-92~D-96） ==========
function loadConfig() {
  try { return JSON.parse(fs.readFileSync("market-config.json", "utf-8")); }
  catch (e) { return {}; }
}
function hasMirror() {
  try {
    const out = execSync("git remote get-url mirror 2>/dev/null", { encoding: "utf-8" }).trim();
    return out.length > 0;
  } catch (e) { return false; }
}
function isNetworkUnreachable(e) {
  const msg = (e.stderr?.toString() || e.message || "").toLowerCase();
  return /could not resolve host|failed to connect|operation timed out|connection reset|connection refused|502|503|504|service unavailable/.test(msg);
}
function fetchWithFailover(agentId) {
  const cfg = loadConfig();
  const retries = cfg.failover?.fetch_retries ?? 2;
  // 1. 尝试 primary（重试 N 次，避免临时网络抖动误判）
  for (let i = 0; i < retries; i++) {
    try {
      execSync("git fetch --filter=blob:none origin main --quiet", { encoding: "utf-8", stdio: "pipe", timeout: 15000 });
      execSync("git reset --hard origin/main --quiet", { encoding: "utf-8", stdio: "pipe", timeout: 10000 });
      return { source: "primary", ok: true };
    } catch (e) {
      if (!isNetworkUnreachable(e)) return { source: "primary", ok: false, error: e.message };
    }
  }
  // 2. 尝试 mirror（只读故障转移）
  if (!hasMirror()) return { source: "none", ok: false, error: "primary 不可用且无 mirror" };
  try {
    execSync("git fetch mirror main --quiet", { encoding: "utf-8", stdio: "pipe", timeout: 15000 });
    // 检查 mirror 是否比本地新，避免回退到旧数据
    const ahead = parseInt(execSync("git rev-list --count HEAD..FETCH_HEAD", { encoding: "utf-8" }).trim());
    if (ahead > 0) {
      execSync("git reset --hard FETCH_HEAD --quiet", { encoding: "utf-8", stdio: "pipe", timeout: 10000 });
      if (agentId) log(agentId, "⚠️ primary 不可用，使用 mirror 只读（数据可能延迟）");
      return { source: "mirror", ok: true, stale: true };
    }
    return { source: "mirror", ok: true, stale: true, noUpdate: true };
  } catch (e2) {
    return { source: "none", ok: false, error: e2.message };
  }
}
function refCheckWithFailover(t, agentId) {
  // 1. 尝试 primary
  try {
    const out = execSync(`git ls-remote origin refs/claims/${t}`, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim();
    return { claimed: out.length > 0, source: "primary" };
  } catch (e) {
    if (!isNetworkUnreachable(e)) return { claimed: false, source: "primary", error: e.message };
  }
  // 2. 尝试 mirror（标注 stale）
  if (!hasMirror()) return { claimed: false, source: "none", error: true };
  try {
    const out = execSync(`git ls-remote mirror refs/claims/${t}`, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }).trim();
    return { claimed: out.length > 0, source: "mirror", stale: true };
  } catch (e2) {
    return { claimed: false, source: "none", error: true };
  }
}
function syncToMirror(agentId) {
  // push primary 成功后，best-effort 同步所有 refs 到 mirror
  if (!hasMirror()) return;
  try {
    execSync('git push mirror "refs/heads/*:refs/heads/*" "refs/claims/*:refs/claims/*" "refs/tasks/*:refs/tasks/*" --quiet',
      { encoding: "utf-8", stdio: "pipe", timeout: 30000 });
    if (agentId) log(agentId, "🔄 已同步到 mirror");
  } catch (e) {
    if (agentId) log(agentId, `⚠️ mirror 同步失败（不阻塞）: ${e.message?.slice(0, 80)}`);
  }
}

// ========== 日志 ==========
function logPath(id) {
  const d = new Date().toISOString().slice(0, 10);
  const dir = path.join("logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `agent-${id}-${d}.log`);
}
function log(id, msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath(id), line + "\n"); } catch (e) {}
}

// ========== D-19 签名 ==========
function signEvent(id, file) {
  const sig = path.join(__dirname, "sig.js");
  const r = spawnSync(process.execPath, [sig, "sign", id, file], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error("签名失败: " + (r.stderr || r.stdout || "?"));
}

// ========== git 重试封装（D-73） ==========
function gitWithRetry(cmd, maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    try {
      // push 前先 pull --rebase
      if (cmd.startsWith("git push")) {
        try { execSync("git pull --rebase origin main", { encoding: "utf-8", stdio: "pipe" }); } catch (e) {}
      }
      return execSync(cmd, { encoding: "utf-8" }).trim();
    } catch (e) {
      if (i < maxRetry - 1) {
        try { execSync("git pull --rebase origin main", { encoding: "utf-8", stdio: "pipe" }); } catch (e2) {}
        continue;
      }
      throw e;
    }
  }
}

// ========== 任务状态 ==========
function taskState(t) {
  const ev = path.join("tasks", t, "events");
  if (!fs.existsSync(ev)) return "unknown";
  const f = fs.readdirSync(ev);
  const sd = f.some(x => x.startsWith("settled-")); // settled 事件存在 = 已结算（D-114，优先于 verify-result 判定）
  if (sd) return "settled";
  const cl = f.some(x => x.startsWith("claimed-"));
  const sb = f.some(x => x.startsWith("submitted-"));
  const rs = fs.existsSync(path.join("tasks", t, "result", "verify-result.json"));
  if (rs) return "settled";
  return cl ? (sb ? "submitted" : "claimed") : (f.some(x => x.startsWith("published-")) ? "published" : "draft");
}
function specMeta(t) {
  const s = fs.readFileSync(path.join("tasks", t, "spec.md"), "utf-8");
  const m = k => (s.match(new RegExp("^" + k + ":\\s*(.+)$", "m")) || [])[1];
  return { title: m("title"), complexity: m("complexity"), budget: m("budget"),
           sens: m("sens"), est_range: m("est_range"), id: m("id"),
           output_schema: (s.match(/^output_schema:\s*([\s\S]*?)(?=\n[a-z_]+:|\n---|$)/m) || [])[1]?.trim() };
}
function discover(agentId) {
  // 多镜像故障转移：primary 失败自动切 mirror 只读
  const fr = fetchWithFailover(agentId);
  if (!fr.ok) {
    if (agentId) log(agentId, `❌ fetch 失败（${fr.source}）: ${fr.error || "未知"}`);
    return [];
  }
  return (fs.existsSync("tasks") ? fs.readdirSync("tasks").filter(d => TASK_RE.test(d)) : [])
    .filter(t => taskState(t) === "published")
    .filter(t => !refCheckWithFailover(t, agentId).claimed) // HCA: 排除已被 ref 锁认领的任务
    .map(t => Object.assign({ task: t, state: "published" }, specMeta(t)));
}

// ========== HCA: Git refs 原子认领锁（D-84/D-85） ==========
// 检查任务是否已被认领（只读 ls-remote，~103字节，不修改本地）
function refCheck(t) {
  try {
    const out = execSync(`git ls-remote origin refs/claims/${t}`, { encoding: "utf-8" }).trim();
    return out.length > 0; // 有输出 = ref 存在 = 已被认领
  } catch (e) { return false; } // ls-remote 失败时保守认为未认领（走旧逻辑）
}

// 原子认领：push ref，成功=认领，失败(non-fast-forward)=已被认领
function refClaim(t, id) {
  try {
    execSync(`git push origin HEAD:refs/claims/${t}`, { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch (e) {
    // non-fast-forward = ref 已存在 = 已被认领
    return false;
  }
}

// ========== 认领（重构为返回值，loop 可用） ==========
function claimTask(t, id, opid) {
  if (!TASK_RE.test(t) || !/^[A-Za-z0-9_-]+$/.test(id)) return { ok: false, reason: "非法参数" };
  const st = taskState(t);
  if (st !== "published") return { ok: false, reason: `不可认领 state=${st}` };
  // D-46 白名单
  const spec = fs.readFileSync(path.join("tasks", t, "spec.md"), "utf-8");
  const sens = (spec.match(/^sens:\s*(\S+)/m) || [])[1] || "L0";
  if (sens === "L1" || sens === "L2") {
    const al = path.join("tasks", t, "restricted", "allowlist.md");
    const fpMatch = fs.readFileSync(path.join("agents", id, "agent.md"), "utf-8").match(/^key_fingerprint:\s*(\S+)/m);
    if (!fpMatch) return { ok: false, reason: "agent 无指纹" };
    const fp = fpMatch[1];
    const inList = fs.existsSync(al) && new RegExp("^" + id + "\\s+" + fp.replace(/[.+?^${}()|[\]\\]/g, "\\$&") + "$", "m").test(fs.readFileSync(al, "utf-8"));
    if (!inList) return { ok: false, reason: `${sens} 机密任务不在白名单` };
  }
  // HCA: 先用 ref 原子锁认领（D-85）
  const rc = refCheckWithFailover(t, id);
  if (rc.claimed) return { ok: false, reason: "ref 检查：已被认领" };
  // D-96: mirror 模式下 refCheck 返回"未认领"时不直接认领（防止 mirror 延迟）
  if (rc.source === "mirror" && rc.stale) {
    return { ok: false, reason: "mirror 只读模式：ref 状态可能延迟，暂不认领（等 primary 恢复）" };
  }
  if (rc.source === "none") return { ok: false, reason: "primary 和 mirror 均不可用，无法确认认领状态" };
  if (!refClaim(t, id)) return { ok: false, reason: "ref 原子认领失败（他人先占）" };
  log(id, `[hca] ref 原子认领成功 ${t}`);

  const evDir = path.join("tasks", t, "events");
  fs.mkdirSync(evDir, { recursive: true });
  const fn = `claimed-${opid}-${id}.md`;
  const evPath = path.join(evDir, fn);
  fs.writeFileSync(evPath,
    `---\nevent: claimed\ntask: ${t}\nworker: ${id}\nop_id: ${opid}\nts: ${new Date().toISOString()}\n---\n${id} 认领 ${t}。\n`);
  try { signEvent(id, evPath); } catch (e) {
    try { fs.unlinkSync(evPath); } catch (_) {}
    return { ok: false, reason: `签名失败: ${e.message}` };
  }
  gitWithRetry(`git add tasks/${t}/events/${fn} && git commit -q -m "claim ${t} by ${id}"`);
  gitWithRetry("git push origin HEAD:main");
  syncToMirror(id); // D-93: push 成功后自动同步 mirror（best-effort）
  // 冲突检测
  const others = fs.readdirSync(evDir).filter(f => f.startsWith("claimed-") && f !== fn).map(f => {
    const m = fs.readFileSync(path.join(evDir, f), "utf-8").match(/worker:\s*(\S+)/);
    return m ? m[1] : "?";
  }).filter(o => o && o !== id);
  if (others.length) {
    try { execSync("git reset --hard origin/main", { stdio: "pipe" }); } catch (e) {}
    return { ok: false, reason: `已被他人认领(${others.join(",")})` };
  }
  return { ok: true, event: fn };
}

// ========== 提交（重构为返回值） ==========
function submitTask(t, id, opid, desc) {
  const evDir = path.join("tasks", t, "events");
  fs.mkdirSync(evDir, { recursive: true });
  const fn = `submitted-${opid}-${id}.md`;
  const evPath = path.join(evDir, fn);
  fs.writeFileSync(evPath,
    `---\nevent: submitted\ntask: ${t}\nworker: ${id}\nop_id: ${opid}\nts: ${new Date().toISOString()}\n---\n${desc || ""}\n`);
  try { signEvent(id, evPath); } catch (e) {
    try { fs.unlinkSync(evPath); } catch (_) {}
    return { ok: false, reason: `签名失败: ${e.message}` };
  }
  gitWithRetry(`git add tasks/${t}/events/${fn} && git commit -q -m "submit ${t} by ${id}"`);
  gitWithRetry("git push origin HEAD:main");
  syncToMirror(id); // D-93: push 成功后自动同步 mirror（best-effort）
  return { ok: true, event: fn };
}

// ========== 执行任务（LLM 推理 + 写 result） ==========
async function executeTask(t, id) {
  const spec = specMeta(t);
  const specFull = fs.readFileSync(path.join("tasks", t, "spec.md"), "utf-8");
  // 读 input_ref
  const inputMatch = specFull.match(/^input_ref:\s*(\S+)/m);
  let inputContent = "(无输入文件)";
  if (inputMatch) {
    const inputPath = path.join("tasks", t, inputMatch[1]);
    if (fs.existsSync(inputPath)) inputContent = fs.readFileSync(inputPath, "utf-8").slice(0, 4000);
  }
  // L2 受限体解密
  const restrictedPath = path.join("tasks", t, "restricted", "content.enc");
  if (fs.existsSync(restrictedPath)) {
    try {
      const r = spawnSync(process.execPath, [path.join(__dirname, "crypt.js"), "open", t, id], { encoding: "utf-8" });
      if (r.status === 0) inputContent = r.stdout;
    } catch (e) { log(id, `L2 解密失败: ${e.message}`); }
  }
  // 构造执行 prompt
  const prompt = llm.buildExecutionPrompt(spec, inputContent);
  const result = await llm.chat([{ role: "user", content: prompt }], { maxTokens: 2000, temperature: 0.2 });
  // 写 result
  const resultDir = path.join("tasks", t, "result");
  fs.mkdirSync(resultDir, { recursive: true });
  const resultFile = path.join(resultDir, "result.json");
  // 尝试解析为 JSON，否则存为文本
  try {
    const parsed = JSON.parse(result);
    fs.writeFileSync(resultFile, JSON.stringify(parsed, null, 2));
  } catch (e) {
    fs.writeFileSync(path.join(resultDir, "result.txt"), result);
    fs.writeFileSync(resultFile, JSON.stringify({ result_text: result }));
  }
  // L2 结果加密交付（D-45）
  if (spec.sens === "L2") {
    try {
      spawnSync(process.execPath, [path.join(__dirname, "crypt.js"), "seal-result", t, id], { encoding: "utf-8" });
    } catch (e) { log(id, `L2 结果加密失败: ${e.message}`); }
  }
  return { ok: true, resultFile };
}

// ========== 验证（L0 断言） ==========
function verifyTask(t) {
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "verify.js"), path.join("tasks", t)], { encoding: "utf-8" });
    return { ok: r.status === 0, output: r.stdout + r.stderr };
  } catch (e) { return { ok: false, output: e.message }; }
}

// ========== 结算（调用结算器） ==========
function settleTask(t, id) {
  try {
    // 查找结算脚本（M0 用 settle.js，若不存在则跳过）
    const settlePath = path.join(__dirname, "settle.js");
    if (fs.existsSync(settlePath)) {
      const r = spawnSync(process.execPath, [settlePath, t], { encoding: "utf-8" });
      return { ok: r.status === 0, output: r.stdout + r.stderr };
    }
    return { ok: true, output: "结算脚本不存在，跳过（人工结算）" };
  } catch (e) { return { ok: false, output: e.message }; }
}

// ========== Agent 信息 ==========
function agentInfo(id) {
  const f = path.join("agents", id, "agent.md");
  if (!fs.existsSync(f)) return { caps: ["general"], rep: 0 };
  const s = fs.readFileSync(f, "utf-8");
  const caps = (s.match(/^capabilities:\s*(.+)$/m) || [])[1]?.split(",").map(x => x.trim()) || ["general"];
  const rep = parseInt((s.match(/^reputation:\s*(\d+)/m) || [])[1] || "0", 10);
  return { caps, rep };
}

// ========== 并发控制：是否有未结算的已认领任务 ==========
function hasActiveClaim(id) {
  const tasks = fs.existsSync("tasks") ? fs.readdirSync("tasks").filter(d => TASK_RE.test(d)) : [];
  for (const t of tasks) {
    const st = taskState(t);
    if (st === "claimed" || st === "submitted") {
      const evDir = path.join("tasks", t, "events");
      if (fs.existsSync(evDir)) {
        const claimed = fs.readdirSync(evDir).find(f => f.startsWith("claimed-") && f.includes(id));
        if (claimed) return true;
      }
    }
  }
  return false;
}

// ========== loop 自主循环 ==========
async function loop(id, opts) {
  const interval = opts.interval || 30;
  const maxRounds = opts.maxRounds || 0; // 0=无限
  const llmMode = opts.llm || "auto"; // auto=有key用LLM,无key降级manual; mock=强制用mock; manual=人工
  log(id, `=== loop 启动 agent=${id} interval=${interval}s llm=${llmMode} maxRounds=${maxRounds || "∞"} ===`);

  // LLM 模式检测
  let useLLM = false;
  if (llmMode === "mock") { useLLM = true; log(id, "LLM 模式: mock（使用 mock-llm）"); }
  else if (llmMode === "manual") { useLLM = false; log(id, "LLM 模式: manual（人工决策）"); }
  else { // auto
    useLLM = llm.hasKey();
    log(id, useLLM ? "LLM 模式: auto（已配置 LLM key）" : "LLM 模式: auto（未配置 LLM key → 降级为人工决策模式，discover 后暂停等待人工 claim）");
  }

  let round = 0;
  let backoff = interval; // 退避间隔

  while (maxRounds === 0 || round < maxRounds) {
    round++;
    log(id, `--- 第 ${round} 轮 ---`);
    try {
      // 0. git pull 同步最新
      try { execSync("git pull --rebase origin main", { encoding: "utf-8", stdio: "pipe" }); } catch (e) {}

      // 1. 并发控制（D-37 probation 并发上限 1）
      if (hasActiveClaim(id)) {
        log(id, "有未结算任务，跳过认领（等待结算）");
        await sleep(interval * 1000);
        continue;
      }

      // 2. discover
      const tasks = discover(id);
      if (tasks.length === 0) {
        log(id, `无可认领任务，退避 ${backoff}s（D-72 指数退避）`);
        await sleep(backoff * 1000);
        backoff = Math.min(backoff * 2, 300); // 上限 300s
        continue;
      }
      backoff = interval; // 有任务时恢复
      log(id, `发现 ${tasks.length} 个可认领任务: ${tasks.map(t => t.task).join(", ")}`);

      // 3. 决策
      let decision = null;
      if (useLLM) {
        const info = agentInfo(id);
        const prompt = llm.buildDecisionPrompt(id, info.caps, info.rep, tasks);
        log(id, `LLM 决策中（prompt ${prompt.length} chars）...`);
        const resp = await llm.chat([{ role: "user", content: prompt }], { maxTokens: 50, temperature: 0.1 });
        log(id, `LLM 决策: ${resp}`);
        const m = resp.match(/claim\s+(T-[0-9A-Z]+)/i);
        if (m && tasks.some(t => t.task === m[1])) decision = m[1];
        else log(id, "LLM 决策为 skip 或无效，跳过本轮");
      } else {
        // 人工模式：输出 discover 结果后暂停（不自动 claim）
        log(id, "人工模式: 请手动执行 claim，或配置 LLM key 后重启 loop");
        log(id, `可认领任务: ${JSON.stringify(tasks, null, 2)}`);
        await sleep(interval * 1000);
        continue;
      }

      if (!decision) { await sleep(interval * 1000); continue; }

      // 4. claim
      const opid = `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      log(id, `认领 ${decision} (op_id=${opid})...`);
      const claimRes = claimTask(decision, id, opid);
      if (!claimRes.ok) {
        log(id, `认领失败: ${claimRes.reason}（尝试下一个任务）`);
        // 尝试下一个任务
        const next = tasks.find(t => t.task !== decision);
        if (next) {
          const opid2 = `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const r2 = claimTask(next.task, id, opid2);
          if (r2.ok) { decision = next.task; log(id, `改认领 ${next.task} 成功`); }
          else { log(id, `改认领也失败: ${r2.reason}`); await sleep(interval * 1000); continue; }
        } else { await sleep(interval * 1000); continue; }
      }
      log(id, `✅ 认领成功 ${decision}`);

      // 5. execute
      log(id, `执行 ${decision}...`);
      const execRes = await executeTask(decision, id);
      log(id, `执行完成: ${execRes.resultFile}`);

      // 6. verify
      const vRes = verifyTask(decision);
      log(id, `验证: ${vRes.ok ? "✅ PASS" : "❌ FAIL"} ${vRes.output.slice(0, 200)}`);

      // 7. submit
      const submitOpid = `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const subRes = submitTask(decision, id, submitOpid, vRes.ok ? "验证通过" : `验证失败: ${vRes.output.slice(0, 100)}`);
      log(id, subRes.ok ? `✅ 提交成功 ${decision}` : `❌ 提交失败: ${subRes}`);

      // 8. settle（尝试自动结算）
      const sRes = settleTask(decision, id);
      log(id, `结算: ${sRes.ok ? "✅" : "⚠️"} ${sRes.output.slice(0, 100)}`);

    } catch (e) {
      log(id, `❌ 本轮异常: ${e.message}`);
      log(id, e.stack?.split("\n").slice(0, 3).join("\n") || "");
    }

    // 等待下一轮
    await sleep(interval * 1000);
  }
  log(id, `=== loop 结束（达到 maxRounds=${maxRounds}）===`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== CLI ==========
if (cmd === "loop") {
  // 解析参数
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--agent") opts.agent = rest[++i];
    else if (rest[i] === "--interval") opts.interval = parseInt(rest[++i], 10);
    else if (rest[i] === "--max-rounds") opts.maxRounds = parseInt(rest[++i], 10);
    else if (rest[i] === "--llm") opts.llm = rest[++i];
  }
  if (!opts.agent) { console.error("usage: loop --agent <id> [--interval 30] [--max-rounds 0] [--llm auto|mock|manual]"); process.exit(2); }
  loop(opts.agent, opts).catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "discover") {
  const c = discover();
  console.log(JSON.stringify(c, null, 2));
  console.log(c.length ? `→ ${c.length} 个可认领任务` : "→ 无可认领任务");
} else if (cmd === "claim") {
  const [t, id, opid] = rest;
  if (!t || !id || !opid) { console.error("usage: claim <task> <id> <opid>"); process.exit(2); }
  const r = claimTask(t, id, opid);
  console.log(r.ok ? `✅ 认领成功 ${t}（${r.event}）` : `❌ 认领失败: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "submit") {
  const [t, id, opid, desc] = rest;
  if (!t || !id || !opid) { console.error("usage: submit <task> <id> <opid> <desc>"); process.exit(2); }
  const r = submitTask(t, id, opid, desc || "");
  console.log(r.ok ? `✅ 已提交 ${t}` : `❌ 提交失败`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === "info") {
  const tasks = fs.existsSync("tasks") ? fs.readdirSync("tasks").filter(d => TASK_RE.test(d)) : [];
  console.log(`节点: ${g("git config user.name")} <${g("git config user.email")}>`);
  console.log(`分支: ${g("git branch --show-current")} @ ${g("git rev-parse --short HEAD")}`);
  console.log(`任务: ${tasks.map(t => `${t}(${taskState(t)})`).join(" ")}`);
} else {
  console.log("用法: agent-runner.js discover | claim <task> <id> <opid> | submit <task> <id> <opid> <desc> | info | loop --agent <id> [--interval 30] [--max-rounds 0] [--llm auto|mock|manual]");
}
