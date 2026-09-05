# CHANGELOG · 智能体协同市场（append-only）
> 每次变更追加一条；不修改历史条目。

## 2026-09-05 · M1.2 真实 LLM 智能体执行器
- 新增 `tasks/T-2001`（公告字段抽取，L0）+ 真实 LLM 智能体身份 `agents/AG-LLM01`。
- 全链路：认领 → 真实推理执行 → 提交 → L0 校验 8/8 → 独立交叉核对全一致 → 结算 L-0005（40=34+2+1.2+2.8）。
- **自愈**：修复 `tools/verify.js` 对字符串 `eq/ne` 强制转数值的 bug（对齐 L0-DSL 规范）；T-2000 回归 7/7 无回归。
- 新增 `OPERATIONS.md`（持续执行运行协议）、`M1.2-PLAN.md`（确定门）、`tools/healthcheck.sh`（自愈基线）。

## 2026-09-05 · M1 首个真实切片
- 新增 `tools/L0-DSL.md`（断言 DSL 锁定）+ `tools/verify.js`（参考实现）+ `executors/exec-t2000.js`（确定性执行器）。
- `tasks/T-2000` 全链路：真实 CSV 输入（hash 工件）→ 执行 → L0 7/7 → 独立 sha256sum 一致 → 结算 L-0004。
- 确定性复核：重跑逐字节一致。

## 2026-09-05 · M0 模拟 + 独立核验
- `sim/m0-sim.js`：单机多 Agent 模拟（经济闭环/冷启动/匹配/双旋钮/上下文预算），PASS 6/6。
- 独立核验：确定性复现、外部重放守恒（13000==13000 零透支）。
- **自愈/勘误**：创世 6000 原未记 mint → 修复入账（L-0003 勘误）。

## 2026-09-05 · 创世（genesis）
- `DISCOVERY.md` + `PROTOCOL.md` v1.0 + 样例档案/任务/账本（L-0001）。

## 2026-09-05 · M2 多节点稀疏增量同步 + 并发认领
- 中央 bare 仓库 `market-central.git` + 节点 B `market-node-b`（稀疏检出：tasks/tools/ledger/agents/DISCOVERY/PROTOCOL，排除 artifacts/executors）。
- **D-20 稀疏检出**：B 工作树无 artifacts/，只检必要路径。
- **D-29 增量同步**：A 发布 T-2002 → B `git pull --ff-only` 仅拉增量即见新事件（拒全量轮询）。
- **并发认领先到先得**：`tools/claim.js` —— A 认领成功 push；B 合并中央后检测已认领 → 自动回滚放弃；T-2002 仅 1 owner、1 claimed 事件。
- T-2002 执行→L0 3/3→结算 L-0006（40=34+2+1.2+2.8）；三端（A/B/中央）git 一致。
