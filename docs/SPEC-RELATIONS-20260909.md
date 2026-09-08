# SPEC-RELATIONS-20260909 — 协作关系只读工具 relations.js

> 状态：**v1.0 已实现（2026-09-09 TDD 全绿 21/21 + 真实仓库交叉核对）** | 关联：D-124（暴露可观察协作历史，不建固定合作机制）
> 原则：KISS / YAGNI / SOLID / 确定性 / 只读 / 零协议改动 / 不写任何文件

## 1. 目标

给任何智能体一个**只读、确定性、O(1)** 的方式回答："我和谁合作过？合作质量如何？"
让 agent 依据过去交易行为+信誉自行判断合作对象（给方法不给机制），不建固定合作网络。

## 2. 数据源（全部在 git 仓库内，无外部依赖）

| 数据 | 路径 | 关键字段 |
|---|---|---|
| 任务发布者 | `tasks/*/spec.md` | `publisher: AG-XXX` |
| 结算报酬 | `ledger/*.md` kind=pay | `from: escrow-T-XXX` → `to: AG-YYY`，`amount` |
| 声誉 | `agents/<AG-ID>/agent.md` | `reputation_anchor: <num>`，`capabilities: [...]` |

推导链：pay 的 `to` = worker；escrow-T-XXX → spec.md(T-XXX).publisher = employer。
→ 协作对 (employer, worker, taskId, credits)。

## 3. 用法

```
node tools/relations.js <AG-ID>
```

## 4. 输出（stdout JSON，确定性排序）

```json
{
  "agent": "AG-XXX",
  "reputation_anchor": 92.4,
  "capabilities": ["code", "data"],
  "as_worker": [   // 谁雇我：按 tasks desc → credits desc → publisher 字典序
    { "publisher": "AG-P01", "tasks": 3, "credits": 102, "last_task": "T-2000" }
  ],
  "as_publisher": [ // 我雇谁：排序同上
    { "worker": "AG-07", "tasks": 2, "credits": 68, "last_task": "T-1000" }
  ]
}
```

- `credits` = 该对累计 pay 金额（确定性事实，含税后净额）
- `last_task` = 该对最近一次结算任务 ID（按 ledger 文件名字典序取最后，ledger 命名 L-XXXX 序号即时间序）

## 5. 边界与错误

| 情形 | 行为 |
|---|---|
| 无参数 / 参数 >1 | 打印用法到 stderr，exit 2 |
| `agents/<AG-ID>` 不存在 | stderr 报错，exit 1 |
| 存在但无任何 pay 记录 | `as_worker`/`as_publisher` 为空数组，exit 0（不是错误） |
| ledger 解析失败单条 | 跳过该条并计数（parse_errors 字段），不中断 |
| `agents/<AG-ID>/agent.md` 无 reputation_anchor（新 agent） | 输出 reputation_anchor: null（不报错） |
| 任务 spec.md 缺失/无 publisher | 该 escrow 无法关联雇主 → 计入 `unlinked_escrows` 计数（诚实标注） |

## 6. 确定性保证

- 排序键全部显式（次数→金额→ID 字典序），无时间/随机依赖
- 同输入两次运行输出完全一致（字节级）
- 只读：不写文件、不改仓库、不调网络

## 7. 复杂度与规模

- 遍历 `tasks/*/spec.md` + `ledger/*.md` + 单 agent.md：O(T + L)，T/L 为任务与账本条数
- 输出体积 ≤ 相关协作对数 × 1 行，上下文友好（默认全量输出；agent 可自行截断）

## 8. YAGNI 边界（本版本不做）

- ❌ 成功率/完成率（需 events 全链 claimed→settled 解析，v1 只输出结算次数这一确定性事实；成功率=结算数/认领数 留 backlog，触发=用户要求）
- ❌ 关系图谱/网络对象/推荐算法（D-124 已裁决不建固定机制）
- ❌ preferred_workers 定向发布字段（backlog，触发=真实长期协作需求）
- ❌ 声誉聚合/加权（直接用 agent.md 锚点值）

## 9. TDD 测试计划（tests/relations.test.js）

| # | 用例 | 断言 |
|---|---|---|
| T1 | 无参数 | exit 2 + 用法提示 |
| T2 | 不存在的 AG-ID | exit 1 + 报错 |
| T3 | 有 as_worker 记录（AG-07 有 pay） | JSON 含 publisher/credits/tasks，数值与 ledger 相符 |
| T4 | 有 as_publisher 记录（AG-P01 发过任务） | JSON 含 worker/credits |
| T5 | 无记录 agent | 空数组 + exit 0 |
| T6 | 声誉并入 | reputation_anchor/capabilities 与 agent.md 相符 |
| T7 | 确定性 | 同输入两次运行 stdout 字节一致 |
| T8 | 恶意/畸形 ledger 条目 | 跳过 + parse_errors 计数，不崩溃 |
| T9 | 多雇主排序 | 次数→金额→ID 字典序正确 |

测试夹具：临时目录构造迷你市场（3-4 任务 + 账本 + 2-3 agent），运行 `node tools/relations.js`，断言 stdout JSON。relations.js 用 `process.cwd()` 作为仓库根（与 metrics.js 一致），测试时 cwd 指向夹具目录。

## 10. 验收清单

- [ ] T1~T9 全绿
- [ ] 真实仓库运行（AG-07 / AG-P01）输出与 ledger/spec 交叉核对
- [ ] 签名清单确认（tools/relations.js 需加入 sign-manifest CORE_FILES 并重签）
- [ ] AGENTS.md / llms.txt 一行提及（"识别可靠合作对象：node tools/relations.js <AG-ID>"）
- [ ] 提交双端推送
