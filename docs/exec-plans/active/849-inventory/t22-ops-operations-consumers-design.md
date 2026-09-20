# T2.2-OPS operations consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-ops-operations-consumers-design.md)

Companion to the [threat matrix](t22-ops-operations-consumers-threat-matrix.md). Operator CLI and operations HTTP use typed inspect/verify/legacy-lookup. `--apply` stays 410. No parameter-specs reconcile/verify import. No reseed, no resurrect of archived current.

Status: **Spec PASS with P2 folded.** Independent review `01a0b06f-3a18-7c44-9e2d-8f1b47c0a5e6`. Implementation may start.

## 1. What T2.2-OPS is

Classify S12-OPS (4). Repair: `scripts/reconcile-parameter-definitions.ts` still imports `parameter-specs` `definitionReconciliation` / `definitionVerification` and uses the unused verifier as a truthy `--verify` gate. Fail closed on apply. Do not steal T1.4.

| Seam | Owner today | T2.2-OPS |
| --- | --- | --- |
| CLI `--apply` | already `catalogLegacyGoneResult` | Keep 410 |
| CLI `--verify` | unused `verifyEffectiveDriverParameterDefinitions` && `readTypedVerificationReport` | **Only S10-PER `readTypedVerificationReport`** |
| CLI inspect / `--dry-run` | `readTypedCutoverInspection` | Keep |
| CLI `--legacy-type/--legacy-id` | `readTypedLegacyOperatorOutcome` | Keep |
| `parameter-specs` imports | dead module-import + effective/governance tokens | **Delete** |
| Operations HTTP | health / ready / pilot-readiness | Keep; no seed |
| Comparison | already PG | Keep |
| Jobs outside shard | seedInitialization, publication installer | **T1.4** |

## 2. Classification method

Group `s12-ops.json` by `file` × `rule`. Labels: canonical-current-inspect, canonical-current-verify, canonical-current-legacy-lookup, canonical-current-apply-gone, canonical-current-health, exact-canonical-history, archived-notice (parameter-specs imports).

## 3. Repairs after Spec PASS

**A. Delete legacy imports (`scripts/reconcile-parameter-definitions.ts`)**

Remove:

```ts
import { reconcileDriverParameterDefinitions, type DefinitionReconciliationMode } from "../server/modules/parameter-specs/definitionReconciliation";
import { verifyEffectiveDriverParameterDefinitions } from "../server/modules/parameter-specs/definitionVerification";
```

`--verify` body is **only** `readTypedVerificationReport`. If S10-PER is missing at compile, fail closed (no `definitionVerification` fallback, no fake adapter). Runtime missing/unapproved report is S10-PER tagged absence (`kind: "absent"`, reasons `missing` / `unapproved`), never stub `ready`. `DATABASE_URL` stays required. `--catalog-only` remains a parse constraint on `--verify`; it does not select the old catalog-only verifier.

Do not keep a truthy `await verifyEffectiveDriverParameterDefinitions &&`. Do not call `reconcileDriverParameterDefinitions`. `--dry-run` stays inspect, not a reconcile dry-run.

**B. Tests**

- Keep `--apply` 410 test.
- Assert the production script source does not contain `parameter-specs`, `reconcileDriverParameterDefinitions`, or `verifyEffectiveDriverParameterDefinitions`.
- Optional: `--verify` with a stub env still requires DATABASE_URL (existing contract); do not add a fake adapter.

**C. Out of family**

Do not 410 overlay/governance/module routes. Do not edit T2.1 fixtures or TOP relocation. Do not rewrite unpublished Scratch 0151–0153. Do not start T1.4 until this family is a local candidate.

## 4. Ratchet

1. Implement A–B.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **OPS** shard entries. No growth, no checker weakening.
4. Receipt: OPS before **4**, total before **3513**, after counts, delta.

Leftover `parameter-specs` import after repair is a Spec fail even if delta ≠ 0. Honest zero only when the import is gone and the checker is blocked.

## 5. Evidence

- `npm run test:scripts -- scripts/reconcile-parameter-definitions.test.ts` (or the scripts vitest config that already includes it).
- `test:server -- parameterCatalogComparisonContribution.test.ts` if comparison is untouched, still run once.
- `git diff --check`. `tsc -b` if types change.
- Browser: **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Delete imports + fix `--verify`.
2. Source-import tests.
3. Checker / OPS shard ratchet if possible.
4. Receipt; review; then T1.4 as the next serial todo. No commit.

## Key Decisions

1. **Typed reads only.** Inspect/verify/legacy stay S7-ORC / S10-PER / S8-LEG.
2. **Apply is gone.** Structural reconcile write is 410, not a dry-run of `reconcileDriverParameterDefinitions`.
3. **Dead import is the leak.** Removing it is the repair, not wrapping it.
4. **Reseed lives in T1.4** if it is `seedInitialization` / installer, not this CLI.
5. **Honest zero allowed** if import gone and checker blocked.

## Open Questions

None.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Drop parameter-specs imports | `scripts/reconcile-parameter-definitions.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-ops.json` if tokens gone | A |
| C | Receipt | T2.2-OPS docs | B |
