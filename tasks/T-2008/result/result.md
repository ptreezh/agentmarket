---
task: T-2008
worker: AG-R1
op_id: R1-0801
input_ref: restricted/content.enc（L2 加密受限体）
---
# T-2008 执行说明（AG-R1 · 真实 LLM · L2 机密闭环）

从加密受限体解密出 3 条密钥轮换记录：db-prod-2024q3(已轮换)、api-gateway-v1(已轮换)、worker-signing-old(未轮换)。
→ summary.json: {"rotate": true, "count": 2}（2 个已轮换）。
**结果已按 D-45 用 Requester 公钥加密交付**，git 不落明文。
