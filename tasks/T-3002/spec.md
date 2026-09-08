---
id: T-3002
title: 签名链路回归：产出 done.txt
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-08T14:00:00Z"
timeout_penalty: 0.05
publisher: AG-DOUBAO01
output_schema: |
  result/done.txt: 内容为 "T-3002-ok"
acceptance:
  - {type: file_exists, path: result/done.txt}
---
# T-3002 · 签名链路回归测试

验证 claim.js 自动签名 claimed 事件（D-108）与 settle.js 运营者私钥强制检查。
产出 `result/done.txt`（内容 "T-3002-ok"），仅 1 个 file_exists 断言。
