#!/usr/bin/env bash
# ============================================================================
# 智能体协同市场 · 进程保活 keepalive.sh（D-69）
# 用法:
#   bash keepalive.sh [选项]
#
# 选项:
#   --pid-file <路径>   agent-runner PID 文件（默认 ./logs/agent-runner.pid）
#   --log-file <路径>   keepalive 日志（默认 ./logs/keepalive.log）
#   --interval <秒>     检查间隔（默认 30）
#   --max-restarts <N>  每小时最大重启次数（默认 5，防崩溃循环）
#   --cmd <命令>        崩溃后重启的命令（默认从 PID 文件旁的 .cmd 读取）
#   --dry-run           只检查不重启
#   --help              显示帮助
#
# 工作原理:
#   1. 读取 PID 文件，检查进程是否存活
#   2. 进程崩溃 → 记录退出码 → 指数退避后重启
#   3. 每小时重启次数超过上限 → 停止重启，告警（防崩溃循环）
#   4. 正常运行 → 等待 interval 后再次检查
#
# 与 join.sh --daemon 配合:
#   join.sh --daemon 启动 agent-runner 后写入 PID 文件和 .cmd 文件
#   keepalive.sh 读取这两个文件进行保活
# ============================================================================
set -euo pipefail

# ---------- 默认参数 ----------
PID_FILE="./logs/agent-runner.pid"
LOG_FILE="./logs/keepalive.log"
INTERVAL=30
MAX_RESTARTS=5
RESTART_CMD=""
DRY_RUN=false

# ---------- 颜色输出 ----------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi
log()  { echo "${C_BLUE}[KEEPALIVE]${C_RESET} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
ok()   { echo "${C_GREEN}[OK]${C_RESET} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
warn() { echo "${C_YELLOW}[WARN]${C_RESET} $(date '+%Y-%m-%d %H:%M:%S') $*"; }
err()  { echo "${C_RED}[ERROR]${C_RESET} $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pid-file)     PID_FILE="$2"; shift 2 ;;
    --log-file)     LOG_FILE="$2"; shift 2 ;;
    --interval)     INTERVAL="$2"; shift 2 ;;
    --max-restarts) MAX_RESTARTS="$2"; shift 2 ;;
    --cmd)          RESTART_CMD="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=true; shift ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "❌ 未知选项: $1"; exit 2 ;;
  esac
done

# ---------- 初始化 ----------
mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$PID_FILE")"
exec >> >(tee -a "$LOG_FILE") 2>&1

log "=== keepalive 启动 ==="
log "PID_FILE=$PID_FILE"
log "LOG_FILE=$LOG_FILE"
log "INTERVAL=${INTERVAL}s"
log "MAX_RESTARTS=$MAX_RESTARTS/hour"
log "DRY_RUN=$DRY_RUN"

# 重启历史文件（记录每次重启时间，用于计算每小时重启次数）
RESTART_HISTORY="${PID_FILE}.restarts"

# ---------- 函数 ----------

# 读取 PID 文件
read_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo ""
    return
  fi
  cat "$PID_FILE" 2>/dev/null || echo ""
}

# 检查进程是否存活
is_alive() {
  local pid="$1"
  if [[ -z "$pid" ]]; then return 1; fi
  kill -0 "$pid" 2>/dev/null
}

# 读取重启命令（优先 --cmd，其次 PID 文件旁的 .cmd）
get_restart_cmd() {
  if [[ -n "$RESTART_CMD" ]]; then
    echo "$RESTART_CMD"
    return
  fi
  local cmd_file="${PID_FILE}.cmd"
  if [[ -f "$cmd_file" ]]; then
    cat "$cmd_file"
    return
  fi
  echo ""
}

# 计算最近 1 小时内的重启次数
count_recent_restarts() {
  if [[ ! -f "$RESTART_HISTORY" ]]; then
    echo 0
    return
  fi
  local now=$(date +%s)
  local count=0
  while read -r ts; do
    if [[ -n "$ts" ]] && (( now - ts < 3600 )); then
      ((count++))
    fi
  done < "$RESTART_HISTORY"
  echo "$count"
}

# 记录重启时间
record_restart() {
  date +%s >> "$RESTART_HISTORY"
  # 清理超过 24 小时的记录
  if [[ -f "$RESTART_HISTORY" ]]; then
    local now=$(date +%s)
    local tmp="${RESTART_HISTORY}.tmp"
    while read -r ts; do
      if [[ -n "$ts" ]] && (( now - ts < 86400 )); then
        echo "$ts"
      fi
    done < "$RESTART_HISTORY" > "$tmp"
    mv "$tmp" "$RESTART_HISTORY"
  fi
}

# 指数退避等待（基于最近重启次数）
backoff_wait() {
  local recent="$1"
  local delay=$(( 2 ** recent ))
  if (( delay > 60 )); then delay=60; fi
  if (( delay < 1 )); then delay=1; fi
  log "指数退避: ${delay}s（最近 1 小时重启 $recent 次）"
  sleep "$delay"
}

# 重启进程
restart_process() {
  local cmd="$1"
  if [[ -z "$cmd" ]]; then
    err "无重启命令（--cmd 或 ${PID_FILE}.cmd 均未设置），无法重启"
    return 1
  fi

  local recent=$(count_recent_restarts)
  if (( recent >= MAX_RESTARTS )); then
    err "最近 1 小时已重启 $recent 次（上限 $MAX_RESTARTS），停止重启！请手动检查崩溃原因。"
    err "重启历史: $RESTART_HISTORY"
    return 1
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    warn "[dry-run] 应执行重启: $cmd"
    return 0
  fi

  backoff_wait "$recent"
  log "重启进程: $cmd"
  # 后台执行重启命令，输出重定向到 agent-runner 日志
  local agent_log="${PID_FILE%.pid}.log"
  nohup bash -c "$cmd" >> "$agent_log" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"
  record_restart
  ok "进程已重启，新 PID=$new_pid"
}

# ---------- 主循环 ----------
CONSECUTIVE_FAILURES=0

while true; do
  pid=$(read_pid)

  if [[ -z "$pid" ]]; then
    warn "PID 文件不存在或为空: $PID_FILE"
    cmd=$(get_restart_cmd)
    if [[ -n "$cmd" ]]; then
      restart_process "$cmd" || {
        err "重启失败，等待下一轮检查"
        ((CONSECUTIVE_FAILURES++))
      }
    else
      warn "无重启命令，等待 PID 文件出现..."
    fi
  elif is_alive "$pid"; then
    CONSECUTIVE_FAILURES=0
    # 进程正常运行，静默（每 10 轮输出一次心跳）
    if (( $(date +%s) % 300 < INTERVAL )); then
      log "心跳: PID=$pid 运行中"
    fi
  else
    warn "进程已崩溃: PID=$pid 不存在"
    cmd=$(get_restart_cmd)
    if [[ -n "$cmd" ]]; then
      restart_process "$cmd" || {
        err "重启失败"
        ((CONSECUTIVE_FAILURES++))
      }
    else
      err "无重启命令，无法自动恢复"
      ((CONSECUTIVE_FAILURES++))
    fi
  fi

  # 连续失败过多，延长检查间隔
  if (( CONSECUTIVE_FAILURES > 5 )); then
    warn "连续失败 $CONSECUTIVE_FAILURES 次，延长检查间隔到 $((INTERVAL * 2))s"
    sleep $((INTERVAL * 2))
  else
    sleep "$INTERVAL"
  fi
done
