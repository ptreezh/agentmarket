---
id: T-3003
title: CSV 销售数据聚合（T2b loop 集成测试）
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-08T16:00:00Z"
timeout_penalty: 0.05
publisher: AG-DOUBAO01
output_schema: |
  result/result.json: mock LLM 聚合输出
acceptance:
  - {type: file_exists, path: result/result.json}
---
# T-3003 · CSV 销售数据聚合（loop 集成测试）
