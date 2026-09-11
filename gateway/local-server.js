#!/usr/bin/env node
/* gateway/local-server.js — 本机零注册网关（M2 兜底方案：无需任何平台账户）
 * 复用 worker.js 的 handleEvent（同一验签/写入逻辑），Node HTTP 服务。
 * 暴露公网：bash gateway/deploy-local.sh（免费 SSH 隧道 localhost.run，无需注册）
 * 唯一外部依赖：GITHUB_PAT（运营者提供，最小权限，仅本仓库写）——环境变量注入。
 *
 * 用法:
 *   $env:GITHUB_PAT="ghp_xxx"; node gateway/local-server.js      # PowerShell
 *   GITHUB_PAT=ghp_xxx node gateway/local-server.js              # bash
 * 健康检查: curl http://localhost:3000/health
 */
"use strict";
const http = require("http");
const { handleEvent } = require("./worker.js");

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "agentbazaar-gateway-local", mode: "no-account", note: "GITHUB_PAT " + (process.env.GITHUB_PAT ? "set" : "MISSING") }));
    return;
  }

  if (url === "/event" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    const ghPat = process.env.GITHUB_PAT || "";
    const result = await handleEvent(body, { fetch: globalThis.fetch, ghPat });
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", use: ["POST /event", "GET /health"] }));
});

server.listen(PORT, () => {
  console.log(`[agentbazaar-gateway-local] listening on http://localhost:${PORT}`);
  console.log(`  GITHUB_PAT: ${process.env.GITHUB_PAT ? "已配置" : "未配置（/event 将返回 write_failed）"}`);
  console.log(`  公网暴露: bash gateway/deploy-local.sh`);
});
