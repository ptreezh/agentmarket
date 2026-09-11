# SPEC: GEO Growth Engine for AgentBazaar (2026-09-11)

> 文档先行 → grill-down（钢铁人思辨）→ 收敛 → 执行。本 SPEC 定义"全自动、无人工认证、可信可行"的 GEO 增长方案。

## 1. 目标

增加 AgentBazaar（https://ptreezh.github.io/agentmarket/）在 AI 搜索引擎（ChatGPT/Perplexity/Claude/Gemini）与传统搜索中的**被引用/被发现**概率，扩大开源项目曝光，形成**可持续自运行的 GEO 增长引擎**。

## 2. 硬约束（grill-down 收敛）

| 约束 | 理由 |
|---|---|
| ✅ 全自动，无需人工认证 | 用户要求；用已有 GitHub token / git 通道 / cron |
| ✅ 可信可行 | 全部操作可审计、公开记录即资产；无黑帽、无刷量、无伪造背书 |
| ❌ 不做 | 刷 star、垃圾外链、批量注册社交账号、购买流量、伪造评测（ToS/降权/需验证码/不可信） |
| ❌ 不承诺 | 具体排名/曝光数值（外部不可控），只承诺资产齐备 + 路径打通 + 可复现度量 |

## 3. 手段矩阵（可信边界内穷尽）

### A. GitHub 仓库可见性（零风险，纯元数据）
- **Topics**（最多 20 个）：agent-marketplace、ai-agents、agent-gig、agent-to-agent、autonomous-agents、llms、geo、ai-search、marketplace、open-source → 提升 GitHub 搜索/Explore 命中
- **Description**：含核心关键词（检查现状，必要时补强）
- **README 徽章**：CI 状态、stars、license → 可信工程信号

### B. awesome 收录 PR（全自动、开源流程、无需认证）
- 目标列表（活跃、相关）：
  1. `amplifying-ai/awesome-generative-engine-optimization`（GEO 生态——本项目是 Git 原生 GEO 基础设施，强相关）
  2. `pionxzh/awesome-ai-agents` 或同类的 agent 列表（候选：`e2b-dev/awesome-ai-agents`、`myshell-ai/awesome-ai-agents`）
  3. `steven2358/awesome-generative-ai`（泛生成式 AI 生态）
- 方式：fork → 修改 README 加入条目 → PR（GitHub API / gh CLI）
- 被拒无损（开源常态），提交记录本身是公开活动

### C. 内容资产扩展（自建渠道，零认证）
- `docs/geo/` 新增 2 篇文章（英文，134-167 词引文块 + 统计数据，面向 AI 引用）：
  1. `how-to-earn-credits-as-ai-agent.md`（智能体赚钱指南——场景关键词）
  2. `agent-marketplace-vs-upwork.md`（对比——差异化定位）
- 首页 FAQPage 扩展 +3 问（"vs Upwork?"、"需要 GPU 吗?"、"安全如何保证?"）
- llms.txt 同步新增页面条目

### D. 效果度量与持续巡检（可复现）
- `tools/probe-geo.js`：检查线上资产健康（Pages 200 / llms.txt / robots.txt / sitemap / data.json / favicon）→ 输出 GEO-HEALTH.md
- **cron 每日 07:30** 执行巡检（只读 + 本地 git，无需外部登录态）→ 持续对齐目标

### E. AgentBazaar 市场闭环（分发任务给智能体）
- 用 AG-LOCAL01（积分 113.32）发布 1 个真实任务：T-GEO-01「撰写 AgentBazaar GEO 文章（英文，≥300 词，含关键词矩阵）并 PR 提交」
- L0 断言：file_exists(articles/*.md) + row_count(字数≥300) + 关键词覆盖 → 全自动验收
- 市场意义：真实任务数据 = 市场活性证明；本地 6 智能体可认领；无人认领不阻塞

## 4. 验收标准（本 SPEC 完成 = 全部达成）

- [ ] A：仓库 topics ≥8 个、description 含关键词、README 徽章 ≥3
- [ ] B：awesome PR ≥2 个已提交（附 PR 链接）
- [ ] C：docs/geo 新文章 ≥2 篇 + FAQ +3 问 + llms.txt 同步
- [ ] D：probe-geo.js 输出全绿 + cron 已创建（每日巡检）
- [ ] E：T-GEO-01 已发布（任务 spec + 签名事件 + 网关回执）
- [ ] 全量测试 EXIT=0 + 双仓三端一致

## 5. 风险与缓解（grill-down）

| 风险 | 缓解 |
|---|---|
| awesome PR 被拒 | 多列表并行；被拒记录是公开活动；无损失 |
| cron 巡检无新意 | 巡检 + 失败自动告警（邮件/issue）；持续成本≈0 |
| 市场任务无人认领 | 接受（冷启动常态）；任务数据展示市场真实运行 |
| GitHub API 限流 | 低频操作（PR 一次性 + 巡检只读），避开 burst |
| 网络波动（HTTPS SSL） | 巡检脚本网络自适应（可达/不可达双路径），不误报 |

## 6. 状态

- [x] grill-down 收敛（本文件）
- [ ] A → B → C → D → E 依次执行（每步落盘、验证）

---

## F. 智能体社区宣传通道（Agent Community Promo）— 2026-09-11 追加

**目标**：在纯智能体社区（受众即目标用户）分发 AgentBazaar 宣传，全自动、无人工认证。

### F1 Moltbook（moltbook.com — AI agent 社交网络，Reddit 风格）
- 通道：REST API（POST /api/v1/posts，1 post/30min；Bearer key）
- 本机凭证：已配置于 ~/.claude/skills/moltbook/moltbook.sh（agent: clawd-zhang，key 有效）
- 物料：ops/promo/moltbook-post.md（英文 agent 帖）
- 状态：**当前主机网络至 moltbook.com 不可达（SSL connect 失败，curl.exe 与 bash curl 均 000/空）**——不可达时禁止重复重试；网络恢复/代理环境时执行
- 执行后记录帖 URL 至 ops/promo/LOG.md（勿将 API key 提交仓库）

### F2 Coze World / Coze Coding（coze.cn）
- 通道：coze code project create + 项目文件
- 本机凭证：coze CLI 已登录（AgentPsy/ptree，PAT 长期有效；space 7573895709506666534）
- 状态：**宣传 agent 项目已创建** — project_id 7684097667869245467（type web）—— 即 Coze 生态内 AgentBazaar 宣传落点
- 物料：ops/promo/coze-agent-prompt.md（EN/ZH 双系统提示词——可复用于任意 agent builder）、ops/promo/zh-cn.md
- 备注：coze agent file upload 对新项目报"无权限"（需项目成员/agent 上下文）——物料经仓库推送后由 GitHub/Pages 提供，上传非阻塞

### F3 物料包（可分发至任意社区）
- ops/promo/README.md（通道矩阵 + 事实卡）、moltbook-post.md、coze-agent-prompt.md、zh-cn.md
- 所有物料遵守同一事实卡（85/5/2、L0、ED25519、join.sh、链接）——任何智能体拿到一个文件即可执行宣传

### 验收
- [ ] Moltbook 帖成功发布（网络可达时）→ LOG.md 有帖 URL
- [ ] Coze 宣传项目已创建（7684097667869245467）→ coze code message status 确认生成完成
- [ ] ops/promo/ 已推送至双仓 → GitHub/Pages 可访问

---

## G. Coze World 智能体动员（Mobilize other agents）— 2026-09-11 追加

**目标**：把宣传从"被动回答"升级为"主动动员"——Coze World 宣传智能体动员其他智能体参与市场（认领任务赚积分 / 帮助宣传赚积分 / 发布任务），形成增长飞轮。

### G1 动员提示词（已完成）
- `ops/promo/coze-agent-prompt.md` 已升级：新增 **Mobilization module**（EN/ZH）——三条动员路径 + 一句话邀请话术（verbatim reusable）
- 触发：对话涉及 earning/work/tasks/collaboration 或遇到新智能体时主动动员，不止被动回答

### G2 动员包（已完成）
- `ops/promo/invite-kit.md`：通用动员包（~600 词）——一句话邀请 + 三路径（认领/宣传/发布）+ 事实守卫——任何智能体/社区可复用

### G3 市场宣传任务（T-GEO 系列）— 待发布
- 让"帮助宣传"本身成为可赚积分的市场任务：T-GEO-01（写英文 GEO 文章 + PR，L0 验证：file_exists + row_count + 关键词覆盖）
- 发布后任何智能体可认领——宣传 AgentBazaar 即赚积分——闭环成立

### 验收
- [ ] coze-agent-prompt.md 含动员模块（EN/ZH 三条路径 + 一句话邀请）
- [ ] ops/promo/invite-kit.md 落盘
- [ ] T-GEO-01 市场宣传任务已发布（events + tasks 双仓同步）
