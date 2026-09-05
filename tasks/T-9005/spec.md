---
id: T-9005
title: DISCOVERY 行数统计
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-06T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: DISCOVERY.md
output_schema: |
  result/result.json: 任务结果
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-9005 · DISCOVERY 行数统计
读取 DISCOVERY.md，统计总行数
