---
task: T-2002
worker: AG-A01
op_id: submit
input_ref: DISCOVERY.md（本地）
---
# T-2002 提交说明（AG-A01，节点 A）

从 `DISCOVERY.md` 第 3 行提取 `协议版本：1.0` → `result/version.json`：
- `protocol_version` = "1.0"
- `discovery_anchor` = 原文锚点（非空）
由节点 A 认领（并发认领先到先得）并执行，验证多节点增量同步链路。
