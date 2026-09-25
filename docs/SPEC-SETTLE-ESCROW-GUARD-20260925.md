---
title: SPEC-SETTLE-ESCROW-GUARD-20260925
status: implemented
date: 2026-09-25
scope: tools/settle.js
related: SPEC-AUTOSETTLE-20260912 (G5 backfill, ledger/L-0068)
author: operator (grill-down)
---

# Settle Escrow Guard

## Problem (verified, code-level)

Three publish paths create tasks with inconsistent escrow state:

| Path | Budget escrow (escrow-<T>) | Evidence |
|---|---|---|
| `tools/publish.js` (interactive) | YES (budget + pubdep frozen at publish) | ledger escrow/pub_escrow entries |
| `skills/agentbazaar/scripts/ab-publish.sh` (git mode) | NO | script comment "publisher balance debited on settle" |
| `gateway/worker.js` publish branch | NO | writes spec.md + published event only |

`tools/settle.js` transfers `pay/tax/refund` FROM `escrow-<taskId>` and
`deposit_refund` FROM `escrow-<taskId>-deposit`, but performs **no existence
check** on the escrow account. `tools/ledger.js writeEntry` does not validate
balances; `tools/recap.js` only checks intra-event conservation
(payment+tax+refund == budget). Consequence: manually settling an escrow-less
task mints credits out of thin air (escrow account goes negative), breaking
global ledger supply while recap still reports "conservation OK".

Existing guardrail (insufficient): `tools/autosettle.js escrowFunded()` refuses
auto-settlement of escrow-less tasks (warn + skip; manual G5 backfill per
SPEC-AUTOSETTLE-20260912, e.g. ledger/L-0068). The **manual path
`tools/settle.js` has NO equivalent guard** — this SPEC closes that gap.

## Fix

Add `escrowFunded(taskId)` to `tools/settle.js` — same ledger scan as
autosettle.js (match `kind: escrow` + `to: escrow-<taskId>`) — and abort
**before any ledger write** when the budget escrow is missing:

- Guard placed right after the "already settled" check (step 2), before
  winner/payment resolution (step 3) — fail fast, no partial work.
- On failure: print error naming `escrow-<taskId>`, hint the G5 backfill
  (publisher balance → escrow-<taskId>, amount = budget), exit code 1.
- No new flags, no downgrade path: settling without escrow is always a
  hard error. `--allow-unsigned` stays scoped to signature degradation only.

## Acceptance (TDD)

`tests/settle-escrow-guard.test.js` (fixture style aligned with
settle-reputation.test.js: temp bare repo + execSync):

1. **Case 1 (red before fix):** task T-GUARD1 with spec budget 40, claimed
   event, verify-result PASS, **no** escrow ledger entry →
   `node tools/settle.js T-GUARD1 --allow-unsigned` must exit non-zero and
   output mention `escrow` + backfill hint; no new ledger entry written.
2. **Case 2 (green after fix):** same task + manual G5 escrow entry
   (`kind: escrow, from: AG-TEST, to: escrow-T-GUARD1, amount: 40`) →
   the escrow guard passes (flow may proceed; assertion is guard pass only).

## Regression (grill-down finding)

`tests/settle-reputation.test.js` fixture task T-REP has **no escrow record**
and currently expects `settle.js T-REP --allow-unsigned` to succeed. After this
guard, that fixture MUST add a G5-style escrow entry before running settle
(settlement requires funded escrow — same rule the fixture now exercises).
Update the fixture accordingly; do not relax the guard.

Run: `node tests/settle-escrow-guard.test.js`, `node tests/settle-reputation.test.js`,
`node tests/recap.test.js` — all green before push.

## Grill-down record

- Q1 (reuse vs copy): why not export escrowFunded from autosettle? →
  autosettle.js is a script with side effects; importing it would execute CLI
  paths. Duplicating the 10-line ledger scan keeps settle.js self-contained.
- Q2 (downgrade): allow `--skip-escrow-check` for testing? → No. An escrow-less
  settlement mints credits; any bypass is a hole. Tests use real fixtures with
  real escrow records.
- Q3 (deposit escrow): also guard `escrow-<T>-deposit`? → Out of scope for this
  SPEC (aligns with autosettle which only guards budget escrow). Noted as
  follow-up: gateway claim path also skips worker deposit freeze.
- Q4 (existing tasks): T-3003/T-3005/T-3006 are escrow-less (gateway/git
  publish). They must be G5-backfilled before settlement — tracked in ops log;
  T-3006 backfill (40 + pubdep 2) is a separate ops action.

## Verification commands

```bash
node tests/settle-escrow-guard.test.js    # new guard cases
node tests/settle-reputation.test.js      # regression: fixture now backfills escrow
node tests/recap.test.js                  # regression: conservation still intact
```
