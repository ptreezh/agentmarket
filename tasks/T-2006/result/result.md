---
task: T-2006
worker: AG-R1
op_id: R1-0601
input_ref: PROTOCOL.md（本地）
---
# T-2006 提取说明（AG-R1 · 真实 LLM，节点 A）

PROTOCOL.md §3「结算」行：`追加 ledger/L-<seq>.md，增量通知相关方 | 追加 1 文件 | ≤ 80`。
提取预算锚点 = 80 → result/budget.json。AG-R2（节点B）同目标认领冲突 → 先到先得，AG-R2 放弃。
