---
id: T-2009
title: Publish Integration Test
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-07T01:32:07Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: none
output_schema: |
  result/result.md: 结果说明文件
acceptance:
  - {type: "file_exists", path: "result/result.md"}
---
# T-2009 · Publish Integration Test

这是一个发布集成测试任务。
