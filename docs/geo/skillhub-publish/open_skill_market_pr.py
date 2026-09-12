# -*- coding: utf-8 -*-
"""Open Skill Market: add ptreezh/agentmarket to priority list via gh API + PR."""
import base64, json, subprocess, sys

def gh(args, inp=None):
    cmd = ["gh", "api"] + args
    r = subprocess.run(cmd, capture_output=True, text=True, input=inp)
    if r.returncode != 0:
        print("GH ERR:", r.stderr[:500]); sys.exit(1)
    return r.stdout

# 1) read upstream repositories.yml (base64 via contents API)
up = gh(["repos/coolzwc/open-skill-market/contents/crawler/repositories.yml", "-H", "Accept: application/vnd.github+json"])
upj = json.loads(up)
yml = base64.b64decode(upj["content"]).decode("utf-8")
print("=== upstream repositories.yml ===")
print(yml)

# 2) append our repo to priority list
if "ptreezh/agentmarket" not in yml:
    yml = yml.rstrip() + "\n  - ptreezh/agentmarket\n"
    print("=== modified (appended) ===")
    print(yml)
else:
    print("already present")

# 3) fork default branch sha
fork = gh(["repos/ptreezh/open-skill-market"])
forkj = json.loads(fork)
default_branch = forkj["default_branch"]
head_sha = forkj["pushed_at"] and None
ref = gh(["repos/ptreezh/open-skill-market/git/ref/heads/" + default_branch])
sha = json.loads(ref)["object"]["sha"]
print("fork default branch:", default_branch, "sha:", sha[:10])

# 4) create branch add-agentbazaar from default
branch = "add-agentbazaar"
try:
    gh(["repos/ptreezh/open-skill-market/git/refs", "--input", "-"],
       json.dumps({"ref": "refs/heads/" + branch, "sha": sha}))
    print("branch created:", branch)
except SystemExit:
    print("branch exists, continue")

# 5) PUT repositories.yml to branch (sha required for existing file)
content_b64 = base64.b64encode(yml.encode("utf-8")).decode("utf-8")
body = json.dumps({
    "message": "crawler: add ptreezh/agentmarket to priority repositories",
    "content": content_b64,
    "branch": branch,
    "sha": upj["sha"],
})
gh(["repos/ptreezh/open-skill-market/contents/crawler/repositories.yml", "-X", "PUT", "--input", "-"], body)
print("repositories.yml pushed to branch", branch)

# 6) create PR
pr = gh(["repos/coolzwc/open-skill-market/pulls", "--input", "-"], json.dumps({
    "title": "crawler: add ptreezh/agentmarket (AgentBazaar - git-native agent gig market) to priority list",
    "head": "ptreezh:" + branch,
    "base": "main",
    "body": "## Why\nAgentBazaar (ptreezh/agentmarket) is a zero-cost, git-native agent gig marketplace. It ships two SKILL.md skills under `skills/`: `agentbazaar` (register/publish/claim/submit/review agent tasks; ED25519 identity; `--mode gateway` for no-GitHub-write agents) and `agent-world` (field-tested route hub for 18+ agent platforms).\n\nAdding it to the priority list lets the crawler index both skills automatically.\n\nRepo: https://github.com/ptreezh/agentmarket (MIT, open source, self-hosted)",
}))
prj = json.loads(pr)
print("PR created:", prj.get("html_url"))
