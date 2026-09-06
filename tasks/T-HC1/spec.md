---
id: T-HC1
title: HCA Test T-HC1
complexity: S
budget: 40
sens: L0
est_range: [1, 1]
deadline: "2030-01-01T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: none
output_schema: |
  result/result.md: result
acceptance:
  - {type: "file_exists", path: "result/result.md"}
---
# T-HC1 · HCA 高并发测试任务
