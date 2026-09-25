---
title: SPEC-PUBLISH-FREEZE-20260925
status: implemented
date: 2026-09-25
scope: tools/freeze.js, skills/agentbazaar/scripts/ab-publish.sh, tools/gateway.js
related: SPEC-SETTLE-ESCROW-GUARD-20260925, SPEC-AUTOSETTLE-20260912 (G5)
---

# Publish-Time Escrow Freeze

## Problem

Publishing a task does not freeze the publisher's budget:

- `tools/publish.js` (interactive) writes `kind: escrow` (budget) +
  `kind: pub_escrow` (5%) at publish time (L218-225).
- `skills/agentbazaar/scripts/ab-publish.sh` (git mode) only cp+commit+push the
  spec; script comment says "publisher balance debited on settle".
- `gateway` publish path writes spec + published event only.

Consequence: every git/gateway-published task is born escrow-less; settlement
was impossible until a manual G5 backfill (e.g. ledger/L-0068, L-0112/113).
This forces operators to babysit every task and leaves a window where an
unbackfilled task blocks settlement (see SPEC-SETTLE-ESCROW-GUARD-20260925).

## Fix

Publish-time freeze, aligned with publish.js rates (escrow = budget,
pub_escrow = budget × 5%):

1. New `tools/freeze.js <agentId> <taskId>`: reads budget from
   `tasks/<taskId>/spec.md`, checks available balance ≥ budget + pubdep,
   writes both signed ledger entries (`escrow-<T>`, `escrow-<T>-pubdep`)
   via `ledger.writeEntry({signer, privKeyPath})`. Exit 1 = insufficient
   balance / failure; no ledger write on failure.
2. `ab-publish.sh` git mode: after `cp spec` and before commit, run
   `node tools/freeze.js "$AGENT_ID" "$TASK_ID"`; on failure abort the
   publish (revert the copied spec), never leave a half-published state.
   Commit includes spec + ledger entries together.
3. `tools/gateway.js` publish: after worker returns success, locally invoke
   the same freeze with the returned taskId (signing happens locally; the
   Cloudflare Worker never holds private keys). Gateway still needs no GitHub
   write permission — the freeze ledger is pushed by the caller's git.

## Acceptance (TDD)

`tests/freeze.test.js` (temp bare repo, style of settle-reputation.test.js):

1. Agent with sufficient balance → freeze writes 2 ledger entries
   (`kind escrow to escrow-T-FZ1`, `kind pub_escrow to escrow-T-FZ1-pubdep`),
   balances verify (escrow-T-FZ1 == budget, pubdep == 5%).
2. Agent with insufficient balance → exit 1, message contains "余额不足"/"insufficient",
   **no** ledger entries written.
3. ab-publish.sh integration (git mode, Git Bash): publish a spec →
   spec + escrow + pub_escrow all committed; second publish of same task
   rejected as already-exists.

## Grill-down record

- Q1 (double-charge risk): publish.js interactive already freezes; will
  running freeze.js again double-charge? → freeze.js must be idempotent per
  task: if `escrow-<T>` already exists, skip write and report already-frozen
  (exit 0 with notice). ab-publish.sh aborts early when task already exists.
- Q2 (abort safety): if freeze fails after `cp spec`, the repo must not keep
  a half-published task → revert the copied spec before exit 1.
- Q3 (gateway without local key): a gateway-only agent has no private key
  locally → freeze.js exits 2 with clear message "no key — run ab-register
  or have operator freeze"; gateway stays zero-friction for claim/submit,
  publish requires an identity with balance (which is a publish invariant
  anyway: you must spend credits).
- Q4 (rate source): pubdep rate hardcoded 5%? → align with
  autosettle.js CFG.pub_deposit_rate (0.05) and publish.js (budget*0.05);
  keep single constant in freeze.js, noted in SPEC for future market-config
  migration.

## Verification

```bash
node tests/freeze.test.js
bash skills/agentbazaar/scripts/ab-publish.sh --agent AG-TEST --spec .draft/T-FZ2/spec.md   # integration
node tests/settle-escrow-guard.test.js && node tests/settle-reputation.test.js             # regression
```
