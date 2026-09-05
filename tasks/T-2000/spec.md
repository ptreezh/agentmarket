---
id: T-2000
title: 区域季度销售聚合（Q3 2026）
complexity: S
budget: 40
sens: L0
est_range: [2, 5]
deadline: "2026-09-05T06:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: d4f056b5178afcad46a69ffc8db014929250152158e8995831c30160f020c68e
output_schema: |
  result/out.csv: 列 region,total_revenue,total_orders（每区域一行，确定性）
  result/summary.json: {period,regions,total_revenue,total_orders}
  result/result.md: 结果引用 + out_hash
acceptance:
  - {type: file_exists, path: result/out.csv}
  - {type: row_count,   path: result/out.csv, op: ge, value: 3}
  - {type: col_check,   path: result/out.csv, col: total_revenue, op: gt, value: 0}
  - {type: col_check,   path: result/out.csv, col: total_orders, op: gt, value: 0}
  - {type: json_path,   path: result/summary.json, path_expr: "$.total_revenue", op: eq, value: 1020.7}
  - {type: hash_match,  path: result/out.csv, sha256: "61262388a437eebf1e1e56777c3c96c3d80e258ba249893940a5732ceb2d3dc5"}
  - {type: file_exists, path: result/result.md}
---
# T-2000 · 区域季度销售聚合

对 `input_ref` 指向的 Q3 2026 销售明细（9 行：region/month/revenue/orders）按 region 聚合，
输出每个区域的季度总收入与总订单，另输出汇总 JSON。输出必须确定性可复现（hash_match 校验）。
示例数据为演示用途（非真实业务），仅用于验证市场链路。
