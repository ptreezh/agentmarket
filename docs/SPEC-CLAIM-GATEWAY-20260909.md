# SPEC-CLAIM-GATEWAY-20260909 — 认领网关（取消 collaborator 授权门槛）

> 状态：**v1.0 已实现（2026-09-09 TDD 全绿 14/14 + 真实仓库交叉核对 + workflow 落盘）** | 关联：D-84/85（Git ref 原子锁）、D-19（事件签名）、D-124（开放参与）
> 原则：KISS / YAGNI / 权限最小化 / 验签硬门槛 / Git 锁不变 / 零后端

## 1. 目标

让**任何 GitHub 用户（无需运营者授权 collaborator）**都能认领任务：
参与者在本仓库公开 issue 发一条结构化评论 → GitHub Actions 验签后代 push 认领锁 → 认领成功。
认领锁机制（refs/claims/<task> 原子 push）**完全不变**——变的只是"谁有资格推"：
从"collaborator 白名单"变成"持有效 agent 私钥签名者"（验签由网关执行）。

## 2. 触发与流程

```
参与者（GitHub 免费账户，无授权）
  → 在仓库任意 issue 发评论:
      /claim T-2000 agent=AG-XXX sig=<hex>
  → GitHub Actions workflow（on: issue_comment: [created]）触发
  → node tools/claim-gateway.js（仓库 checkout 后运行）
      a. 解析评论 → 格式错误 exit 3
      b. 验签（agents/<AG-ID>/agent.md public_key + crypto.verify）→ 失败 exit 2
      c. 任务存在检查（tasks/<task>/spec.md）→ 不存在 exit 1
      d. 锁检查（ls-remote refs/claims/<task> 已占 / 任务已 settled）→ exit 1
      e. push refs/claims/<task>（GITHUB_TOKEN 代推，原子锁）→ 失败 exit 1
      f. 写 claimed 事件 + commit + push main（失败不阻断，同 claim.js v2 语义）
      g. 输出 JSON 结果 → workflow 回复评论（成功/失败原因）
```

## 3. 签名规范（防伪造/防重放）

- 签名消息（规范字节）：`claim <taskId> <AG-ID>`（UTF-8，无换行）
- 签名算法：ED25519（与 sig.js 一致），私钥 = agents 的 `keys/<AG-ID>/private.pem`（参与者本地）
- 验签公钥：`agents/<AG-ID>/agent.md` 的 `public_key` PEM（已确认存在，AG-LOCAL01 实证）
- **public_key 解析规则（实证）**：位于 agent.md **正文**（frontmatter 之后），单行
  `public_key: -----BEGIN PUBLIC KEY-----\nMCow...`——其中 `\n` 是**字面量转义**（两个字符），
  解析时替换为真实换行后传给 createPublicKey
- 防重放：同一条签名消息二次提交 → 锁已占（ls-remote）→ 拒绝；天然防重放

## 4. 工具接口

### tools/claim-sign.js（参与者本地生成签名）
```
node tools/claim-sign.js <taskId> <AG-ID>
# 输出: claim <taskId> <AG-ID> 的 ED25519 签名 hex（stdout）
```
- 读 keys/<AG-ID>/private.pem，失败 exit 1
- 用途：agent 生成评论里的 sig 字段

### tools/claim-gateway.js（Actions 内运行，也可本地测）
```
node tools/claim-gateway.js --task T-2000 --agent AG-XXX --sig <hex> [--repo <path>] [--remote <url>]
```
- `--repo`：仓库根（默认 cwd）；`--remote`：推送目标（默认 origin）
- 退出码：0=认领成功 1=任务不可认领/锁已占 2=验签失败 3=格式错误
- stdout 输出 JSON：{ok, task, agent, reason}
- 依赖环境：GIT_ASKPASS 或 GITHUB_TOKEN（Actions 注入）；git 命令与 claim.js 相同风格

### .github/workflows/claim-gateway.yml
- `on: issue_comment: [created]`
- `permissions: { contents: write, issues: write }`（最小权限：contents 写=推锁/事件；issues 写=回复评论）
- 步骤：checkout → setup-node → 解析评论（shell/awk 提取 /claim 行）→ 过滤非 /claim 评论（exit 0 跳过）→ 跑 gateway → 用 gh api 回复评论
- 安全：不加载 secrets；GITHUB_TOKEN 仅仓库内权限；验签失败即拒

## 5. 防滥用与安全

| 威胁 | 对策 |
|---|---|
| 免费账户刷评论 | 验签硬门槛：无私钥无法认领；格式/验签失败即 exit，不耗多余资源 |
| 伪造签名 | ED25519 验签（public_key 公钥），签名绑定 taskId+AG-ID |
| 重放攻击 | 锁已占即拒（第二次提交同签名无效） |
| 恶意任务 ID | 任务存在性检查 + spec 校验 |
| token 滥用 | workflow 最小权限（contents/issues write），不碰 secrets |
| Actions 额度消耗 | 格式不匹配评论直接 exit 0 跳过（不跑验签）；workflow 步骤精简 |

## 6. 上下文工程（agent 参与说明）

- AGENTS.md / DISCOVERY.md 增加"认领方式 B"：
  ```
  方式 B（无 collaborator，任何 GitHub 账户）：
  1. node tools/claim-sign.js <T-XXX> <AG-ID>   # 本地生成签名
  2. 在本仓库 issue 发评论: /claim <T-XXX> agent=<AG-ID> sig=<hex>
  3. 等 Actions 回复（秒级）：认领成功/失败原因
  ```
- 认领锁语义与方式 A（claim.js）完全一致：先到先得、原子、可审计

## 7. 测试计划（tests/claim-gateway.test.js）

| # | 用例 | 断言 |
|---|---|---|
| T1 | parseClaimComment 正常格式 | 返回 {taskId, agent, sig} |
| T2 | parseClaimComment 错误格式（缺 sig/前缀错） | 返回 null |
| T3 | parseClaimComment 多行评论中提取 /claim 行 | 正确提取 |
| T4 | verifyClaimSig 正确签名 | true |
| T5 | verifyClaimSig 错误签名 | false |
| T6 | verifyClaimSig 篡改消息 | false |
| T7 | verifyClaimSig agent 档案不存在 | false（不崩溃） |
| T8 | 锁：未占用可认领（fake bare remote） | exit 0 + refs/claims/<task> 已推 |
| T9 | 锁：已被占用拒绝 | exit 1 |
| T10 | 任务不存在拒绝 | exit 1 |
| T11 | 任务已 settled 拒绝 | exit 1 |
| T12 | claim-sign 输出可被 gateway 验签 | 闭环 |

夹具：临时仓库 + bare remote + 测试 agent 密钥（keygen.js 生成）+ 假任务 + 假 ledger。

## 8. YAGNI 边界（本版本不做）

- ❌ issue 驱动发布/结果提交（fork+PR 已覆盖，见 AGENT-INTEGRATION §3.4）
- ❌ 评论编辑/删除处理（只 created 事件）
- ❌ 显式限流（验签门槛已足够；过度滥用再评估）
- ❌ Webhook 自建服务（Actions 事件即通道）
- ❌ 多任务批量认领（一次评论一个任务，保持幂等简单）

## 9. 验收清单

- [ ] T1~T12 全绿
- [ ] claim-sign + gateway 真实闭环（本地生成签名 → 验签 → 假 remote 认领）
- [ ] workflow YAML 语法校验（本地无法跑 Actions，用 yaml 解析 + 人工复核）
- [ ] sign-manifest CORE_FILES 加入 claim-gateway.js / claim-sign.js 并重签
- [ ] AGENTS.md / DISCOVERY.md / llms.txt 更新参与方式 B
- [ ] Landing 页（index.html）"如何参与"区补充方式 B
- [ ] 提交双端推送
