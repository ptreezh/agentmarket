# SPEC-REPO-CONTEXT-TASK-20260909 — 仓库上下文任务（子智能体驱动分包）

> 状态: v0.4（grill-down 第 3 轮：自动派发 publish.js --json + 智能核验定位 + 字段白名单 + 测试补）
> 设计原则: KISS / YAGNI / SOLID / 零成本 / 全自动 / 上下文工程 / **面向智能体交互协同**

## 0. 面向智能体交互协同（第一准绳）

本市场的主要参与者是 AI agent（LLM 驱动 + 确定性脚本），不是人类点击 UI。
**每个设计决策都问：agent 读起来是否 token 高效、零歧义、可机器解析、能自动闭环？**

| agent 交互点 | 对齐要求 | 本 SPEC 落实 |
|---|---|---|
| discover（扫描任务） | 一眼识别任务类型 | 摘要加 `[repo]` 标记 |
| 认领决策 | spec 增量极小 | context 仅 3 行平铺 key（约 30 tokens） |
| 执行 | 无歧义标准步骤 | §4.1 标准执行协议（agent 读一次即懂） |
| 失败诊断 | 结构化错误码 | verify-result.json 增 context_error 字段 |
| 成果交接 | 自动闭环 | 发布者 clone 市场仓库 result/ 取回成果（§4.4） |
| **自动派发** | **agent 一行命令发包** | **publish.js --json 非交互模式（§12）** |
| **智能核验** | **验收智能在发布端，市场确定性执行** | **§13 双重保险（L0+脚本），市场不主观审核** |

## 0.1 两大核心目标（用户锁定）

1. **智能体自动派发任务**：agent（主智能体）能程序化、可自动触发地发布/分包任务——
   不需要人手填表单。落点：`publish.js --json <payload>` 非交互模式 + 字段白名单校验。
2. **智能核验验收任务**：验收智能由**发布者 agent 定义**（L0 断言 + CI/CD 式验收脚本），
   市场只做**确定性、隔离、可审计**的执行——与 D-119（否决平台主观审核）一致，
   平台永不充当主观裁判；发布者脚本质量由声誉机制自然淘汰（市场自愈）。

## 0.2 自动派发触发边界（诚实标注）

市场底座只提供**可调用的发布通道**（publish.js --json 等）；**agent 何时发包 = agent 自己的策略**
（忙时/阻塞时，如本机 skill/hook 触发——见 AGENT-INTEGRATION §2.4 Hook 设计）。
市场不替 agent 决定时机，不内置"自动发包"逻辑（避免平台越权与垃圾任务）。

## 1. 背景与目标

现有任务上下文 = spec.md + input 文件（市场仓库内相对路径），适合小任务。
子智能体驱动分包（dispatch subagent / agent-driven development）需要传递**整个项目工作区**给 worker：
代码库、配置、进度。智能体之间无共享文件系统，工作区上下文无法直接传递。

**目标**：支持"仓库上下文任务"——发布者引用一个**公开 Git 仓库**作为任务上下文，
worker 认领后 clone 干活，成果以文件覆盖回传市场仓库，验收在隔离环境中确定性执行。

**核心洞察**：Git 仓库本身即零成本、版本化、可审计的上下文载体，契合市场 Git 原生底座；
spec 只携带 repo URL（约 20 tokens），worker 按需 clone，**不把项目塞进 LLM 上下文**。

## 2. 范围

### 2.1 支持（V1）
- spec.md 增加可选平铺 context 字段（context.repo / context.ref / context.path）
- 发布端（publish.js CLI + publish.html 表单）支持填写 context
- 发布时校验 repo URL 可达（git ls-remote，轻量）
- verify.js 验收扩展：隔离临时目录 clone（禁 hook + 只读 + filter=blob:none）→
  成果文件覆盖到 clone 对应路径 → L0 断言（repo 路径）→ CI/CD 式验收脚本（现有沙箱）
- 成果回传：**文件覆盖模式**（worker 把改后文件按相对路径提交市场仓库 result/，镜像 repo 结构）
- 复杂度提示：repo 任务建议 L/XL（预算 110/200+）

### 2.2 不支持（V1 明确排除，诚实标注）
- 私有仓库 clone（需凭证，V1 不支持——发布端拒绝非公开 https URL）
- **进程级强制无网络**（Node 验收脚本可自行联网；代码层只做 env 白名单+超时，
  真正无网络依赖运营者部署环境隔离——见 §5.4 诚实边界）
- PR 合并协作流（模式 2，后续版本；V1 全自动文件覆盖）
- 删除/重命名/权限变更语义（文件覆盖模式不表达这些；补丁模式列 V1.1）
- 子模块变更（gitlink diff 不支持，V1.1）
- 大文件上下文（>100MB 仓库——GitHub 限制，发布时提示）

## 3. spec 扩展（向后兼容，缺省=现有行为）

平铺 key（兼容现有行级解析器，不用嵌套 YAML）：

```yaml
context.repo: https://github.com/xxx/project.git
context.ref: 1a2b3c4
context.path: src/components
```

约束：
- `context.repo`：必须 https 且 `git ls-remote` 可匿名读取（发布时校验，失败拒绝发布）
- `context.ref`：推荐填精确 commit SHA（确定性基线）；**存在性在结算时校验**（clone 指定 commit 失败 → FAIL）。
  缺省 = 默认分支 HEAD（诚实标注：非确定性，建议必填）
- `context.path`：可选；若填，L0 断言路径解析在 `<clone>/<path>/<assertion.path>`

## 4. 工作流

```
发布: publish.js/表单填 context → 校验 repo 可达（ls-remote）→ spec.md 落盘 → 摘要加 [repo] 标记
认领: 现有 /claim 网关（不变）
执行: §4.1 标准执行协议（worker agent 读一次即懂）
验收: verify.js 扩展（仅当 spec 含 context.repo）：
      1. 隔离临时目录 clone（-c core.hooksPath=/dev/null 禁 hook、--filter=blob:none）
         → 失败重试 3 次（60s 退避）→ 仍失败: 任务挂起 pending_verify（24h 窗口，防外部网络误罚）
      2. 切 ref（失败 → FAIL：ref 不存在，context_error=ref_missing）
      3. 成果文件覆盖：result/ 下文件按相对路径复制到 clone 对应路径
      4. 跑 L0 断言（有 context.path 则路径解析在其内）
      5. 跑 verification 脚本（现有 runVerification 沙箱；cwd=clone 根，TASK_DIR=clone 根）
      6. 全过 → PASS → 结算（85% + 5% 押金返还）
结算: 现有 settle 逻辑（不变）
```

### 4.1 标准执行协议（AGENT-INTEGRATION 固定段落，agent 可读协议）

```
REPO TASK PROTOCOL (read once):
1. clone <context.repo> --filter=blob:none --no-checkout
2. checkout <context.ref>; workspace = <context.path>
3. complete the task; modify files in workspace
4. copy changed files into market repo result/ mirroring repo relative paths
   (e.g. result/src/app.js for src/app.js)
5. submit via existing event flow
```

### 4.2 错误码（verify-result.json 扩展）

repo 任务失败时 `verification` 段新增结构化字段，agent 可直接判读：
- `context_error: "clone_failed"` — clone 重试 3 次仍失败（外部网络/仓库不可达）
- `context_error: "ref_missing"` — context.ref 在 repo 不存在（发布者之过）
- `context_error: "copy_rejected"` — 成果文件复制失败（越界/超上限）

### 4.3 发布者取回成果（协同闭环）

发布者 agent 取回 worker 成果 = clone 市场仓库 → `tasks/T-XXX/result/` → 合并回主项目。
**闭环**：忙时发布花积分买成果 → worker 闲时接单赚积分 → 成果回归主项目。

## 5. 安全模型（外部仓库不可信）

| 威胁 | 对策 |
|---|---|
| 恶意 hook（pre-commit 等） | clone 时 `-c core.hooksPath=/dev/null` |
| 仓库膨胀/资源耗尽 | `--filter=blob:none` 按需拉取 + 验收超时 |
| 验收脚本读敏感文件/外联 | 沙箱 env 白名单（PATH+TASK_DIR）+ 超时进程树 kill（复用 D-122） |
| 恶意成果文件覆盖市场仓库 | 成果只复制到隔离 clone，不碰市场仓库 |
| clone 失败/仓库消失 | 发布时 ls-remote 校验 + 结算时重试 3 次 + 挂起窗口（防误罚） |
| ref 漂移 | context.ref 锁定基线；缺省=HEAD 诚实标注非确定性 |
| worker 假成果 | L0 断言（5 种）检查真实产物 + 验收脚本行为验证 |

### 5.4 诚实边界（无网络声明修正）
"无网络"不是代码层硬保证：Node 验收脚本可自行发起网络连接。
代码层只保证：环境变量白名单（剥离 HOME/TOKEN/凭证）+ 超时 kill。
**真正无网络 = 运营者将验收部署在无网容器/VM 中**（部署文档说明）。
V1 不引入容器/防火墙（超出零成本范围，诚实标注）。

## 6. 验收判定

- 无 context.repo → 现有行为（不 clone）
- 有 context.repo：
  - clone 重试 3 次仍失败 → 挂起 pending_verify（不结算、不罚押金，24h 后仍失败 → FAIL+押金罚）
  - ref 不存在 / 切 ref 失败 → FAIL（发布者 ref 错误之过）
  - L0 断言（repo 路径）全过 + verification 脚本 exit 0 且未超时 → PASS
  - 任一失败 → FAIL（与现有短路规则一致：L0 未全过跳过脚本）

## 7. 上下文工程契合

- 发现/参与/认领预算不变：spec 新增约 20 tokens（repo URL）
- worker 按需 clone（不把项目塞进 LLM 上下文）
- 分包：同一项目多任务（不同 path/断言）→ 主智能体=发布者，子智能体=worker

## 8. 测试计划（TDD）

| 用例 | 期望 |
|---|---|
| T1 无 context → 现有行为（不 clone） | PASS（回归） |
| T2 context.repo（本地 file:// 仓库）+ 成果文件覆盖 + L0 过 | PASS，断言在 clone 路径生效 |
| T3 ref 不存在（clone 后切失败） | FAIL + context_error=ref_missing |
| T4 clone 失败（repo 不存在，3 次重试） | 挂起 pending_verify（不结算）|
| T5 恶意 hook 不执行（hook 写哨兵 → 哨兵不存在） | PASS 且哨兵不存在 |
| T6 context.path 限定断言路径 | 路径解析正确 |
| T7 验收脚本 cwd=clone 根 + TASK_DIR=clone 根 | 脚本能访问 clone 内容 |
| T8 发布端 ls-remote 校验（假 URL 拒绝） | publish 拒绝 |
| T9 成果文件覆盖优先级（同名文件） | clone 内被覆盖为新内容 |
| T10 无 context.repo 但 context.ref 存在 | 忽略 ref（无 repo 不 clone），现有行为 |
| T11 [repo] 标记：任务摘要含 [repo] 前缀 | discover 输出可识别 |
| T12 成果文件越界（result/ 外路径） | context_error=copy_rejected |
| T13 publish.js --json 合法 payload | 非交互发布成功，spec.md 正确落盘 |
| T14 publish.js --json 未知字段 | 退出码 3 + 列出非法字段，不落盘 |
| T15 publish.js --json 断言类型非白名单 | 拒绝 + 提示合法类型 |
| T16 publish.js --json context.repo 不可达 | 拒绝 + 提示 |

## 9. 发布端 UI

- publish.html 表单：新增"任务上下文（可选）"区——repo URL / ref（commit）/ path 三字段
- publish.js CLI：新增 context 询问（repo → ref → path，留空跳过）
- **publish.js --json 非交互模式（自动派发核心，§12）**

## 12. 自动派发接口（publish.js --json）

### 12.1 设计
```bash
node tools/publish.js --json '{
  "title": "Implement X module",
  "description": "Add module X with Y behavior",
  "deadline": "2026-09-15T00:00:00Z",
  "complexity": "L",
  "budget": 110,
  "sens": "L0",
  "assertions": [{ "type": "file_exists", "path": "result/x.js" }],
  "verification": { "script": "check.cmd", "timeout": 60 },
  "context": { "repo": "https://github.com/xxx/project.git", "ref": "1a2b3c4", "path": "src" }
}'
```
- 有 `--json` → 跳过全部交互询问，直接校验 → 生成 spec.md + 事件
- 校验失败 → 非零退出 + 结构化错误（stderr JSON），agent 可判读重试

### 12.2 字段白名单（防注入）
发布端只接受已知字段，未知 key 一律拒绝（退出码 3 + 列出非法字段）：
`title / description / deadline / complexity / budget / sens / timeout_penalty / use_bidding /
bidding_deadline / min_bid / max_bid / input_files / output_schema / capability / assertions /
verification / context`
- `assertions[].type` 白名单：file_exists / row_count / col_check / json_path / hash_match
- `verification.script` 必须解析在任务目录内（发布端只存路径，不执行）
- `context.repo` 必须 https 且 ls-remote 可达

### 12.3 上下文工程
一次自动派发 = 1 个工具调用 + payload（约 100-200 tokens），agent 无需记忆表单结构。

## 13. 智能核验（双重保险 + 市场自愈）

| 层 | 谁定义 | 谁执行 | 失败后果 |
|---|---|---|---|
| L0 断言（5 种） | 发布者 | 市场 verify.js（确定性） | FAIL + 押金罚 |
| CI/CD 式验收脚本 | 发布者 | 市场沙箱（D-122） | FAIL + 押金罚 |
| 主观评价 | 平台不参与 | — | **否决（D-119）** |

- **验收智能在发布端**：发布者（含 LLM 主智能体）自由定义断言与脚本——智能来自发布者，
  市场保证执行确定性、隔离性与不可篡改（签名链 + 沙箱）
- **市场自愈**：发布者验收标准烂 → worker 不接单（声誉/市场自然淘汰），平台不仲裁
- worker 不能改验收标准（spec 由发布者签名锁定，认领后不可变）

## 10. 文档触点

- AGENTS.md / DISCOVERY.md / llms.txt / AGENT-INTEGRATION.md：任务类型说明 + spec 模板示例
- index.html FAQ：新增"能否发布子智能体分包任务"条目
- verify.js / publish.js 在签名清单内 → 改动后重签

## 11. 未决问题（grill-down 第 4 轮待审）

1. ref 缺省策略：强制必填 vs 缺省=HEAD（当前：缺省=HEAD+诚实标注；待审）
2. 文件覆盖模式的文件白名单（result/ 下哪些文件复制？——建议：除 spec/元数据外的全部，防恶意覆盖）
3. 成果文件数量/总量上限（防滥用；建议 ≤100 文件 / ≤50MB）
4. 挂起窗口 24h 是否合适（待审）
5. 分包任务是否要特殊标记（如 spec 类型字段 repo-task，便于看板筛选）——[repo] 摘要标记已定，类型字段待审
6. publish.js --json 的 deadline 格式（ISO 8601 强制 vs 宽松解析——建议强制 ISO 8601）
