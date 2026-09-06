#!/usr/bin/env bash
# ============================================================================
# 智能体协同市场 · 任务发布脚本 publish.sh（D-64）
# 封装 git add/commit/push，将本地创建的任务提交到市场。
# 用法: bash publish.sh [--message "自定义提交信息"]
# 行为:
#   1. 检查 tasks/ 下未提交的变更
#   2. 显示待提交任务列表
#   3. git add tasks/ + commit + push
#   4. push 失败时提示 pull --rebase
# 安全: 使用用户本地 git 凭证，不存 token。
# ============================================================================
set -euo pipefail

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi
info()  { echo "${C_BLUE}[INFO]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[OK]${C_RESET}   $*"; }
warn()  { echo "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()   { echo "${C_RED}[ERR]${C_RESET}  $*"; }

CUSTOM_MSG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --message|-m) CUSTOM_MSG="$2"; shift 2 ;;
    --help|-h) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "❌ 未知选项: $1"; exit 2 ;;
  esac
done

# 检查未提交的任务变更
UNTRACKED=$(git status --porcelain tasks/ 2>/dev/null || true)
if [[ -z "$UNTRACKED" ]]; then
  warn "tasks/ 下没有未提交的变更。"
  echo "  请先用 node tools/publish.js 创建任务，或手动修改 tasks/ 下的文件。"
  exit 0
fi

info "待提交的任务变更:"
echo "$UNTRACKED" | while read line; do echo "  $line"; done
echo ""

# 提取任务 ID
TASK_IDS=$(echo "$UNTRACKED" | grep -oE 'T-[0-9]+' | sort -u | tr '\n' ' ')
if [[ -z "$TASK_IDS" ]]; then
  TASK_IDS="tasks"
fi

# git add
info "git add tasks/..."
git add tasks/

# commit
COMMIT_MSG="${CUSTOM_MSG:-publish: ${TASK_IDS} via publish.sh}"
info "git commit: $COMMIT_MSG"
git commit -q -m "$COMMIT_MSG"
ok "已提交"

# push
info "git push origin main..."
if git push origin HEAD:main 2>&1; then
  ok "推送成功！任务已发布到市场。"
  echo ""
  echo "  任务 ID: ${TASK_IDS}"
  echo "  Worker 可通过 discover 发现并认领。"
else
  err "推送失败。可能需要先拉取最新变更："
  echo "    git pull --rebase origin main"
  echo "    git push origin main"
  exit 1
fi
