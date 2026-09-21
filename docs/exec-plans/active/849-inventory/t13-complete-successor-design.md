# T1.3 complete successor and B2 materialization — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t13-complete-successor-design.md)

Companion to the [threat matrix](t13-complete-successor-threat-matrix.md). Product questions already closed by ADR-0045/0046, T1.1, and T1.2 are not reopened.

Status: **design Spec PASS with P2 (grok-4.6 re-review).** Implementation local candidate: Standards PASS with P2, Spec PASS with P2. Receipt: [t13-complete-successor-acceptance.md](t13-complete-successor-acceptance.md).

## 1. What changes

Reuse the existing successor builder, vendor importer, publisher/installer, seed initialization, JSON source owner, and module owner. Do not add a parallel catalog writer, a second JSON ingest, or seed-invented placement.

| Seam | File | Change |
| --- | --- | --- |
| v4 change-set budget | `builder/capabilities.ts` | Override **only** `CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps` to `128`. Do **not** mutate `SHARED_BUDGETS` (frozen v3 must stay 32). Shared display/doc/example budgets unchanged |
| ConfigurationSchema builder proof | `builder/completeSuccessor.test.ts` | Cover `create-subject-with-definitions` with `kind: "configuration-schema"` / `configuration-schema-id` and `productPath: "m2-core"` |
| Vendor production import | `import/vendorAdapter.ts` `importVendorCatalog` | Unchanged algorithm; succeeds once the v4 budget allows ~48 `create-subject-with-definitions` plus revises. ConfigurationSchema is a **second** one-op successor and does not consume the vendor budget |
| ConfigurationSchema successor | new composer next to `importVendorCatalog` in `catalog-publication/import/` | After the vendor successor is installed, `buildCompleteSuccessor({ productPath: "m2-core", ... })` from that predecessor with one ConfigurationSchema subject and two definitions. Vendor importer never reads `power-management.json` |
| JSON seed ingest | `seedInitialization/materialize.ts` | Mixed config-set: DTS `base`/`overlay` + JSON `misc`. `ingestConfigRevision` receives **all members** (JSON is in the revision member list, filtered out of the DTS parse set). JSON bindings via `registerCanonicalJsonSource` **after** the all-project placement barrier. Remove `TD-124-json-project-source-semantics`. YAML/TOML/ENV still `TD-124` |
| Reviewed placement | new `seedInitialization/placementCapacity.ts` | Extra free `driver-group` via `createParameterModule` (`kind: "driver-group"`, `origin: "curated"`, **no** compatible mapping). Free `business` module the same way only if measured short. Not `registerOrClaimDriver`. Not called from inside `materializeSeedSources`. Idempotent claim-or-skip on completed replay |
| Seed sources | `realSeedSources()` helpers | Per project: `vendor-drivers.dts` (base), `charging-thermal.dts` (overlay), `power-config.json` (JSON owner) |
| Manifest honesty | `scripts/lib/seedReconciliation.ts` | DTS compatibility items `merge` onto `node-type:charging_core`. JSON items take ConfigurationSchema formal subject. Conservation stays 127; planned bindings stay 124 |
| Identity oracle | new integration test | Assert 124/372 natural keys and stable allocated IDs; B6 zero-binding fail-closed without capacity |

No new ADR. No new SQL migration. No rewrite of applied history or T1.1 0151–0153. D1 `vendor-catalog-1.yaml` remains the compile-vendor-catalog-release artifact and is **not** the production seed publication path.

## 2. Inventory and merge

Current-round rule (already in `manifest.json` `scope.currentRoundRule`):

1. 115 vendor definitions are current, including `charging_core` `fast-charge-profile-matrix` and `battery-thermal-derate-curve`.
2. Four compatibility items are current (two JSON, two DTS).
3. Eight YAML/TOML/ENV items stay `defer` / TD-124.
4. Planned bindings remain 124 per project because the two new vendor properties **are** the formal definitions for the two DTS locators.

T1.3 manifest updates (generator-owned, then `seed:reconcile`):

| Input | Old formal subject | New formal subject | Disposition |
| --- | --- | --- | --- |
| vendor `charging_core` / `fast-charge-profile-matrix` | `nodename=charging_core` | unchanged | `preserve` |
| vendor `charging_core` / `battery-thermal-derate-curve` | `nodename=charging_core` | unchanged | `preserve` |
| compatibility `/parameterLibrary/9` | `compatibility-item` / `dts-fast-charge-profile-matrix` | `node-type:charging_core` | **`merge`** into the vendor definition; keep `oldIdentity` |
| compatibility `/parameterLibrary/10` | `compatibility-item` / `dts-battery-thermal-derate-curve` | `node-type:charging_core` | **`merge`** likewise |
| compatibility `/parameterLibrary/1` | `compatibility-item` / `charge-voltage-limit` | `configuration-schema:wiseeff.power-config` / `charger.cv.limitMv` | `preserve` content; transform identity |
| compatibility `/parameterLibrary/2` | `compatibility-item` / `battery-temp-target` | `configuration-schema:wiseeff.power-config` / `battery.thermal.targetTempC` | `preserve` content; transform identity |

`realSource.subjectSelection` for charging-thermal becomes `node-type:charging_core` (no longer `pending-reviewed-subject-selection`). JSON `subjectSelection` becomes `configuration-schema:wiseeff.power-config`.

Binding arithmetic, unchanged and now measured:

```text
120 board business occurrences
+ 2 charging-thermal DTS occurrences (one matrix, one curve)
+ 2 JSON pointers
= 124 bindings / project
× 3 projects
= 372
```

Repeated board occurrences that share a definition stay separate bindings (`disposition: merge` on the occurrence, not a second definition). Structural keys stay excluded.

## 3. Change-set budget

Today `SHARED_BUDGETS.maxChangeSetOps = 32` is copied into both frozen v3 and v4. Full vendor import emits one `create-subject-with-definitions` per new subject (~48 after T1.2’s 49-subject D1 snapshot minus the acme predecessor subject) plus any revises. That is why T1.2 production import still fails `resource-budget-exceeded`.

| Allow-list | `maxChangeSetOps` | Why |
| --- | --- | --- |
| `CATALOG_CAPABILITY_V3_ALLOW_LIST` | **32** | v3 meaning does not widen |
| `CATALOG_CAPABILITY_ALLOW_LIST` (v4) | **128** | Full vendor tree + ConfigurationSchema + margin. Still a closed budget, not unbounded |

Raising the v4 number changes the published allow-list digest (`canonicalDigest` of the allow-list identity). Pin the new digest from the owner; do not hand-edit goldens. Revision string stays `catalog-capability/v4`. T1.2 installer proofs (frozen v3 refuse-before-write, reason `unsupported-consumer-capability-revision`) stay.

Implementation constraint: `SHARED_BUDGETS.maxChangeSetOps` stays 32. Frozen v3 copies it. v4 spreads `{ ...SHARED_BUDGETS, maxChangeSetOps: 128, maxArraySchemaDepth, ... }`. Mutating the shared constant would widen v3 and fail B2-20.

Rejected alternatives: paging vendor import into multiple successors (would split the complete successor); removing the budget (unbounded change sets); raising frozen v3 or `SHARED_BUDGETS` (widens v3).

## 4. Two successors, one current pin

`importVendorCatalog` already calls `buildCompleteSuccessor` and must stay vendor-YAML-only (`power-management.json` is excluded by inventory). ConfigurationSchema is not vendor YAML. Owner of the second successor is a thin composer **next to** `importVendorCatalog` in `server/modules/catalog-publication/import/` (not seedInitialization). It passes `productPath: "m2-core"`; any other product path refuses `create-subject-with-definitions` (`unsupported-change-op`).

Sequence on a helper-owned database:

1. **Vendor successor.** `importVendorCatalog` from the acme predecessor → persist candidate → original reviewer authorizes → original approver `installPublishedRelease`. Content: 115 vendor definitions, `charging_core` NodeType, gpio_int nested arrays, acme retired without `successorId`.
2. **ConfigurationSchema successor.** `buildCompleteSuccessor` from the **installed vendor** predecessor with a one-subject change set (below) → persist → same review/authorize/install rules. This is the proof that ConfigurationSchema travels through the builder, which `completeSuccessor.test.ts` currently lacks.
3. Seed materialize reads the **current** installed release (step 2).

Do not concatenate ConfigurationSchema ops into `importVendorCatalog`. Do not hand-build a vendor change set as production evidence.

### 4.1 ConfigurationSchema change set

Governed model id `wiseeff.power-config` (valid `parseCanonicalConfigurationSchemaId`; commas/filename suffixes forbidden).

```text
{
  op: "create-subject-with-definitions",
  kind: "configuration-schema",
  canonicalKey: "wiseeff.power-config",
  selector: { kind: "configuration-schema-id", value: "wiseeff.power-config" },
  definitions: [
    {
      propertyKey: "charger.cv.limitMv",          // 18 chars, dots legal
      content: {
        displayName: "Charge voltage limit",
        documentation: "<reviewed power-management.json description + explanation for charge-voltage-limit>",
        unit: "mV",
        valueSchema: { type: "integer", minimum: 4200, maximum: 4500 },
        examples: [4300]
      }
    },
    {
      propertyKey: "battery.thermal.targetTempC", // 27 chars
      content: {
        displayName: "Battery thermal target",
        documentation: "<reviewed power-management.json description + explanation for battery-temp-target>",
        unit: "°C",
        valueSchema: { type: "integer", minimum: 30, maximum: 42 },
        examples: [36]
      }
    }
  ]
}
```

Ranges and `documentation` copy reviewed `power-management.json` metadata (`description` + `explanation`); they are not inferred from JSON example files. `validateSupportedDefinitionContent` **requires** `documentation` (`capabilities.ts`); the sketch must not ship without it. Frozen identity allocates one subject id and two definition ids. No driver nature/cardinality. No invented compatible. Composer calls `buildCompleteSuccessor` with `productPath: "m2-core"` (same as `importVendorCatalog`).

Unit tests: `completeSuccessor.test.ts` builds this change against a tiny predecessor with `productPath: "m2-core"`, asserts subject kind, selector namespace, both property keys, required documentation, and carry-forward of predecessor members. Integration: real PG install as step 2.

## 5. JSON and DTS materialization

Per project, reviewed files already exist:

| Config-set role | Path | Ingest / bind owner |
| --- | --- | --- |
| `base` (sort 0) | `src/config/seed-sources/<project>/vendor-drivers.dts` | parameter-topology: DTS parse + revision membership |
| `overlay` (sort 1) | `src/config/seed-sources/<project>/charging-thermal.dts` | same; listed in `overlayOrder` |
| `misc` (sort 2) | `src/config/seed-sources/<project>/power-config.json` | membership via `ingestConfigRevision`; **bindings** via `registerCanonicalJsonSource`. Never `overlay` |

`materializeSeedSources` today refuses every non-DTS file with `deferredTo: "TD-124-json-project-source-semantics"`. That reason is wrong after T1.1. It also assigns `role: index === 0 ? "base" : "overlay"` and `overlayOrder: files.slice(1)`, which would make JSON an overlay and fail DTS resolve with `include-missing`.

Format split:

```text
dts, dtsi → upload + config-set membership (base/overlay) + ingestConfigRevision parse set
json     → upload + config-set membership (role misc, not overlay) + ingest member list
           + registerCanonicalJsonSource AFTER the placement barrier
yaml/yml/toml/env → UNSUPPORTED_FORMAT, deferredTo: "TD-124"
anything else     → existing VALIDATION_FAILED
```

### 5.1 Mixed revision membership (P1-1)

T1.1 `registerCanonicalJsonSource` reuses a `resolved`+`complete` DTS revision whose **member count equals every current config-set file** (DTS and JSON) and whose members match file id/version/role/sort_order/source_name. It will not manufacture a DTS revision when any current member is DTS. Proof: `canonicalJsonSource.integration.test.ts` mixed-set case — JSON role is `misc`, not `overlay`; register is `CONFLICT` until that mixed membership revision exists.

`ingestConfigRevision` already filters JSON out of the DTS parse set (`dtsMembers = members.filter(format !== "json")`) and still `insertConfigRevisionMembers(..., manifest.members)` for **all** members. That is the only existing way a mixed set gets a reusable revision.

Required ingest manifest per project:

- `entryFile`: `vendor-drivers.dts`
- `overlayOrder`: `[charging-thermal.dts]` only — JSON is not an overlay and is not in the DTS `files` map
- `members`: all three files, JSON with `role: "misc"`, `format: "json"`

JSON is therefore **passed to** `ingestConfigRevision` as a **member**, and **not passed** as a DTS parse/overlay input. B2-09 must say that distinction. Do not ingest DTS-only then add JSON afterwards: reuse would fail and the two JSON bindings would never exist.

### 5.2 Binding writes only after the placement barrier (P1-2)

`registerCanonicalJsonSource` is not a staging helper. It `stabilizeCanonicalBinding` and `writebackProtectedReference` immediately. Calling it in the per-project stage loop would write JSON bindings even when `csub_drv_sc8562` has no free driver-group, breaking B6’s zero-binding fail-closed.

Ordered procedure inside `materializeSeedSources`:

1. **Stage (no binding writes), all three projects:** archive-before-rebuild; upload three files; add config-set membership with the roles above; `ingestConfigRevision` mixed membership; `ensureSeedSubjectRegistrations` with DTS-observed subjects **plus** the explicit ConfigurationSchema subject (see §6).
2. **Placement barrier:** if any `missing-placement-module` (driver-group **or** ConfigurationSchema business), record `failed`, throw `SeedInitializationBlockedError`, **zero** bindings — no DTS sync, no JSON register.
3. **JSON preflight (no writes):** parse each `power-config.json` and resolve both mappings against the published snapshot. Any mapping/parse failure fails the run here with zero JSON bindings.
4. **DTS value sync** per project (existing `syncPublishedCatalogProjectValuesInTransaction`).
5. **JSON register** per project via `registerCanonicalJsonSource` with `createUserInvocation(auth)` (existing helper, not a forged system user) and `canAdminParameters`.
6. **Completed replay:** `(organization_id, seed_digest)` returns `already-complete` with no archive, no ingest, no JSON register, no curator, no binding writes. Owner `canonicalSeedInitializationDigest` in `seedInitialization/` hashes this exact UTF-8 payload (trailing newline, no timestamp) and prefixes `sha256:`:

```text
wiseeff.seed-initialization.digest.v1
organization=<organizationId>
targets=<atlas,aurora,nebula sorted by project id>
<projectId>/board.dts=<sha256 hex of exact UTF-8 file bytes>
<projectId>/charging-thermal.dts=<sha256 hex>
<projectId>/power-config.json=<sha256 hex>
```

Projects are emitted in the same sorted-id order as `targets`. File names are fixed; omitting `power-config.json` changes the digest, so a DTS-only payload cannot `already-complete` skip JSON. No other plan fields enter the digest (target identity is already those three ids).

A JSON mapping failure therefore cannot mark the run `completed`. JSON preflight-before-write means mapping errors produce zero JSON bindings. Unexpected register failure after preflight is the same class as a DTS sync failure on a later project: the run is not `completed`; it is not a B6 bypass.

### 5.3 JSON registration arguments

- `configurationSchemaId`: `wiseeff.power-config`
- `rootPointer`: `""` (document root; keys are literal dotted top-level keys)
- `mappings`: published definition ids for `charger.cv.limitMv` → JSON Pointer `/charger.cv.limitMv` and `battery.thermal.targetTempC` → `/battery.thermal.targetTempC` (leading slash required; dots are one pointer token)
- Manifest generator currently stores `realSource.locator` as `charger.cv.limitMv` without a slash; T1.3 updates the generator so recorded locators match runtime JSON Pointers
- Auth: same seed admin as DTS upload; `createUserInvocation(auth)` + `parameter:file-admin`

Per-project JSON values stay the reviewed file bytes (`atlas` 4300/36, `aurora` 4350/38, `nebula` 4380/40). Recommended values remain metadata on the compatibility record; current values come from the source file.

`realSeedSources()` in `canonicalBindingMaterialization.integration.test.ts` and `nodeTypeSubjectBinding.integration.test.ts` currently load only `vendor-drivers.dts`. T1.3 loads all three files with the roles above.

Seed YAML/TOML/ENV refusal evidence is a **seed** materialize test (extend `materialize.test.ts`), `deferredTo: "TD-124"`, not only `unsupportedFormat.test.ts`. After T1.3 the existing JSON materialize case (`seedDigest: "sha256:seed-materialize-json"`) must invert from refuse to the mixed-membership path.

## 6. Reviewed placement capacity and ConfigurationSchema registration

B6 is already implemented for **observed DTS subjects**: `ensureSeedSubjectRegistrations` picks an existing module of the required kind with no `subject_placements` row. Drivers need `driver-group`; node-types need `node-type`; ConfigurationSchema needs `business`. The unmodified reviewed DTS slice is one free **driver-group** short for `csub_drv_sc8562`.

That is not enough for JSON:

- `observedSubjectsWithDefinitions` calls `resolveObservedSubject` with DTS `compatible` + `nodeName` only. It never takes a ConfigurationSchema id. `charging-thermal.dts` has node `charging_core` with no `compatible`, so it registers the NodeType, not `wiseeff.power-config`.
- `registerCanonicalJsonSource` requires an active governed registration and placement (`CONFLICT`: “An active governed registration and placement are required.”).
- Measure-then-curate of a free `business` module only creates **capacity**. Without putting the ConfigurationSchema subject on the registration list, JSON still fail-closes and 124/372 is unreachable (P1-3).

T1.3 therefore:

1. **Curate capacity** as an explicit operator step, not inside `materializeSeedSources`.
2. **Register the published ConfigurationSchema subject explicitly** in the stage loop, unioned with DTS-observed subjects, **after** a free `business` module exists and **before** the placement barrier.

### 6.1 Curator

New owner `curateReviewedSeedPlacementCapacity`:

- Extra free `driver-group`: `createParameterModule` with `kind: "driver-group"`, `origin: "curated"`, **no** compatible mapping. Do **not** use `registerOrClaimDriver` (that API requires an exact compatible and a business parent, and always inserts compatible mappings — a fake `sc8562` compatible is forbidden).
- Extra free `business` module: `createParameterModule` `kind: "business"` **only if** measurement shows no free business module for ConfigurationSchema placement. If one already exists, do not create a spare.
- Seed admin’s real auth. Idempotent claim-or-skip: completed replay of the **initialization procedure** is a no-op for the curator too, not only for archive/ingest/JSON/bindings.
- Not invoked from `materializeSeedSources`. Tests replace the raw `INSERT` in `nodeTypeSubjectBinding.integration.test.ts` with this owner.

### 6.2 Explicit ConfigurationSchema on the B6 list

`ensureSeedSubjectRegistrations` input =

```text
observedSubjectsWithDefinitions(snapshot, dtsObservedRows)
  ∪ [{ subjectId: published wiseeff.power-config subject id, subjectKind: "configuration-schema" }]
```

The ConfigurationSchema id comes from the current installed snapshot (step 2 successor), never from a DTS node name and never invented. If the subject is missing from the snapshot, that is a publication failure, not a silent skip.

`materializeSeedSources` still fail-closes if a required module is missing after that union: `failed` + `missing-placement-module` (including the ConfigurationSchema subject) + zero bindings.

## 7. Authorization, locks, archive

Keep the existing path. Do not add a second initializer.

| Gate | Owner |
| --- | --- |
| Target identity | `resolveSeedInitializationPlan` — Atlas/Aurora/Nebula by stable id; `missing-project` / `organization-mismatch` / `identity-ambiguous` block |
| One-in-flight | 0148 advisory lock, fixed three-project scope, even across digests |
| Archive-before-rebuild | `captureProjectParameterPlane` + `assertProjectParameterPlaneArchived` |
| Parameter edit | `canEditParameters` on every target |
| JSON admin | `canAdminParameters` inside `registerCanonicalJsonSource`, invocation `createUserInvocation(auth)` |
| Catalog install | original approver of the candidate (T1.2: publisher-as-installer → `publication-capability-missing`) |
| Completed replay | `(organization_id, seed_digest)` → `{ status: "already-complete" }`, no archive, no ingest, no JSON register, no curator, no binding writes. Digest covers all three per-project files |

No direct SQL for bindings, occurrences, subjects, releases, or values in the production path. Fixture SQL remains test-only for unrelated table setup (org, users), not for Catalog identities.

## 8. Identity oracle and preservation

**Owner clarification, 2026-09-21:** input-order identity acceptance means replaying the same completed instance with permuted project/file inputs preserves all already allocated binding IDs and the oracle set. Successor digest determinism still applies to reordered change sets. Independently initialized databases are not required to allocate equal random source or binding IDs; the existing allocator and binding key remain unchanged. This is the owner's accepted local-closure boundary, not a new cross-database identity guarantee.

Before materialize, capture:

- Non-parameter relation counts and shared-object checksums (reuse archive v2 inventory where it already lists them)
- Custom-project ids outside `{atlas, aurora, nebula}`
- Current Catalog release pin

After successful materialize:

- Binding set per project equals the 124 natural keys below, 372 total
- Allocated binding IDs are stable across a second completed replay (no-op, same IDs)
- File order permutation of the three seed files does not change IDs
- Custom projects and non-parameter checksums match the before capture
- TD-124 items have no binding and no ProjectValue
- `charging_core` DTS occurrences bind to the NodeType definitions, not to a second compatibility subject
- JSON occurrences bind to `wiseeff.power-config` with JSON Pointer locators and `logicalNodeId: null`

Natural key (order-independent; this is the B2-11 oracle, not a shorter tuple):

```text
(projectId, occurrenceKind, locator, subjectKind, subjectCanonicalKey, propertyKey)
```

DTS locators stay DTS path/property (T1.1). JSON locators stay JSON Pointer with a leading slash (`/charger.cv.limitMv`, `/battery.thermal.targetTempC`). Do not compare against D1 slug definition ids; production frozen identity is the publication allocator.

Dangling overlay targets stay measured **29** unresolved `&label` targets and **37** missing `&name` refs per board (manifest `412-413`). They mint **no** canonical bindings. 120 board business occurrences remains the binding addend. Stub removal is T2.4.

A dedicated integration test on helper PG is the evidence owner. Historical “PLANNED 124” in the manifest remains labelled planned until this test is green; then the test, not the manifest prose, is the runtime fact.

## 9. Evidence and environment

Helper PostgreSQL: port **55438**, disposable database name distinct from T1.2’s `wiseeff_t12_capv4` (for example `wiseeff_t13_successor`). Never `wiseeff` on 5432, never `wiseeff_lane_849`.

Required checks (narrowest useful during edits; all of these before handoff):

- `completeSuccessor` unit including ConfigurationSchema
- capabilities budget 128 vs frozen 32
- `importVendorCatalog` full-tree successor (not budget failure)
- ConfigurationSchema PG install through real installer
- `canonicalJsonSource` still owns JSON
- materialize: JSON accepted, YAML refused
- B6 fail-closed without capacity
- identity oracle 124×3 with capacity
- replay no-op
- `seed:reconcile:check`
- affected `test:server` / `test:scripts`
- `npm run build` (TypeScript / shared types)
- `docs:check`, `git diff --check`

Not S1/S2, not Hosted, not target. Local initialization is not target execution.

## 10. Key decisions

1. **Honesty 127 / 119 / 124, not silent 125.** T1.2 added two vendor properties; they merge onto DTS locators rather than adding bindings.
2. **v4 budget 128, frozen v3 stays 32.** Completes vendor import without a new capability revision.
3. **Two successors.** Vendor import stays YAML-only; ConfigurationSchema is a distinct `buildCompleteSuccessor` from the installed vendor predecessor.
4. **One ConfigurationSchema `wiseeff.power-config`.** One JSON file, two literal dotted keys, one `registerCanonicalJsonSource` call per project. Composer lives next to `importVendorCatalog` and passes `productPath: "m2-core"`.
5. **JSON membership vs JSON bindings.** JSON is an ingest **member** with role `misc` so the mixed revision is reusable; JSON **bindings** still go through `registerCanonicalJsonSource` after the placement barrier. Remove the bogus TD-124-json refuse. YAML/TOML/ENV stay TD-124, proven by a seed materialize test.
6. **Placement is curated, not invented.** Extra free `driver-group` (and business if needed) via `createParameterModule` with no compatible mapping. B6 sees DTS-observed subjects **and** the explicit ConfigurationSchema subject, and still fail-closes.
7. **Original approver installs.** Same T1.2 authorization lesson.
8. **D1 slugs are not production seed IDs.** Oracle uses natural keys plus publication-allocated IDs.
9. **No migration, no 0151 rewrite, no lane writes, no commit in this todo.**

## 11. Implementation order (after Spec PASS)

1. Raise v4 `maxChangeSetOps`; pin allow-list digest; prove frozen v3 still 32.
2. ConfigurationSchema unit coverage on `buildCompleteSuccessor`.
3. Full `importVendorCatalog` successor on helper PG; authorize as original approver; install.
4. ConfigurationSchema successor from that predecessor; install.
5. Manifest merge/identity updates; `seed:reconcile`.
6. Placement curator through module owner; keep B6 fail-closed test.
7. Mixed membership as §5.1 (`misc` JSON member, DTS-only overlayOrder); load all three seed files; JSON register only after the placement barrier (§5.2).
8. Identity oracle 124/372, replay, preservation, order independence.
9. Independent Standards + Spec implementation review.
10. Bilingual acceptance receipt; stop for user confirmation.

## 12. Open questions

None that block design. ConfigurationSchema business-module shortage is a measurement, not a product question: if the unioned B6 list reports `missing-placement-module` for the ConfigurationSchema subject, curate one reviewed `business` module with `createParameterModule`; if a free business module already exists, do not create a spare. Spec P1-1/P1-2/P1-3 are closed in this revision (mixed `misc` membership, JSON register after barrier, explicit ConfigurationSchema on the registration list).

## PR Plan

This todo does not open a PR. The local candidate stays on `codex/849-853-t11-source-identity` with T1.1/T1.2 dirty work. A later authorized integration PR is T3.4b.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | v4 change-set budget 128 | `builder/capabilities.ts`, capability tests | Spec PASS |
| B | ConfigurationSchema builder proof + successor | `completeSuccessor.test.ts`, composer next to `importVendorCatalog` in `catalog-publication/import/`, installer PG | A |
| C | Full vendor import successor | `vendorAdapter` tests, vendorSuccessor integration | A |
| D | Mixed DTS+JSON `misc` membership, JSON register after barrier, explicit ConfigurationSchema on B6 list, placement curator | `materialize.ts`, `placementCapacity.ts`, seed helpers | B, C |
| E | Identity oracle 124/372 + B6 + replay | new/extended seedInitialization integration tests | D |
| F | Manifest honesty + bilingual receipts | `seedReconciliation.ts`, T1.3 acceptance docs | E |
