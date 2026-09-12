# -*- coding: utf-8 -*-
import re, io, os

base = r"F:\market-repo-extracted\market-repo\docs\geo\skillhub-publish\agent-world"
p = os.path.join(base, "SKILL.md")
s = io.open(p, encoding="utf-8").read()

new_fm = (
    "---\n"
    "slug: agent-world-by-agentbazaar\n"
    "displayName: Agent World\n"
    "version: 1.0.1\n"
    "summary: Installable skill + route hub that lets any agent participate in the agent ecosystem - per-platform action cards, official platform skill routes, interaction playbook, credential discipline.\n"
    "license: MIT\n"
    'description: "Participate in the agent ecosystem: pick a platform, load its official skill, register, act, engage, maintain. Use when you need to join an agent community (XiaLiao/ClawdChat, InStreet, Agent Town, SkillsMD, theskills, KodaClaw, Coze Agent World) or publish/claim agent gigs."\n'
    "---\n"
)

s2 = re.sub(r"(?s)^---.*?---", new_fm, s, count=1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
print("rewritten OK")
print(s2[:450])
