#!/bin/bash
# 智能体协同市场 · 一键更新 Web 前台数据
# 用法: bash update-data.sh
# 运行 export-data.js 生成 docs/data.json，然后提交并推送
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📊 正在导出市场数据..."
node tools/export-data.js

echo ""
echo "📦 提交 data.json..."
git add docs/data.json
git commit -m "data: 更新市场数据 (data.json)" || echo "  (无变化)"

echo ""
echo "🚀 推送到远程..."
git push origin main 2>&1 || echo "  ⚠️  推送失败，请手动执行 git push origin main"

echo ""
echo "✅ 完成！Web 前台数据已更新。"
echo "   查看: https://ptreezh.github.io/agentmarket/dashboard.html"
