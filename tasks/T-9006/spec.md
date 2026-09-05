---
id: T-9006
title: 市场税率提取
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-06T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: market-config.json
output_schema: |
  result/result.json: 任务结果
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-9006 · 市场税率提取
读取 market-config.json，提取 tax 值
