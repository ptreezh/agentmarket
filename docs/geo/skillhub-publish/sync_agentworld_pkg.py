# -*- coding: utf-8 -*-
"""Sync skills/agent-world into SkillHub + WorkBuddy publish packages (v1.0.2).
Adds AgentBazaar as a route entry (SKILL.md description + decision table +
skill-routes table). Reuses the dual-lang workbuddy frontmatter pattern.
Outputs:
  docs/geo/skillhub-publish/agent-world/           (SkillHub package)
  docs/geo/skillhub-publish/workbuddy-agent-world/ (WorkBuddy package)
  docs/geo/skillhub-publish/agent-world-workbuddy.zip
"""
import io, re, os, shutil

base = r"F:\market-repo-extracted\market-repo"
pkg_base = os.path.join(base, "docs", "geo", "skillhub-publish")
src = os.path.join(base, "skills", "agent-world")

# ---------- SkillHub package ----------
dst = os.path.join(pkg_base, "agent-world")
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("MANIFEST.json"))

p = os.path.join(dst, "SKILL.md")
s = io.open(p, encoding="utf-8").read()
new_fm = (
    "---\n"
    "name: agent-world\n"
    "slug: agent-world-by-agentbazaar\n"
    "displayName: Agent World\n"
    "version: 1.0.2\n"
    "summary: Installable skill + route hub that lets any agent participate in the agent ecosystem - per-platform action cards, official platform skill routes (incl. AgentBazaar gig market), interaction playbook, credential discipline.\n"
    "license: MIT\n"
    'description: "Participate in the agent ecosystem: pick a platform, load its official skill, register, act, engage, maintain. Use when you need to join an agent community (XiaLiao/ClawdChat, InStreet, Agent Town, SkillsMD, theskills, KodaClaw, Coze Agent World) or publish/claim agent gigs on AgentBazaar."\n'
    "---\n"
)
s2 = re.sub(r"(?s)^---.*?---", new_fm, s, count=1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
print("SkillHub agent-world package ready:", dst)

# ---------- WorkBuddy package (dual-lang) ----------
dst2 = os.path.join(pkg_base, "workbuddy-agent-world")
if os.path.exists(dst2):
    shutil.rmtree(dst2)
shutil.copytree(src, dst2, ignore=shutil.ignore_patterns("MANIFEST.json"))

p2 = os.path.join(dst2, "SKILL.md")
s2b = io.open(p2, encoding="utf-8").read()
new_fm2 = (
    "---\n"
    "name: agent-world\n"
    "display_name: 智能体世界导航\n"
    "display_name_en: Agent World\n"
    'description_zh: "智能体生态参与向导：一份可安装的技能 + 路由中枢。选择平台（虾聊/InStreet/Agent Town/SkillsMD/theskills/KodaClaw/Coze Agent World 等 18+），加载该平台官方技能，完成注册、行动、互动与维护；同时路由到 AgentBazaar 智能体集市发布与认领任务。每个条目均为 2026-09 实测状态。"\n'
    'description_en: "Agent ecosystem participation guide: installable skill + route hub. Pick a platform (XiaLiao/ClawdChat, InStreet, Agent Town, SkillsMD, theskills, KodaClaw, Coze Agent World and 18+ more), load that platform\'s official skill, then register, act, engage and maintain. Also routes to the AgentBazaar agent gig market for publishing/claiming tasks. Every entry is field-tested (2026-09)."\n'
    "slug: agent-world-by-agentbazaar\n"
    "displayName: Agent World\n"
    "version: 1.0.2\n"
    "summary: Installable skill + route hub that lets any agent participate in the agent ecosystem - per-platform action cards, official platform skill routes (incl. AgentBazaar gig market), interaction playbook, credential discipline.\n"
    "license: MIT\n"
    'description: "Participate in the agent ecosystem: pick a platform, load its official skill, register, act, engage, maintain. Use when you need to join an agent community or publish/claim agent gigs on AgentBazaar."\n'
    "---\n"
)
s3 = re.sub(r"(?s)^---.*?---", new_fm2, s2b, count=1)
io.open(p2, "w", encoding="utf-8", newline="\n").write(s3)
print("WorkBuddy agent-world package ready:", dst2)

# ---------- zip ----------
zip_path = os.path.join(pkg_base, "agent-world-workbuddy.zip")
if os.path.exists(zip_path):
    os.remove(zip_path)
zf = shutil.make_archive(zip_path[:-4], "zip", dst2)
print("zip:", zip_path, os.path.getsize(zip_path), "bytes")

# sanity: no BOM, LF endings
for f in (p, p2):
    data = io.open(f, "rb").read()
    assert not data.startswith(b"\xef\xbb\xbf"), "BOM detected: " + f
print("sanity OK (no BOM)")
