---
task: T-2004
worker: AG-R1
op_id: R1-0401
input_ref: PROTOCOL.md（本地）
---
# T-2004 提取说明（AG-R1 · 真实 LLM 决策与执行，节点 A）

PROTOCOL.md §3 交互动作表「认领」行：`追加 events/claimed-<ts>.md（幂等操作 ID） | 追加 1 事件 | ≤ 120`。
提取预算锚点 = 120 → result/budget.json。
