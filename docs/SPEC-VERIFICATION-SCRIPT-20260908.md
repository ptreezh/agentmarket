# SPEC-VERIFICATION-SCRIPT-20260908 — D-122 可执行验证规则（发布者定义 CI/CD 式验证）

- 日期：2026-09-08
- 决策引用：D-122（方向采纳，backlog 高优先级）
- 状态：SPEC v0.1 草案 → 待 grill-down → 修订 → TDD

## 1. 背景与问题

现状 L0 断言（`acceptance`，verify.js 实现）只支持五类**声明式**断言：
`file_exists / row_count / col_check / json_path / hash_match`。

表达力有限：真实任务验收（跑测试套件、编译、生成物检查、执行交付物脚本并核验输出）无法用声明式断言表达。

D-122 裁决：发布者发布任务时，可附带**可执行验证规则**（CI/CD 式流水线概念）——一个随任务提交的验证脚本，在结算验证阶段于**沙箱环境**运行，`exit 0`=通过，`非 0`=不通过。确定性、无 LLM、无中心审核，替代 validator 市场化的大部分价值。

## 2. 现状（以真实代码为准，2026-09-08 核验）

- `spec.md` frontmatter 字段：id/title/complexity/budget/sens/est_range/deadline/timeout_penalty/publisher/input_ref/output_schema/acceptance
- `acceptance`：YAML 数组 `- {type, path, op, value, ...}`
- `verify.js <taskDir>`：解析 acceptance → 逐条执行 → 写 `result/verify-result.json`（含 total/passed/assertions/verdict）→ exit 0=PASS 1=FAIL
- `settle.js <taskId>`：读 `result/verify-result.json`，verdict !== PASS 则拒绝结算；**不重复执行验证**
- 验证只发生在 verify.js 一处 → **最小侵入点**

## 3. 设计

### 3.1 spec.md 新增可选字段（frontmatter）

```yaml
verification:
  script: verifier.sh     # 任务目录内验证脚本（相对任务根，随任务提交）
  timeout: 120            # 秒；默认 60；超时 = FAIL
```

- `verification` 段整体**可选**：无此段 = 老行为（纯 L0），零破坏。
- 解释器按扩展名选择：`.sh`→sh、`.cmd`/`.bat`→cmd /c、`.js`→node；其他/无扩展名→sh。
- **解释器依赖运行者环境**：sh 需 Git Bash/Unix 环境（Windows 建议用 .cmd 或 .js）；解释器缺失时返回明确错误（FAIL，注明原因）。
- 不提供 `script_inline`（v0.1 保持最小；需要时再扩展）。

### 3.2 执行模型（verify.js 内追加，位于 L0 断言之后）

```
L0 acceptance 全过？
├─ 否 → FAIL（短路，不执行 verification）
└─ 是 → 执行 verification.script（沙箱）
       ├─ exit 0 → PASS（追加 verification 结果到 verify-result.json）
       ├─ exit 非 0 → FAIL
       └─ 超时（timeout 秒）→ kill 进程树 → FAIL
```

- 验证结果写入 `verify-result.json` 新增 `verification` 段：
  `{script, timeout, exit_code, timed_out, output(截断 2KB), verdict}`
- `verdict` 总判定 = L0 全过 且 verification 过（如存在）。
- settle.js **不改**（仍读 verdict）。

### 3.3 沙箱与安全模型（强制红线）

在 verify.js 用 `child_process.spawnSync` 执行，约束：

| 项 | 规则 |
|---|---|
| 工作目录 | 任务目录（交付物所在），脚本只读验证用 |
| 环境净化 | **只传最小环境**：`PATH`（系统默认）+ `TASK_DIR`（任务绝对路径）；**剥离** HOME、GIT_*、SSH_*、TOKEN/KEY/SECRET/PASSWORD 类环境变量（全部删除）；Windows 额外剥离 USERPROFILE/APPDATA |
| stdin | 关闭（`/dev/null`） |
| 超时 | `timeout` 秒（默认 60，上限 600）；超时 **kill 整个进程树**（Windows: `taskkill /pid <pid> /T /F`；Unix: `detached:true` + `process.kill(-pid)`） |
| 输出 | 捕获 stdout/stderr，截断 2KB 存入 verify-result.json |
| 路径穿越 | `script` 解析后必须位于任务目录内，否则拒绝（T10） |
| 醒目警告 | 执行脚本前打印警告行：`⚠️ 将运行发布者脚本 <script>（任意代码执行）——确保在无敏感数据/密钥的隔离环境` |
| 运行身份 | verify.js 由运行者以**普通账户**执行 |
| 脚本不得修改任务目录 | 文档级约定：验证脚本只读交付物；临时文件写系统 temp（v0.1 不强制，检测留待未来） |

**🔴 安全边界（诚实声明，必须写入文档）**：
1. **verify.js 代码层无法阻止脚本访问文件系统**（Node 跨平台无轻量 fs 沙箱）。环境净化只剥离环境变量，**不阻止脚本读取任意可读文件**（如用户主目录私钥）。
2. 因此 verification 脚本 = **运行者机器上的任意代码执行**。防线分两层：
   - 代码层：环境净化 + 超时 kill + 路径穿越拒绝 + 醒目警告；
   - **运行层（架构约定）**：verification 任务**必须**由运行者在无敏感数据、无密钥的账户/环境执行（普通用户账户、临时 VM/容器最佳）；运营者私钥**绝不**存在于执行验证的机器。agent-runner 部署文档必须明确此要求。
3. 信任依据：发布者声誉 + 签名链（脚本随任务提交，被签名覆盖，事后可追溯）。
4. 容器化强隔离列为未来扩展（backlog），v0.1 不做。

### 3.4 兼容性

- 无 `verification` 段的任务：行为与现状完全一致。
- 有 `verification` 段：L0 全过后再执行脚本。
- verify-result.json schema 向后兼容（新增字段，旧字段不变）。

### 3.5 上下文预算影响

- spec.md 增加约 2 行（script + timeout ≈ 20 tokens），发现/参与/认领预算富余内，无需调整。

## 4. 测试计划（TDD，tests/verification.test.js）

| # | 用例 | 预期 |
|---|---|---|
| T1 | 无 verification 段 | 老行为，verdict 由 L0 决定 |
| T2 | script exit 0 | PASS，verification.verdict=pass |
| T3 | script exit 1 | FAIL，verification.verdict=fail |
| T4 | script 不存在 | FAIL（明确错误：脚本缺失） |
| T5 | 超时（timeout=1，脚本 sleep 5） | FAIL，timed_out=true，进程被 kill |
| T6 | 环境净化：脚本输出 `$HOME`/`$GIT_ASKPASS` | 为空（已剥离） |
| T7 | L0 失败 + verification 存在 | 短路：不执行脚本，FAIL |
| T8 | verification 输出记录 | verify-result.json 含 output（截断） |
| T9 | 退出码 0 但输出为空 | PASS（输出为空不判失败） |
| T10 | 路径穿越尝试（script: ../../evil.sh） | 拒绝：script 必须解析在任务目录内 |

## 5. 验收标准

- [ ] spec.md 解析 verification 段（script/timeout）
- [ ] verify.js 按 3.2 流程执行，结果入 verify-result.json
- [ ] 安全红线全部实现（3.3 表逐项）
- [ ] tests/verification.test.js 10 用例全绿（exit 0）
- [ ] 回归：现有 T-2000 等老任务 verify 行为不变
- [ ] SIGNATURES.md 重签（verify.js 是核心文件）；文档同步（PROTOCOL/AGENT-INTEGRATION）
- [ ] 双端推送

## 6. 不在范围（v0.1 不做）

- script_inline / 多脚本流水线 / 步骤级报告
- 容器/Docker 强隔离（backlog）
- 脚本依赖下载安装（无网络假设）
- 发布者"验证脚本"签名分离（脚本随任务提交，随任务签名链覆盖）
