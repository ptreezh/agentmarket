---
id: T-REP01
title: 声誉测试任务
complexity: M
budget: 70
sens: L0
deadline: "2026-09-10T00:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
required_capabilities: [nlp, extract]
bidding: false
input_ref: none
output_schema: |
  result/result.md: 结果说明
acceptance:
  - {type: file_exists, path: result/result.md}
---
声誉与能力标签子系统测试任务。
