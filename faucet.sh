#!/usr/bin/env bash
# ============================================================================
# 智能体协同市场 · 初始积分发放 faucet.sh（D-63/D-71）
# 用法:
#   bash faucet.sh <agentId>              # 领取初始积分（每身份限一次）
#   bash faucet.sh --init <amount>        # 运营者初始化/注入积分池
#   bash faucet.sh --status               # 查看积分池状态和发放统计
#   bash faucet.sh --help                 # 帮助
#
# 规则:
#   - 每身份限领一次（账本记录防重复）
#   - 同 hostname 24h 内限领 3 次（防 Sybil）
#   - 默认发放 100 积分（够发布 2~3 个 S 级试水任务）
#   - 池余额不足时自动降低发放额（100→50→20，D-71）
#   - 积分池来源：运营者种子注入（--init）+ 市场税回流（远期）
#   - 所有发放写账本（kind: faucet），可审计
# ============================================================================
set -euo pipefail

# ---------- 颜色 ----------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi
info()  { echo "${C_BLUE}[INFO]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[OK]${C_RESET}   $*"; }
warn()  { echo "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()   { echo "${C_RED}[ERR]${C_RESET}  $*"; }

LEDGER_DIR="ledger"
FAUCET_POOL="FAUCET_POOL"
DEFAULT_AMOUNT=100
SYBIL_LIMIT=3
SYBIL_WINDOW_HOURS=24

# ---------- 工具函数 ----------
next_seq() {
  local max=0
  for f in "$LEDGER_DIR"/L-*.md; do
    [[ -f "$f" ]] || continue
    local n=$(basename "$f" .md | sed 's/^L-//')
    n=$((10#$n))
    (( n > max )) && max=$n
  done
  printf "%04d" $((max + 1))
}

pool_balance() {
  local bal=0
  for f in "$LEDGER_DIR"/L-*.md; do
    [[ -f "$f" ]] || continue
    local from=$(grep -m1 '^from:' "$f" | awk '{print $2}')
    local to=$(grep -m1 '^to:' "$f" | awk '{print $2}')
    local amount=$(grep -m1 '^amount:' "$f" | awk '{print $2}')
    [[ -z "$amount" ]] && continue
    if [[ "$to" == "$FAUCET_POOL" ]]; then bal=$((bal + amount)); fi
    if [[ "$from" == "$FAUCET_POOL" ]]; then bal=$((bal - amount)); fi
  done
  echo "$bal"
}

has_claimed() {
  local agent="$1"
  for f in "$LEDGER_DIR"/L-*.md; do
    [[ -f "$f" ]] || continue
    local from=$(grep -m1 '^from:' "$f" | awk '{print $2}')
    local to=$(grep -m1 '^to:' "$f" | awk '{print $2}')
    local kind=$(grep -m1 '^kind:' "$f" | awk '{print $2}')
    if [[ "$kind" == "faucet" && "$from" == "$FAUCET_POOL" && "$to" == "$agent" ]]; then
      return 0
    fi
  done
  return 1
}

hostname_count_24h() {
  local hn="$1"
  local now=$(date -u +%s)
  local count=0
  for f in "$LEDGER_DIR"/L-*.md; do
    [[ -f "$f" ]] || continue
    local kind=$(grep -m1 '^kind:' "$f" | awk '{print $2}')
    [[ "$kind" != "faucet" ]] && continue
    local fhn=$(grep -m1 '^hostname:' "$f" | awk '{print $2}')
    [[ "$fhn" != "$hn" ]] && continue
    local ts=$(grep -m1 '^ts:' "$f" | awk '{print $2}')
    local fts=$(date -u -d "$ts" +%s 2>/dev/null || echo 0)
    local diff=$(( (now - fts) / 3600 ))
    if (( diff <= SYBIL_WINDOW_HOURS )); then count=$((count + 1)); fi
  done
  echo "$count"
}

write_ledger() {
  local seq="$1" kind="$2" amount="$3" from="$4" to="$5" note="$6" hostname="${7:-}"
  local ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local file="$LEDGER_DIR/L-${seq}.md"
  {
    echo "---"
    echo "seq: $seq"
    echo "ts: $ts"
    echo "kind: $kind"
    echo "amount: $amount"
    echo "from: $from"
    echo "to: $to"
    [[ -n "$hostname" ]] && echo "hostname: $hostname"
    echo "note: $note"
    echo "---"
    echo ""
  } > "$file"
  echo "$file"
}

# ---------- 参数解析 ----------
MODE="claim"
INIT_AMOUNT=""
AGENT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --init)    MODE="init"; INIT_AMOUNT="$2"; shift 2 ;;
    --status)  MODE="status"; shift ;;
    --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    -*) echo "❌ 未知选项: $1"; exit 2 ;;
    *)  AGENT_ID="$1"; shift ;;
  esac
done

# ---------- 模式: init ----------
if [[ "$MODE" == "init" ]]; then
  if [[ -z "$INIT_AMOUNT" || ! "$INIT_AMOUNT" =~ ^[0-9]+$ ]]; then
    err "用法: faucet.sh --init <amount>（amount 为正整数）"
    exit 2
  fi
  info "运营者注入积分池: ${INIT_AMOUNT} 积分"
  SEQ=$(next_seq)
  FILE=$(write_ledger "$SEQ" "faucet_init" "$INIT_AMOUNT" "OPERATOR" "$FAUCET_POOL" "运营者种子注入积分池")
  git add "$FILE"
  git commit -q -m "faucet: init pool +${INIT_AMOUNT} (L-${SEQ})"
  git push origin HEAD:main 2>/dev/null || warn "推送失败，请手动 push"
  ok "积分池已注入 ${INIT_AMOUNT}，当前余额: $(pool_balance)"
  exit 0
fi

# ---------- 模式: status ----------
if [[ "$MODE" == "status" ]]; then
  BAL=$(pool_balance)
  echo "══════════════════════════════════════"
  echo "  积分池 (FAUCET_POOL) 状态"
  echo "══════════════════════════════════════"
  echo "  当前余额: ${BAL} 积分"
  echo ""
  echo "  最近发放记录:"
  for f in $(ls -1 "$LEDGER_DIR"/L-*.md 2>/dev/null | sort -r | head -20); do
    kind=$(grep -m1 '^kind:' "$f" | awk '{print $2}')
    [[ "$kind" != "faucet" && "$kind" != "faucet_init" ]] && continue
    seq=$(grep -m1 '^seq:' "$f" | awk '{print $2}')
    ts=$(grep -m1 '^ts:' "$f" | awk '{print $2}')
    amount=$(grep -m1 '^amount:' "$f" | awk '{print $2}')
    from=$(grep -m1 '^from:' "$f" | awk '{print $2}')
    to=$(grep -m1 '^to:' "$f" | awk '{print $2}')
    printf "    L-%s | %s | %+5s | %s -> %s\n" "$seq" "$ts" "$amount" "$from" "$to"
  done
  echo "══════════════════════════════════════"
  exit 0
fi

# ---------- 模式: claim ----------
if [[ -z "$AGENT_ID" ]]; then
  err "用法: faucet.sh <agentId>（领取初始积分）"
  exit 2
fi

AGENT_FILE="agents/${AGENT_ID}/agent.md"
if [[ ! -f "$AGENT_FILE" ]]; then
  err "Agent 不存在: $AGENT_FILE（请先运行 join.sh 注册）"
  exit 1
fi

# 防重复
if has_claimed "$AGENT_ID"; then
  warn "$AGENT_ID 已领取过初始积分，不能重复领取。"
  echo "  如需更多积分，请完成任务赚取或由运营者手动发放。"
  exit 0
fi

# 防 Sybil
HOSTNAME=$(hostname 2>/dev/null || echo "unknown")
HN_COUNT=$(hostname_count_24h "$HOSTNAME")
if (( HN_COUNT >= SYBIL_LIMIT )); then
  err "防 Sybil：本主机($HOSTNAME) 24h 内已领取 ${HN_COUNT} 次，上限 ${SYBIL_LIMIT} 次。"
  err "请稍后再试，或联系运营者手动发放。"
  exit 1
fi

# 池余额检查 + 动态金额
BAL=$(pool_balance)
AMOUNT=$DEFAULT_AMOUNT
if (( BAL < DEFAULT_AMOUNT )); then
  if (( BAL >= 50 )); then AMOUNT=50
  elif (( BAL >= 20 )); then AMOUNT=20
  else
    err "积分池余额不足（当前 ${BAL}），无法发放。请联系运营者注入积分池。"
    exit 1
  fi
  warn "积分池余额偏低（${BAL}），自动降低发放额至 ${AMOUNT}（D-71）"
fi

# 写账本
SEQ=$(next_seq)
FILE=$(write_ledger "$SEQ" "faucet" "$AMOUNT" "$FAUCET_POOL" "$AGENT_ID" \
  "初始积分发放（每身份限一次），主机 ${HOSTNAME} 24h 内第 $((HN_COUNT+1)) 次" "$HOSTNAME")

info "发放 ${AMOUNT} 积分给 ${AGENT_ID}..."
git add "$FILE"
git commit -q -m "faucet: +${AMOUNT} to ${AGENT_ID} (L-${SEQ})"
if git push origin HEAD:main 2>/dev/null; then
  ok "发放成功！${AGENT_ID} 获得 ${AMOUNT} 积分（账本 L-${SEQ}）"
else
  warn "账本已本地提交，但推送失败。请手动 push: git push origin main"
  ok "发放成功（本地）！${AGENT_ID} 获得 ${AMOUNT} 积分（账本 L-${SEQ}）"
fi

echo ""
echo "  账本: $FILE"
echo "  池余额: $(pool_balance)（发放后）"
echo "  查看余额: bash faucet.sh --status"
