# T1.2 catalog-capability/v4 — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/capability-v4-threat-matrix.md)

Contract: #849, #853 T1.2, [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md) value-schema decision, and [ADR-0016](../../../adr/0016-cell-arrays-are-governed-by-column-width-only.md) column-width rule. Product direction (nested arrays, mixed item schemas, array `description`, metadata `minItems`/`maxItems`, `charging_core` as a NodeType) is already decided. This matrix freezes the remaining implementation and security boundary.

Status: **design Spec-approved; implementation on Scratch.** See [design](capability-v4-design.md) and [acceptance](capability-v4-acceptance.md). No commit/PR/seal.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1 remains an uncommitted dirty candidate and is not rewritten.
- Risk **R3**. Independent Spec review of this matrix and the [implementable design](capability-v4-design.md) precedes production edits. Independent Standards and Spec review of the resulting candidate follows local green.
- Stop after T1.2 local delivery. No T1.3 successor/seed counts, consumer-family migration, commit, PR, merge, Hosted, target, or Issue mutation.

## Invariant under protection

A published Catalog release keeps the exact meaning of `catalog-capability/v1`, `/v2` and `/v3`. A new release may advertise `catalog-capability/v4` only when its value schemas stay inside the v4 allow-list, resource budgets, and fail-closed keyword policy. A consumer that only admits v1–v3 must refuse v4 content before any catalog write. Cardinality is copied from reviewed vendor metadata, never from observed example rows. `charging_core` is a distinct NodeType subject, never a rename or merge of `huawei,charging_core`.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| B4-01 | Historical v1/v2/v3 meaning | Existing v1/v2/v3 artifacts, goldens and admitted historical releases compile, install and read with the same interpretation. Current-revision pins that must move to v4 are updated once and explained | Compiler/publication suites; frozen v3 allow-list tests |
| B4-02 | v4 success | Nested arrays, mixed item schemas (`{description}` without `type`), array-level `description`, and metadata `minItems`/`maxItems` compile, admit and persist through the formal publisher/installer | Capability unit tests + successor builder + real PG install |
| B4-03 | Unknown keyword fail-closed | `$ref`, `$dynamicRef`, `pattern`, `format`, `exclusiveMinimum`, `additionalItems`, `prefixItems`, `unevaluatedItems`, `contains`, and any other non-allow-listed key are refused at the first extra key. Keywords are not dropped | `capabilities.test.ts` |
| B4-04 | Depth and container budgets | Array-schema nesting above `maxArraySchemaDepth` or schema-object walk above `maxSchemaContainerNodes` fails with `resource-budget-exceeded` before compile/install. Compiler `valueSchemaRules` complexity limits still apply | Capability + compiler tests |
| B4-05 | Cardinality source | `gpio_int` `minItems`/`maxItems` equal vendor `constraints.cells: 3` from `mt-mt5788.yaml` and `sc8562.yaml`. A 3-row DTS example cannot mint row cardinality. Unreviewed 4/5-column fixtures cannot mint inner width | Vendor adapter + gpio_int fixture |
| B4-06 | No flattening | `constraints.cells` becomes **inner** group width on a nested array. Outer group count is unconstrained. A 1-D `minItems=maxItems=cells` flattening is refused | Vendor adapter Red/Green |
| B4-07 | Cells on an incompatible shape | `cells` on a scalar/string/boolean/null schema fails `cells-require-array-or-mixed`. Other unknown constraint keys still `unhandled-constraint:<keys>`. No silent drop | Existing charger-cells test, retargeted to the cells reason |
| B4-08 | Mixed item schema | Array `items: { description: "…" }` without `type` is admitted. Mixed plus unknown keys fails closed. Root mixed `{description}` remains valid | Capability tests |
| B4-09 | v3 consumer refuses v4 | Frozen v3 allow-list rejects nested arrays / `minItems` / array `description`. `installPublishedReleaseForTests` with frozen v3 `consumerCapability` refuses a v4 candidate **and** a nested-array compiled bundle before materialize; reason `unsupported-consumer-capability-revision`, not omitted-impact `unsupported-catalog-capability`; domain snapshot unchanged. Production `installPublishedRelease` has no override | `verifyAuthorizationForActivation` + installer pre-materialize allow-list walk; real PG |
| B4-10 | Current consumer admits history | Current runtime still admits v1, v2 and v3 **policy** revisions and v3-shaped definition schemas, and does not reinterpret those schemas as v4. Kernel bundles have no capability field | Runtime capabilities + historical replay |
| B4-11 | Prefix/wildcard forgery | `catalog-capability/v4-beta`, `catalog-capability/v`, `catalog-capability/v10`, empty and unknown strings fail closed. No prefix match | Runtime admission tests |
| B4-12 | charging_core NodeType identity | Formal subject `node-type:charging_core` with selector `node-type-name=charging_core`. Underscore is legal. Distinct from `driver:huawei,charging_core`. No compatible is invented from the node name | Successor builder + vendor YAML + PG install |
| B4-13 | Name-similarity merge | Publishing `charging_core` does not reuse, alias, retire or rewrite `huawei,charging_core` identities, definitions or selectors | PG identity assertions |
| B4-14 | Formal publication only | charging_core and gpio_int v4 content reach the database only through compile → admit → persist candidate → authorized install. Direct SQL insert of subjects/definitions/releases is absent from evidence | Publication/installer PG |
| B4-15 | Historical replay of v3 content | A v3-shaped integer/string/boolean/null/1-D array/mixed definition still publishes on v4 without schema rewrite | Capability + successor tests |
| B4-16 | Example vs schema | Nested examples must match the nested schema. Example row counts never become `minItems`/`maxItems`. Over-budget example lists still fail | Capability example matcher |
| B4-17 | Concurrent / duplicate NodeType | Two concurrent introductions of `node-type:charging_core` cannot both commit distinct subjects | Existing unique/lock tests extended |
| B4-18 | Generated artifacts | OpenAPI DTO recursion, capability allow-list digest and vendorContentHash are regenerated from owners. Unexplained S2-SCH/ACL/relation-count/compiler-golden drift is a blocker | contract/docs/golden checks |
| B4-19 | No T1.3 scope leak | Atlas/Aurora/Nebula 124/372 identity sets, acme retirement as a seed action, and eleven consumer families are unchanged. gpio_int unblocking is capability/import mapping only | Diff review + seed-count tests untouched |

## Non-goals

- Nested-array plugin system, JSON Schema dialect expansion (`$defs`, `oneOf`, `anyOf`, `allOf`, `not`), or a second value-schema engine.
- Inferring matrix width/height from DTS/JSON examples or live observations.
- Complete vendor successor, three-project materialization, or TD-124 formats.
- SQL migration. v4 is a capability revision; T1.1 unpublished 0151–0153 stay untouched.
- Reinterpreting v1/v2/v3 allow-lists to accept nested arrays.

## Self-review limit

This matrix was written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
