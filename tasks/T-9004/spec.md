---
id: T-9004
title: 协议认领预算提取
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-06T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: PROTOCOL.md
output_schema: |
  result/result.json: 任务结果
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-9004 · 协议认领预算提取
读取 PROTOCOL.md §3，提取「认领」环节预算
