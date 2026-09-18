# ADR-0046: Source occurrence identity spans DTS occurrences and software configuration instances

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md)

Date: 2026-09-15

## Status

Accepted as the source-identity contract for the parameter entry-point unification of [#849](https://github.com/tzrea1-Q/WiseEff/issues/849) — scope item 2, Implementation Decisions 3, 6, 7, 10 and 13, Testing Decision 6, and user stories 10, 11 and 21.

This record freezes the semantic contract that implementation must satisfy. It does **not** certify that any migration, relation, route, UI surface or threat-matrix row is complete or verified; certification comes from the executable matrix and its gates. At decision time, implementation was in flight on `feat/849-parameter-unification` (PR #858), which claimed ADR-0045; that historical numbering context is not current delivery status. Current T1.1 status is recorded in the [source-occurrence matrix](../exec-plans/active/849-inventory/source-occurrence-threat-matrix.md). Re-check ADR numbering immediately before merge, per [Fleet Coordination](../agents/fleet-coordination.md).

## Context

Canonical Binding identity is currently pinned to a DTS logical node:

- `parameter_catalog.project_parameter_bindings.logical_node_id` is `not null` (`server/migrations/0137_canonical_parameter_catalog_schema.sql:1139`), and three of its unique keys include it (`:1147`, `:1151`, `:1152-1156`).
- `parameter_catalog.parameter_observations` carries `logical_node_id text not null` (`:2995`) inside its own composite key (`:3006-3008`); `parameter_catalog.parameter_observation_matches` references that key (`:3214-3223`) and also carries a composite foreign key back into the Binding's seven-column match identity (`:3239-3244`).
- The immutability trigger `parameter_catalog.protect_binding_identity()` compares `logical_node_id` and friends on every update (`:1300-1324`).
- Current resolution is a migration-owned SQL function with enumerated grants: `parameter_catalog.resolve_current_binding(text, text, text)` (`server/migrations/0144_definition_replacement.sql:499`, grants at `:654-698`).
- The write path repeats the same identity: `StabilizeBindingCommand.logicalNodeId: string` (`server/modules/parameter-bindings/binding/types.ts:19`), a non-empty check that fails the command (`binding/service.ts:59-60`), `deriveBindingId()` hashing it (`binding/repositories.ts:42-63`), and `loadBindingByComposite()` / `insertBinding()` keyed on `(project_id, logical_node_id, definition_id)` (`:105-126`, `:143-148`).

The synchronous entry point is also a DTS observation model: `listObservedProperties()` reads `dts_occurrence_effects`, `dts_logical_node_revisions` and `dts_property_occurrences`, and passes the resulting `logicalNodeId` into `stabilizeCanonicalBinding()`. The gap is therefore not one `if` in `materialize.ts`.

Meanwhile JSON software configuration is already partially representable and explicitly deferred:

- `project_parameter_values.value_kind` admits `'json'` (`0137:1214`), and the two JSON seed sources carry scalar `number` values that the publication capability already accepts — so neither the value container nor the definition capability is the blocker.
- `server/modules/parameter-bindings/seedInitialization/materialize.ts:124-137` refuses every non-DTS file before semantic ingest with `UNSUPPORTED_FORMAT` and `deferredTo: TD-124-json-project-source-semantics`.

[#849](https://github.com/tzrea1-Q/WiseEff/issues/849) already requires the Binding boundary to distinguish a DTS occurrence from a software configuration instance, and to never merge multiple config-sets or instances merely because they share a Definition.

## Decision

1. **One source-occurrence identity layer.** Introduce a unified relation, `parameter_catalog.project_parameter_source_occurrences`, whose identity is at least organization + project + config-set + occurrence-kind + instance-id, and which additionally pins the immutable source-file identity and a format-specific locator. DTS occurrences reference the existing `logical_node_id`; ConfigurationSchema occurrences use a stable `configuration_instance_id`; the JSON locator is a strictly defined JSON-Pointer grammar — explicit `~0`/`~1` escaping and array-index rules — not an ambiguous dotted string.
2. **Binding uniqueness follows the occurrence.** `project_parameter_bindings` gains `source_occurrence_id`, and its project-scoped uniqueness becomes `(project_id, source_occurrence_id, definition_id)`. Because the occurrence already distinguishes config-set and instance, two instances that share a Definition can never collapse into one Binding.
3. **No nullable-and-flat DTS columns.** `logical_node_id` is not simply made nullable next to a set of JSON-only nullable columns; that would burden the Binding with a permanent DTS/JSON XOR and keep future formats in one table. Existing DTS bindings are backfilled in place, keep their current Binding IDs, and their identity is never re-derived. Only new JSON bindings derive identity from the occurrence.
4. **The revision pin is not Binding identity.** The immutable file-version / config-revision pin is a ProjectValue and source-revision concern. Making it part of the Binding key would mint a new Binding on every legitimate writeback.
5. **Historical capability revisions keep their meaning.** `catalog-capability/v1`, `/v2` and `/v3` are not reinterpreted: B1 is a project-side identity evolution. The runtime already retains the older revisions and accepts the current one, and that historical-compatibility policy stands.
6. **JSON writeback contract.** All non-target semantics must be preserved, and any serialization-only change (whitespace, key order) must appear in the reviewer-visible diff. Byte-for-byte JSON preservation is **not** promised, because serialization may legitimately reorder or reformat.
7. **Expand, verify, then switch.** Identity migration is schema-expand: add the occurrence relation and backfill DTS first, dual-read to equality, and only then switch uniqueness and queries. `logical_node_id` is not dropped until the full matrix passes. On failure, consumers revert to the old DTS projection — an applied migration is never rewritten.
8. **Completion is the full matrix.** B1 closes only against import preview → candidate/draft → review → apply → source reparse → export → reimport, for both DTS and JSON. "Preview + apply" is an internal milestone, not acceptance.

The seed equality oracle is unchanged by this decision: the reviewed fixture stays at exactly 124 bindings per project (120 board + 2 DTS compatibility + 2 JSON compatibility) and 372 across three projects. Real deployments with several config-sets and instances may legitimately exceed 124; 124 is the fixture's exact set, not a schema bound, and acceptance is equality rather than a lower bound.

## Accepted clarification — 2026-09-16

The user explicitly confirmed the following T1.1 decisions after independent design review:

- A JSON configuration instance receives a server-owned opaque identity at explicit import/registration, scoped to Organization, Project, config-set, immutable file ID, governed ConfigurationSchema and root/subtree JSON Pointer. Updates and reimport of the same proven instance preserve its identity; renaming the same file ID does too. Replacing the file ID, changing the config-set/model, or relocating the instance root creates a new instance with explicit mapping, never an automatic history/value transfer. Array indices alone cannot prove continuity after reordering. The unified source-occurrence relation owns the instance identity; parameter locators and revision pins remain distinct from its root locator.
- Unprovable historical Binding, observation or match provenance blocks the **whole identity migration**. Resolve historical file versions through their immutable file ID rather than the current-version pointer; missing, contradictory or ambiguous evidence yields a report and transactional abort. Do not fabricate provenance, delete or silently quarantine rows to continue. Old DTS schema/data remain usable. Quarantine-and-continue is not authorized.

These clarify identity lifetime and upgrade availability, not completed implementation, migration acceptance, or target/deletion authorization.

## Consequences

- **Shared SQL surface is wider than the Binding table.** `parameter_observations` is pinned to `logical_node_id`, `parameter_observation_matches` copies the binding match identity, and `resolve_current_binding` is a migration-owned function whose `EXECUTE` grants are enumerated. A same-signature overload cannot coexist, so the expand step adds a *new* function name with its own grants, and the ACL/role surface is expected to change.
- **Trigger ordering.** `protect_binding_identity()` blocks any update to the identity columns, so the backfill of a new column happens first; the function is extended to cover the occurrence only after the backfill, and before uniqueness is switched.
- **Ownership.** `parameter-files` owns JSON file parsing, locator, patch and writeback; the Binding layer consumes one source-occurrence contract. `parameter-topology/ingestService.ts` stays the DTS owner and must not become a combined DTS+JSON parser.
- **Frozen fingerprints.** The S2-SCH schema fingerprint and the canonical relation count change, and the role manifest and ACL fingerprints plausibly change with the new function grants. The catalog capability allow-list digest, `catalog-capability/v3` and the compiler contract goldens must **not** change for B1; if they do, that is an anomaly to explain rather than a detail to update.
- **Specification before implementation.** This change is R3. A threat matrix and an independent Spec review precede implementation, not follow it.

### Decisions recorded with this ADR

Two further decisions from the same review are recorded here because they bound the same parameter plane; they are not architecture-level identity decisions.

**Value-schema capability.** Publish one `catalog-capability/v4` that covers recursive/nested arrays, `minItems`/`maxItems`, description-only mixed item schemas and array-level `description`. Cardinality may only come from authoritative vendor metadata, never from observed data: the `gpio_int` cell count is `constraints.cells: 3` declared in `schemas/dts/vendor/wiseeff/mt-mt5788.yaml` and `schemas/dts/vendor/wiseeff/sc8562.yaml`, whereas the 3 rows of the complex DTS fixtures are observations and must not become a schema bound. Column semantics for those fixtures require reviewed source evidence before they can become invariants; flattening a cell matrix is not acceptable. The formal subject for `charging_core` is a reviewed NodeType publication decision, not a name-similarity match against the existing `huawei,charging_core` Driver. `v1`/`v2`/`v3` artifacts keep their meaning, and a v3 consumer must reject v4 content before install rather than tolerate it.

**Seed completion is fail-closed.** Seed initialization must not report `completed` while any required subject has no free placement module of the correct kind. `seed_initialization_runs.status` already admits `'failed'` and the run already carries a `blocked` array (`server/migrations/0148_seed_initialization_runs.sql:15,18`), so this needs no migration — only a subject-level blocker DTO and the completion condition. Automatically provisioning a user-visible `business` module is rejected: it would widen trusted-system authority from data initialization into information-architecture change, and a ConfigurationSchema subject has no source-derived topology that could justify a taxonomy position. Operator-curated remediation is required instead.

## Required verification owners

- **Identity and migration:** the canonical catalog schema owner and the Binding repository owner, against a real lane PostgreSQL, including the backfill's non-change of historical DTS binding IDs.
- **JSON source semantics:** the parameter-files owner, covering locator grammar, revision pinning, stale-revision CAS, writeback preservation and export/reimport locator stability.
- **Capability v4:** the catalog-publication builder owner, covering recursive depth and container budgets, fail-closed unknown keywords, and exact reviewed `gpio_int` output.
- **Seed fail-closed:** the seed-initialization owner, covering the blocker journal and a second completed replay being a no-op.
- **Independent review:** Standards and Spec review the threat matrix before implementation, and the resulting release and seed fixtures before any acceptance claim.
