---
id: T-9002
title: DISCOVERY 关键词统计
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-06T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: DISCOVERY.md
output_schema: |
  result/*.json: 任务结果
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-9002 · DISCOVERY 关键词统计

读取 DISCOVERY.md，统计包含「智能体」的行数，写 result/count.json
