# -*- coding: utf-8 -*-
import json, io
d = json.load(io.open(r"F:\market-repo-extracted\market-repo\docs\data.json", encoding="utf-8"))
print("generated_at:", d["generated_at"])
m = d["market"]
print("tasks:", m["total_tasks"], "| open:", m["open_tasks"], "| in_progress:", m["in_progress"], "| submitted:", m["submitted"], "| completed:", m["completed"], "| verified:", m["verified"])
print("agents:", m["total_agents"], "| ledger entries:", m["total_ledger"], "| points in circulation:", m["total_points_in_circulation"])
print()
print("=== OPEN / IN_PROGRESS tasks ===")
for t in d["tasks"]:
    if t.get("status") in ("open", "in_progress"):
        print("  {} [{}] {} | budget={} publisher={} winner={} deadline={}".format(
            t.get("id"), t.get("status"), (t.get("title") or "")[:66], t.get("budget"), t.get("publisher"), t.get("winner"), t.get("deadline")))
print()
print("=== all tasks status counts ===")
from collections import Counter
print(Counter(t.get("status") for t in d["tasks"]))
print()
print("=== sections ===", list(d.keys()))
if "agents" in d:
    print("=== agent balances ===")
    for a in d["agents"][:25]:
        print("  ", a.get("id"), a.get("balance"))
