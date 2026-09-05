---
id: T-2008
title: 密钥轮换核对（L2 机密）
complexity: S
budget: 60
sens: L2
est_range: [1, 3]
deadline: "2026-09-05T12:00:00Z"
timeout_penalty: 0.05
publisher: AG-P01
restricted_ref: sha256:5271bf11ce0cfc82
input_ref: restricted/content.enc（X25519+AES-256-GCM 加密受限体，白名单可解密）
output_schema: |
  result/summary.json: {rotate: bool, count: int}
acceptance:
  - {type: file_exists, path: result/summary.json}
  - {type: json_path,   path: result/summary.json, path_expr: "$.count", op: eq, value: 2}
---
# T-2008 · 密钥轮换核对（公开壳，内容见受限体）

本任务是 L2 机密任务：公开壳只声明任务类型/复杂度/预算/验收类型；**任务内容与敏感输入在加密受限体**，仅 Requester 白名单内 worker 可解密。验收 = 在受限体给出的密钥清单中核对轮换状态，写 result/summary.json（需含 rotate 布尔与 count 计数）。
