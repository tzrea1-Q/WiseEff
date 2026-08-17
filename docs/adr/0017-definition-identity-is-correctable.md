# Definition identity is correctable and `parameter_specs.id` is a surrogate

ADR-0013 made parameter definition identity `(owner scope, attribution_subject_id, property_key)`, and ADR-0014 restated it as the stable key a versioned definition hangs from. Both are about the right thing: identity must survive moving or renaming the module that merely *places* the subject. Neither ADR said identity could never be corrected — but the implementation made it so, in two compounding ways.

First, `parameter_specs.id` is a hash of the identity triple (`specIdentity.ts:139-144`), and so is `specification_key` (`:137-138`). Second, three find-or-create paths locate an existing definition by **re-deriving that hash**: DTS ingest of unmatched surface properties (`provisionalSurfaceBinding.ts:22`), review-time draft creation (`reviewApply.ts:483`), and overlay materialization (`driverSchemaOverlayService.ts:110`). Identity is therefore not merely stored — it is the address. Changing a stored identity field while the row keeps its old id makes those three paths conclude the definition does not exist and insert a duplicate, silently splitting one property across two rows.

The product consequence is that a mis-authored identity is uncorrectable. The editor renders both fields read-only (`ParameterSpecDetail.tsx:303`), there is no delete route, and deprecation is soft (ADR-0011), so the only recourse — deprecate and recreate — leaves the wrong row in the catalog permanently. The read-only hint compounds it by pointing the operator at 模块管理 (`:304-307`), which can change tree placement, mappings, and a binding's `module_id`, but holds no path that writes `parameter_specs.attribution_subject_id`. An operator who picked the wrong subject at creation is sent to look for a control that does not exist.

We decided that **the identity triple stays the business key, `parameter_specs.id` is demoted to a surrogate key, and correcting a mis-authored identity is an audited governance act**:

- Definitions are located by the identity triple, not by a hash of it. The hash survives only as the id generator for newly created rows.
- Uniqueness moves onto the triple itself as a database constraint, instead of being an emergent property of the derived `specification_key`.
- `attribution_subject_id` is correctable in any lifecycle state, because re-attribution changes where a definition is classified and claimed — never the bytes written to a device.
- `property_key` is correctable only while `referenceCount = 0`. Renaming a referenced property changes the property name written into every bound project's DTS, which is a semantic change to shipped configuration rather than a correction of a typo.
- `specification_key` remains derived and is rewritten in the same transaction, because roughly two dozen read sites still parse it.
- Both corrections are audited with the before and after identity, under new `spec-reattributed` and `spec-property-key-changed` actions.

### Supersedes (partial)

| Prior ADR | Superseded claim | Replacement |
| --- | --- | --- |
| ADR-0013 | Identity is stable in the sense that it can only ever be established at creation | Identity is stable against *placement* changes, and correctable as an explicit audited act when it was authored wrongly |
| ADR-0014 | `ParameterSpec` is a stable identity keyed by owner scope + `attribution_subject_id` + `property_key`, with the row id derived from that key | The triple remains the business key and uniqueness constraint; the row id is a surrogate that never changes, so no foreign key moves when identity is corrected |

## Considered Options

- **Keep identity immutable; correct by deprecate + recreate.** Rejected. There is no delete, so every correction leaves a permanent wrong row that still appears in audit, still resolves for parsing under ADR-0011, and still competes in search. The recreated definition also loses its version history and its bindings, which converts a typo into a project-level migration.
- **Keep `id` as the identity hash and cascade an id rewrite.** Rejected. Around a dozen tables carry `parameter_spec_id` — bindings, review tasks and decisions, policy targets, history entries, debugging parameters, node operations, overlay properties, cutover runs, versions, and `dts_property_specs`. A correct cascade is possible in one transaction, but audit rows reference the old id as `target_id` and would be left dangling, so the act would erase its own trail. Demoting the id costs one lookup change per find-or-create path and moves no foreign key at all.
- **Allow a `property_key` rename while references exist, behind a confirmation.** Rejected as a default. The rename propagates into generated DTS for every bound project, so the honest framing is a migration with per-project review, not a correction. Under ADR-0014 that belongs to staged cutover, not to an inline editor field. The zero-reference gate keeps the cheap case cheap without pretending the expensive case is cheap.
- **Freeze `specification_key` at its historical value.** Rejected. Module filtering (`semanticParameterReads.ts:58`), the migration matcher (`migration.ts:230-252`), semantic identity naming (`semanticParameterIdentityNames.ts:17-30`), the module repository (`parameter-modules/repository.ts:379-381`), and agent perception (`perceptionTools.ts:90-93`) all read it as fact rather than as history. A frozen key would make a corrected definition filter and match under its wrong identity.

## Consequences

- Migration `0090` adds a unique index on the identity triple. Because `property_key` lives on `dts_property_specs` (`0048_parameter_topology_schema_shadow.sql:53-64`) while `attribution_subject_id` lives on `parameter_specs`, the constraint needs the key reachable from one table; the existing `unique nulls not distinct (organization_id, source_kind, specification_key)` (`:15`) stays as the derived-key guard.
- The three find-or-create paths resolve by columns first and fall back to hash-generated ids only when inserting. This is a behavior-preserving refactor that must land and be verified on its own, because getting it wrong produces duplicate definitions silently rather than an error.
- `buildSubjectScopedManualSpecIds` keeps its name and formula but changes role: it is an id *generator*, no longer an id *resolver*. Existing rows keep their historical ids, which is why the surrogate framing is compatible with the data already in the catalog.
- Re-attribution does not move bindings. A binding's `module_id` continues to be resolved by mapping under ADR-0010, so `attributionModules` may keep reporting observed placement that disagrees with a freshly corrected subject until the next ingest — which is correct, because observed and declared attribution are different facts.
- Coverage claims and overlay properties reference the definition by id, so they follow the correction automatically instead of needing repair.

## Follow-up

- Referenced `property_key` rename is a staged **source-rewriting** cutover, not an inline field and not this route: [ADR-0034](0034-referenced-property-key-rename-is-a-source-cutover.md) (TD-117). Zero-reference rename stays here.
- Whether platform-global definitions accept identity correction only from `platform-admin`, in step with the deprecate/restore ownership split recorded in ADR-0011. **Settled in implementation:** the same ownership split as deprecate/restore (ID-R5).
- Retiring the remaining direct `specification_key` parsing so the column can eventually stop being a display source.
