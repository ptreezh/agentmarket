#!/usr/bin/env node
/* mock-llm.js · 本地模拟 OpenAI 兼容 API 服务器
 * 用于无 LLM key 环境的集成测试。
 * 用法:
 *   node tools/mock-llm.js [--port 3999] [--delay 100] [--fail-rate 0]
 * 环境变量（供 agent-runner 使用）:
 *   LLM_BASE_URL=http://localhost:3999
 *   LLM_API_KEY=mock-key
 *   LLM_MODEL=mock-model
 * 行为:
 *   - 决策请求（含"可认领任务列表"）→ 返回 "claim <第一个任务ID>"
 *   - 执行请求（含"任务："）→ 返回预设结果（CSV聚合/公告抽取/通用）
 *   - 其他 → 返回 "OK"
 */
"use strict";
const http = require("http");

const args = process.argv.slice(2);
const port = parseInt(args.find(a => a.startsWith("--port"))?.split("=")[1] || "3999", 10);
const delay = parseInt(args.find(a => a.startsWith("--delay"))?.split("=")[1] || "0", 10);
const failRate = parseFloat(args.find(a => a.startsWith("--fail-rate"))?.split("=")[1] || "0");

function extractUserMessage(body) {
  const msgs = body.messages || [];
  return msgs.filter(m => m.role === "user").map(m => m.content).join("\n");
}

function decide(userMsg) {
  // 从任务列表中提取第一个任务 ID
  const match = userMsg.match(/\d+\.\s+(T-\d+)/);
  if (match) return `claim ${match[1]}`;
  return "skip";
}

function execute(userMsg) {
  // 根据任务类型返回预设结果
  if (userMsg.includes("CSV") || userMsg.includes("聚合") || userMsg.includes("sales")) {
    return JSON.stringify({ total_revenue: 12500, avg_order: 250, order_count: 50 });
  }
  if (userMsg.includes("公告") || userMsg.includes("抽取")) {
    return JSON.stringify({ company: "示例公司", event: "业绩预告", amount: "1.2亿" });
  }
  // 通用：返回简单结果
  return JSON.stringify({ result: "completed", summary: "任务已完成" });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.includes("/chat/completions")) {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      // 模拟失败率
      if (Math.random() < failRate) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "mock internal error" } }));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        const userMsg = extractUserMessage(parsed);
        let content;
        if (userMsg.includes("可认领任务列表")) content = decide(userMsg);
        else if (userMsg.includes("任务：")) content = execute(userMsg);
        else content = "OK";

        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id: "mock-" + Date.now(),
            object: "chat.completion",
            model: parsed.model || "mock-model",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          }));
        }, delay);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid JSON" } }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200); res.end("mock-llm OK");
  } else {
    res.writeHead(404); res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`mock-llm listening on http://localhost:${port}`);
  console.log(`环境变量: LLM_BASE_URL=http://localhost:${port} LLM_API_KEY=mock-key LLM_MODEL=mock-model`);
  console.log(`delay=${delay}ms, failRate=${failRate}`);
});
