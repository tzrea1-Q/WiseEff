# T2.2-KNW knowledge consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-knw-knowledge-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-KNW, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Knowledge definition picker row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Knowledge row, T2.2-DTS [acceptance](t22-dts-reload-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the KNW implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-knw-knowledge-consumers-design.md). Independent review `01a0b039-d4ae-7730-8244-3dc0c277e5bc`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-DTS remain uncommitted; do not rewrite except KNW-owned paths.
- Allowed paths: `server/modules/knowledge/**`, `KnowledgeRepository.ts`, `knowledgeClient.ts`, `src/features/knowledge/**`, matching tests, `e2e/acceptance/knowledge.acceptance.spec.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-knw.json` for ratchet. Classify in-family; do not steal MOD/OPS/AGT/LOG.
- Stop after T2.2-KNW. No T2.2-MOD or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible knowledge picker/chip surface changes. Default: no UI sweep (SQL pin repair).
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_knw`.

## Invariant under protection

Every S12-KNW runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. New picker selections are **canonical current** (org or platform-global spec). Stored reference rows stay. Missing/retired specs render **notice-only**, not selectable. Other tenants' specs **404**. There is **no scanner-visible inner join that runtime rewrites to LEFT JOIN**, and **no `specification_key` property-key fallback**. Repair source SQL before deleting an allowance.

## Intake (measured 2026-09-18)

Shards still total **3513**. S12-KNW `s12-knw.json` has **50** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `parameterReferences.ts` | 16 | 13 raw-read + 3 identifier |
| Production `routes.ts` | 3 | catalog-route |
| Production `repository.ts` / `logDomainRetrieval.ts` | 4 | unresolved |
| Client | 1 | catalog-route |
| Tests / e2e | 26 | sql-write, route, identifier, raw-read |

Rules: raw-read 14, sql-write 14, catalog-route 12, identifier 5, unresolved 5.

Live leak: `REFERENCE_SPEC_PROJECTION` still falls back through `string_to_array(ps.specification_key)`. `loadParameterReferencesByEntryIds` **source SQL** inner-joins `parameter_specs`. Runtime `pinK` wraps `db.query` via `interceptKnowledgeReferenceSql` (inner → left) and `overlayKnowledgeReferenceRows` / `lookupLegacyIdentifier`. `pinR` overlays mapping status. Empty resolve can inject a synthetic row. That is not an honest pin (same shape as T2.2-FIL/LOG/DTS intercepts).

Already good: `knowledge_parameter_references` and list/delete are `organization_id`-scoped. `resolveReferenceableSpec` 404s other tenants (`ps.organization_id = $1 or ps.organization_id is null`). Published-only reverse lookup. Deprecation does not delete reference rows.

## Classification freeze

| Class | Meaning in KNW | This todo |
| --- | --- | --- |
| Canonical current — picker | `resolveReferenceableSpec` for new links | Keep org/global; unresolved not selectable |
| Canonical current — stored refs | `knowledge_parameter_references` | Keep rows; LEFT JOIN in source SQL |
| Notice-only / historical | missing spec, deprecated, archived mapping | Render notice; do not rewrite rows |
| Exact canonical history | tests, e2e | Keep / retarget intercept tests |
| Archived notice | specification_key fallback; `pinK` intercept | **Remove** |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22K-01 | Inventory | 50 entries classified by file×rule | receipt table |
| T22K-02 | Exact property pin | Projection uses `coalesce(ps.property_key, dps.property_key)` only; no `specification_key` fallback in source | `parameterReferences.ts` + tests |
| T22K-03 | Historical refs | Load-by-entry uses **LEFT JOIN** `parameter_specs` in source SQL so orphans stay visible | `parameterReferences.ts` |
| T22K-04 | No intercept | `pinK` / `interceptKnowledgeReferenceSql` / `__knwPin` / query wrap **gone**. No synthetic empty-result inject | grep + comparison test |
| T22K-05 | Picker | `resolveReferenceableSpec` 404s unknown and other-tenant specs; unresolved not selectable | existing tests |
| T22K-06 | Cross-org | Reference CRUD stays `organization_id`; no other-tenant disclosure | existing tests |
| T22K-07 | History | Do not rewrite stored `knowledge_parameter_references` | no bulk update |
| T22K-08 | Mapping overlay | If mappingStatus is kept, apply it **explicitly** after the query, not via `db.query` wrap | `parameterReferences.ts` |
| T22K-09 | Ratchet | Repair first; vs 50/3513. Leftover intercept is Spec fail even if delta ≠ 0. Honest zero only if intercept gone and checker blocked | shard + checker if runnable |
| T22K-10 | UI | 1440x900 only if picker/chip UI changes. Default no sweep | receipt |
| T22K-11 | Environment | 55438 disposable | receipt |
| T22K-12 | Non-goals | T2.2-MOD…OPS, T1.4, T2.1 fixture, Hosted, commit | receipt |

## Non-goals

- Zeroing 50 KNW allowances.
- 410 of knowledge routes.
- Deleting stored references when a spec is deprecated.
- Selecting unresolved legacy ids in the picker.
- Churning T2.1 `semanticBindingFixture.ts` or T2.2-TOP relocation fixtures.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
