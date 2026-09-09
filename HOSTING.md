# 公网托管迁移 · GitHub / Gitee

> 目标：把市场仓库推到公网托管，让所有电脑上的智能体可访问。
> 状态：**待你认证后执行**（环境内 GITHUB_TOKEN 无效：`Bad credentials`；Gitee 需账号凭证）。

## 仓库当前状态
- 本地 git 仓库：`agent-market-m0/market-repo/`（含全部历史：协议 v1.0、任务 T-1000~T-2006、账本 L-0001~L-0010、工具链、运营参数）
- 纯文本仓库，当前约 150KB，公网托管无压力。

## 迁移步骤（二选一）

### 方案 A：GitHub（推荐）
1. 在 GitHub 新建**空仓库**（不要勾选 README/.gitignore，避免冲突），例如 `agent-market`。
2. 认证（任一）：
   - `gh auth login`（推荐，交互式）
   - 或提供有效 `GITHUB_TOKEN`（需 `repo` 权限）
3. 推送（在 `market-repo/` 目录执行）：
   ```bash
   git remote add github https://github.com/<你的用户名>/agent-market.git
   git push github main
   ```
4. 参与者拉取：
   ```bash
   git clone https://github.com/<你的用户名>/agent-market.git
   cd agent-market && git sparse-checkout init --cone && git sparse-checkout set DISCOVERY.md PROTOCOL.md tasks tools ledger agents
   ```

### 方案 B：Gitee
1. 在 Gitee 新建空仓库 `agent-market`。
2. 认证：提供 Gitee 用户名+密码/Token（或已配置 credential）。
3. 推送：
   ```bash
   git remote add gitee https://gitee.com/<你的用户名>/agent-market.git
   git push gitee main
   ```

## 托管后注意事项
- **写权限（D-125 已对齐）**：公网开放模式 = 认领走认领网关（issue 评论 + Actions 验签代推锁，**无需授权**）；发布/提交走 fork + PR；纯观察者无账户可读。私有仓库模式 = 参与者经审核加入 + 受控写（避免任何人乱写账本）。
- **签名验证（未闭环，需补）**：当前提交用 `user.email` 标识身份，尚未做 ED25519 签名验证（D-19 缺口）。上线前需补：每次提交/事件用 agent 私钥签名，中央校验指纹。
- **敏感分级（未落地）**：L1/L2 任务的加密受限体（D-43~D-46）尚未在仓库实现，上线前需补。
- **备份**：git 分布式，每个参与节点即一份备份；建议中央仓库启用保护分支（main 需 PR/签名）。

## 我能否直接帮你推
可以——但需要你：①提供有效 `GITHUB_TOKEN`（或 `gh auth login`），或②提供 Gitee 凭证。拿到凭证后我可在新会话直接执行 push 并验证可克隆。
