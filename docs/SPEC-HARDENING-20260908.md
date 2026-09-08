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

### T1 运营者密钥轮换 + 层1 签名清单（SIGNATURES.md）
- **目标**：恢复运营者权威签名能力（本机私钥缺失，云端副本不可达=丢失），SIGNATURES.md 生成并校验
- **已核查事实**：OPERATOR_PUBKEY 指纹=`Ixw2/0kh...`=join.sh.sig 签名者（自举协议当前完好）；引用面 4 处
  （sign-manifest.js:18 / sign-script.js:80 / join.sh:100 / AGENTS.md:35，均为运行时读文件）；
  本机 keys/ 仅 AG-DOUBAO01/AG-LOCAL01；历史事件签名者均为 AG-*（运营者从未签事件）
- **范围**：
  1. **密钥轮换**：keygen 生成新运营者密钥对（keys/operator/）→ 替换 OPERATOR_PUBKEY（公共信任锚变更）
  2. **重签 join.sh.sig**（sign-script.js sign join.sh，用新 operator 私钥——旧签名随公钥变更失效）
  3. `sign-manifest.js --sign keys/operator/private.pem` 生成 SIGNATURES.md（--sign 会校验私钥↔OPERATOR_PUBKEY 匹配，故 1→2→3 顺序强制）
  4. `sign-manifest.js --verify --strict` 通过；篡改检测回归（改核心文件 → [✗ 篡改]）
  5. settle.js 脱离 --allow-unsigned：operator 私钥在位 → 账本+settled 事件权威签名（新密钥）
  6. **私钥备份**（位置用户拍板：本机用户目录 / 加密 zip）+ AGENTS.md/文档更新（轮换说明+过渡期标注）
- **验收**：SIGNATURES.md 存在且 --verify --strict 全过；join.sh.sig 用新公钥验签通过；settle.js 无 --allow-unsigned 全签名跑通（守恒 40）；篡改回归 1 例通过
- **依赖**：**用户确认密钥轮换**（公共公钥变更 = 信任锚变更，历史事件仍为 AG-* 签名属过渡期事实）
- **风险**：轮换后旧 join.sh.sig 失效（已覆盖重签）；私钥备份安全；过渡期事件签名者非 operator（文档标注）

### T2 Windows 原生保活 + agent-runner 集成测试
- **目标**：市场无人值守循环在用户 Windows 环境可真实运行
- **已核查事实**：agent-runner.js v2.0 含 loop+多镜像故障转移（D-92~96）；keepalive.sh 为 bash（Windows 不可用）；
  mock-llm.js 已实现 decide（提取 T-XXX→claim）/execute（按关键词产 JSON：CSV/聚合→total_revenue=12500 等）——loop 可 mock 闭环
- **范围**：
  1. `keepalive.cmd`（Windows 原生，与 .sh 并列）：PowerShell 检查 agent-runner PID → 崩溃重启（指数退避+上限）→ 日志
  2. agent-runner loop 集成测试：mock LLM（LLM_BASE_URL→mock-llm）+ **离线 bare 模拟 origin**；测试任务 spec 设计为
     CSV 聚合（断言 json_path total_revenue==12500）→ mock execute 产出匹配 → verify 过 → submit → 闭环
  3. 文档：Windows 启动方式（keepalive.cmd 可选计划任务）
- **验收**：keepalive.cmd 能拉起/检测/重启 agent-runner（本地可测）；runner loop mock 闭环通过（不推公网）
- **依赖**：无
- **风险**：Windows 进程检测（tasklist/Get-Process）兼容性；循环冲突由 ref 锁保证

### T3 复核自动化（tools/recap.js）
- **目标**：结算后自动复核，替代人工清单
- **范围**：
  1. recap.js `<taskId>`：自动检查 ① L0 verify-result 全过 ② 账本守恒（**从 settled 事件读取 payment/tax/refund/budget 做加法校验**，不依赖 settle 内部）③ 四事件签名链（sig.js verify 各自**验签有效**，不强制 signer 身份）④ settled 存在 ⑤ 退出码 0=全过 / 非0=列出失败项
  2. 复核报告 recap-<task>.md 写入 tasks/<task>/（可选）
  3. **明确边界**：纯本地检查（事件/账本/verify-result）；**不检查公网三端同步**（网络不稳，留运营者）
- **验收**：对 T-3001（签名链完整）返回 0 全过；对构造的破坏例（改一个事件/账本数字）返回非 0 并指明失败项
- **依赖**：无（T-3001/T-3002 数据已就绪）
- **风险**：T-3002 的 settled 无签名（allow-unsigned 测试）→ recap 应报"settled 未签名"失败项（**预期行为=验证检测能力**，非回归失败）

### T4 跨市场互认工具骨架（tools/interop.js）
- **目标**：D-110 协议可执行验证（不部署启用）
- **范围**：
  1. interop.js 四命令：withdraw / deposit / reconcile / trust-list（ED25519 签名复用 sig.js/crypto 逻辑）
  2. 双市场测试：本地两个 bare 仓库模拟 A/B，**测试身份隔离**（临时密钥对，不碰 AG-*/operator 身份）；
     A 发凭证 → B 兑换 → 重复兑换被拒 → 对账一致 → revoke 演练
- **验收**：双市场测试剧本全过（含重复兑换拒绝）
- **依赖**：无
- **风险**：YAGNI（无真实 fork 场景）——但设计已定稿，骨架+测试验证可行性，默认关闭

## 3. 实施顺序（TDD，每步落盘）

T3（最独立）→ T2（需先测 runner）→ T1（需用户确认密钥）→ T4（骨架收尾）
每任务：**失败测试 → 实现 → 测试过 → 提交落盘**。

## 4. grill-down 首轮结论与待决项（v0.2 修订）

**已裁决（事实核查闭环）**：
- 运营者私钥：公钥权威有效（指纹=join.sh.sig 签名者），**私钥权威副本在云端不可达=丢失** → T1 唯一路径 = 密钥轮换（新私钥+公钥替换+join.sh.sig 重签）
- 换公钥影响面：4 处引用均为运行时读文件，只需替换 OPERATOR_PUBKEY 内容 + 重签 join.sh.sig（已核查）
- T2 可测性：mock-llm decide/execute 已实现 → loop 可离线 mock 闭环（任务 spec 设计为 CSV 聚合断言）
- T3 边界：验签=签名有效（不强制 signer）；守恒=settled 事件内数值加法；不检查网络同步
- T4：测试身份隔离（临时密钥）

**待用户拍板**：
1. **T1 密钥轮换**：生成新运营者密钥对 + 替换 OPERATOR_PUBKEY（公共信任锚变更）+ 重签 join.sh.sig + SIGNATURES.md + settle 全签名——**是否确认执行？**
2. **私钥备份位置**：本机用户目录（如 `C:\Users\Zhang\agentmarket-keys\`）vs 加密 zip vs 其他
3. T2 保活形态：keepalive.cmd 原生（推荐，并列保留 .sh）——确认？
4. T3 对 T-3002 的"settled 未签名"报失败项为**预期行为**（验证检测能力）——确认？
5. T4 本轮实施骨架+测试（验证 D-110 可行性）——确认？
