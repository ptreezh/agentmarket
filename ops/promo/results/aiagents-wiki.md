# aiagents.wiki Directory Submission — AgentBazaar

- **Channel:** aiagents.wiki — independent AI-agent directory / index (~358 profiles; Next.js + Vercel)
- **Date:** 2026-09-26 (Asia/Shanghai, UTC+8)
- **Type:** Directory listing (not a social post). Self-serve contribution route only.

## Result
- **Status:** ⛔ BLOCKED — cannot submit; no live entry route exists yet.
- **Listing URL:** none (no fake / fabricated listing was created).
- **Submission reference / ID:** none — the form transmits nothing server-side.

## Why blocked (verified, not guessed)
The directory's only self-serve route is `https://aiagents.wiki/submit`. It is a **non-functional placeholder**:

1. The submit `<button>` is server-rendered **`disabled`** with literal label **"Coming Soon"** — it cannot be activated from the page.
2. The attached React submit handler (`onSubmit`, chunk `c3b5e98ae50978a3.js`) is a **front-end mock with no network call**:
   ```js
   d = async t => { t.preventDefault(); l(true);
     console.log("Form submitted:", e);
     setTimeout(() => { l(false);
       alert("Thank you for your submission! We'll review it and get back to you soon.");
       s({serverName:"",description:"",link:"",category:"",contactEmail:""});
     }, 1000); }
   ```
   It only `console.log`s the payload, shows an alert, and resets state. There is **no `fetch`, no `POST`, no `/api/*` submit endpoint** anywhere in the page or its JS chunks. (The only `/api/` string in the bundle, `/api/broadcast`, is Next.js HMR websocket plumbing — unrelated.)
3. **No GitHub PR / data-file route.** There is no `github.com` link anywhere on the site (nav, footer, sitemap); `agents.json` is a generated read-only feed, not a fork-edit contribution path.

Per the brief's hard constraints, I did **not** force/click the disabled button or rely on the "Thank you" alert (that would be a fake listing with zero server effect).

## Exact route + required fields identified (ready to fire once live)
Route: `GET https://aiagents.wiki/submit` → form fields (all marked required `*`):

| Field | Value to use |
|---|---|
| Agent name * | `AgentBazaar` |
| Short Description * (**max 200 chars**) | `Open-source, git-native, zero-cost AI-agent gig marketplace. Agents publish/claim tasks; L0 machine-checkable acceptance, ED25519-signed events; workers keep 85%.` (~165 chars) |
| Link (GitHub or docs) * | `https://github.com/ptreezh/agentmarket` (dashboard: `https://ptreezh.github.io/agentmarket/`) |
| Category * (dropdown) | **Other** — options are only: Web Scraping, Communication, Productivity, Development, Database, Cloud Service, File System, Cloud Storage, Version Control, Other. No "marketplace/registry/A2A" category; Other is the only fit. |
| Contact Email * | **needs a real human reply-to address** — none on file in the repo (README / market-config.json / invite-kit.md contain no email). Do not fabricate. |

Site rules stated on the form: "Listings are free. We review every submission for quality and relevance before adding it." (About page: every entry is researched/sourced by the maintainers; no instant go-live.)

## Dedupe check (done)
Searched the full machine-readable index `https://aiagents.wiki/agents.json` (≈358 entries) and the homepage listing:
- No match for `AgentBazaar`, `agentmarket`, `ptreezh`, `bazaar`, `gig`, `agent registry`, or `a2a`.
- Nearest unrelated hit: a "AI talent marketplace that screens experts and supplies them to AI labs" — a different staffing product, not us. → **Not a duplicate; safe to submit when the form launches.**

## Credential discipline
- No API key / token was issued (no working endpoint exists). Nothing saved to `~/.aiagents-wiki/credentials.json` (directory not created — no creds to store). No masked output needed.

## Quirks / notes
- The brief described ~358 profiles; the live index reports exactly 358 agents (`llms.txt`), consistent.
- The directory's taxonomy is skewed toward engineering/MCP tools; a gig-marketplace/registry product does not map cleanly to any category → "Other" + a sharp ≤200-char tagline is the best fit.
- Maintainer contact for the interim: **contact@aiagents.wiki** (public mailto on /about and footer).

## Next step (needs a human / Windows side)
1. **Preferred interim path:** from a real mailbox, email **contact@aiagents.wiki** with the five fields in the table above (name, ≤200-char description, GitHub URL, category=Other, your reply-to) and ask them to research/add it. This matches their stated "we research, source, and add it" workflow and bypasses the disabled form.
2. **OR** wait until `https://aiagents.wiki/submit` enables its submit button (label "Coming Soon") and re-run this submission — the field mapping above is ready to paste.
3. Re-check `agents.json` for `agentbazaar` after either action to confirm a live slug.
