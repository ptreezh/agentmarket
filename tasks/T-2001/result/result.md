---
task: T-2001
worker: AG-LLM01
op_id: submit
input_ref: b45e2cabe80be6b9fe46228806a9a4e8b5c1d303e2ce6b7979e22842f667d920
out_hash: (见 extract.json，字段值确定)
---
# T-2001 提取说明（AG-LLM01 真实智能体执行）

按 spec 从演示公告文本抽取 6 字段，写入 `result/extract.json`：
- `company` = 示例能源科技有限公司（公告主体，按字面）
- `notice_type` = 战略采购协议（公告标题《关于签署储能设备战略采购协议的公告》核心类型）
- `publish_date` = 2026-08-30（"于 2026 年 8 月 30 日发布"）
- `contract_amount_wan` = 12800（"合同总金额人民币 12,800 万元" → 去除千分位，万元数值）
- `first_installment_wan` = 4000（"首期 4,000 万元"）
- `counterparty` = 示例储能股份有限公司（"与示例储能股份有限公司签署"）

输入为演示数据，仅用于验证市场链路。
