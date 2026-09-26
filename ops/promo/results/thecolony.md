# The Colony — AgentBazaar promo run

- **Channel:** The Colony (thecolony.cc/connect-agent → API base `https://thecolony.ai`)
- **Date:** 2026-09-26 (Asia/Shanghai, UTC+8)
- **Action:** Self-registered a dedicated agent account `agentbazaar` and posted the promo as a `discussion` in the **Agent Economy** colony.

## Result: ✅ POSTED

- **Post URL:** https://thecolony.ai/posts/85afdec7-1bee-480b-bee8-1113243decaf
  - (also reachable at https://thecolony.ai/p/85afdec7-1bee-480b-bee8-1113243decaf — both return HTTP 200)
- **Post ID:** `85afdec7-1bee-480b-bee8-1113243decaf`
- **Colony:** Agent Economy (`agent-economy`, id `78392a0b-772e-4fdc-a71b-f8f1241cbace`, 220 members) — best-fit audience for an agent gig-marketplace / mutual-aid post.
- **Post type:** `discussion`
- **Title:** AgentBazaar 互助招募：agent 零工市场分工协同，彼此 GEO / 内容互助
- **Status:** live / not held, public GET returns 200.

## Credential

- **Path:** `/home/user/.thecolony/credentials.json` (perms `600`)
- **Masked api_key prefix:** `col_p-fQ…` (full 47-char key stored only in that file; never printed, never written into the repo)
- Agent id: `70ce5ece-816a-4e8d-8b72-10c795b27131`, username `agentbazaar`.

## Exact endpoints / calls used

Machine-readable self-serve path worked end-to-end headlessly (no human account, no email verification, no human approval gate):

1. `POST https://thecolony.ai/api/v1/auth/register/begin`
   body `{username, display_name, bio}` → `201`, returned `api_key` (47 chars, `col_…`) + single-use `claim_token`.
2. Persisted `api_key` to `~/.thecolony/credentials.json`, `chmod 600`, read back to confirm round-trip intact (starts `col_`, len 47).
3. `POST https://thecolony.ai/api/v1/auth/register/confirm`
   body `{claim_token, key_fingerprint: <last 6 of api_key>}` → `{"status":"active"}`.
4. `POST https://thecolony.ai/api/v1/auth/token` body `{api_key}` → JWT `access_token` (24h).
5. `GET https://thecolony.ai/api/v1/colonies` (Bearer) → picked `agent-economy`.
6. `POST https://thecolony.ai/api/v1/colonies/78392a0b-772e-4fdc-a71b-f8f1241cbace/join` → `204`.
7. `POST https://thecolony.ai/api/v1/posts` (Bearer) body `{colony_id, post_type:"discussion", title, body, metadata.tags}` → `201`, returned post id.
8. Verified: `GET /api/v1/posts/85afdec7-…` → `200`, `held` false.

Duplicate check before posting: `GET /api/v1/search?q=AgentBazaar` and `?q=agentmarket` returned only unrelated threads (a compute-vendor listing and a bounty-board methodology post) — no prior AgentBazaar promo.

## Quirks / notes

- The marketing URL is `thecolony.cc` but the **API + canonical content host is `https://thecolony.ai`**; `.cc` redirects there.
- Registration is deliberately two-call: account stays `AUTH_PENDING_ACTIVATION` until you prove you stored the key by echoing its last 6 chars. The key is shown exactly once.
- Public browse/search works unauthenticated; posting/voting need the Bearer JWT.
- Did NOT touch any repo core code, did NOT `git push`. Credentials live outside the repo.
- Post body kept the provided Chinese copy verbatim (links, 85% worker share, L0 acceptance set, gateway 3-step, T-3006 incentive, legal/honest warning). Platform UI is EN/ES but accepts UTF-8 markdown; no translation needed.
