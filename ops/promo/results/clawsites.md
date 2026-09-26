# ClawSites Promo Result — AgentBazaar

- **Channel:** ClawSites (www.clawsites.com) — community directory, category `/category/community` ("AI Agent Communities & Directories", 23 listings at time of submission)
- **Date:** 2026-09-26 (Asia/Shanghai, UTC+8)
- **Action:** Self-serve directory submission via the site's documented bot API.

## Result
- **Status:** ⚠️ submitted, pending review (human-reviewed before publish; not yet live)
- **Submission ref (server ID):** `cmuhr6m8m00002yrv5d1qdt9l`
- **Server response:** `HTTP 201 Created` → `{"id":"cmuhr6m8m00002yrv5d1qdt9l","status":"pending"}`
- **What happens next (per skill.md):** enters the review queue → auto screenshot taken → if approved it appears in the directory under Community → submitter would be notified via X only if a handle was provided (none given).
- **Do NOT treat as live:** no listing URL exists yet; the directory is human-reviewed. Re-check later at https://www.clawsites.com/category/community for an "AgentBazaar" card.

## Dedupe check
Enumerated all 23 community listings on the category page (MoltX, Moltlaunch, MoltOverflow, Claw Hunt, Molt Church, HOL Plugins, AgentLux, AgentRolodex, A2A Directory, AgentNDX, OpenAgent.bot, LLM Explorer, AgentList, AgentList.io, AgDex, AgentFirst Directory, Agent Hub, AgentSystems, Hermes Atlas, skills.sh, Openwork, Clawdslist, Agentsy). No "AgentBazaar" / "agentmarket" / ptreezh.github.io entry → safe to submit. The API also rejects duplicate URLs server-side.

## Exact route + fields used
- **Route discovered:** The "Submit a site" button in the header opens a modal ("Hey bot! — Submit your site via API") that points agents to **https://www.clawsites.com/skill.md**. That file documents the machine-readable endpoint. No web form / no login required.
- **Endpoint:** `POST https://www.clawsites.com/api/submissions`
- **Headers:** `Content-Type: application/json`
- **Body sent:**
  ```json
  {
    "name": "AgentBazaar",
    "url": "https://ptreezh.github.io/agentmarket/",
    "category": "COMMUNITY",
    "description": "Open-source, git-native, zero-cost AI-agent gig marketplace: agents publish/claim tasks for credits with L0 machine-checkable acceptance.",
    "honeypot": ""
  }
  ```
- **Field constraints honored (from skill.md + modal JS):**
  - `name`: 2–100 chars → "AgentBazaar" (11).
  - `url`: full https:// working public URL → `https://ptreezh.github.io/agentmarket/`.
  - `category`: exact enum → `COMMUNITY` (one of PRODUCTIVITY/AUTOMATION/ANALYTICS/MANAGEMENT/SOCIAL/CONTENT/MARKETING/DASHBOARD/SCHEDULING/INTEGRATION/MONITORING/UTILITIES/DOCS/COMMUNITY/OTHER).
  - `description`: 10–140 chars → used a 137-char tight version (the brief's full multi-sentence description was ~480 chars and would have been rejected by the 140-char cap).
  - `twitterHandle` / `contactEmail`: omitted (optional; none provided).
  - `honeypot`: sent empty string (the "Leave empty" trap field; real users/bots leave it blank).

## Credential discipline
- No key/token/login issued — the submissions API is open (no auth). Nothing saved to `~/.clawsites/credentials.json` (not applicable).
- Rate limit: 10 submissions/hour/IP; well under.

## Quirks / notes
- The directory has **no named HTML submit page** (`/submit`, `/add`, `/suggest`, `/new`, `/listing` all 404). The real intake is the JSON API surfaced via the on-site "Submit a site" modal → `skill.md`.
- The site is explicitly bot-friendly: the modal literally says "Send this to your agent: Read https://www.clawsites.com/skill.md…" — headless JSON POST is the intended path, no browser/captcha.
- Description cap is tight (140 chars); had to compress the supplied blurb, dropping the 85% worker-share, ED25519 event chain, atomic git-ref claim lock, and gateway 3-step entry details. Those are on the target landing page itself for reviewers to see.
- Editorial policy confirms intake checks: URL must load, relevance to agent workflows, understandable description; reviewer assigns category; listings are human-reviewed (AI drafts are treated as private proposals).
- Did NOT modify repo core code; did NOT `git push`. Temp scratch files kept under `.scratch/` in the repo workspace and contained no secrets.
