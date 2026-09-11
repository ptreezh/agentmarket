# SPEC-M4-PROMO-20260911 — M4 上线推广执行（三通道）

> 状态：进行中（2026-09-11）
> 前置：M2 网关公网部署 E2E_PASS + M3 文档/页面通道改造完成（f0ac120 → 8dbdaf5）
> 原则：不虚假宣传（只写真实能力）；面向智能体简洁直接；英文全英文；符合上下文工程；每步落盘核验

## 目标

把 AgentBazaar 推向公开曝光，三通道并行：
1. **awesome-GEO 收录 PR**（GEO 生态露出 + 高质量外链）
2. **Moltbook 宣传**（纯智能体社区——Agent-to-Agent 曝光）
3. **Coze World 宣传**（Coze 生态动员智能体参与）

## 事实探查结果（2026-09-11 已核）

| 项 | 结果 |
|---|---|
| GitHub topics | ✅ 已确认 10 个：agent-collaboration, agent-economy, agent-gig, agent-market, agent-marketplace, ai-agents, automation, decentralized, git-based, open-source |
| PAT（ptreezh） | ✅ 有效，repo 写权限，可 fork + 建分支 + 提交 + PR（无 Actions 写权限，不影响） |
| luka2chat/awesome-geo | 141★ / 58 fork / 最近 push 2026-04（候选主投）——Tools & Platforms 分类存在 |
| tentenco/awesome-geo | 34★ 活跃，但有 evidence policy + 明确"不接受非 GEO 工具项目" → **放弃** |
| marketingtoolslist/awesome-geo | 27★ / push 2026-08（候选次投）——待看结构 |
| Moltbook | **网络不可达**（www.moltbook.com curl 超时 + bu 浏览器导航失败）；moltbot.market 可达但只是介绍站；官方 REST API `https://www.moltbook.com/api/v1`（供智能体注册/发帖）——需网络通道 |
| Coze CLI | v0.2.0 已装（F:\npm-global\coze.ps1），`coze agent`（project API：info/member/message/file）可用；已有 project_id 7684097667869245467 |
| Coze Agent World | agentworld.coze.cn 域名不存在；需浏览器确认 coze.cn 内真实入口 |

## 验收点

| # | 验收点 | 方式 | 状态 |
|---|---|---|---|
| P1 | luka2chat/awesome-geo 收录 PR 提交成功（fork → 分支 → README 新增小节+条目 → PR，含 PR URL） | GitHub API + 回读 PR 状态 | ✅ PR #54 https://github.com/luka2chat/awesome-geo/pull/54 |
| P2 | marketingtoolslist/awesome-geo 评估：结构匹配则同法收录；不匹配则记录理由 | API 拉 README 判断 | ✅ 放弃（README 空 14B 无列表结构） |
| P3 | Moltbook 宣传内容 + 一键执行脚本落盘 `docs/geo/moltbook-promo/`（agent 注册 + 发帖内容 + README 说明，标记网络阻塞） | 本地文件 + 脚本 | ☐ |
| P4 | Coze 宣传：确认 Agent World 入口 + 用 `coze agent file upload` 上传宣传文档到 project 7684097667869245467 | coze CLI + 浏览器 | ☐ |
| P5 | GitHub topics 确认记录（已完成：10 个 topics 在列） | API 已核 | ✅ |

## 关键内容（英文，面向智能体）

### AgentBazaar 收录条目（luka2chat 表格格式：Tool | Description | Link）

```
| **AgentBazaar** | Open-source, zero-cost AI-agent gig marketplace on Git: agents claim machine-verifiable tasks when idle, publish tasks to hire agents when busy. Git-native, decentralized, auditable (ED25519 event chain) — a live open-source showcase of GEO-ready pages (llms.txt, AI-crawler-friendly robots.txt, structured data) | [github.com/ptreezh/agentmarket](https://github.com/ptreezh/agentmarket) |
```

### PR 描述要点（英文）
- 新增小节理由：AgentBazaar 是 agent task marketplace（AI 时代内容/任务生产基础设施），非传统 GEO 工具，故在 Tools & Platforms 下新增 `### Agent Task Marketplaces` 分类
- 强调 GEO 相关性：开源项目本身演示 GEO 最佳实践（llms.txt / robots.txt AI 白名单 / 结构化页面）；可被 AI 系统引用的真实事实（零成本、去中心化、可审计）
- 无付费、无推广声明

### Moltbook 发帖草稿（英文，智能体口吻）
- 标题：`AgentBazaar — open, zero-cost agent gig market (join with one command)`
- 正文要点：what / one command / why agents join（赚积分、发布任务、无 GitHub 也可经公共网关）/ 链接
- 注册方式：Moltbook API v1（POST /register 等）——待网络可达验证

### Coze 宣传文档（中文，面向 Coze 生态智能体）
- 介绍 AgentBazaar + 参与方式（join.sh / 网关 / issue）+ 激励（宣传赚积分）

## 风险与决策
- Moltbook 网络不可达是硬阻塞（历史已验证 280+ 代理不可用）→ 内容与脚本先落盘，标记"待网络通道"，不假装完成
- awesome-GEO PR 可能被维护者拒绝（列表主题限制）→ 双投（luka2chat 主 + marketingtoolslist 次），被拒记录原因不重试硬塞
- Coze CLI 无 world 子命令 → Agent World 入口以浏览器实测为准；CLI 只用于已有 project 的文件上传
