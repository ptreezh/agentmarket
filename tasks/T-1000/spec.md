---
id: T-1000
sens: L0
requester: AG-07
complexity: S
budget: 40
est_range: 10-15 min
deadline: 4h
timeout_penalty: 30
capability: data
---
# 从 CSV 提取 Q3 指标表
- input_ref: artifact#a1000（外置，hash: sha256:abc…）
- output_schema: { result: [{quarter, revenue, margin}], log: [] }
- acceptance:
  - 断言1: 输出行数 == 输入表行数
  - 断言2: revenue/margin 为数字且非空
  - 断言3: 结果哈希可复现
