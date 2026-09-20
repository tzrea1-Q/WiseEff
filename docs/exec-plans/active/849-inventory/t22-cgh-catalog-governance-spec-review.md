# T2.2-CGH design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-cgh-catalog-governance-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2** (re-review after FAIL)

Independent Spec review of [t22-cgh-catalog-governance-design.md](t22-cgh-catalog-governance-design.md) and [t22-cgh-catalog-governance-threat-matrix.md](t22-cgh-catalog-governance-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-CGH completion in the review itself. Chinese twins: decision parity on every 410 vs keep.

First review `01a0aeec-4759-7333-9c1f-517ee277ca54` **FAIL** (P1: detail `view=governance` 410 vs T2.1 draft-by-id). Re-review `01a0aef7-2256-7960-a145-498f19d9830c` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Prior P1 closed: winning-router detail `?view=governance` stays canonical-current-dts-spec. Do not invent `lifecycle=draft`. Do not churn T2.1 `semanticBindingFixture.ts`.

## P2 (folded before implementation)

1. T22C-01 “three classes” vs four labels (canonical current split Catalog vs DTS). Folded: four labels; invariant “three” means current / history / archived.
2. POST-mint 410 vs auth/body parse order. Folded: **gone-first** (unauthenticated and invalid-body POSTs are 410, not 401/400).
3. `OrganizationSpecGovernancePanel.createParameterSpec` mock fallback. Folded: API mode injects catalog ports; default no UI sweep.

## Checked and accepted

- Bare `POST /api/v2/parameter-specs` is not spec-review `createSpec` (`/resolve`).
- List `view=governance` keep until T2.2-MOD (`OrganizationModuleGovernancePanel`).
- PATCH/deprecate/restore/reattribute/cutover keep until T2.2-TOP.
- Overlay keep (T22C-06). Mock ports: none in CGH (T22C-15).
- Catalog-api isolation 410s are not the winning `registerParameterSpecRoutes` surface.

**Implementation may start** (P2s folded). Do not start T2.2-TOP. Do not mark T2.2-CGH complete from this review.
