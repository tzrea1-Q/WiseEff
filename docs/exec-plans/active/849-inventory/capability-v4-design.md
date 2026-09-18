# T1.2 catalog-capability/v4 — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/capability-v4-design.md)

Companion to the [threat matrix](capability-v4-threat-matrix.md). Product questions already closed by ADR-0046 are not reopened.

Status: **design Spec-approved (grok-4.6 re-review PASS).** Implementation is on the Scratch tree; see [acceptance receipt](capability-v4-acceptance.md).

## 1. What changes

Reuse the existing capability allow-list, successor builder, vendor importer, kernel compiler, installer and consumer admission. Do not add a parallel validator or plugin registry.

| Seam | File | Change |
| --- | --- | --- |
| Current revision | `server/modules/catalog-publication/builder/types.ts` | `CATALOG_CAPABILITY_CONTRACT_REVISION = "catalog-capability/v4"` |
| Frozen v3 allow-list | `builder/capabilities.ts` | Keep today's keyword sets and non-recursive array items as `CATALOG_CAPABILITY_V3_ALLOW_LIST` |
| v4 allow-list | `builder/capabilities.ts` | Recursive `SupportedValueSchema`; array keywords `type`, `items`, `description`, `minItems`, `maxItems`; budgets below |
| DTO | `server/modules/contracts/dtoSchemas/parameterCatalog.ts` | `z.lazy` recursive value schema; nested examples |
| Consumer admission | `runtime/capabilities.ts` | Current set = v1,v2,v3,v4. Frozen v3 set remains. Exact-string membership, no prefix |
| Installer gate | `verifyAuthorizationForActivation` + post-compile allow-list walk in `installPublishedRelease` | Online-publication: refuse candidate `capability_contract.revision` not in the consumer set. All modes: refuse definition `valueSchema` that fails the consumer allow-list. Both run before materialize. Reason `unsupported-consumer-capability-revision`. Production has no consumer override |
| Vendor constraints | `import/vendorAdapter.ts` `foldConstraints` | Fold reviewed `cells`/`description` onto a nested array; never flatten |
| Vendor nested shapes | `import/vendorYaml.ts` `vendorValueSchemaFor` | Two new closed shapes: `nested-string-array`, `nested-u32-array` |
| gpio_int | existing `mt-mt5788.yaml`, `sc8562.yaml` | Bytes unchanged; mapping changes |
| charging_core | new `schemas/dts/vendor/wiseeff/nodename-charging-core.yaml` + `catalog.json` | NodeType only; update `vendorContentHash` via `vendorDirectoryHash` |
| Frontend fixtures | `src/application/parameter-catalog/fixtures.ts` and matching client tests | Current revision literal follows the constant |

No new ADR. No new SQL migration. No rewrite of applied history or T1.1 0151–0153.

## 2. Value-schema contract (v4)

`SupportedValueSchema` is recursive. Scalars stay as in v3. Mixed remains `{ description: string }` with no `type` and no other keys.

Array schema:

```text
{
  type: "array",
  description?: non-empty string, same control-character rules as other descriptions,
  minItems?: integer >= 0,
  maxItems?: integer >= 0,
  items?: SupportedValueSchema   // scalar, mixed, or another array
}
```

Rules:

1. Unknown keys fail with `unknown-json-schema-keyword` at the extra key path.
2. `$ref` / `$dynamicRef` stay `json-schema-ref-forbidden`.
3. Author-supplied `minItems`/`maxItems` are integers `>= 0`; `minItems > maxItems` fails; each may not exceed `maxItemsBound`. Folded vendor `cells` is stricter: integer `>= 1` (ADR-0016 positive width). `cells: 0` / negative / non-integer fails with `invalid-cells-cardinality`.
4. Cardinality is present only when the author/vendor metadata supplied it. Absence means unconstrained, not zero and not “observe the example”.
5. `exampleMatchesSchema` recurses. `SupportedDefinitionContent.examples` is `readonly ContractJsonValue[]`. Example length never writes `minItems`/`maxItems`.
6. Root mixed schema is unchanged. Mixed **items** are the v4 addition.

### Budgets (published on the allow-list identity)

| Budget | Value | Rationale |
| --- | --- | --- |
| `maxArraySchemaDepth` | 4 | Counts only objects with `type: "array"`. Root array = 1; gpio_int / charging_core nested = 2; depth 5 fails. Mixed or scalar `items` do not increment array depth. |
| `maxSchemaContainerNodes` | 256 | Walk of the schema JSON object graph. Tighter than compiler JSON-Schema walk (64/4096). |
| `maxItemsBound` | 4096 | Prevent huge declared bounds; not a row-count inference |
| existing display/doc/example/change-set budgets | unchanged | |

Exceeding a budget is `resource-budget-exceeded`. Compiler `valueSchemaRules.traversal` remains the second fence for persisted release documents.

### Frozen v3

`CATALOG_CAPABILITY_V3_ALLOW_LIST` is a byte-stable copy of today's allow-list: array keys `type`+`items` only; items only `string` or `integer`(+bounds); no array `description`/`minItems`/`maxItems`; no recursive arrays. `validateSupportedDefinitionContentAt(content, path, allowList)` is the shared walker. Publication uses v4. Tests and the v3 consumer proof use the frozen v3 list. v3 meaning is not widened.

## 3. Consumer vs bundle admission

Today `catalogConsumerSupportsRevision` is an exact `Set` of v1/v2/v3 and is used only by dual-fact readiness against **policy**. `installPublishedRelease` does not read a capability revision. Kernel bundle/manifest has no capability field; do **not** add one (that would churn compiler goldens). Existing install `unsupported-catalog-capability` means **omitted impact facts**, not revision membership — do not reuse it.

Add a distinct authorization reason `unsupported-consumer-capability-revision` (new `PublicationAuthorizationReason`; OpenAPI/DTO union regenerated from that owner).

```text
CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS = frozen ["catalog-capability/v1","catalog-capability/v2","catalog-capability/v3"]
SUPPORTED_CATALOG_CONSUMER_REVISIONS     = v3 set + "catalog-capability/v4"
admitCatalogCapabilityRevision(revision, supported = current set) → boolean  // exact Set.has, no prefix
```

Two pre-write checks, both before `materializeCompiledRelease` / pointer advance / receipt insert. On failure the domain snapshot equals the pre-call snapshot.

1. **Candidate revision (online-publication).** In `verifyAuthorizationForActivation`, after the candidate is loaded, read `capability_contract.revision` and call `admitCatalogCapabilityRevision`. A v4-advertised candidate is refused by a v3 consumer even if every schema happens to be v3-shaped.
2. **Compiled definition allow-list (bootstrap, advance, online-publication, adopt).** After `compileCatalogRelease`, run `validateValueSchema` against the consumer allow-list for every definition `valueSchema`. Failure is the same `publication-not-authorized` / `unsupported-consumer-capability-revision` (with the failing path), not omitted-impact `unsupported-catalog-capability`. A nested-array compiled release with no candidate still fails a v3 consumer. Historical integer/string/1-D/mixed v3 shapes pass the v4 walker.

Production `installPublishedRelease` and `verifyAuthorizationForActivation` always use the current v1–v4 set plus the v4 allow-list. They do **not** take a consumer override.

Frozen v3 injection exists only on `installPublishedReleaseForTests` / `PublicationActivationTestOptions`:

```text
consumerCapability?: {
  revisions: ReadonlySet<string>;
  allowList: CapabilityAllowListIdentity;
}
```

`productionInstallOptions` strips this field. B4-09 evidence: persist a v4 candidate that contains charging_core or gpio_int nested schema, call `installPublishedReleaseForTests` with `{ consumerCapability: { revisions: V3_SET, allowList: V3_ALLOW_LIST } }`, observe `publication-not-authorized` / `unsupported-consumer-capability-revision`, snapshot unchanged; then production `installPublishedRelease` without the override succeeds.

Readiness keeps using `catalogConsumerSupportsRevision` against policy so a v4 policy is admitted by the current consumer and a forged `catalog-capability/v4-beta` is not. Current runtime still admits historical v1/v2/v3 policy and v3-shaped content.

## 4. gpio_int mapping (no flatten)

Vendor bytes stay:

```yaml
gpio_int:
  valueShape: mixed
  constraints:
    cells: 3
    description: phandle pin flags
```

`foldConstraints` today allows only `minimum`/`maximum` and therefore blocks. The seed-reconciliation note that said “minItems=maxItems=cells on the mapped schema” is a **pre-v4 flattening sketch**. ADR-0016 and ADR-0046 win: `cells` is **column width**, row count is not a definition fact, flattening a cell matrix is forbidden.

Reviewed mapping:

```json
{
  "type": "array",
  "description": "phandle pin flags",
  "items": {
    "type": "array",
    "minItems": 3,
    "maxItems": 3,
    "items": { "description": "mixed" }
  }
}
```

Outer array = specifier groups, unconstrained. Inner array = one specifier of exactly 3 cells. `valueShape: mixed` supplies mixed items; `constraints.description` is the array-level description; `constraints.cells` is inner cardinality only.

`cells` folds only when the mapped schema is `array` or mixed (`{description}` without `type`, including `valueShape: mixed`). Otherwise the importer fails with **`cells-require-array-or-mixed`** (not `unhandled-constraint:cells`). Other unknown constraint keys still fail with `unhandled-constraint:<sorted extra keys>`. Empty `constraints: {}` stays structural-non-param.

Inner `items.description` is the existing mixed token `"mixed"` from `vendorValueSchemaFor("mixed")`. Vendor prose `phandle pin flags` is the **array-level** `description` only. Do not copy that prose onto items.

Do not read `exampleValue` (`<&gpio6 15 0>`) to set 3. Do not change vendor YAML to drop `cells`.

## 5. charging_core NodeType

Legal name: `parseCanonicalNodeName("charging_core")` already succeeds (`[A-Za-z][A-Za-z0-9,._+-]{0,30}`). Do not change the grammar.

New vendor document `nodename-charging-core.yaml`:

- `nodename: [charging_core]` only. No `compatible`. Mixed selectors stay rejected.
- Properties for the two reviewed DTS compatibility fields, using closed nested shapes, **without** min/max (the 3 example rows and 4/5 columns are observations):
  - `fast-charge-profile-matrix`: `nested-string-array`
  - `battery-thermal-derate-curve`: `nested-u32-array`
- Documentation states this is a demo NodeType subject, not `huawei,charging_core`.

`vendorValueSchemaFor`:

- `nested-string-array` → `{ type: "array", items: { type: "array", items: { type: "string" } } }`
- `nested-u32-array` → `{ type: "array", items: { type: "array", items: { type: "integer", minimum: 0 } } }`

List the file in `schemas/dts/catalog.json` and set `vendorContentHash` to `vendorDirectoryHash(vendor/wiseeff)`. No extra-file walk.

Single publication path: list the YAML in `catalog.json`, run `importVendorCatalog` (it already emits `create-subject-with-definitions` for nodename documents), persist the candidate, then `installPublishedRelease` on a helper-owned database. Do not accept a hand-built change-set as the charging_core evidence path. Focused fixtures may contain only this NodeType plus the acme predecessor — not the 113-file successor.

Assertions:

- subject kind `node-type`, canonical key `node-type:charging_core`, selector `node-type-name` / `charging_core`
- `driver:huawei,charging_core` identity, aliases and definitions unchanged when that driver is in the predecessor
- no `compatible=charging_core` and no alias onto the Huawei driver

This is not the 113-file complete successor and not 124/372 project bindings.

## 6. Compiler and runtime

Kernel `inspectValueSchema` already walks nested JSON Schema with maxDepth 64 / maxContainerNodes 4096 and forbids `$ref`. v4 schemas must pass that walk and `requireValidSchema`. Do not raise those limits.

Runtime matcher/subject kinds stay Driver / NodeType / ConfigurationSchema. v4 does not add a fourth kind. ProjectValue storage already admits JSON arrays; definition-side example/schema matching must accept nested arrays. T1.3 owns seed materialization of the compatibility DTS values.

## 7. Tests (Red then Green)

Minimum Red cases before production patches:

1. Nested array definition content fails `validateSupportedDefinitionContent` on the **current** (v3) allow-list.
2. `foldConstraints` on gpio_int YAML still reports `unhandled-constraint:cells,description`.
3. Frozen v3 consumer set returns false for `catalog-capability/v4`.

Then implement, and add:

- Capability: nested/mixed/description/minItems success; unknown keys; budget overflow; example mismatch; v3 allow-list still rejects v4 shapes; v3-shaped content still accepted by v4.
- Vendor adapter: gpio_int maps to the nested schema above; cells on a scalar still blocked; charging_core YAML maps to NodeType not Driver.
- Successor + installer on real PostgreSQL: importer-built v4 successor with charging_core installs via production `installPublishedRelease`; the same candidate with test-only frozen v3 `consumerCapability` returns `unsupported-consumer-capability-revision` and writes nothing; a nested-array compiled bundle is refused by the v3 allow-list walk on bootstrap/advance; historical v3 integer definition still installs on the current consumer.
- Existing publication/compiler suites as the affected regression. Do not claim T1.1's 171 as this candidate.

## 8. Documentation and fingerprints

Update bilingual T1.2 receipts, todolist checkbox only after local acceptance, and the inventory README. Capability allow-list digest **will** change; that is expected for v4 and must be regenerated from `canonicalDigest(allow-list)`. Historical v3 goldens must not be rewritten to v4 schemas. S2-SCH / ACL / canonical relation count should stay unchanged; unexplained movement is a stop.

## 9. Explicit non-edits

T1.1 dirty files, unpublished 0151–0153, persistent `wiseeff_lane_849`, allowance baselines, and the `/Users/tzrea1/Develop/WiseEff` checkout are out of scope. No commit/PR/Issue update in this todo.
