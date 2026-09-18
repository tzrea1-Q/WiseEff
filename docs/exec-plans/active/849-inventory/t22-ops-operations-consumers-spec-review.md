# T2.2-OPS design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-ops-operations-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-ops-operations-consumers-design.md](t22-ops-operations-consumers-design.md) and [t22-ops-operations-consumers-threat-matrix.md](t22-ops-operations-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, T1.4, target, or Issue mutation in this review.

Review `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Dead `parameter-specs` import is removed in source, not wrapped. `--apply` stays 410. Overlay/governance/module-route 410 stay T1.4. `seedInitialization` / publication installer stay T1.4. T2.1/TOP fixtures stay out. Leftover `parameter-specs` import, `reconcileDriverParameterDefinitions` call, or `verifyEffectiveDriverParameterDefinitions` truthy-gate after repair is Spec fail even if delta ≠ 0.

## P2 (folded before implementation)

1. **S10-PER missing is fail-closed.** Deleting the dead import is the shard leak, not a license to stub verify. Fold: `--verify` body is only `readTypedVerificationReport`. If S10-PER is missing at compile, fail closed (no `definitionVerification` fallback, no fake adapter). Runtime missing/unapproved report is S10-PER tagged absence (`kind: "absent"`, reasons `missing` / `unapproved`), never stub `ready`. `DATABASE_URL` stays required. `--catalog-only` remains a parse constraint on `--verify`; it does not select the old catalog-only verifier.

2. **ZH parity.** Align ZH matrix/design with EN: `--dry-run` keep as inspect; comparison keep; T22O-01–10 table; never public raw/governance HTTP; no fake S10-PER adapter; leftover `parameter-specs` import after repair is Spec fail even if delta ≠ 0; T1.4 contents listed (overlay/governance/module 410, seedInitialization writers, installer).

## Checked and accepted

- **(a) Dead import vs S10-PER missing.** Live leak is `scripts/reconcile-parameter-definitions.ts` importing `reconcileDriverParameterDefinitions` / `verifyEffectiveDriverParameterDefinitions` and using the unused verifier as `await verifyEffectiveDriverParameterDefinitions &&`. `--verify` already calls `readTypedVerificationReport` (S10-PER `readReport`). Deleting the import is the allowance repair. Fail-closed if S10-PER is missing is: no fallback to `definitionVerification`, no fake adapter (P2-1). Tagged absence is the S10-PER missing-report contract, not a stub ready report. Not a P1.

- **(b) Restart cannot reseed vs T1.4.** Product: scheduled/background/script and restart paths use canonical owners and cannot reseed or resurrect archived state. In-family restart is operations health/ready/pilot-readiness: dual-fact **read** + `createStartupRuntimePin` reader; no `seedInitialization` import; T22O-06 keep / no materialize. Shard is 4 rows on the CLI only (`s12-ops.json`); `server/modules/operations/**` is 0. `parameter-bindings/seedInitialization` and catalog publication installer sit outside the shard. T1.3 already: no reset after ordinary startup/upgrade/publication. T1.4 owns remaining writers and stale-replay-after-restart. Leaving them to T1.4 is correct; rewriting them here would steal T1.4. Not a P1.

- **(c) `--apply` 410.** Already `catalogLegacyGoneResult("ops-reconcile-apply")` with test (`exitCode` 2). Keeping 410 is enough for the write path. Do not call `reconcileDriverParameterDefinitions`. `--dry-run` stays inspect (`readTypedCutoverInspection`), not a reconcile dry-run. Import deletion is A, not a second apply change.

- **(d) ZH/EN parity.** Repair intent matches (delete import, `--verify` only S10-PER, keep 410, reseed outside shard is T1.4, leftover import is Spec fail). ZH compresses T22O rows, omits `--dry-run`/comparison keep, omits no-fake-adapter / DATABASE_URL, and omits the public raw/governance non-goal bullet. Fold P2-2 before production edits. Not a P1 split.

Product matches the todolist line. Inventory Release/operations (catalog-only and full verification, reconciliation ledger, self-hosted checks; owner parameter-specs + operations) is consumed as typed S7-ORC / S10-PER / S8-LEG diagnostics, not by keeping the catalog-only verifier. Transition Operations tooling: never public raw/governance; typed mapping heads; diagnostics need operator authority — CLI is an operator job with `DATABASE_URL`; no public raw/governance HTTP; S8-LEG lookup does not reclassify R6/R8 or write archived as current. Health probes stay unauthenticated (not raw migration diagnostics). Pilot-readiness `admin:access` is existing, 0 shard rows, keep.

**Implementation may start** (P2s folded). Do not start T1.4. Do not mark T2.2-OPS complete from this review.
