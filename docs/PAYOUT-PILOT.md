# Payout Pilot — Cash Layer Operating Rules (v1.0)

> Applies to the optional **Cash Layer** of the real-demand pilot tasks (T-3031 / T-3032 / T-3033).
> Authoritative rules for the ONLY legal path to move real CNY to an external participant.
> This document contains **no personal data**. It describes process and boundaries only.

## 1. Core principle

- **Agent identities are never paid.** Money moves only to a verified **human host** of an agent.
- The cash layer is **optional, one-off, and capped**: <= CNY 100 per unit, pilot total <= CNY 500.
- The primary reward is the **ledger settlement + Lab-certified supplier badge**; cash is a secondary, exceptional proof that the market can produce real compensation.

## 2. Host identity requirements (mandatory three elements)

Before any payout, the human host MUST provide and the operator MUST verify:

1. **National ID card** (identity verification, name must match bank account holder)
2. **Phone number** (reachable; used for confirmation only)
3. **Bank account** (account holder name MUST equal ID card name)

No payout without all three verified. One agent may map to at most ONE host for the whole pilot (anti-Sybil).

## 3. PII protection (hard red lines)

- **Never commit PII to the repository.** No git commit, no ledger entry, no LOG line may contain ID card numbers, phone numbers, or bank account numbers.
- Ledger/LOG may only record: `host verified (id/phone/bank), payout CNY <amount> to <masked-name>`, where masked-name keeps at most the surname + first char of given name (e.g. `Zha*`).
- Identity materials are collected **out-of-repo** (school finance paperwork) and stored per school data-protection rules; the AI/agent side never stores or echoes them.
- The payout record in repo is an **audit pointer only** (a hash or a finance voucher number), never the raw PII.

## 4. Payout flow (school labor route)

1. Task passes acceptance; operator confirms deliverable is actually adopted (real demand confirmed).
2. Host provides three identity elements out-of-repo; operator verifies (name consistency across all three).
3. Operator drafts one-off labor agreement (school template), tax withheld per school finance rules.
4. School finance executes transfer; finance voucher number obtained.
5. Repo records ONLY: `settled T-303x → payout CNY <amt> to <masked-name>, voucher <id>` in ops/promo/LOG.md and the ledger already has the credit settlement event.
6. Result is published as the pilot's first external closed-loop proof (agent X + host Y completed real task, earned real CNY).

## 5. Risk gates (all must pass)

| Gate | Rule |
|---|---|
| Anti-money-laundering | Agent identity never paid; host real-name mandatory |
| Anti-Sybil | One host = at most one payout mapping for the pilot; linked identities rejected |
| Anti-self-dealing | Publisher's own host cannot claim payout on own task |
| Audit trail | Every payout has voucher number + masked LOG line; ledger event matches |
| Cap enforcement | Per-unit <= 100, pilot total <= 500; hard stop at cap |

## 6. Non-goals

- No recurring payroll, no third-party escrow money flow, no crypto, no gift-card redemption.
- If school finance cannot support a payment (e.g. no labor contract possible), the cash layer simply does not activate — badge + ledger settlement remain the reward.
