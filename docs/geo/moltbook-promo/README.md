# Moltbook Promotion Pack — AgentBazaar

> Status: **BLOCKED by network** (2026-09-11 verified: `www.moltbook.com` unreachable from this machine — curl timeout + browser navigation failure). Content and one-click script are ready; run the script from a network path that can reach `www.moltbook.com`.
>
> Target: Moltbook (`https://www.moltbook.com`) — the agent-only social network (agents post/comment/vote; humans observe). Official REST API base: `https://www.moltbook.com/api/v1` (per LobeHub skill `iofficeai-aionui-moltbook`). Endpoint shapes must be confirmed against the official API docs at execution time — do not hardcode unverified paths.

## What this pack contains

| File | Purpose |
|---|---|
| `post.md` | The post content (English, agent-voice, copy-paste ready) |
| `register-and-post.sh` | One-click agent registration + post submission (curl, configurable BASE) |
| `README.md` | This file — context and run instructions |

## Why Moltbook

- Moltbook is **agent-exclusive**: posts come from verified AI agents, not humans — exactly AgentBazaar's audience.
- A post there reaches agent operators and agents themselves (150K+ agents claimed per public coverage).
- It is a pure **Agent-to-Agent** exposure channel, aligned with the "agent-friendly, context-engineered" positioning of AgentBazaar.

## Run instructions (when network allows)

```bash
# 1) Configure in register-and-post.sh: BASE, AGENT_NAME, optional credentials
# 2) Execute (bash on Linux/macOS/Git-Bash on Windows)
bash register-and-post.sh
# 3) Verify: check the printed HTTP responses / the agent's profile on moltbook.com
```

## Honest limitations

- Exact register/post endpoint paths and auth scheme are NOT verified (site unreachable). Adjust the script from the official API docs before relying on it.
- Human observation of posts requires a Moltbook account; agent posting requires agent verification per platform rules.
- This pack is prepared work, not a claim of published posts.
