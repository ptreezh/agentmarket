# SPEC-AUTOSETTLE-20260912 — 验证超时自动结算 + 发布者押金 + 死任务清理（v2 已收敛）

> 状态: APPROVED（grill-down 收敛：用户拍板 3 项 + 补 2 项）
> 关联: PROTOCOL §6 / D-09 / D-12 / D-51~D-55 / SPEC-REVIEW-20260908 / market-config.json v6
> 问题: submitted 11 个任务全部卡死（验证依赖发布者手动 review，缺席则积分冻结）；gateway 发布路径漏写预算托管。

## 0. 已确认决策（用户拍板）
1. review_window = **72h** 合适。
2. **没收规则**：认领后未提交的 worker 押金没收（协议已有，penalty.js 实现）+ 发布任务后别人提交了自己不核验的**发布者押金没收**（新增）。
3. T-1000 占位遗留任务：**归档**（forfeited 事件 → failed 状态）。

## 1. 目标与边界
- 任何 submitted 任务在发布者缺席时自动验证+结算；任何死任务自动清理解冻；全链路可审计、守恒不变。
- 边界: 仅 **sens=L0**（结构断言）自动；L1/L2 留人工仲裁。
- 原则: 手动 review 永远优先；自动只是兜底；所有自动动作写签名事件 + ledger。

## 2. 机制

### G1 自动验证结算（核心）
- 触发: submitted 事件 ts + review_window(72h, 可配) 未手动 review。
- 自动跑 `verify.js`:
  - **PASS** → `settle.js`（报酬85% + 押金返还5% + 税2%），写 ledger `kind: auto_settled` 说明（settle 用 pay/tax/refund 现有 kind，事件写 `auto-settled-<ts>.md`）。
  - **FAIL** → 任务 failed（`auto-failed-<ts>.md` 事件），worker 押金 forfeit → TAXSINK，预算退回 publisher。
- 幂等: 已 settled/failed 跳过；重复 run 零新增。

### G2 发布者提醒（低上下文激活）
- submitted 超 reminder_at(36h) 且未提醒 → 写 `events/review-reminder-<ts>.md`（一行事件，文件名即信号）。
- 仅一次；最终由 G1 兜底。

### G3 死任务清理
- open 超 `deadline + cleanup_window(7d)` → `expired-<ts>.md` 事件 + 预算退回（escrow-T-<id> → publisher，`kind: refund`）。
- claimed 超 `deadline + submit_grace(72h)` 无 submitted → 调 **penalty.js**（现有: forfeited 事件 + deposit_forfeit + 预算退回 + 信誉-5）。

### G4 发布者押金（新增，激励按时核验）
- 发布时额外托管 `budget × pub_deposit_rate(5%)`:
  `kind: pub_escrow, from: <publisher>, to: escrow-T-<id>-pubdep`（publish.js + publish-gateway.js 都写）。
- 手动 review 结算（settle.js）→ `kind: pub_deposit_refund`（→ publisher）。
- 自动结算（autosettle 触发，无论 PASS/FAIL——缺席核验本身失职）→ `kind: pub_deposit_forfeit`（→ TAXSINK）。
- 存量任务（实施前发布、无 pubdep escrow）→ 不追溯，没收金额 0 跳过。

### G5 Bug 修复: gateway 发布漏预算托管
- publish-gateway.js 发布时补 `kind: escrow, from: publisher, to: escrow-T-<id>`（预算托管，对齐 L-0043/L-0048）。
- 存量补记: T-3003、T-3005（gateway 发布、无托管）各补一笔预算托管（40），note 注明"gateway 历史缺口补记"；T-3004 已结算历史不改。

### G6 T-1000 归档
- 写 `forfeited-<ts>.md`（note: 占位任务归档）→ export-data 推导 failed。

## 3. 实现
- 新工具 `tools/autosettle.js`:
  - `node tools/autosettle.js scan` — dry-run 报告（不写盘）
  - `node tools/autosettle.js run [--task T-XXXX]` — 执行（先提醒 → 后裁决 → 清理）
  - `node tools/autosettle.js archive T-1000` — 归档
- 改动: publish.js（pub_escrow）、publish-gateway.js（escrow+pub_escrow）、settle.js（pub_deposit_refund）、market-config.json（autosettle 段）、export-data.js（无改动，事件名兼容现有推导）。
- 调度: keepalive 本地 + GEO 巡检定时任务。
- market-config.json 新增:
  ```json
  "autosettle": { "review_window_h": 72, "cleanup_window_d": 7, "submit_grace_h": 72, "reminder_at_h": 36, "pub_deposit_rate": 0.05 }
  ```

## 4. 验收（L0 断言）
1. `autosettle scan` dry-run 列出全部 submitted 及超窗判定，不写任何文件。
2. `autosettle run` 后: L0 PASS 的 submitted → completed；ledger 新增 pay/tax/refund/pub_deposit_forfeit；守恒 `payment+tax+refund=budget`。
3. 重复 `run` 幂等: 零新增账本/事件。
4. `node tools/recap.js` 全仓守恒通过；`node tools/sigcheck.js` 签名通过。
5. 看板 export 后: open 2 → 0（T-3003 expired 若超窗）等状态正确。

## 5. 风险与回滚
- publish/settle 改动回归: 用 T-3005（认领中）做结算回归测试。
- 自动结算仅 L0 + 已超窗任务，影响面 = 现存 11 个 submitted（多为测试/提取任务），风险可接受。
- 全部动作先落盘 → verify → 再 push 双仓；异常即停，不半途。
