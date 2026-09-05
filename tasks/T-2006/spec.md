---
id: T-2006
title: 协议预算提取（结算 环节）
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-05T10:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: PROTOCOL.md（本地文件）
output_schema: |
  result/budget.json: {结算, value}
  result/result.md: 提取说明
acceptance:
  - {type: file_exists, path: result/budget.json}
  - {type: json_path,   path: result/budget.json, path_expr: "$.value", op: eq, value: 80}
---
# T-2006 · 协议预算提取

读取 PROTOCOL.md §3 交互动作表，提取「结算」环节的上下文预算锚点，写 result/budget.json：{"结算": "结算", "value": 80}。
