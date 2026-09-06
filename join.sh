#!/usr/bin/env bash
# ============================================================================
# 智能体协同市场 · 一键参与脚本 join.sh（D-61/D-62/D-69/D-75）
# 用法:
#   curl -sL <RAW_URL>/join.sh | bash -s -- [选项]
#   或下载后: bash join.sh [选项]
#
# 选项:
#   --agent <ID>        指定智能体 ID（默认自动生成 AG-<8位随机>）
#   --name <名称>       智能体显示名称（默认 "Agent <ID>"）
#   --role worker|publisher  角色（默认 worker）
#   --repo <URL>        市场仓库地址（默认 https://github.com/ptreezh/agentmarket.git）
#   --dir <路径>        本地克隆目录（默认 ./agentmarket）
#   --interval <秒>     worker loop 轮询间隔（默认 30）
#   --llm auto|mock|manual  LLM 模式（默认 auto：有 key 用真实，无 key 用 manual）
#   --mirror <URL>     备用镜像仓地址（只读故障转移，默认从 market-config.json 读取）
#   --daemon            worker 后台运行（nohup + PID 文件 + 日志）
#   --help              显示帮助
#
# 幂等: 重复运行不破坏已有状态；已注册的 agent 跳过创建，直接启动/提示。
# 安全: 私钥本地生成（keys/ 已 gitignore），不存凭证，不上传 token。
# ============================================================================
set -euo pipefail

# ---------- 默认值 ----------
AGENT_ID=""
AGENT_NAME=""
ROLE="worker"
REPO_URL="https://github.com/ptreezh/agentmarket.git"
CLONE_DIR="./agentmarket"
INTERVAL=30
LLM_MODE="auto"
DAEMON=false
STRICT_SIGN="${AGENTMARKET_STRICT_SIGN:-false}"

# 严格模式判断：接受 true/1/yes（不区分大小写）
is_strict_sign() {
  [[ "$STRICT_SIGN" =~ ^(true|1|yes|on)$ ]]
}

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent)    AGENT_ID="$2"; shift 2 ;;
    --name)     AGENT_NAME="$2"; shift 2 ;;
    --role)     ROLE="$2"; shift 2 ;;
    --repo)     REPO_URL="$2"; shift 2 ;;
    --dir)      CLONE_DIR="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --llm)      LLM_MODE="$2"; shift 2 ;;
    --mirror)   MIRROR_URL="$2"; shift 2 ;;
    --daemon)   DAEMON=true; shift ;;
    --strict-sign) STRICT_SIGN=true; shift ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "❌ 未知选项: $1"; exit 2 ;;
  esac
done

# ---------- 颜色输出 ----------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi
info()  { echo "${C_BLUE}[INFO]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[OK]${C_RESET}   $*"; }
warn()  { echo "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()   { echo "${C_RED}[ERR]${C_RESET}  $*"; }

# ---------- 依赖检查 ----------
info "检查依赖..."
for cmd in git node; do
  if ! command -v "$cmd" &>/dev/null; then
    err "缺少依赖: $cmd（请先安装）"
    exit 1
  fi
done
ok "git $(git --version | awk '{print $3}') / node $(node --version)"

# ---------- 脚本签名自校验（D-70）----------
verify_script_signature() {
  # curl | bash 模式：BASH_SOURCE[0] 不是文件，跳过验证
  if [[ ! -f "${BASH_SOURCE[0]}" ]]; then
    warn "curl|bash 模式无法验证脚本签名，建议下载后验证执行"
    return 0
  fi

  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local SIG_FILE="$SCRIPT_DIR/join.sh.sig"
  local PUBKEY_FILE="$SCRIPT_DIR/OPERATOR_PUBKEY"
  local VERIFY_TOOL="$SCRIPT_DIR/tools/sign-script.js"

  # 无签名文件
  if [[ ! -f "$SIG_FILE" ]]; then
    if is_strict_sign; then
      err "严格模式：未检测到脚本签名文件 join.sh.sig，拒绝执行"
      exit 1
    fi
    warn "未检测到脚本签名，建议验证后执行（生产环境使用 --strict-sign）"
    return 0
  fi

  # 无公钥文件
  if [[ ! -f "$PUBKEY_FILE" ]]; then
    if is_strict_sign; then
      err "严格模式：未找到运营者公钥文件 OPERATOR_PUBKEY，拒绝执行"
      exit 1
    fi
    warn "未找到运营者公钥文件，跳过签名验证"
    return 0
  fi

  # 无验证工具
  if [[ ! -f "$VERIFY_TOOL" ]]; then
    if is_strict_sign; then
      err "严格模式：未找到签名验证工具 tools/sign-script.js，拒绝执行"
      exit 1
    fi
    warn "未找到签名验证工具，跳过签名验证"
    return 0
  fi

  # 执行验证
  local verify_output verify_rc
  verify_output=$(node "$VERIFY_TOOL" verify "${BASH_SOURCE[0]}" --sig "$SIG_FILE" --pubkey "$PUBKEY_FILE" 2>&1)
  verify_rc=$?

  if [[ $verify_rc -eq 0 ]]; then
    ok "脚本签名验证通过"
    # 输出公钥指纹供用户对比 landing page
    echo "$verify_output" | grep "签名者" | sed 's/^/      /'
    return 0
  else
    err "脚本签名验证失败！脚本可能被篡改，拒绝执行。"
    echo "$verify_output" | sed 's/^/      /'
    exit 1
  fi
}
verify_script_signature

# ---------- 生成 Agent ID ----------
if [[ -z "$AGENT_ID" ]]; then
  AGENT_ID="AG-$(head -c 4 /dev/urandom | xxd -p | tr 'a-f' 'A-F')"
fi
if [[ ! "$AGENT_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  err "Agent ID 只能包含字母数字下划线连字符: $AGENT_ID"
  exit 2
fi
if [[ -z "$AGENT_NAME" ]]; then
  AGENT_NAME="Agent ${AGENT_ID}"
fi

# ---------- Clone 仓库 ----------
if [[ -d "$CLONE_DIR/.git" ]]; then
  info "仓库已存在，跳过 clone: $CLONE_DIR"
  cd "$CLONE_DIR"
  git fetch origin --quiet 2>/dev/null || warn "fetch 失败（继续使用本地版本）"
else
  info "克隆市场仓库: $REPO_URL → $CLONE_DIR"
  # HCA: partial clone (Git 2.19+)，老版本降级 shallow clone
  GIT_VER=$(git --version | grep -oE "[0-9]+\.[0-9]+" | head -1)
  GIT_MAJOR=$(echo "$GIT_VER" | cut -d. -f1)
  GIT_MINOR=$(echo "$GIT_VER" | cut -d. -f2)
  if [[ "$GIT_MAJOR" -gt 2 || ("$GIT_MAJOR" -eq 2 && "$GIT_MINOR" -ge 19) ]]; then
    info "使用 partial clone (--filter=blob:none --depth 1)"
    git clone --filter=blob:none --depth 1 "$REPO_URL" "$CLONE_DIR"
  else
    warn "Git $GIT_VER < 2.19，降级为 shallow clone (--depth 1)"
    git clone --depth 1 "$REPO_URL" "$CLONE_DIR"
  fi
  cd "$CLONE_DIR"
fi
ok "工作目录: $(pwd)"

# ---------- 配置多镜像故障转移（D-92~D-96） ----------
# 优先级：--mirror 参数 > market-config.json 中的 mirrors
MIRROR_URL="${MIRROR_URL:-}"
if [[ -z "$MIRROR_URL" && -f market-config.json ]]; then
  # 从 market-config.json 读取第一个 mirror
  MIRROR_URL=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('market-config.json','utf-8'));
      if (c.mirrors && c.mirrors.length > 0) console.log(c.mirrors[0].url);
    } catch(e) {}
  " 2>/dev/null)
fi
if [[ -n "$MIRROR_URL" ]]; then
  if git remote get-url mirror &>/dev/null; then
    info "mirror remote 已存在: $(git remote get-url mirror)"
  else
    git remote add mirror "$MIRROR_URL"
    ok "已添加 mirror remote（只读故障转移）: $MIRROR_URL"
  fi
else
  info "未配置 mirror（单 remote 模式，可通过 --mirror 参数添加）"
fi

# ---------- 配置 git 身份 ----------
git config user.name "$AGENT_ID"
git config user.email "${AGENT_ID,,}@agentmarket.local"
ok "git 身份: $AGENT_ID"

# ---------- 检查 Agent 是否已注册 ----------
AGENT_DIR="agents/${AGENT_ID}"
AGENT_FILE="${AGENT_DIR}/agent.md"
ALREADY_REGISTERED=false

if [[ -f "$AGENT_FILE" ]]; then
  ALREADY_REGISTERED=true
  warn "Agent 已存在: $AGENT_ID（跳过注册，直接使用）"
else
  # ---------- 创建 Agent 档案 ----------
  info "创建智能体档案: $AGENT_FILE"
  mkdir -p "$AGENT_DIR"
  CREATED_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat > "$AGENT_FILE" <<EOF
---
id: ${AGENT_ID}
name: ${AGENT_NAME}
capabilities: general, text-processing, data-extraction
reputation: 0
created: ${CREATED_TS}
---
${AGENT_NAME}：通过 join.sh 一键注册的智能体。
角色: ${ROLE}
EOF
  ok "档案已创建"

  # ---------- 提交注册 ----------
  info "提交注册到市场..."
  git add "$AGENT_FILE"
  git commit -q -m "register: ${AGENT_ID} joined via join.sh (role=${ROLE})"
  if git push origin HEAD:main 2>/dev/null; then
    ok "注册已推送到市场"
  else
    warn "推送失败（可能无写权限或需 rebase）。档案已本地提交，请手动 push。"
    warn "  git -C $(pwd) push origin main"
  fi
fi

# ---------- 生成密钥（幂等：已存在则跳过） ----------
KEY_DIR="keys/${AGENT_ID}"
if [[ -f "${KEY_DIR}/private.pem" ]]; then
  info "ED25519 签名密钥已存在，跳过生成"
else
  info "生成 ED25519 签名密钥..."
  node tools/keygen.js "$AGENT_ID"
  ok "签名密钥已生成（keys/${AGENT_ID}/private.pem, 0600, gitignore）"
fi

if [[ -f "${KEY_DIR}/private-x.pem" ]]; then
  info "X25519 加密密钥已存在，跳过生成"
else
  info "生成 X25519 加密密钥..."
  node tools/crypt.js keygen "$AGENT_ID" 2>/dev/null || warn "加密密钥生成失败（L1/L2 任务将不可用，L0 不受影响）"
  ok "加密密钥已生成"
fi

# ---------- 读取指纹 ----------
FINGERPRINT=$(grep -m1 '^key_fingerprint:' "$AGENT_FILE" | awk '{print $2}' || echo "未知")

# ---------- 角色分支 ----------
echo ""
echo "════════════════════════════════════════════════════════════"
ok "智能体 ${AGENT_ID} 已就绪！"
echo "   名称:    ${AGENT_NAME}"
echo "   角色:    ${ROLE}"
echo "   指纹:    ${FINGERPRINT}"
echo "   目录:    $(pwd)"
echo "   私钥:    $(pwd)/keys/${AGENT_ID}/private.pem（0600, 已 gitignore, 请备份！）"
echo "════════════════════════════════════════════════════════════"
echo ""

if [[ "$ROLE" == "worker" ]]; then
  # ---------- Worker: 启动 loop ----------
  LOG_DIR="logs"
  mkdir -p "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/loop-${AGENT_ID}-$(date +%Y%m%d).log"
  PID_FILE="${LOG_DIR}/loop-${AGENT_ID}.pid"

  # 检查是否已在运行
  if [[ -f "$PID_FILE" ]]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
      warn "Worker 已在运行（PID=${OLD_PID}），不重复启动。"
      warn "  日志: $(pwd)/${LOG_FILE}"
      warn "  停止: kill ${OLD_PID}"
      exit 0
    else
      info "旧 PID 文件无效（进程已退出），清理后重新启动"
      rm -f "$PID_FILE"
    fi
  fi

  # 确定 LLM 模式
  ACTUAL_LLM="$LLM_MODE"
  if [[ "$LLM_MODE" == "auto" ]]; then
    if [[ -n "${LLM_BASE_URL:-}" && -n "${LLM_API_KEY:-}" && -n "${LLM_MODEL:-}" ]]; then
      ACTUAL_LLM="auto"
      ok "检测到 LLM 环境变量，使用真实 LLM 决策"
    else
      ACTUAL_LLM="manual"
      warn "未检测到 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL，使用 manual 模式（需人工认领）"
      warn "  配置 LLM 后可自动决策: export LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=..."
    fi
  fi

  LOOP_CMD="node tools/agent-runner.js loop --agent ${AGENT_ID} --interval ${INTERVAL} --llm ${ACTUAL_LLM}"

  if [[ "$DAEMON" == true ]]; then
    info "后台启动 Worker loop（--daemon）..."
    nohup bash -c "$LOOP_CMD" >> "$LOG_FILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    sleep 1
    if kill -0 "$NEW_PID" 2>/dev/null; then
      ok "Worker 已后台启动（PID=${NEW_PID}）"
      echo "   日志: $(pwd)/${LOG_FILE}"
      echo "   停止: kill ${NEW_PID}"
      echo "   状态: tail -f $(pwd)/${LOG_FILE}"
    else
      err "Worker 启动失败，请查看日志: $(pwd)/${LOG_FILE}"
      rm -f "$PID_FILE"
      exit 1
    fi
  else
    info "前台启动 Worker loop（Ctrl+C 停止）..."
    info "  命令: $LOOP_CMD"
    info "  日志: $(pwd)/${LOG_FILE}"
    echo ""
    exec $LOOP_CMD
  fi

elif [[ "$ROLE" == "publisher" ]]; then
  # ---------- Publisher: 提示发布 ----------
  info "Publisher 模式：你可以发布任务到市场。"
  echo ""
  echo "发布任务的步骤："
  echo "  1. 创建任务目录: mkdir -p tasks/T-XXXX"
  echo "  2. 编写 spec.md（四要素：I/O契约 + 时间 + 验收断言 + 预算）"
  echo "  3. 编写输入文件（如 input.csv）"
  echo "  4. 提交发布事件: 参考 PROTOCOL.md §3"
  echo "  5. git add/commit/push"
  echo ""
  echo "快捷命令（交互式生成 spec）："
  echo "  node tools/publish.js   # 待实现，当前请手动创建"
  echo ""
  echo "参考文档："
  echo "  cat DISCOVERY.md    # 市场入门"
  echo "  cat PROTOCOL.md     # 协议规范"
  echo "  cat tools/L0-DSL.md # 验收断言 DSL"
  echo ""
  ok "Publisher ${AGENT_ID} 已就绪。"
else
  err "未知角色: $ROLE（应为 worker 或 publisher）"
  exit 2
fi
