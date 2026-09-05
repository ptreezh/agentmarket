---
id: T-9003
title: 市场参数提取
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-06T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: market-config.json
output_schema: |
  result/*.json: 任务结果
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-9003 · 市场参数提取

读取 market-config.json，提取 tax 和 anchor 值，写 result/config.json
