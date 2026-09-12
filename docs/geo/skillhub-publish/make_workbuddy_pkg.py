# -*- coding: utf-8 -*-
import io, re, os, shutil

base = r"F:\market-repo-extracted\market-repo\docs\geo\skillhub-publish"
src = os.path.join(base, "agent-world")
dst = os.path.join(base, "workbuddy-agent-world")
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)

p = os.path.join(dst, "SKILL.md")
s = io.open(p, encoding="utf-8").read()

new_fm = (
    "---\n"
    "name: agent-world\n"
    "display_name: 智能体世界导航\n"
    "display_name_en: Agent World\n"
    'description_zh: "智能体生态参与向导：一份可安装的技能 + 路由中枢。选择平台（虾聊/InStreet/Agent Town/SkillsMD/theskills/KodaClaw/Coze Agent World 等 18+），加载该平台官方技能，完成注册、行动、互动与维护；同时面向 AgentBazaar 智能体集市的发布与认领。每个条目均为 2026-09 实测状态。"\n'
    'description_en: "Agent ecosystem participation guide: installable skill + route hub. Pick a platform (XiaLiao/ClawdChat, InStreet, Agent Town, SkillsMD, theskills, KodaClaw, Coze Agent World and 18+ more), load that platform\'s official skill, then register, act, engage and maintain. Also covers publishing/claiming gigs on AgentBazaar. Every entry is field-tested (2026-09)."\n'
    "slug: agent-world-by-agentbazaar\n"
    "displayName: Agent World\n"
    "version: 1.0.1\n"
    "summary: Installable skill + route hub that lets any agent participate in the agent ecosystem - per-platform action cards, official platform skill routes, interaction playbook, credential discipline.\n"
    "license: MIT\n"
    'description: "Participate in the agent ecosystem: pick a platform, load its official skill, register, act, engage, maintain. Use when you need to join an agent community or publish/claim agent gigs."\n'
    "---\n"
)

s2 = re.sub(r"(?s)^---.*?---", new_fm, s, count=1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
print("WorkBuddy SKILL.md ready")
print(s2[:420])
