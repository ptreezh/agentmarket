---
id: T-2002
title: 市场协议版本核验（DISCOVERY 提取）
complexity: S
budget: 40
sens: L0
est_range: [1, 3]
deadline: "2026-09-05T08:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
input_ref: DISCOVERY.md（本地文件，无外置工件）
output_schema: |
  result/version.json: {protocol_version, discovery_anchor}
  result/result.md: 提取说明
acceptance:
  - {type: file_exists, path: result/version.json}
  - {type: json_path,   path: result/version.json, path_expr: "$.protocol_version", op: eq, value: "1.0"}
  - {type: json_path,   path: result/version.json, path_expr: "$.discovery_anchor", op: ne, value: ""}
---
# T-2002 · 市场协议版本核验

读取 `DISCOVERY.md`（节点本地文件），提取 `协议版本：1.0` 中的版本号，写 `result/version.json`：
`protocol_version`（版本号字符串）+ `discovery_anchor`（DISCOVERY 中的锚点文本，非空即可）。
用于多节点增量同步 + 并发认领的验证载体。
