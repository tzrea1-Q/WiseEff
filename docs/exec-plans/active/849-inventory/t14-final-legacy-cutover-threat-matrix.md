# T1.4 final legacy cutover — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-final-legacy-cutover-threat-matrix.md)

Contract: #849/#853 T1.4. Eleven T2.2 families are local candidates. This matrix freezes the aggregate cutover boundary.

Status: **revised after Spec FAIL `01a0b09b-727a-7128-9ec2-9e13c8668c97`.** Companion: [implementable design](t14-final-legacy-cutover-design.md). Awaiting Spec re-review. No commit, PR, seal, target, destructive archive, or Issue mutation.

## Lane and boundaries

- Worktree `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`, HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`.
- User waived per-todo 确认. Still no commit/PR/target/destructive/Issue.
- Helper PG 55438 only. Never `wiseeff_lane_849`, never `5432/wiseeff`.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable).
- Do not execute T2.3a/b deletion. Do not open PR.

## Invariant under protection

After T1.4, remaining **current** legacy catalog allowances are **zero**, with **no checker weakening** and **no hidden references**. Fallback / mixed read / dual-write / TD-125 leave only after successor contracts are met. Production-role HTTP and workers deny legacy **current** reads/writes. Stale drafts/approvals/memberships/queues/caches/checkpoints are fenced at the rebuild epoch; unrelated jobs/history stay; stale replay after restart is rejected.

## Intake (measured 2026-09-18, after T2.2-OPS)

- Historical shard total still **3513**. Families recorded honest zeros because the checker **does not complete**.
- Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` fails: `Runtime topology relocation rejected: destination whole-file blob for server/modules/parameter-topology/editService.ts`.
- Frozen destination blob in `edit-service-version-index-relocation.json` / source-workflow record: `0d87d79a…`. Current `git hash-object` of `editService.ts`: `0052e18d…`. `editService.test.ts` similarly drifted (`22cd4709…` vs `edcd0ff5…`). Drift is T2.2-TOP (and later) uncommitted edits after the independently reviewed relocation record.
- T2.2 families were forbidden from rewriting those fixtures. **T1.4 owns unblocking the checker** by a **reviewed destination-blob successor**, not by deleting relocation pairs or weakening `rejectAllowanceGrowth`.
- Deferred 410s still live: overlay HTTP (DTS coverage), `GET /api/v2/parameter-specs?view=governance` list (picker retargeted in MOD; handler remains), `/api/v2/parameter-modules` writes (transition final). SeedInitialization / publication installer restart-reseed was left to T1.4 by OPS.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T14-01 | Checker runnable | Checker completes against trusted-base without flag invention | checker stdout |
| T14-02 | Current successor only | Rebind dest OID + pair `new` on `source-workflow-relocation.json` and `source-workflow-consumer-relocation.json` only. Historical version-index / runtime-topology dest OIDs and provenance SHAs **unchanged**. Pair `old` ids full; pair `new` anchor + current-scan fingerprint | relocation JSON + Spec |
| T14-03 | Zero current allowances | After repair, remaining scanner hits are 0. The checker does not distinguish history. Naming an owner is not zero. T1.4 incomplete while shard rows remain | checker counts |
| T14-04 | No weakening | No deleted relocation pairs, no `--skip`, no fixture rewrite that drops mapping | diff of checker/relocation |
| T14-05 | Deferred 410 | Overlay / governance-list / module-write 410 only if live product callers are gone; else keep 2xx and name the remaining caller | route tests |
| T14-06 | No reseed | Restart/health/installer do not re-materialize completed seed | existing T1.3 tests + OPS |
| T14-07 | Dual-write | Mixed read/dual-write/TD-125 removed only with successor evidence | receipt |
| T14-08 | Denial | Direct production-role HTTP/worker current legacy write denied | focused tests |
| T14-09 | Fence | Stale drafts fenced at rebuild epoch; unrelated history kept | receipt / later T2.3 |
| T14-10 | Non-goals | T2.3 destructive delete, T3.3b target, PR/merge, Issue close | receipt |

## Non-goals

- Rewriting relocation **source** inventory or dropping the 26/28 editService pairs.
- Inventing checker flags.
- Archive table drop (T2.3a/b).
- Commit / PR / Hosted / target / Issue.

## Self-review limit

Written by the coordinating implementer. Independent Spec required before production edits.
