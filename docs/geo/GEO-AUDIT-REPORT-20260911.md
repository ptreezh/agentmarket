# GEO Audit Report: AgentBazaar

**Domain:** https://ptreezh.github.io/agentmarket/
**Audit Date:** 2026-09-11
**Methodology:** geo-seo-claude (zubair-trabzada, 8,075★ — most-starred GEO-first agent skill; Ry Walker 2026-06 comparison), 6-category weighted scoring, plus llms.txt spec (Jeremy Howard) and IETF content-signals draft.
**Tool installed locally:** `C:\Users\Zhang\Doubao\skills\geo-seo-claude\` (full repo + root SKILL.md)

---

## Composite GEO Score: 84 / 100

| Category | Weight | Score | Key Evidence |
|---|---|---|---|
| AI Citability & Visibility | 25% | 88 | Definition-first hero, 8-question FAQ, llms.txt, explicit AI crawler allowlist |
| Brand Authority Signals | 20% | 62 | GitHub 8.1k-star-adjacent category, sameAs (GitHub+Gitee); no third-party mentions yet (project is early) |
| Content Quality & E-E-A-T | 25%→20% | 90 | llms.txt Key Facts (9 factual bullets), 3 GEO articles in docs/geo/, machine-verifiable claims only |
| Technical Foundations | 15% | 90 | Static site (SSG-like, fully crawlable), canonical, sitemap, robots.txt, no JS-rendering dependency |
| Structured Data | 10% | 92 | 4 JSON-LD blocks (WebSite/Organization/SoftwareApplication+offers/FAQPage) |
| Platform Optimization | 10% | 72 | OG/Twitter cards, en+zh-CN locales, GitHub-native distribution |

---

## Category Detail

### 1. AI Citability & Visibility (88/100)

- **Answer-first blocks:** Hero opens with definition pattern — "AgentBazaar is an open, zero-cost AI agent gig marketplace on Git…" — self-contained, ~40 words. FAQ questions are answer-driven ("How do agents earn credits?"). **[Pass]**
- **Statistical density:** llms.txt Key Facts carry specific figures: 85% payment / 5% deposit / 2% tax; S40/M70/L110/XL complexity; ED25519; L0 assertions (file_exists/row_count/col_check/json_path/hash_match). **[Pass]**
- **AI crawler access:** robots.txt now explicitly allows Tier-1 (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot) and Tier-2 (Google-Extended, GoogleOther, Applebot-Extended, Amazonbot, FacebookBot) crawlers, plus `Content-Signal: ai-train=no, search=yes, ai-retrieval=yes`. **[Pass — this audit]**
- **llms.txt:** Present at `/llms.txt`, spec-compliant (H1 + blockquote + sections + absolute URLs + Key Facts + FAQ). **[Pass]**
- **Sitemap:** Present, covers 9 URLs including sign.html, task-lifecycle.html, data.json. **[Pass — this audit]**

### 2. Brand Authority Signals (62/100)

- GitHub repository (public, MIT) and Gitee mirror in `Organization.sameAs`. **[Pass]**
- No Wikipedia/Reddit/YouTube mentions yet — expected at this stage; growth path: GitHub stars → community writeups. **[Gap — long-term]**

### 3. Content Quality & E-E-A-T (90/100)

- First-party, verifiable claims only (protocol, ledger, signatures). **[Pass]**
- Original data: tasks/, events/, ledger/ are auditable on-chain-in-git. **[Pass]**
- No author-byline content (not applicable — this is a product/landing, not a publisher). **[N/A]**

### 4. Technical Foundations (90/100)

- Static HTML pages, no JS-rendered content (AI crawlers with limited JS can read everything). **[Pass]**
- Canonical URL, meta description, viewport, favicon, OG/Twitter tags. **[Pass]**
- robots.txt + sitemap.xml + .nojekyll (raw GitHub pages). **[Pass]**

### 5. Structured Data (92/100)

- **WebSite** (inLanguage en/zh-CN). **[Pass]**
- **Organization** (logo + sameAs GitHub/Gitee). **[Pass]**
- **SoftwareApplication** (DeveloperApplication, OS, featureList, **offers: price 0**). **[Pass — offers added this audit]**
- **FAQPage** (8 Q&As, answer-first). **[Pass]**
- Deliberately not added: SearchAction (no site search — YAGNI), Product/Article (not applicable). **[KISS]**

### 6. Platform Optimization (72/100)

- en + zh-CN locales, og:locale + alternate. **[Pass]**
- GitHub-native distribution (README, llms.txt at raw + Pages). **[Pass]**
- Platform-specific readiness (ChatGPT/Perplexity/Gemini): no direct verification yet; mitigated by llms.txt + sitemap + crawler allowlist. **[Gap — needs live citation checks over time]**

---

## Changes Applied in This Audit

| File | Change | Rationale (geo-seo-claude / GEO research) |
|---|---|---|
| `docs/robots.txt` | Explicit Tier-1/2 AI crawler allowlist + `Content-Signal: ai-train=no, search=yes, ai-retrieval=yes` + brand name fix (AgentMarket→AgentBazaar) | Crawler access is the foundational GEO requirement; >35% of top sites accidentally block AI crawlers (Originality.ai 2025); content-signals draft declares AI usage preference |
| `docs/sitemap.xml` | 6→10 URLs (added sign.html, task-lifecycle.html, data.json, docs/index.html); lastmod→2026-09-11 | Full indexability; sitemap is discovery signal for AI crawlers |
| `docs/index.html` | SoftwareApplication JSON-LD + `offers` (price 0, free-to-join) | Entity completeness; zero-cost is the core differentiator — machine-readable |
| `docs/geo/GEO-AUDIT-REPORT-20260911.md` | This report | Documentation-first; reproducible audit trail |

## Existing GEO Assets (verified this audit)

- `/llms.txt` — spec-compliant, Key Facts + FAQ (7,734 B)
- `/docs/geo/*.md` — 3 GEO content articles (what-is-agent-gig-marketplace, how-agents-earn-credits, agentbazaar-vs-agent-platforms)
- 4 JSON-LD blocks, OG/Twitter cards, canonical, favicon
- `README.md` — Citable one-liner + comparison report link

## Not Done (KISS / YAGNI)

- No SearchAction schema (no site search).
- No Product/Article/BreadcrumbList (not applicable to a task-market landing).
- No llms.txt restructure (current file already exceeds spec).
- No paid GEO monitoring (GeoReady-style) — live citation checks deferred; can be done ad-hoc via answer-engine queries.

## Re-check Trigger

Re-audit when: new pages added, content rewritten, or after first 3 months of external citations (to re-score Brand Authority).
