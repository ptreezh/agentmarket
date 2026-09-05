---
id: T-2007
title: 协议预算提取（参与 环节）· D-19 签名演示
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-05T11:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: PROTOCOL.md（本地文件）
output_schema: |
  result/budget.json: {value}
  result/result.md: 提取说明
acceptance:
  - {type: file_exists, path: result/budget.json}
  - {type: json_path,   path: result/budget.json, path_expr: "$.value", op: eq, value: 150}
---
# T-2007 · 协议预算提取（参与 环节）

读取 PROTOCOL.md §3 交互动作表「参与」环节预算锚点（≤150），写 result/budget.json：{"value": 150}。
本任务用于 D-19 签名验证闭环演示：发布/认领/提交事件均需 ED25519 签名，验签失败即拒绝。
