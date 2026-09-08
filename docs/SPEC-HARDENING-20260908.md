# 安全加固与无人值守 MASTER SPEC（2026-09-08）

> 状态：**v0.1 待 grill-down** · 流程：spec 落盘 → 钢铁人质疑 → 修订 → 置信 → TDD
> 前置事实：`keys/operator/` 本机不存在；OPERATOR_PUBKEY（`MCowBQYDK2VwAyEAKGEM...`）独立于
> AG-DOUBAO01/AG-LOCAL01，**从未有事件用其对应私钥签名**（云端权威副本当前会话不可达，视为丢失）。

## 1. 差距分析（现状 → 目标）

| 任务 | 现状 | 缺口 |
|---|---|---|
| T1 层1 签名清单 | sign-manifest.js 已实现+篡改检测实测；SIGNATURES.md 未生成 | **运营者私钥丢失/不可达** → 清单无法权威签名；settle 需 --allow-unsigned |
| T2 无人值守保活 | agent-runner.js v2.0（loop+故障转移）已存在；keepalive.sh 存在（D-69） | keepalive.sh 为 **bash**——用户 Windows 环境 WSL 无 node，不可用；runner loop 未做集成测试 |
| T3 复核自动化 | 复核清单为人工核查（T-3001 复盘） | 无 tools/recap.js 自动复核工具 |
| T4 跨市场互认 | docs/INTEROP.md（D-110）设计定稿 | interop.js 未实现；双市场测试剧本未建 |

## 2. 任务规格

### T1 运营者密钥恢复 + 层1 签名清单（SIGNATURES.md）
- **目标**：恢复运营者权威签名能力，SIGNATURES.md 生成并校验
- **范围**：
  1. 运营者密钥恢复：**生成新运营者密钥对**（keys/operator/，keygen 逻辑复用）→ 更新 OPERATOR_PUBKEY → **私钥备份**（用户已接受密钥备份方向；备份位置用户拍板）
  2. `sign-manifest.js --sign keys/operator/private.pem` 生成 SIGNATURES.md（覆盖核心路径：tools/、market-config.json、OPERATOR_PUBKEY、join.sh、faucet.sh、AGENTS.md）
  3. `sign-manifest.js --verify` 通过；篡改检测回归（改任一核心文件 → 报 [✗ 篡改]）
  4. settle.js 脱离 --allow-unsigned：operator 私钥在位 → 账本+settled 事件权威签名
  5. 文档：OPERATOR_PUBKEY 变更说明 + 过渡期标注（历史事件仍为 AG-* 签名）
- **验收**：SIGNATURES.md 存在且 --verify 全过；settle.js 无 --allow-unsigned 全签名跑通（守恒 40）；篡改回归 1 例通过
- **依赖**：用户确认生成新运营者密钥（公共公钥变更 = 信任锚变更）
- **风险**：历史事件非 operator 签名（过渡期事实，文档标注）；私钥备份安全

### T2 Windows 原生保活 + agent-runner 集成测试
- **目标**：市场无人值守循环在用户 Windows 环境可真实运行
- **范围**：
  1. `keepalive.cmd`（Windows 原生，替代/并列 bash keepalive.sh）：检查 agent-runner 进程 → 崩溃重启（指数退避+上限）→ 日志
  2. agent-runner.js loop 集成测试：mock LLM（tools/mock-llm.js 已有）跑通 discover→claim→submit 完整循环（T-3003 级 S 任务，离线 bare 模拟 origin）
  3. 文档：Windows 启动方式（keepalive.cmd + 计划任务可选）
- **验收**：keepalive.cmd 能拉起/检测/重启 agent-runner（本地可测）；runner loop mock 测试闭环通过
- **依赖**：无
- **风险**：Windows 进程检测（tasklist/PID 文件）兼容性；循环冲突由 ref 锁保证

### T3 复核自动化（tools/recap.js）
- **目标**：结算后自动复核，替代人工清单
- **范围**：
  1. recap.js `<taskId>`：自动检查 ① L0 verify-result 全过 ② 账本守恒（payment+tax+refund=budget；deposit_refund=deposit）③ 四事件签名链（published/claimed/submitted/settled 各自验签）④ settled 存在且时间合理 ⑤ 退出码 0=全过 / 非0=列出失败项
  2. 复核报告 recap-<task>.md 写入 tasks/<task>/（可选）
- **验收**：对 T-3001（签名链完整）返回 0 全过；对构造的破坏例（改一个事件/账本数字）返回非 0 并指明失败项
- **依赖**：无（T-3001/T-3002 数据已就绪）
- **风险**：T-3002 的 settled 无签名（allow-unsigned 测试）→ recap 对 T-3002 应报"settled 未签名"（预期失败项，同时验证检测能力）

### T4 跨市场互认工具骨架（tools/interop.js）
- **目标**：D-110 协议可执行验证（不部署启用）
- **范围**：
  1. interop.js 四命令：withdraw / deposit / reconcile / trust-list（ED25519 签名复用 sig.js/crypto 逻辑）
  2. 双市场测试：本地两个 bare 仓库模拟 A/B，A 发凭证 → B 兑换 → 重复兑换被拒 → 对账一致 → revoke 演练
- **验收**：双市场测试剧本全过（含重复兑换拒绝）
- **依赖**：无
- **风险**：YAGNI（无真实 fork 场景）——但设计已定稿，骨架+测试验证可行性，默认关闭

## 3. 实施顺序（TDD，每步落盘）

T3（最独立）→ T2（需先测 runner）→ T1（需用户确认密钥）→ T4（骨架收尾）
每任务：**失败测试 → 实现 → 测试过 → 提交落盘**。

## 4. grill-down 待决项（首轮）

1. **T1.1 运营者密钥恢复方式**：生成新密钥对 + 更新 OPERATOR_PUBKEY + 备份——是否确认？（公共公钥变更影响未来参与者信任）
2. **T2 保活形态**：keepalive.cmd 原生（推荐）vs 计划任务 vs 两者
3. **T3 recap 对 T-3002 的预期**：settled 无签名 → recap 应报失败（验证检测能力）还是放行（测试任务豁免）？
4. **T4 是否本轮实施**：骨架+测试（推荐，验证 D-110 可行性）vs 纯文档（YAGNI 严格）
