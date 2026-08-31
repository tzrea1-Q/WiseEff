# Parameter catalog contract and consumer inventory

**Status:** research note for Issue #669

**Tree inspected:** `e895bedefa90c2d00c0dcc9e1f6e7496c060534d`

**Scope:** current repository contracts and consumers only; no live-database or
out-of-repository client inspection

## Decision summary

A replacement must preserve the **semantic catalog**, not the current table
layout. The durable contract is an owner-scoped, subject-scoped and
property-scoped definition with version-pinned historical semantic
interpretation; a deterministic effective projection; stable opaque definition
and binding identifiers; fail-closed recognition; and tenant-scoped, audited
governance. The current dual-written lifecycle fields, denormalized identity
columns, legacy unlinked staging, physical identifier formulas, flat-storage
adapter and several "latest version" lookups are implementation details or known
divergences, not behavior to clone. The `module_id` uniqueness suffix is a
current compatibility duty whose removal is only a candidate cleanup pending
populated-data and retained-ID proof.
([ADR-0039](../adr/0039-effective-driver-parameter-catalog.md),
[ADR-0014](../adr/0014-parameter-definitions-are-versioned-subjects.md),
[ADR-0017](../adr/0017-definition-identity-is-correctable.md),
[ADR-0029](../adr/0029-parameter-platform-primitives-live-in-a-standalone-kernel-module.md))

## Method and confidence boundary

This inventory traces the schema catalog into database materialization, then
follows production SQL callers and route/frontend consumers. It uses only
tracked repository sources: ADRs and product/API/domain docs, SQL migrations,
server and frontend production code, runbooks, scripts and contract manifests.
Tests were used only to locate production seams; they are not evidence of live
production data. The resulting contract map is current-tree evidence, not proof
that a deployed database has completed every repair or that an external client
does not depend on an undocumented response detail.

## 1. Authoritative schema inputs and identity

### Source hierarchy

1. `schemas/dts/catalog.json` is the tracked allow-list and pins each vendor
   schema plus its content hash and upstream DTS/toolchain provenance.
   `schemaLoader.ts` loads catalog-listed YAML and reachable common references;
   it emits typed driver/property definitions rather than treating every file in
   the directory as authoritative.
   ([catalog](../../schemas/dts/catalog.json),
   [loader](../../server/modules/parameter-specs/schemaLoader.ts))
2. Active platform and organization overlays are the only database-owned schema
   additions. The registry cache composes the pinned root with active overlays
   and keys the result by catalog hash plus overlay digest. Organization
   promotion copies a definition into the platform tier; it does not silently
   re-own the original row.
   ([registry cache](../../server/modules/parameter-specs/schemaRegistryCache.ts),
   [overlay service](../../server/modules/parameter-specs/driverSchemaOverlayService.ts),
   [overlay repository](../../server/modules/parameter-specs/driverSchemaOverlayRepository.ts))
3. Matching preserves an explicit tier order: Linux base, then a unique vendor
   add/narrow match, then reviewed manual platform/organization gap-fill. A
   same-tier tie stays ambiguous, and a single property hit cannot disambiguate
   an ambiguous driver.
   ([matcher](../../server/modules/parameter-specs/matcher.ts),
   [overlay decisions](../adr/0008-platform-authored-parsing-is-an-org-scoped-overlay.md))
4. A runtime observation is evidence, not schema authority. Topology ingestion
   may recognize a property only through a complete effective definition; an
   unknown or ambiguous observation stays as occurrence/review evidence.
   Historical bindings must not make a new occurrence recognized.
   ([effective-definition seam](../../server/modules/parameter-specs/effectiveDefinitionService.ts),
   [ingest service](../../server/modules/parameter-topology/ingestService.ts),
   [ADR-0039](../adr/0039-effective-driver-parameter-catalog.md))

### Durable identity and effective-selection rules

The business identity of a property definition is:

```text
owner scope (platform or organization)
  + canonical AttributionSubject.source_key
  + property_key
```

`parameter_specs.id` is an opaque stable surrogate for that identity. Identity
corrections update the row in place because bindings, debug operations,
knowledge references, reviews, audits and history retain that ID. A replacement
may use a different physical key, but it must preserve or deterministically map
every externally retained surrogate.
([ADR-0017](../adr/0017-definition-identity-is-correctable.md),
[identity migration](../../server/migrations/0090_parameter_spec_identity_surrogate.sql))

An ordinary effective result requires all of the following:

- one active definition and one active current version;
- a canonical subject whose owner matches the definition owner;
- a DTS property whose driver schema carries the same subject;
- for organization driver schemas, exactly one organization placement for the
  subject; and
- deterministic precedence: organization active override, otherwise platform
  active definition.

Zero candidates means unknown; multiple same-tier winners are a governance
blocker, never a tie resolved by row order. Draft, deprecated and shadowed rows
do not enter the default projection. They remain available only through an
explicit governance view for repair/history.
([ADR-0039](../adr/0039-effective-driver-parameter-catalog.md),
[effective-definition service](../../server/modules/parameter-specs/effectiveDefinitionService.ts),
[verification](../../server/modules/parameter-specs/definitionVerification.ts))

Structural DTS keys are topology, not configurable parameter definitions; the
guard must survive even if a replacement changes its internal allow/deny
representation.
([ADR-0003](../adr/0003-node-enablement-is-not-a-parameter.md),
[structural guard](../../server/modules/parameter-specs/structuralPropertyGuard.ts))

## 2. Relational state and invariants

| State | Current tables | Durable meaning | Required invariants |
| --- | --- | --- | --- |
| Definition | `parameter_specs`, `parameter_spec_versions` | Stable definition identity plus versioned semantic content | owner/subject/property uniqueness; exactly one active version; semantic edits mint a successor while documentation-class fields may update current content in place; historical semantic interpretation remains pinned |
| Driver schema | `driver_schemas`, `driver_schema_versions`, `dts_property_specs` | Subject-bearing schema root and property shape derived from an authoritative schema source | root/version/property ownership and subject alignment; property version belongs to its definition |
| Canonical subject | `attribution_subjects`, `driver_registrations`, `node_type_definitions` | Canonical schema subject, distinct from observed module navigation | unique owner-scoped source key; subject kind and backing row agree |
| Declared placement | `driver_registration_placements` | Organization placement of a driver subject under the registry/module taxonomy | one subject placement and one driver group/module placement per organization |
| Observation | `dts_config_revisions`, `dts_logical_nodes`, `dts_logical_node_revisions`, `dts_node_occurrences`, `dts_property_occurrences`, `dts_occurrence_effects` | What a particular source revision contained | does not create identity or declared placement; unknown/ambiguous evidence is retained |
| Project binding | `project_parameter_bindings` | Current durable project/logical-node/definition/module association; binding ID is the value-workbench identity | tenant ownership; definition is recognized; module is navigation/placement, but the physical four-part uniqueness remains compatible until populated evidence supports a safe simplification |
| Project value | `project_parameter_binding_revisions` | Immutable value fact at a configuration revision, interpreted by an exact definition version | pinned version belongs to the binding's definition; typed/canonical/raw value and policy result remain historical |
| Governance | review tasks, cutover jobs/items, reconciliation runs/items, policy targets | Explicit lifecycle repair and cutover state | deterministic, resumable, tenant-scoped and auditable; no guessed repair |

The original shadow schema and subsequent migrations are the executable source
for this graph.
([0048](../../server/migrations/0048_parameter_topology_schema_shadow.sql),
[0082](../../server/migrations/0082_attribution_subjects.sql),
[0083](../../server/migrations/0083_parameter_spec_versioning.sql),
[0118](../../server/migrations/0118_effective_driver_parameter_catalog.sql),
[0126](../../server/migrations/0126_guard_binding_spec_version_owner.sql),
[ADR-0032](../adr/0032-semantic-edits-on-active-definitions-mint-a-successor.md))

The active-version and subject/schema/property invariants are enforced in SQL,
not merely in the service. This matters for a replacement: keeping only a
well-behaved HTTP writer while dropping database- or transaction-level
protection would weaken the contract for scripts, migrations and concurrent
governance actions.
([0119](../../server/migrations/0119_effective_driver_parameter_catalog_contract.sql),
[0120](../../server/migrations/0120_effective_driver_parameter_catalog_finalize.sql),
[0123](../../server/migrations/0123_harden_node_type_identity.sql),
[0124](../../server/migrations/0124_harden_driver_identity_owner.sql),
[0125](../../server/migrations/0125_harden_driver_schema_owner_scope.sql))

## 3. Writer inventory

| Owner/seam | Writes | Contract significance |
| --- | --- | --- |
| Tracked-schema materializer (`parameter-specs/repository.ts`) | matched specs, versions, driver schemas/versions and DTS property rows | Materializes authoritative pinned schema input; it must converge on semantic identity rather than invent a new row per observation. |
| Definition governance service | draft creation, documentation update, activate/deprecate/restore, reattribution, property-key correction and version/property cutovers | Primary human-governed mutation API; lifecycle changes and identity corrections are audited and preserve the stable spec ID. |
| Overlay service/repository/materializer | organization/platform driver schema overlays, their versions/properties and promotion/retirement | Only supported DB-owned schema-authoring path; activation is separate from draft materialization. |
| Effective-definition binding seam | recognized project bindings | `createRecognizedBinding` is the canonical binding-creation seam; callers must first resolve a single effective definition. |
| Topology ingest/binding/edit/migration services | observations, review evidence, bindings, binding revisions, migration tips and structured edits | Observations remain evidence; incomplete identity/placement cannot become a recognized binding; edit/migration paths must retain exact tip/version/source locks. |
| Review apply and cutover/reconciliation services | reviewed definitions, successor versions, repaired identity/placement and current tips | Repairs are explicit, resumable and history-preserving; they do not delete or rewrite historical binding revisions. |
| Module repository and placement services | attribution modules, recomputed binding modules and driver-registration placements | Navigation taxonomy and declared placement are governed separately from observed topology. |
| Import/project lifecycle services | import batches and project-owned catalog/binding cleanup | Imports enter project value workflows rather than author schema; project deletion must clean tenant-owned references without damaging platform definitions. |
| Maintenance scripts | schema seed/materialization, verification and reconciliation invocations | Operational writers share the same invariants and must remain gated; they are not an alternative business API. |

Sources:
[definition repository](../../server/modules/parameter-specs/repository.ts),
[governance service](../../server/modules/parameter-specs/service.ts),
[overlay service](../../server/modules/parameter-specs/driverSchemaOverlayService.ts),
[review apply](../../server/modules/parameter-specs/reviewApply.ts),
[property-key cutover](../../server/modules/parameter-specs/propertyKeyCutover.ts),
[reconciliation](../../server/modules/parameter-specs/definitionReconciliation.ts),
[binding seam](../../server/modules/parameter-specs/effectiveDefinitionService.ts),
[topology ingest](../../server/modules/parameter-topology/ingestService.ts),
[binding service](../../server/modules/parameter-topology/bindingService.ts),
[edit service](../../server/modules/parameter-topology/editService.ts),
[topology migration](../../server/modules/parameter-topology/migration.ts),
[module repository](../../server/modules/parameter-modules/repository.ts),
[placement service](../../server/modules/parameter-modules/driverRegistrationPlacement.ts),
[import writer](../../server/modules/parameters/importBatchRepository.ts),
[project cleanup](../../server/modules/projects/repository.ts).

`provisionalSurfaceBinding.ts` is present but has no production caller on this
tree; only tests import it. Its ability to draft a spec for an unmatched surface
is legacy/dead implementation, directly contrary to the accepted fail-closed
recognition rule. It is not a compatibility obligation.
([provisional seam](../../server/modules/parameter-topology/provisionalSurfaceBinding.ts),
[accepted ingest rule](../../server/modules/parameter-topology/ingestService.ts),
[ADR-0039](../adr/0039-effective-driver-parameter-catalog.md))

## 4. Reader and consumer inventory

| Consumer | What it consumes | Compatibility obligation and owner |
| --- | --- | --- |
| Catalog/governance HTTP | effective projection by default; explicit raw/history governance projection; schema overlay and lifecycle/cutover operations | Preserve effective-default semantics, explicit governance scope, tenant isolation and route/schema compatibility. Owner: parameter-specs + contracts. |
| Parameter topology HTTP | schema root, modules, occurrences, effective specs, review tasks, bindings and history | Preserve separation of declared placement, observation and definition identity. Owner: parameter-topology. |
| Project parameter workbench | binding IDs, binding tips, pinned versions, drafts/submission rounds/change requests, compare/history/import/init/dashboard | Preserve binding IDs and exact-version interpretation; migrate tips and all historical FKs atomically. Owner: parameters + parameter-drafts. |
| File sync/writeback | logical locator/property occurrence, binding and source occurrence | Preserve deterministic source occurrence and raw-format provenance; a definition alone is insufficient for writeback. Owner: files + parameter-topology. |
| Agent tools | parameter search citations and approved draft/submit mutation by binding ID | Preserve stable binding citations, server-owned actor/execution provenance and the normal draft/review policy path. Owner: agent + parameters. |
| Log analysis | tenant-scoped related-parameter context by binding/definition | Preserve tenant filtering and stable related-parameter references. Owner: logs analyzer. |
| Debugging | optional spec/binding links on debugging parameters and node operations | Debug values remain operational overlays and never mutate the definition library; migrate retained links. Owner: debugging. |
| DTS reload | candidates from bindings, pinned value shape, debug mapping, run targets/snapshots, draft-only promotion | Preserve spec/binding IDs used by stored runs; prefer exact binding mapping; promotion creates drafts and does not write catalog values directly. Owner: dts-reload. |
| Knowledge | durable references to `parameter_specs.id` and display of lifecycle metadata | Preserve or map referenced surrogate IDs; deprecation must not orphan retained knowledge. Owner: knowledge. |
| Module registry | canonical subject and declared placement plus observed navigation | Preserve authoritative placement while allowing observed modules to remain navigation evidence. Owner: parameter-modules. |
| Release/operations | catalog-only and full verification, reconciliation ledger, self-hosted candidate checks | Replacement cannot receive traffic until populated-data reconciliation and checks pass. Owner: parameter-specs + operations. |

Primary sources:
[semantic reads](../../server/modules/parameters/semanticParameterReads.ts),
[version selection](../../server/modules/parameters/specVersionSelection.ts),
[file identity](../../server/modules/parameter-files/syncIdentity.ts),
[writeback](../../server/modules/parameter-files/writebackService.ts),
[Agent perception](../../server/modules/agent/tools/perceptionTools.ts),
[log-analysis DB tools](../../server/modules/logs/analyzer/tools/dbToolBackends.ts),
[debugging repository](../../server/modules/debugging/repository.ts),
[DTS reload repository](../../server/modules/dts-reload/repository.ts),
[DTS reload promotion](../../server/modules/dts-reload/promote.ts),
[knowledge references](../../server/modules/knowledge/parameterReferences.ts).

### Direct production source census

The following is the complete non-test current-tree census of production files
that name a core catalog/subject/binding table directly. Files that consume the
same concepts only through services or ports are covered by the consumer matrix
above.

- [parameter-specs](../../server/modules/parameter-specs/):
  `definitionReconciliation.ts`, `definitionVerification.ts`,
  `driverSchemaOverlayRepository.ts`, `driverSchemaOverlayService.ts`,
  `effectiveDefinition.ts`, `effectiveDefinitionService.ts`,
  `propertyKeyCutover.ts`, `repository.ts`, `reviewApply.ts`, `service.ts`, and
  `structuralPropertyGuard.ts`;
- [parameter-topology](../../server/modules/parameter-topology/):
  `bindingService.ts`, `editService.ts`, `migration.ts`,
  `provisionalSurfaceBinding.ts`, `service.ts`, and `writeLock.ts`;
- [parameter-modules](../../server/modules/parameter-modules/):
  `attributionSubjectRepository.ts`, `driverPlacement.ts`,
  `driverRegistrationPlacement.ts`, `ensureAttributionModuleForBinding.ts`,
  `repository.ts`, `resolveAttributionSubject.ts`, and `service.ts`;
- [parameters](../../server/modules/parameters/): `repository.ts`, `service.ts`,
  `semanticParameterReads.ts`, `semanticParameterIdentityNames.ts`,
  `specVersionSelection.ts`, `fileSyncConflictRepository.ts`,
  `importBatchRepository.ts`, `initializationRepository.ts`,
  `parameterModuleRepository.ts`, `reviewWorkflowRepository.ts`, and
  `dashboard/hotspotRepository.ts`;
- [parameter-drafts](../../server/modules/parameter-drafts/repository.ts),
  [parameter-files sync](../../server/modules/parameter-files/syncIdentity.ts),
  [parameter-files writeback](../../server/modules/parameter-files/writebackService.ts),
  and [project cleanup](../../server/modules/projects/repository.ts);
- [Agent perception](../../server/modules/agent/tools/perceptionTools.ts),
  [log-analysis DB tools](../../server/modules/logs/analyzer/tools/dbToolBackends.ts),
  [DTS-reload repository](../../server/modules/dts-reload/repository.ts),
  [DTS-reload behavioural verification](../../server/modules/dts-reload/behaviouralVerify.ts),
  and [knowledge](../../server/modules/knowledge/) reference/routes/service/schema
  files; and
- [contract schema registry](../../server/modules/contracts/schemaRegistry.ts),
  which names the types for HTTP/OpenAPI rather than acting as a data writer.

### Project-value and historical interpretation contract

Definitions and project values are different aggregates. A binding revision
pins `parameter_spec_version_id`, and current workbench reads interpret its value
through that pinned version. If no explicit binding/change-request pin exists,
the selection helper may rank eligible versions, but it must never silently
reinterpret a historical value using a newly activated definition version.
([ADR-0014](../adr/0014-parameter-definitions-are-versioned-subjects.md),
[version selection](../../server/modules/parameters/specVersionSelection.ts),
[semantic reads](../../server/modules/parameters/semanticParameterReads.ts),
[binding/version guard](../../server/migrations/0126_guard_binding_spec_version_owner.sql))

The current binding service and database treat project × logical node ×
definition × module as the durable physical association. ADR-0010 records
removing `module_id` from uniqueness as separable cleanup and found it redundant
in one simulation, but that does not waive present compatibility. A replacement
must preserve module behavior and existing binding IDs first; it may simplify
the key only after populated-data proof and an explicit ID-reconciliation
decision.
([module migration](../../server/migrations/0067_binding_module_id.sql),
[binding service](../../server/modules/parameter-topology/bindingService.ts),
[ADR-0010](../adr/0010-attribution-tree-is-taxonomy-not-topology.md),
[domain model](../design-docs/domain-model.md))

### Debug and reload boundaries

`debug_nodes` is the current product runtime catalog. `debugging_parameters` and
its node bindings remain only for legacy runtime/history interpretation; the old
Admin parameter family is retired, and old debugging reload-target/parameter-
reload routes are offline. Neither catalog's runtime values become library
definitions. DTS-reload candidate discovery is binding-based; its value shape
comes from the tip revision's pinned definition version. Exact binding mapping
wins over a definition fallback. Behavioural verification still carries a
legacy debug-to-binding bridge, so a replacement must migrate or explicitly
retire that bridge. Promotion creates ordinary parameter drafts, keeping review
and write authorization outside the reload engine.
([ADR-0019](../adr/0019-debug-values-never-mutate-the-parameter-library.md),
[API contract](../design-docs/api-contract.md),
[debug-node catalog](../../server/modules/debugging/catalogSplitRepository.ts),
[reload repository](../../server/modules/dts-reload/repository.ts),
[value shape](../../server/modules/dts-reload/valueShape.ts),
[debug overlay](../../server/modules/dts-reload/debugOverlay.ts),
[behavioural verification](../../server/modules/dts-reload/behaviouralVerify.ts),
[promotion](../../server/modules/dts-reload/promote.ts),
[ADR-0035](../adr/0035-debug-value-promotion-stages-drafts.md))

## 5. HTTP, OpenAPI and frontend surfaces

The contract exposes an effective catalog by default and requires explicit
governance scope for raw lifecycle/history access. The API also exposes
definition lifecycle, review, identity/version/property-key cutover, schema
overlay/promotion, module/driver registry, topology, binding/history and project
value workflows. Route-manifest and schema-registry checks are the mechanical
source for registered HTTP/OpenAPI compatibility; narrative API docs explain the
projection semantics.
([API contract](../design-docs/api-contract.md),
[route manifest](../../server/modules/contracts/routeManifest.ts),
[schema registry](../../server/modules/contracts/schemaRegistry.ts))

The frontend depends on the `ParameterTopologyRepository` port rather than SQL.
Its HTTP and mock adapters must remain semantically aligned. The parameter-admin
URL defaults to the effective view and preserves an explicit governance query;
the governance panel consumes both the effective catalog and repair/history
detail. Domain DTOs expose scope/override/declared-placement/observation state.
([port](../../src/application/ports/ParameterTopologyRepository.ts),
[HTTP adapter](../../src/infrastructure/http/parameterTopologyClient.ts),
[mock adapter](../../src/infrastructure/mock/mockParameterTopologyRepository.ts),
[admin URL](../../src/application/parameters/parameterAdminUrl.ts),
[governance panel](../../src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx),
[domain types](../../src/domain/parameter-topology/types.ts))

The compatibility surface is wider than the v2 catalog adapter. The v1
parameter client still serves project workflows; dedicated debug and DTS-reload
clients serve their route families; and the route assembly exposes
`/parameters`, `/parameter-review`, `/parameter-admin`, `/node-debugging`,
`/dts-reload` and `/debugging-admin`. Knowledge authoring also selects retained
spec references. A replacement plan must name each as a migrated, adapted or
intentionally retired consumer rather than relying on the route manifest alone.
([v1 parameter client](../../src/infrastructure/http/parameterClient.ts),
[debug client](../../src/infrastructure/http/debuggingClient.ts),
[reload client](../../src/infrastructure/http/dtsReloadClient.ts),
[app configuration](../../src/appConfig.ts),
[route assembly](../../src/app/routes.tsx),
[knowledge reference UI](../../src/features/knowledge/KnowledgeParameterReferenceChips.tsx))

The module tree currently also uses observed `attributionModules` for UI
navigation. That is a consumer presentation rule, not evidence that an observed
module may define identity or declared placement.
([module-tree builder](../../src/application/parameters/buildParameterSpecModuleTree.ts),
[ADR-0039](../adr/0039-effective-driver-parameter-catalog.md))

## 6. Stable IDs, audit and trusted execution

The following identifiers have retained meaning and therefore require explicit
migration or compatibility mapping:

- `parameter_specs.id` in bindings, versions, driver/property rows, reviews,
  debug operations, knowledge references, cutover jobs and audit subject links;
- `project_parameter_bindings.id` in binding revisions, project workflows,
  Agent citations, file writeback, debug mappings and DTS-reload runs/snapshots;
- `parameter_spec_versions.id` pinned by binding revisions and change workflows;
- canonical subject and placement IDs where governance/reconciliation history
  refers to the exact object.

Opaque ID stability is the contract; current prefixes/hash formulas are not.
([ADR-0017](../adr/0017-definition-identity-is-correctable.md),
[spec identity helper](../../server/modules/parameter-specs/specIdentity.ts),
[knowledge references](../../server/modules/knowledge/parameterReferences.ts),
[base schema](../../server/migrations/0048_parameter_topology_schema_shadow.sql))

Definition creation, lifecycle changes, identity corrections, version/property
cutovers, review resolution and reconciliation are governance mutations and must
emit durable audit in the same transaction boundary. Agent/System activity must
carry trusted, server-owned principal and execution provenance; a replacement
must not collapse it back into a caller-supplied user ID. Historical legacy rows
are admitted only through explicit compatibility constraints and must not define
the forward write contract.
([audit service](../../server/modules/parameter-specs/service.ts),
[atomic audit ADR](../adr/0027-audit-events-commit-with-their-domain-write.md),
[trusted provenance ADR](../adr/0038-trusted-invocation-provenance-separates-principal-and-initiator.md),
[0129](../../server/migrations/0129_parameter_execution_provenance.sql),
[0131](../../server/migrations/0131_parameter_governance_execution_identity.sql),
[0135](../../server/migrations/0135_parameter_execution_identity_discriminated_constraints.sql))

## 7. Migration and release gates

The effective-catalog migration chain is itself a compatibility ledger:

- `0118` introduces subject-bearing schemas, declared driver placement and
  persisted reconciliation runs/items;
- `0119`–`0120` enforce effective identity, owner/schema/property alignment and
  one active version;
- `0121` permits a transient legacy two-step staging sequence without allowing
  that incomplete state into the effective projection;
- `0122`–`0126` correct and harden node-type, blank-name, owner, subject,
  property/schema and binding-version ownership;
- `0127`–`0128` repair populated data deterministically and preserve history;
- `0129`–`0136` add trusted execution provenance and historical compatibility
  constraints across parameter-sensitive writes.

([0118](../../server/migrations/0118_effective_driver_parameter_catalog.sql),
[0121](../../server/migrations/0121_effective_driver_parameter_catalog_legacy_write_compat.sql),
[0122](../../server/migrations/0122_classify_nodename_driver_subjects.sql),
[0127](../../server/migrations/0127_repair_populated_effective_driver_catalog.sql),
[0128](../../server/migrations/0128_repair_driver_placement_subject_cutover.sql),
[0136](../../server/migrations/0136_parameter_execution_principal_deleted_marker.sql))

Release is fail closed. The reconciliation runbook requires snapshot/write
freeze, migration, dry-run review, approved per-organization apply and a final
full check. A non-zero/blocker result stops release; destructive cleanup and
guessed identity are forbidden. Catalog-only verification covers the effective
driver-definition subset used by self-hosted candidate readiness; the full check
also covers node-type and project-binding-tip integrity. Toolchain-backed
topology publication runs revision-scoped verification before accepting a
configuration revision.
([reconciliation runbook](../runbooks/effective-driver-parameter-catalog-reconciliation.md),
[verification](../../server/modules/parameter-specs/definitionVerification.ts),
[topology service](../../server/modules/parameter-topology/service.ts),
[self-hosted runtime](../runbooks/self-hosted-runtime.md))

Any replacement release therefore needs, at minimum:

1. a populated-data classifier and deterministic reconciliation plan;
2. stable-ID/FK mapping for every retained consumer above;
3. dual-write or bounded freeze/cutover with no interval where incomplete rows
   appear effective;
4. catalog-only and full independent checks against the candidate data;
5. route/OpenAPI contract checks plus focused PostgreSQL behavior coverage; and
6. rollback that restores both data and traffic routing without deleting audit
   or historical value facts.

## 8. Business contracts versus implementation accidents

| Preserve as business contract | Do not clone as a compatibility contract | Replacement action/owner |
| --- | --- | --- |
| Owner + canonical subject + property identity | `property_key` denormalized on `parameter_specs` | Choose one canonical representation; migration owner maps and verifies identity. |
| Stable opaque spec/binding/version references | Current ID prefix/hash formulas | Preserve IDs or publish a complete immutable mapping; catalog + data-migration owners. |
| Pinned historical semantic interpretation; semantic edits mint successors | Documentation-class in-place edits, plus duplicated lifecycle/version fields and duplicated property content used by the `0083` dual-write bridge | Preserve semantic pins while allowing documented non-semantic correction; normalize storage only after verifying every historical pin. |
| One active complete definition/version and deterministic org-over-platform precedence | Physical table split and SQL trigger names | Re-enforce invariants transactionally; catalog owner. |
| Observation never grants authority | `provisionalSurfaceBinding.ts` unmatched draft creation (no production caller) | Retire; topology owner keeps review evidence only. |
| Incomplete staging never appears effective | `0121` unlinked active-DTS staging for the legacy two-step importer | Retire with the old writer or contain behind the same fail-closed projection; migration owner. |
| Current project/logical-node/definition/module binding and stable binding ID | `module_id` as a *candidate* removable uniqueness suffix, not a settled accident | Treat the four-part key as compatible now; simplify only after populated proof, duplicate/ID reconciliation and an explicit decision by parameters + module owners. |
| Explicit binding/change-request version pins | "latest version by numeric version" lookups in Agent perception, log-analysis context and write-lock schema-default loading | Route through the canonical selection seam and add migration tests; Agent/logs/topology owners. |
| Effective default and explicit governance view | Raw `specification_key` parsing and `driverModule` display fallbacks | Preserve DTO meaning during transition, then remove only with route/frontend migration. |
| Semantic storage as production target | Legacy flat `parameter_definitions` / `project_parameter_values` adapter and boot-time mode bridge | Keep only until the explicit semantic cutover gate; parameters owner. |
| Audited trusted User/Agent/System mutations | Legacy rows admitted by `NOT VALID`/compatibility constraints | Preserve old audit readability, disallow new ambiguous writes; security + domain owners. |

The observed "latest version" divergences are in
[`perceptionTools.ts`](../../server/modules/agent/tools/perceptionTools.ts),
[`dbToolBackends.ts`](../../server/modules/logs/analyzer/tools/dbToolBackends.ts)
and [`writeLock.ts`](../../server/modules/parameter-topology/writeLock.ts).
They conflict with the explicit pin-first policy in
[`specVersionSelection.ts`](../../server/modules/parameters/specVersionSelection.ts).
A replacement must preserve the pin-first policy and either repair or adapt
these consumers; reproducing row-order behavior would turn an accident into a
new contract.

The legacy/semantic storage bridge is explicitly transitional and is removed
only through a gated cutover, rather than preserved as a second product model.
([ADR-0029](../adr/0029-parameter-platform-primitives-live-in-a-standalone-kernel-module.md),
[identity-mode seam](../../server/modules/parameter-kernel/parameterIdentityMode.ts))

## 9. Replacement compatibility checklist

Before implementation tickets may call a replacement compatible, the named
owners need to demonstrate:

- **Catalog owner:** same effective results for every complete identity and the
  same blockers for zero/multiple/incomplete identities; version-pinned semantic
  and lifecycle history retained while documentation corrections remain possible.
- **Migration owner:** every retained spec, version and binding ID maps exactly
  once; all FK consumers and audit subject links reconcile; populated repair is
  deterministic and resumable.
- **Topology/module owners:** observations remain non-authoritative; canonical
  subjects and declared placement remain distinct from observed navigation.
- **Parameters/files owners:** binding tips and historical revisions retain
  their exact version/value/source interpretation; draft/review/writeback locks
  remain valid.
- **Agent/log/debug/reload/knowledge owners:** no dangling citations or retained
  references; tenant scope and pin-first value shape remain intact; reload
  promotion still enters ordinary drafts.
- **API/frontend owners:** default effective and explicit governance semantics,
  stable DTO identifiers, route manifest/OpenAPI and mock/HTTP port parity pass.
- **Security/operations owners:** trusted provenance and atomic audit remain;
  reconciliation, catalog-only, full, contract and self-hosted readiness gates
  pass before traffic cutover.

## Hard unknowns

1. No live populated database was inspected. The repository defines repair and
   verification behavior, but the actual number and shape of legacy,
   ambiguous, incomplete or duplicate rows remains unknown until the separate
   populated-database rehearsal is run.
2. Out-of-repository clients and retained exports were not inventoried. The
   tracked route/OpenAPI/frontend surfaces are known, but undocumented consumers
   may rely on current DTO fields or opaque IDs.
3. The repository contains transitional legacy/semantic storage support; this
   note cannot prove which mode each deployed environment currently serves or
   that the semantic cutover gate has been satisfied everywhere.
4. Simplifying the physical binding key requires populated-data evidence about
   rows that differ only by `module_id`; the domain contract alone does not prove
   that such rows can be merged without an ID-retention decision.
5. The repository does not settle whether every v1 route/DTO is permanent or a
   bounded adapter. External stability and deprecation windows need an explicit
   API-owner decision.
6. Current-version and current-binding-revision pointers coexist with local
   "latest" queries. The replacement must choose and enforce one canonical
   pointer policy before consumer migration.
7. It is unknown which pinned/vendor/platform/organization schema digests and
   overlay source artifacts must be retained for exact historical replay; the
   registry proves current composition, not long-term artifact retention.
8. Any changed ID scheme still needs an approved translation and audit policy;
   repository evidence establishes stable references but not permission to
   rewrite their public/audit identity.
9. The long-term replacement for the legacy debug behavioural-verification
   bridge and the absence of a normal production writer for
   `parameter_policy_targets` require owner decisions rather than inference.
10. TD-042 remains the documented semantic-cutover readiness blocker, but this
    repository-only inventory cannot establish its deployed-environment state or
    closure evidence.
