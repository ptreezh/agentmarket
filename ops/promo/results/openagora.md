# OpenAgora Promo Result — AgentBazaar

- **Channel:** OpenAgora (https://openagora.cc; canonical https://agora.naxlab.xyz) — open A2A agent registry / directory. Source repo: github.com/Noxr3/openagora.
- **Date:** 2026-09-26 (Asia/Shanghai, UTC+8)
- **Action:** Located the register route, reverse-engineered the exact submit endpoint + payload from the client bundle, ran a dedupe check (partial), and attempted two `POST /api/agents` submissions.

## Route + fields used (confirmed, not guessed)
- Web form page: `GET https://openagora.cc/register` ("Register Your Agent" — Server-Rendered Next.js App Router page).
- Actual submit call (deobfuscated from chunk `/_next/static/chunks/07lhnki_k3z8v.js`, component `RegisterAgentForm`):
  - **`POST https://openagora.cc/api/agents`**
  - Header: `Content-Type: application/json` (no auth cookie / bearer / captcha / login / email-verification challenge observed — endpoint is anonymous).
  - On success the client redirects to `/agents/<id>`.
- JSON body shape (client form field → API key):
  - `name` (form "Agent Name *") → **required**
  - `url` (form "Service Endpoint URL *") → **required**
  - `description` (form "Description")
  - `provider` (form "Provider / Organization")
  - `avatar_url` (form "Avatar URL", nullable)
  - `capabilities` — string[] (form "Capabilities (comma-separated)")
  - `skills` — array of `{name, description, tags:string[]}` (form "Skills + Add Skill")
  - `payment_schemes` — array (optional x402 / MPP toggles; omitted → `[]`)
  - **`slug`** — required by the server but NOT sent by the browser form (see Quirks).

## Dedupe check
- Homepage prerender reports **"0 Registered agents"** and `/agents` shows **"No agents found"** → registry appears empty.
- Live dedupe via `GET /api/agents` could NOT be completed: every DB-backed request returned upstream **522 / HTTP 500 "Gateway Timeout"**. No existing "AgentBazaar"/"agentmarket"/"ptreezh" entry could be enumerated live.

## Result
- **Status:** ⛔ **blocked (upstream outage — no live entry confirmed, nothing faked)**
- **Registry entry URL/id:** none returned.
- What happened, in order:
  1. `POST /api/agents` without `slug` → fast **HTTP 400** `{"error":"name, url, and slug are required"}`. (Pre-DB validation; no write.)
  2. Corrected body to include `slug:"agentbazaar"` and re-POST → request passes validation but **read times out (~25–35s)** waiting on the DB; no response body / no `id`.
  3. All follow-up reads (`GET /api/agents`, `GET /api/agents/agentbazaar`) → **HTTP 500 {"error":"Gateway Timeout"}** or raw Cloudflare **522** from `hxbmsgqwtoqxppkosjbg.supabase.co`.
- Root cause: OpenAgora's backing Supabase Postgres origin is down (Cloudflare 522 Connection timed out). Read/write to the DB hangs; only pre-DB validation responds.
- **Ambiguity (be aware):** the second POST may have inserted a row server-side before the response timed out. It cannot be confirmed or rejected while the DB is down. The `slug` value (`agentbazaar`) is expected to be unique-constrained, so re-submitting the same slug on recovery should either succeed cleanly or return a duplicate-conflict (which itself proves the earlier write landed) — it should not create two rows.

## Credential
- None issued. The register endpoint is anonymous (no token / API key / session). Nothing saved under `~/.openagora/`.

## Quirks / notes
- The browser form never sends `slug`, but the server requires it ("name, url, and slug are required"). For a headless POST you must add `slug` yourself (used `agentbazaar`).
- Docs page referenced on the homepage (`/docs/how-agents-use-openagora`) does not resolve (fetch error); nav "Docs" actually points to https://dokki.one/pub/openagora. The machine-readable flow is just the JSON POST above.
- No human-review gate, no login, no captcha, no email verification — once the DB is back this is a single headless POST away from a live listing. Not a moderation-pending situation; it's a pure infra outage.
- Did not modify repo core code; did not `git push`; temp payload scripts lived in /tmp.
- Submission content prepared: name `AgentBazaar`; url `https://github.com/ptreezh/agentmarket`; provider `open-source community (ptreezh)`; capabilities `[task marketplace, gig-work, agent registry, A2A, git-native]`; the full long description (85% worker cut, L0 acceptance checks, ED25519 event chain, git-ref claim lock, gateway URL, T-3006 incentive) was included verbatim.

## Next step (when Supabase recovers — likely minutes to hours)
1. `GET https://openagora.cc/api/agents` until it returns a real JSON array.
2. Check for slug/name `agentbazaar`:
   - If present → record ✅ with its `/agents/<id>` URL (the earlier timed-out POST landed).
   - If absent → re-run `POST /api/agents` with the exact body above (slug `agentbazaar`); expect `2xx` + `{id}`, then confirm at `GET /api/agents/agentbazaar` and the public page `/agents/<id>`.
