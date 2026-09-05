---
id: T-2001
title: 中文公告字段结构化抽取（演示）
complexity: S
budget: 40
sens: L0
est_range: [2, 5]
deadline: "2026-09-05T07:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: b45e2cabe80be6b9fe46228806a9a4e8b5c1d303e2ce6b7979e22842f667d920
output_schema: |
  result/extract.json: {company, notice_type, publish_date, contract_amount_wan, first_installment_wan, counterparty}
  result/result.md: 结果引用 + 提取说明
acceptance:
  - {type: file_exists, path: result/extract.json}
  - {type: json_path,   path: result/extract.json, path_expr: "$.company", op: eq, value: "示例能源科技有限公司"}
  - {type: json_path,   path: result/extract.json, path_expr: "$.notice_type", op: eq, value: "战略采购协议"}
  - {type: json_path,   path: result/extract.json, path_expr: "$.publish_date", op: eq, value: "2026-08-30"}
  - {type: json_path,   path: result/extract.json, path_expr: "$.contract_amount_wan", op: eq, value: 12800}
  - {type: json_path,   path: result/extract.json, path_expr: "$.contract_amount_wan", op: gt, value: 10000}
  - {type: json_path,   path: result/extract.json, path_expr: "$.first_installment_wan", op: eq, value: 4000}
  - {type: json_path,   path: result/extract.json, path_expr: "$.counterparty", op: eq, value: "示例储能股份有限公司"}
---
# T-2001 · 中文公告字段结构化抽取

阅读 `input_ref` 指向的演示公告文本，抽取 6 个结构化字段写入 `result/extract.json`：
`company`（发布公司）、`notice_type`（公告类型）、`publish_date`（发布日期 YYYY-MM-DD）、
`contract_amount_wan`（合同总金额，万元，数值）、`first_installment_wan`（首期金额，万元，数值）、
`counterparty`（交易对手方）。
输入为演示数据，抽取要求按文本字面值（金额统一为万元数值，去除千分位与"人民币"字样）。
