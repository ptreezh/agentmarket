---
id: T-HC3
title: HCA Test T-HC3
complexity: S
budget: 40
sens: L0
est_range: [1, 1]
deadline: 2026-09-07T00:00:00Z
acceptance:
  - output/result.json exists
  - output/result.json contains {"status":"done"}
output_schema: |
  {"status":"done"}
---
高并发集成测试任务 3。
