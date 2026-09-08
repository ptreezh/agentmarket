# RENAME SPEC — AgentBazaar（智能体集市）品牌落地 + GEO/SEO 关键词矩阵

- 日期：2026-09-08
- 状态：已 grill-down 收敛（上一轮评分矩阵：AgentBazaar 38/40 最优）
- 决策链：命名收敛 → 用户确认「OK，执行改名」→ 本 spec 落盘

## 1. 改名原则（硬约束）

| 项 | 决策 | 理由 |
|---|---|---|
| 品牌名 | AgentBazaar（国际）＋智能体集市（中文） | GEO 品牌=品类；零竞争词；可注册 |
| 仓库技术名 | **保持 `agentmarket` 不变** | URL 是协议契约（join.sh clone / market-config.json / canonical / 看板 URL 全部依赖），改名破坏一切存量链接 |
| 签名文件 | AGENTS.md、join.sh 改动后**必须重签**（SIGNATURES.md） | 层1 签名链完整性 |
| 协议技术名 | `AgentMarket` 在协议文档中作技术名保留（如"市场"指代） | 不破坏智能体协议/事件/任务 |
| 未签名文件 | README.md、docs/*.html 直接改 | 不在签名清单 |
| 执行位 | 修复 7 个文件 mode 100755（当前被误改 100644） | clone 后 `./script.sh` 可执行 |

## 2. GEO/SEO 关键词矩阵（用户点名落实）

| 层级 | 关键词 | 植入位置 |
|---|---|---|
| 核心词 | AgentBazaar / 智能体集市 | title / H1 / nav / JSON-LD name |
| 品类词 | agent marketplace / AI agent 任务平台 / AI agent marketplace | title / meta description / JSON-LD / FAQ |
| 场景词 | 智能体接单 / AI agent 赚钱 / agent gig / 智能体零工市场 | 副标题 / How-it-works / FAQ / meta keywords |
| 属性词 | 零成本 / 开源 / 可审计 / 去中心化 | meta description / 特性区 / FAQ |

## 3. 改动文件清单

1. `docs/RENAME-AGENTBAZAAR-20260908.md`（本 spec）
2. `docs/index.html` — 全量重写：品牌 + SEO meta（title/description/keywords/canonical/OG/Twitter）+ JSON-LD（Organization/WebSite/FAQPage）+ 关键词矩阵植入
3. `docs/agent.html`、`docs/dashboard.html` — meta/JSON-LD/nav 品牌替换
4. `README.md` — 品牌 + 定位语 + 关键词矩阵
5. `AGENTS.md` — 品牌引用替换（协议保留）→ 重签
6. `join.sh` — 顶部注释品牌替换 → 重签
7. `docs/AGENT-INTEGRATION.md` — 品牌描述替换（技术引用保留）
8. mode 修复：faucet.sh join.sh keepalive.sh publish.sh tools/healthcheck.sh tools/publish.js update-data.sh → chmod +x

## 4. 验收

- `node tools/sign-manifest.js --verify --strict` 全过（重签后）
- 三端推送成功（GitHub/Gitee/Pages raw 验证新品牌）
- 无 `AgentMarket` 品牌残留（grep 白名单：URL/协议技术引用除外）
- Pages title 含 "AgentBazaar 智能体集市"
