#!/usr/bin/env bash
# gateway/deploy-local.sh — 零注册公网暴露（M2 兜底：无需任何平台账户/CAPTCHA）
# 前置：仅需 GITHUB_PAT（运营者最小权限 PAT，本仓库写）
# 用法:
#   GITHUB_PAT=ghp_xxx bash gateway/deploy-local.sh
# 说明: 使用 localhost.run 免费 SSH 隧道（无需注册）。重启后公网 URL 会变化——
#       运营者部署正式 Serverless 版后可固定（见 deploy.sh）。
set -euo pipefail
cd "$(dirname "$0")"

if [[ -z "${GITHUB_PAT:-}" ]]; then
  echo "[ERR] 缺少 GITHUB_PAT 环境变量。请提供最小权限 PAT（仅 ptreezh/agentmarket 内容读写）。"
  echo "  设置: export GITHUB_PAT=ghp_xxx   或   \$env:GITHUB_PAT='ghp_xxx' (PowerShell)"
  exit 1
fi

echo "[INFO] 1/2 启动本机网关 (端口 3000)..."
PORT="${PORT:-3000}"
GITHUB_PAT="$GITHUB_PAT" node local-server.js &
GW_PID=$!
trap 'kill $GW_PID 2>/dev/null || true' EXIT

sleep 1.5
echo "[INFO] 本机健康检查:"
curl -s "http://localhost:$PORT/health" || { echo "网关启动失败"; exit 1; }
echo ""

echo "[INFO] 2/2 建立免费公网隧道 (localhost.run，无需注册)..."
echo "  公网地址见下方 (https://<随机>.lhr.life) — 复制后测试 /health 和 /event"
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:$PORT nokey@localhost.run || {
  echo "[ERR] 隧道失败。备选: serveo.net (ssh -R 80:localhost:$PORT serveo.net) 或使用 Serverless 版 deploy.sh"
  exit 1
}
