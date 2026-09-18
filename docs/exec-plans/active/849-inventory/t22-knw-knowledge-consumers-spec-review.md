# T2.2-KNW design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-knw-knowledge-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-knw-knowledge-consumers-design.md](t22-knw-knowledge-consumers-design.md) and [t22-knw-knowledge-consumers-threat-matrix.md](t22-knw-knowledge-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-KNW completion in the review itself.

Review `01a0b039-d4ae-7730-8244-3dc0c277e5bc` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Intercept is not the pin. Stored rows kept. Cross-org 404 kept. Leftover wrap after repair is Spec fail even if delta ≠ 0.

## P2 (folded before implementation)

1. Delete `interceptKnowledgeReferenceSql` **entirely** (not only as a wrap). Mapping/`lookupLegacyIdentifier` only **after the load query**; never on picker/resolve empty results; no synthetic inject.
2. ZH: insert/delete no-wrap; orphan `propertyKey`→spec id is notice-only, not picker; inventory Knowledge row; T2.1/TOP out of family; T22K-04 function-gone.

**Implementation may start** (P2s folded). Do not start T2.2-MOD. Do not mark T2.2-KNW complete from this review.
