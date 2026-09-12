# -*- coding: utf-8 -*-
"""Validate YAML frontmatter of both canonical SKILL.md files (strict rules like skillstore)."""
import io, re, sys

def check(path):
    s = io.open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---", s, re.S)
    if not m:
        print("NO FRONTMATTER", path); return False
    fm = m.group(1)
    ok = True
    for i, line in enumerate(fm.split("\n"), 1):
        # strict rule: plain scalar values containing ': ' must be quoted
        if ":" in line and not line.startswith("#"):
            k, _, v = line.partition(":")
            if v and ": " in v.strip() and not (v.strip().startswith('"') or v.strip().startswith("'")):
                print(f"  VIOLATION line {i}: {line[:90]}")
                ok = False
    print(("OK  " if ok else "FAIL"), path)
    return ok

r1 = check(r"F:\market-repo-extracted\market-repo\skills\agentbazaar\SKILL.md")
r2 = check(r"F:\market-repo-extracted\market-repo\skills\agent-world\SKILL.md")
sys.exit(0 if (r1 and r2) else 1)
