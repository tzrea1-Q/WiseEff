# T2.2-FIL design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-fil-file-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-fil-file-consumers-design.md](t22-fil-file-consumers-design.md) and [t22-fil-file-consumers-threat-matrix.md](t22-fil-file-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-FIL completion in the review itself. Chinese twins: exact `dps.property_key`, delete intercept, no definitionId→specId coerce, Spec PASS before production edits.

Review `01a0afa4-6152-77c2-947b-87f66c9304aa` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Design does not keep intercept as the pin, does not keep `split_part` in source SQL, and does not pre-authorize production edits.

## P2 (folded before implementation)

1. `pinW` / `interceptExactWritebackSourceSql` in `writebackService.ts`. Folded: T22F-04 covers both property-pin and writeback wraps; inner-join `dts_property_specs` in FIL source SQL; delete both wraps.
2. `applyLockedOverlayWriteback` requires `parameterSpecId: string`. Folded: load spec id from the locked binding; never from `parameterDefinitionId`; do not omit.
3. `syncService.ts` passes `parameterDefinitionId: resolved.definitionOrSpecId` and omits `parameterSpecId`. Folded: semantic path passes `parameterSpecId` from the binding match.
4. Allowed paths omitted `s12-fil.json`, `schemas.ts`, `syncService.ts`, `candidateRepository.ts`. Folded: in-family classify; do not steal AGT.

## Checked and accepted

- Candidate/config-set/baseline/export stay 2xx.
- Do not 410 file routes.
- Do not churn T2.1 `semanticBindingFixture.ts`.
- Repair then ratchet vs 56/3513; not a zero-56 mandate.
- Zero delta **and** source SQL still containing `split_part` fallback is a Spec fail.

**Implementation may start** (P2s folded). Do not start T2.2-AGT. Do not mark T2.2-FIL complete from this review.
