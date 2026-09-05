#!/usr/bin/env node
/* LLM 客户端模块 · llm.js（OpenAI 兼容 API）
 * 用法（作为模块）:
 *   const llm = require('./llm.js');
 *   const resp = await llm.chat([{role:'user',content:'...'}], {maxTokens:150});
 * 用法（CLI 测试）:
 *   node tools/llm.js chat "你好"          # 用环境变量配置调用真实 LLM
 *   node tools/llm.js test                 # 检测配置并测试连通性
 * 配置（优先级：命令行 > 环境变量 > 配置文件）:
 *   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 *   或 ~/.agent-market/config.json: {"baseUrl":"...","apiKey":"...","model":"..."}
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

function loadConfig() {
  const cfg = {
    baseUrl: process.env.LLM_BASE_URL || "",
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "",
    timeout: parseInt(process.env.LLM_TIMEOUT || "30000", 10),
  };
  const cfgFile = path.join(process.env.HOME || "~", ".agent-market", "config.json");
  if (!cfg.baseUrl && fs.existsSync(cfgFile)) {
    try {
      const f = JSON.parse(fs.readFileSync(cfgFile, "utf-8"));
      cfg.baseUrl = f.baseUrl || cfg.baseUrl;
      cfg.apiKey = f.apiKey || cfg.apiKey;
      cfg.model = f.model || cfg.model;
      cfg.timeout = f.timeout || cfg.timeout;
    } catch (e) { /* 忽略配置解析错误 */ }
  }
  return cfg;
}

function hasKey() {
  const c = loadConfig();
  return !!(c.baseUrl && c.apiKey && c.model);
}

function postJSON(urlStr, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const opts = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, headers),
      timeout,
    };
    const req = lib.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try {
          const j = JSON.parse(buf);
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${j.error?.message || buf.slice(0,200)}`));
          else resolve(j);
        } catch (e) { reject(new Error(`JSON parse error: ${buf.slice(0,200)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("LLM request timeout")); });
    req.write(data);
    req.end();
  });
}

async function chat(messages, opts = {}) {
  const cfg = loadConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    throw new Error("LLM 未配置（缺 baseUrl/apiKey/model），请设置环境变量或 ~/.agent-market/config.json");
  }
  const body = {
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens || 1024,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.3,
  };
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  const j = await postJSON(`${cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, body, headers, cfg.timeout);
  return j.choices?.[0]?.message?.content || "";
}

// 决策 prompt 构造（上下文预算≤150 token）
function buildDecisionPrompt(agentId, caps, rep, tasks) {
  const taskList = tasks.map((t, i) => `${i + 1}. ${t.task}: ${t.title}，复杂度${t.complexity}，预算${t.budget}，敏感${t.sens}`).join("\n");
  return `你是智能体 ${agentId}，能力标签：${caps.join(",")}，信誉：${rep}。
可认领任务列表：
${taskList}
决策：输出 "claim <task_id>" 认领一个任务，或 "skip" 跳过。只输出决策，不要解释。`;
}

// 执行 prompt 构造
function buildExecutionPrompt(spec, inputContent) {
  return `任务：${spec.title}
输入内容：
${inputContent}
输出 schema：
${spec.output_schema || "（见 spec）"}
请按输出 schema 产出结果。如果输出是 JSON，只输出 JSON 不要解释。`;
}

// CLI
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  (async () => {
    if (cmd === "test") {
      const c = loadConfig();
      console.log("配置检测:");
      console.log(`  baseUrl: ${c.baseUrl ? c.baseUrl.slice(0,40)+"..." : "(未设置)"}`);
      console.log(`  apiKey:  ${c.apiKey ? c.apiKey.slice(0,8)+"..." : "(未设置)"}`);
      console.log(`  model:   ${c.model || "(未设置)"}`);
      console.log(`  hasKey:  ${hasKey()}`);
      if (hasKey()) {
        try {
          const r = await chat([{ role: "user", content: "回复'OK'两个字" }], { maxTokens: 10 });
          console.log(`  连通性: ✅ LLM 响应: ${r}`);
        } catch (e) { console.log(`  连通性: ❌ ${e.message}`); }
      }
    } else if (cmd === "chat") {
      if (!hasKey()) { console.error("LLM 未配置"); process.exit(1); }
      const r = await chat([{ role: "user", content: args.join(" ") }]);
      console.log(r);
    } else {
      console.log("用法: llm.js test | chat <消息>");
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { chat, hasKey, loadConfig, buildDecisionPrompt, buildExecutionPrompt };
