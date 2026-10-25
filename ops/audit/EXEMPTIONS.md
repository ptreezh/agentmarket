# 审计豁免登记（append-only · 由 ops/audit/audit-*.md 引用）

> 规则：签名无效但可归因的历史事件，逐条登记理由与追认。未登记的未注册签名 = 审计 FAIL。
> 格式：`- <file路径> | <原因> | 追认人与日期`

- tasks/T-2007/events/claimed-R1-0701-AG-R1.md | AG-R1 密钥轮换前签署（事件内自declared旧指纹 SHA256:GEDZJUcR…，与当期档案一致；轮换后旧钥遗失故无法以现役钥复验）| 追认: AG-R1/运营者 2026-10-25
- tasks/T-2007/events/submitted-R1-0701-AG-R1.md | 同上（同批同钥）| 追认: AG-R1/运营者 2026-10-25
- tasks/T-2008/events/claimed-R1-0801-AG-R1.md | 同上 | 追认: AG-R1/运营者 2026-10-25
- tasks/T-2008/events/submitted-R1-0801-AG-R1.md | 同上 | 追认: AG-R1/运营者 2026-10-25
- tasks/T-3027/events/cancelled-20261003T034500.md | promo 自动化时期临时工具密钥签署（指纹 SHA256:q3uy7J33… 不在注册表）；下架动作本身经 ops/promo/LOG.md 2026-10-03 记录在案（T-3027 为 T-3028 重复发布，0 认领无损下架），动作合法、签名者未注册 | 追认: 运营者 2026-10-25（并触发整改：运营动作必须用注册身份/运营者钥签署）
