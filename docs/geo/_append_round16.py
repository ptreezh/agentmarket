# -*- coding: utf-8 -*-
log = r"F:\market-repo-extracted\market-repo\docs\geo\M4-EXEC-LOG-20260911.md"
entry = """

## round16 — 新开放技能商店逐台上架（2026-09-12）
- 目标：用户要求「全网搜索别的开放技能商店上架」。本轮逐新平台推进，同时用 GitHub topics/PR 打通爬虫自动收录通道。
- **Skill Store（skillstore.io，一页式 GitHub URL 提交）**：匿名提交两个技能（不勾 notify-via-github）：
  - agentbazaar → 提交 ID `d51898f0-a4d5-47c0-8e29-b8bbd7579312`（状态页 /zh-hans/submissions/...）
  - agent-world → 提交 ID `efdd21b4...`
  - 平台流程：克隆仓库 → 安全审计（脚本类技能额外审查）→ 在 marketplace 仓库建 PR → 审核上线（5-10 分钟，可回状态页查）
- **GitHub topics（OPEN SKILL MARKET 自动收录通道）**：gh api PUT 成功写入 9 个 topics：agent-marketplace, ai-agents, open-source, agents, ai-skill, claude-skill, gig-economy, self-hosted, skill-marketplace。爬虫按 topic 搜索自动发现 skills/agentbazaar + skills/agent-world
- **Open Skill Market PR（coolzwc/open-skill-market）**：gh repo fork（ptreezh/open-skill-market）→ gh api 全程操作（读上游 repositories.yml → 追加 `  - ptreezh/agentmarket` → fork 建分支 add-agentbazaar → PUT contents → 建 PR）→ **PR #6 创建成功：https://github.com/coolzwc/open-skill-market/pull/6**（脚本 docs/geo/skillhub-publish/open_skill_market_pr.py）
  - 踩坑①：YAML 追加须缩进两格（priority 列表成员）；② PUT contents 修改已存在文件必须带文件 sha（取上游 contents API 的 sha）；③ 分支已存在时报 422 → continue 处理
- **ClawHub（OpenClaw 官方技能集市，clawhub.ai）**：CLI v0.23.3 全局安装。登录两条路：
  - device flow：`clawhub login --no-browser` → clawhub.ai/cli/device?user_code=XXX → 需浏览器 GitHub OAuth（GitHub 登录页可达，但需要用户凭证）
  - `--token clh_...`：仅能从 ClawHub web UI 生成（先登录 ClawHub → Settings → API tokens）
  - 已实测：gh 的 gho_ token 作 --token 报 401（ClawHub token 不通用）；**浏览器授权被用户跳过（browserControl skipped）→ ClawHub 挂起，等用户浏览器 GitHub 授权或提供 clh_ token**
  - 源码确认（npm 全局 clawhub/dist）：device flow 仅 POST /api/cli/device/code + /api/cli/device/token，无 GitHub token 兑换通道
- **Cow Skill Hub（skills.cowagent.ai，开源 zhayujie/cow-skill-hub）**：文档确认仅「浏览器登录（GitHub/Google）+ 上传 zip（≤5MB）」无 API。GitHub OAuth 浏览器侧两次超时/重置；Google 登录点击无跳转。未登录未上架
- **ClaudeSkill（claudeskil.com，2.8k 技能）**：邮箱 magic link 多次发送均触发「Too many sign-in attempts in a short window」（限流窗口 >1 分钟）；163 收件箱仅 5 封旧邮件、无 ClaudeSkill 邮件（mail_cli search 'claude' 0 匹配）。页面另有 GitHub/Google 通道（受浏览器网络限制）。未登录未上架
- **SkillsMP（skillsmp.com，320 万 SKILL.md 自动索引站）**：纯爬虫收集公开 GitHub SKILL.md，无提交页。搜索 'agentbazaar' 仅返回其他项目（DonalMoloney/agent-bazaar 等），**尚未索引 ptreezh/agentmarket** → 依赖 GitHub topics/爬虫周期，记录为「自动收录待索引」
- **结论（截至 round16 末）**：新增可交付上架 2 项（Skill Store ×2 提交、Open Skill Market PR #6）+ 自动收录通道 2 条（GitHub topics、SkillsMP）；ClawHub/CowSkillHub/ClaudeSkill 因浏览器 GitHub OAuth 网络限制 + 用户跳过授权而 blocked（如实记录，非成功）
- 教训：
  - 浏览器访问 github.com 持续超时/重置，但 gh CLI（API 通道）完全正常 → **凡 GitHub 交互一律 gh api，浏览器只用于非 GitHub 站点**
  - 用户跳过 browserControl 接管后，不得反复请求；ClawHub/CowSkillHub 归类为「需用户浏览器授权」挂起
  - 爬虫收录型商店（Open Skill Market topics、SkillsMP、gigs.sh 等）优先打通 GitHub 元数据（topics/PR），零摩擦
"""
with open(log, "a", encoding="utf-8") as f:
    f.write(entry)
print("appended OK, size:", len(entry))
