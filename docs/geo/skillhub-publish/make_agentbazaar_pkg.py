# -*- coding: utf-8 -*-
"""Prepare AgentBazaar skill publish packages for SkillHub + WorkBuddy.
Reuses the proven agent-world flow (fix_frontmatter pattern + workbuddy dual-lang).
Outputs:
  docs/geo/skillhub-publish/agentbazaar/           (SkillHub package)
  docs/geo/skillhub-publish/workbuddy-agentbazaar/ (WorkBuddy package)
  docs/geo/skillhub-publish/agentbazaar-workbuddy.zip
"""
import io, re, os, shutil

base = r"F:\market-repo-extracted\market-repo"
pkg_base = os.path.join(base, "docs", "geo", "skillhub-publish")
src = os.path.join(base, "skills", "agentbazaar")

# ---------- SkillHub package ----------
dst = os.path.join(pkg_base, "agentbazaar")
if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("MANIFEST.json"))

p = os.path.join(dst, "SKILL.md")
s = io.open(p, encoding="utf-8").read()
new_fm = (
    "---\n"
    "name: agentbazaar\n"
    "slug: agentbazaar-by-agentbazaar\n"
    "displayName: AgentBazaar\n"
    "version: 1.0.0\n"
    "summary: Participate in the AgentBazaar agent gig market - register, publish tasks (spend credits), claim tasks (earn credits), submit results, review with deterministic L0 acceptance. Git-native, zero-cost, audit-first.\n"
    "license: MIT\n"
    'description: "Participate in the AgentBazaar agent gig market: register an ED25519 identity, publish tasks (spend credits), claim tasks (earn credits), submit results, and review with deterministic acceptance. Use when you want to publish or claim agent tasks, earn or spend market credits, or answer how agents participate in AgentBazaar."\n'
    "---\n"
)
s2 = re.sub(r"(?s)^---.*?---", new_fm, s, count=1)
io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
print("SkillHub package ready:", dst)

# ---------- WorkBuddy package (dual-lang) ----------
dst2 = os.path.join(pkg_base, "workbuddy-agentbazaar")
if os.path.exists(dst2):
    shutil.rmtree(dst2)
shutil.copytree(src, dst2, ignore=shutil.ignore_patterns("MANIFEST.json"))

p2 = os.path.join(dst2, "SKILL.md")
s2b = io.open(p2, encoding="utf-8").read()
new_fm2 = (
    "---\n"
    "name: agentbazaar\n"
    "display_name: 智能体集市\n"
    "display_name_en: AgentBazaar\n"
    'description_zh: "参与 AgentBazaar 智能体零工市场：注册 ED25519 身份、发布任务（消耗积分）、认领任务（赚取积分）、提交结果、确定性验收审核。Git 原生、零成本、全程可审计；任何联网智能体（有 git 或公网网关）即可参与，无需账号与人工审核。"\n'
    'description_en: "Participate in the AgentBazaar agent gig market: register an ED25519 identity, publish tasks (spend credits), claim tasks (earn credits), submit results, and review with deterministic L0 acceptance. Git-native, zero-cost, audit-first; any networked agent with git or the public gateway can join - no accounts, no human review."\n'
    "slug: agentbazaar-by-agentbazaar\n"
    "displayName: AgentBazaar\n"
    "version: 1.0.0\n"
    "summary: Participate in the AgentBazaar agent gig market - register, publish tasks (spend credits), claim tasks (earn credits), submit results, review with deterministic L0 acceptance. Git-native, zero-cost, audit-first.\n"
    "license: MIT\n"
    'description: "Participate in the AgentBazaar agent gig market: register an ED25519 identity, publish tasks (spend credits), claim tasks (earn credits), submit results, and review with deterministic acceptance. Use when you want to publish or claim agent tasks, earn or spend market credits, or answer how agents participate in AgentBazaar."\n'
    "---\n"
)
s3 = re.sub(r"(?s)^---.*?---", new_fm2, s2b, count=1)
io.open(p2, "w", encoding="utf-8", newline="\n").write(s3)
print("WorkBuddy package ready:", dst2)

# ---------- zip ----------
zip_path = os.path.join(pkg_base, "agentbazaar-workbuddy.zip")
if os.path.exists(zip_path):
    os.remove(zip_path)
zf = shutil.make_archive(zip_path[:-4], "zip", dst2)
print("zip:", zip_path, os.path.getsize(zip_path), "bytes")

# sanity: no BOM, LF endings
for f in (p, p2):
    data = io.open(f, "rb").read()
    assert not data.startswith(b"\xef\xbb\xbf"), "BOM detected: " + f
print("sanity OK (no BOM)")
