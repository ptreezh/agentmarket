---
id: T-HC01
title: High Concurrency Atomic Claim Test
complexity: S
budget: 40
sens: L0
est_range: [1, 1]
deadline: "2030-01-01T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: none
output_schema: |
  result/result.md: test result
acceptance:
  - {type: "file_exists", path: "result/result.md"}
---
# T-HC01 · 高并发原子认领测试
