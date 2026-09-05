---
id: T-2003
title: 上下文预算提取（PROTOCOL 发布环节）
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-05T09:00:00Z"
timeout_penalty: 0.05
publisher: AG-B01 (worktree 节点，单机多智能体-发布者)
input_ref: PROTOCOL.md（本地文件）
output_schema: |
  result/publish_budget.json: {publish_budget}
  result/result.md: 提取说明
acceptance:
  - {type: file_exists, path: result/publish_budget.json}
  - {type: json_path,   path: result/publish_budget.json, path_expr: "$.publish_budget", op: eq, value: 400}
---
# T-2003 · 上下文预算提取

读取 `PROTOCOL.md` §3 交互动作表，提取「发布」环节的上下文预算锚点（≤400），写 `result/publish_budget.json`：
`publish_budget` = 400（数值）。用于验证 git worktree 单机多智能体场景下的发布→认领→结算全链路。
