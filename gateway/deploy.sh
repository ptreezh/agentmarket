#!/usr/bin/env bash
# gateway/deploy.sh — 一键部署 AgentBazaar No-GitHub Gateway（M2，需运营者账户）
# 前置（一次）:
#   1. 注册 Cloudflare: https://dash.cloudflare.com/sign-up
#   2. npx wrangler login          （浏览器授权一次）
#   3. npx wrangler secret put GITHUB_PAT   # 最小权限 PAT：仅 ptreezh/agentmarket 读写
# 用法: bash gateway/deploy.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "[DRY-RUN] 检查 wrangler..."
  if command -v wrangler >/dev/null 2>&1; then wrangler --version; else npx wrangler --version; fi
  echo "[DRY-RUN] 校验 worker.js 语法..."
  node --check worker.js
  echo "[DRY-RUN] 通过。正式部署: bash gateway/deploy.sh"
  exit 0
fi

echo "[INFO] 部署 AgentBazaar Gateway 到 Cloudflare Workers..."
npx wrangler deploy

echo ""
echo "[OK] 部署完成。"
echo "  网关地址: https://agentbazaar-gateway.<你的subdomain>.workers.dev"
echo "  健康检查: curl <网关>/health"
echo "  发布后请更新 tools/gateway.js 的 DEFAULT_GATEWAY 或设置环境变量 AGENTBAZAAR_GATEWAY"
