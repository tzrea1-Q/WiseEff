# T2.2-OPS operations consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-ops-operations-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-OPS, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Operations row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Release/operations row, T2.2-MOD [acceptance](t22-mod-module-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the OPS implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-ops-operations-consumers-design.md). Independent review `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-MOD remain uncommitted; do not rewrite except OPS-owned paths.
- Allowed paths: `server/modules/operations/**`, `scripts/reconcile-parameter-definitions.ts`, `scripts/reconcile-parameter-definitions.test.ts`, `s12-ops.json`. Do not steal T1.4 (parameter-specs overlay/governance 410, module-route 410, seedInitialization writers, publication installer).
- Stop after T2.2-OPS as a family; T1.4 follows only as the next authorized serial todo (user waived per-todo 确认). Still no commit/PR/target/destructive/Issue.
- Viewport: none expected (CLI/ops reads). No UI sweep.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_ops`.

## Invariant under protection

Scheduled/background/script and restart paths in this family use **canonical owners** (S7-ORC inspect, S10-PER `readReport`, S8-LEG typed lookup). They **cannot reseed** project bindings or **resurrect archived state as current**. `--apply` / structural reconcile write is **410 gone**. There is **no** `parameter-specs` definitionReconciliation / definitionVerification import on the operator CLI. Diagnostics are typed reads only; they do not call public raw/governance HTTP or reclassify R6/R8.

## Intake (measured 2026-09-18)

Shards still total **3513**. S12-OPS `s12-ops.json` has **4** entries in **2** file×rule groups, all on `scripts/reconcile-parameter-definitions.ts`:

| Kind | Count | Notes |
| --- | --- | --- |
| Production script | 4 | module-import 2 + effective-governance-contract 2 |
| `server/modules/operations/**` | 0 | health/ready/pilot-readiness; comparison already typed |
| Tests | 0 shard rows | `reconcile-parameter-definitions.test.ts` is an allowed path |

Live leak: the CLI still imports `reconcileDriverParameterDefinitions` and `verifyEffectiveDriverParameterDefinitions` from `parameter-specs`. `--verify` uses `await verifyEffectiveDriverParameterDefinitions && await readTypedVerificationReport(...)` — the function is never invoked, only used as a truthy gate, but the import keeps the allowance. `--apply` already returns `catalogLegacyGoneResult`. Default inspect and `--legacy` already use typed OPS comparison readers.

Already good: `parameterCatalogComparisonContribution.ts` inspect/verify/legacy are S7-ORC / S10-PER / S8-LEG. Operations HTTP is health/readiness only (no catalog mutate). Comparison tests query real PostgreSQL. No `pinO` intercept.

Restart/reseed outside this shard (`parameter-bindings/seedInitialization`, catalog publication installer) is **T1.4**, not this family.

## Classification freeze

| Class | Meaning in OPS | This todo |
| --- | --- | --- |
| Canonical current — inspect | S7-ORC `readTypedCutoverInspection` | Keep |
| Canonical current — verify | S10-PER `readTypedVerificationReport` | Keep; drop dead `parameter-specs` verify import |
| Canonical current — legacy lookup | S8-LEG typed mapping head | Keep; no reclassify |
| Canonical current — apply-gone | `--apply` 410 | Keep |
| Canonical current — health/restart | `/health/*`, pilot-readiness | Keep; no reseed |
| Exact canonical history | CLI tests, comparison tests | Keep / retarget import assertions |
| Archived notice | `parameter-specs` reconcile/verify imports | **Remove** |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22O-01 | Inventory | 4 entries classified by file×rule | receipt table |
| T22O-02 | No spec import | `reconcile-parameter-definitions.ts` does not import `parameter-specs` | source + test |
| T22O-03 | No reseed | CLI never calls `reconcileDriverParameterDefinitions`. `--apply` stays 410 | source + existing apply test |
| T22O-04 | Typed verify | `--verify` only `readTypedVerificationReport` (no truthy-gate on the unused function) | source + test |
| T22O-05 | No resurrect | Legacy lookup is S8-LEG mapping; archived disposition is not written as current | comparison + CLI parse test |
| T22O-06 | Health | operations routes do not materialize/seed on ready/live | existing health tests |
| T22O-07 | Ratchet | Repair first; vs 4/3513. Leftover parameter-specs import is Spec fail even if delta ≠ 0. Honest zero only if import gone and checker blocked | shard + checker if runnable |
| T22O-08 | UI | No sweep | receipt |
| T22O-09 | Environment | 55438 disposable | receipt |
| T22O-10 | Non-goals | T1.4, T2.1 fixture, TOP relocation, Hosted, commit; 410 overlay/governance/module routes | receipt |

## Non-goals

- Zeroing 4 OPS allowances if checker cannot complete.
- 410 of overlay, parameter-specs governance list/detail, or `/api/v2/parameter-modules`.
- Rewriting `seedInitialization` / publication installer (T1.4).
- Calling public `view=governance` / raw modes.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
