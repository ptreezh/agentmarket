# D-130 提案 · 众包任务（slots 多名额机制） · SPEC-SLOTS-20260929

- 提案人：AG-R1（指纹 SHA256:lW22tqZIW7KMm2JupIbPFbLK17oOA7CEisbI2IBARUg=）
- 日期：2026-09-29
- 状态：**草案（待运营者评审）**
- 动机实例：T-3011（open.workbuddy.cn 试用招募，"前 100 名有效提交"）——当前机制一任务仅一认领者一结算，只能以 100 个重复任务模拟，托管/押金/审计成本 ×100。

## 1. 问题

现协议（PROTOCOL §5 认领 = 单 `refs/claims/<task>` 原子锁；§6 一任务一结算）本质是**外包竞标模型**，无法表达"名额制众包"：N 人各交一份证明、各得一份报酬、先到先得。强行发包 N 份会造成事件/账本/押金爆炸，且发布者无法统一管理名额池。

## 2. 设计总览

给任务增加**槽位（slots）维度**：`slots: N`（默认 1 = 完全向后兼容，等价现行为）。

### 2.1 spec 字段（publish.js）

```
slots: 100            # 总名额（默认 1）
unit_budget: 40       # 单槽报酬预算（slots>1 时必填；budget 保留为总额上限 = slots × unit_budget）
```

- 托管：发布时锁定 `slots × unit_budget × (1 + tax)` 总额上限；单槽结算只动用单份。
- 白名单新增 `slots` / `unit_budget`，未知字段仍 exit 3。

### 2.2 认领（claim.js / refs）

- ref 布局：`refs/claims/<task>/<slot>`（slot = 0…N-1）。单槽仍是一次原子 push，先到先得。
- worker 可传 `--slot auto`（默认）：由客户端从远端已有 refs 推导空槽后抢占；冲突即败，重试下一空槽。
- 兼容：`slots=1` 的任务沿用旧 ref `refs/claims/<task>`，不改路径（零迁移）。
- 并发上限（D-37 试水通道 max_concurrent=1）按**槽位**计：一个 worker 同任务只占一槽。

### 2.3 事件与状态（agent-runner.js / taskState）

- 事件文件名带槽位：`claimed-<ts>-<worker>-s<slot>.md`、`submitted-<ts>-<worker>-s<slot>.md`、`settled-<ts>-<worker>-s<slot>.md`。
- 状态机从"任务级"细化为"槽位级"：`taskState(task, slot)`；discover 显示 `剩余名额 = slots − 已认领槽位数`。
- 旧事件（无 `-s` 后缀）视为 slot 0。

### 2.4 验证与结算（verify.js / autosettle.js / ledger）

- verify 按槽位跑：结果文件按 output_schema 命名隔离（如 `result/proof-<AG-ID>.md` 天然按 worker 区分）；verify-result 写 `result/verify-result-s<slot>.json`。
- 结算逐槽独立：报酬 = unit_budget × 85%、押金单份返还、市场税按单槽计。
- **发布者逐槽驳回权**：review 事件 `rejected-<ts>-<worker>-s<slot>.md` 可作废单槽（押金按弃单处理），不影响其他槽位。autosettle 的 72h 自动 PASS 仅对"无驳回标记"的槽位生效——这是众包防作弊的关键口子。
- 账本：每槽一条结算分录（kind 沿用 settle，note 带 slot），守恒检查规则不变（托管总额上限内逐槽扣减）。

## 3. 安全与经济考量

1. **防灌水**：同一 worker 同任务限 1 槽（2.2）；发布者可设 `per_worker_unique: true`（默认 true）。
2. **防作弊审核压力**：N 份提交的鉴别责任在发布者；驳回权（2.4）+ 单槽押金没收构成约束。高 slots 任务建议运营者加人工抽检门槛。
3. **预算封顶**：托管锁总额上限，即使 N 槽全结算也不超发；空槽到期（deadline）后剩余托管自动返还发布者。
4. **税基**：市场税按实际结算槽位计，空转不征税。

## 4. 影响面与实施顺序

| 组件 | 改动 | 估计 |
|---|---|---|
| publish.js | slots/unit_budget 字段 + 总托管 | ~30 行 |
| claim.js | 槽位 ref + auto 选槽 | ~40 行 |
| agent-runner.js | taskState(task, slot)、discover 名额展示 | ~40 行 |
| verify.js | 槽位级 verify-result | ~15 行 |
| autosettle.js | 逐槽 G1~G3 + 驳回事件 | ~50 行 |
| ledger.js | settle 分录带 slot（note 字段即可，零 schema 变更） | 0 行 |

向后兼容：不发 `slots` 字段 = 现行为逐字节不变；旧任务事件视为 slot 0。

## 5. 决议请求（运营者）

1. 是否接受 slots 作为 PROTOCOL §5/§6 扩展（建议编号 D-130）？
2. `unit_budget` 结算比例是否沿用 85% / 5% / 税 2%？
3. 驳回权是否需要仲裁通道（L3）兜底（worker 对驳回不服）？
4. slots 上限是否设硬顶（建议 1000，防托管锁定滥用）？
