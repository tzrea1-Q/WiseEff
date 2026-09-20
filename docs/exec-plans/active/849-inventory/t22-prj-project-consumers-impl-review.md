# T2.2-PRJ implementation review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-prj-project-consumers-impl-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Independent Standards and Spec of the uncommitted T2.2-PRJ client/runtime draft owner. Reviewers did not write the code. No commit, no T2.2-FIL, no SEAL.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`.

## Standards

Verdict: **PASS with P2**

Scoped to the six named files. v2 list uses catalog schema, not workbenchDraftListSchema. `parameterId` ← `bindingId` so discard matches `b.id`. v1 GET/DELETE remain fallback.

P2: no client test for no-arg `listDrafts()` v1 mine; two-project refresh test does not assert listDrafts fan-out; mock applyImportBatch hydrates listDrafts() without projectId.

## Spec

Verdict: **PASS with P2**

Refresh is per-project v2. v1 DELETE not 410. PARAM-INIT still future. T2.1 fixture unchurned. Classification 88 groups / 422. Honest zero delta. Checker blocked by T2.2-TOP editService blob as allowed.

Local candidate may be reported. Do not mark T2.2-PRJ SEALED/committed.
