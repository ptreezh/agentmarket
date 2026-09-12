# -*- coding: utf-8 -*-
log = r"F:\market-repo-extracted\market-repo\docs\geo\M4-EXEC-LOG-20260911.md"
entry = """

## round16b — SkillStore 422 根因定位与修复（2026-09-12）
- 现象：skillstore.io 前两个提交（tree URL agentbazaar d51898f0 / 根 URL 0b23325a）均 "Processing failed"（GitHub Actions 422）
- 定位：aiskillstore/marketplace Actions run 34673322747 日志 → `##[error]Submission skill discovery failed: skills/agentbazaar/SKILL.md:4: invalid YAML plain scalar; quote values containing ': '`
- 根因：SKILL.md frontmatter description 为 plain scalar 且含 `: `（如 "Full protocol: PROTOCOL.md."），skillstore 严格 YAML 解析拒绝；SkillHub/WorkBuddy 解析宽容所以此前未暴露
- 修复（commit 3f22c2c 双仓已推）：
  - skills/agentbazaar/SKILL.md + skills/agent-world/SKILL.md 的 description 改单引号包裹（引号内 `: ` 安全，值内无单引号）
  - 重跑两个 scripts/gen_manifest.py（agentbazaar integrity 0f31cafd…；agent-world integrity 47e0130f…，files 6/21307B）
  - 新增 docs/geo/_check_yaml.py 严格规则自检（`:` 后值含 `: ` 且未加引号 → VIOLATION）→ 两个规范版 SKILL.md 均 OK
- 重提受阻：skillstore 同一仓库 1 小时重复提交限制（"This repository was already submitted within the last hour."，"重试"按钮不绕过）。**待 1 小时后用目录 URL 重提**：tree/main/skills/agentbazaar + tree/main/skills/agent-world（避免根 URL 扫到 docs/geo/skillhub-publish/ 下 4 个平台衍生 SKILL.md）
- 附加发现：aiskillstore/marketplace 公开仓库（skills/ + pending/ + governance/），无用户 PR 收录通道，仅提交页
- 教训：**skillstore 类严格解析平台要求 frontmatter 值全部引号包裹**；本地校验脚本应纳入 CI 前置；提交前先跑 _check_yaml.py
"""
with open(log, "a", encoding="utf-8") as f:
    f.write(entry)
print("appended round16b, size:", len(entry))
