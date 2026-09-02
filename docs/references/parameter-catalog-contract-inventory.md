# Current parameter-catalog contract and replacement-compatibility inventory

**Status:** research note for Issue #669

**Tree inspected:** `e895bedefa90c2d00c0dcc9e1f6e7496c060534d`

**Scope:** current repository contracts and consumers only; no live-database or
out-of-repository client inspection

## Decision summary

A replacement must preserve stable opaque definition/binding references,
version-pinned historical semantic interpretation, fail-closed recognition,
trusted audit and deterministic migration of current data. It must **not**
preserve today's organization-over-platform effective projection as the target
model. The approved destination has one Platform schema catalog as structural
truth, one current definition revision per formal Driver/NodeType subject plus
property key, organization registration/placement without schema authorship,
and one current Parameter definitions page. Organization overlays and definition
overrides are compatibility inputs to classify, migrate/archive and then reject
for new operational writes; raw/governance projections are transitional or
internal migration/audit surfaces whose exact removal contract remains for #677.
([Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))

The current dual-written lifecycle fields, denormalized identity columns,
legacy unlinked staging, physical identifier formulas, flat-storage adapter and
several "latest version" lookups are implementation details or known
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

### Reading this inventory

"Current contract" below means behavior and retained data that the replacement
must handle during migration. It does not automatically mean a destination
operational feature. The approved target supersedes current behavior where it
is explicit: Platform-only structural truth replaces organization
overlays/overrides; one current definitions page replaces peer effective versus
governance navigation; matching work moves to a review queue; revision/audit
history lives in definition detail; and raw migration diagnostics stay internal.
([Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))

## 1. Current authoritative inputs and approved target identity

### Current source hierarchy

1. `schemas/dts/catalog.json` is the tracked allow-list and pins each vendor
   schema plus its content hash and upstream DTS/toolchain provenance.
   `schemaLoader.ts` loads catalog-listed YAML and reachable common references;
   it emits typed driver/property definitions rather than treating every file in
   the directory as authoritative.
   ([catalog](../../schemas/dts/catalog.json),
   [loader](../../server/modules/parameter-specs/schemaLoader.ts))
2. In the current implementation, active platform and organization overlays are
   database-owned schema additions. The registry cache composes the pinned root
   with active overlays and keys the result by catalog hash plus overlay digest.
   Organization promotion copies a definition into the platform tier; it does
   not silently re-own the original row. These rows and artifacts are migration
   inputs only in the approved replacement: new organization schema authorship
   and organization definition overrides retire.
   ([registry cache](../../server/modules/parameter-specs/schemaRegistryCache.ts),
   [overlay service](../../server/modules/parameter-specs/driverSchemaOverlayService.ts),
   [overlay repository](../../server/modules/parameter-specs/driverSchemaOverlayRepository.ts),
   [Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))
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

The current storage business identity of a property definition is:

```text
owner scope (platform or organization)
  + canonical AttributionSubject.source_key
  + property_key
```

The approved target identity removes organization definition ownership:

```text
typed formal subject (Driver or NodeType)
  + property_key
```

Organization ownership on current rows is a migration-classification input.
Organizations relate to the target catalog only through subject registration
and one authoritative placement inherited by the registered subject's
definitions.
([Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))

`parameter_specs.id` is an opaque stable surrogate for that identity. Identity
corrections update the row in place because bindings, debug operations,
knowledge references, reviews, audits and history retain that ID. A replacement
may use a different physical key, but it must preserve or deterministically map
every externally retained surrogate.
([ADR-0017](../adr/0017-definition-identity-is-correctable.md),
[identity migration](../../server/migrations/0090_parameter_spec_identity_surrogate.sql))

The current ordinary effective projection requires all of the following:

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

The completeness, unique-winner and fail-closed properties remain durable. The
organization-active-over-platform precedence does not: it is a bounded
compatibility rule for reading and classifying pre-cutover rows. The destination
must produce one current Platform definition and migrate/archive organization
twins rather than reproduce override selection in steady state.
([Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))

Structural DTS keys are topology, not configurable parameter definitions; the
guard must survive even if a replacement changes its internal allow/deny
representation.
([ADR-0003](../adr/0003-node-enablement-is-not-a-parameter.md),
[structural guard](../../server/modules/parameter-specs/structuralPropertyGuard.ts))

## 2. Relational state and invariants

| State | Current tables | Durable meaning | Required invariants |
| --- | --- | --- | --- |
| Definition | `parameter_specs`, `parameter_spec_versions` | Current owner-scoped rows to map into stable formal-subject/property identity plus versioned semantic content | target uniqueness is typed formal subject + property with one current revision; current organization-owned twins are classified for migration/archive; historical semantic interpretation remains pinned |
| Driver schema | `driver_schemas`, `driver_schema_versions`, `dts_property_specs` | Subject-bearing schema root and property shape derived from an authoritative schema source | root/version/property ownership and subject alignment; property version belongs to its definition |
| Canonical subject | `attribution_subjects`, `driver_registrations`, `node_type_definitions` | Current representation to map into a typed formal Driver or NodeType, distinct from observed module navigation | target subject/property identity is Platform structural truth; current owner scope is migration evidence, not destination definition ownership |
| Declared placement | `driver_registration_placements` | Organization registration placement of a formal subject under the registry/module taxonomy | one authoritative subject placement per organization registration, inherited by that subject's definitions |
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
| Definition governance service | current draft creation, documentation update, activate/deprecate/restore, reattribution, property-key correction and version/property cutovers | Current human-governed mutation API and migration input. Stable IDs/history/audit remain; organization definition authoring retires, while the governed Platform publication lifecycle is a separate target-design decision. |
| Overlay service/repository/materializer | current organization/platform driver schema overlays, their versions/properties and promotion/retirement | Current compatibility writer and populated-data migration source. The destination freezes/rejects new organization overlay/override writes and migrates or archives existing rows; it does not retain this as an operational authoring path. |
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
| Catalog/governance HTTP | current effective projection by default; explicit raw/history governance projection; schema overlay and lifecycle/cutover operations | Inventory and bound transition behavior, but do not preserve it as peer destination UI/API. #677 must decide removal/internal-diagnostic compatibility, rejection of overlay writes and any bounded adapter. Owner: parameter-specs + contracts. |
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

The current contract exposes an effective catalog by default and requires
explicit governance scope for raw lifecycle/history access. It also exposes
definition lifecycle, review, identity/version/property-key cutover, schema
overlay/promotion, module/driver registry, topology, binding/history and project
value workflows. Route-manifest and schema-registry checks are the mechanical
source for today's registered HTTP/OpenAPI compatibility; narrative API docs
explain the current projection semantics.
([API contract](../design-docs/api-contract.md),
[route manifest](../../server/modules/contracts/routeManifest.ts),
[schema registry](../../server/modules/contracts/schemaRegistry.ts))

That route inventory is not the destination product contract. The approved UI
has one current Parameter definitions page, matching work in a review queue and
revision/audit history in definition detail. Raw/governance queries are internal
migration/audit compatibility, not a peer product surface; organization overlay
mutations retire. #677 owns the exact `/api/v2` transition, removal response,
bounded compatibility window and internal diagnostic contract.
([Wayfinder map #668](https://github.com/tzrea1-Q/WiseEff/issues/668))

The current frontend depends on the `ParameterTopologyRepository` port rather
than SQL. Its HTTP and mock adapters must remain semantically aligned during the
transition. The current parameter-admin URL defaults to the effective view and
preserves an explicit governance query; the current governance panel consumes
both the effective catalog and repair/history detail. Domain DTOs expose
scope/override/declared-placement/observation state. These are consumer inputs
for #677 and the one-page replacement, not proof that the port or peer views must
survive unchanged.
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
3. a bounded maintenance-window cutover with a verified recovery point, no
   long-lived dual writes and no interval where incomplete rows appear current;
4. catalog-only and full independent checks against the candidate data;
5. route/OpenAPI contract checks plus focused PostgreSQL behavior coverage; and
6. rollback that restores both data and traffic routing without deleting audit
   or historical value facts.

## 8. Business contracts versus implementation accidents

| Target contract to preserve | Current implementation or transition input | Replacement action/owner |
| --- | --- | --- |
| Typed formal Driver/NodeType subject + property identity | Current organization owner scope and `property_key` denormalized on `parameter_specs` | Map every provable row to one Platform definition identity; organization relation moves to registration/placement. |
| Stable opaque spec/binding/version references | Current ID prefix/hash formulas | Preserve IDs or publish a complete immutable mapping; catalog + data-migration owners. |
| Pinned historical semantic interpretation; semantic edits mint successors | Documentation-class in-place edits, plus duplicated lifecycle/version fields and duplicated property content used by the `0083` dual-write bridge | Preserve semantic pins while allowing documented non-semantic correction; normalize storage only after verifying every historical pin. |
| One complete current Platform definition revision per formal subject + property key | Organization-over-platform precedence, organization overlay authoring/definition overrides, physical table split and trigger names | Classify every organization row; migrate provable knowledge to the governed Platform publication path, archive unprovable rows outside operational reads, reject new organization structural writes, and enforce one current winner. |
| Observation never grants authority | `provisionalSurfaceBinding.ts` unmatched draft creation (no production caller) | Retire; topology owner keeps review evidence only. |
| Incomplete staging never appears effective | `0121` unlinked active-DTS staging for the legacy two-step importer | Retire with the old writer or contain behind the same fail-closed projection; migration owner. |
| Current project/logical-node/definition/module binding and stable binding ID | `module_id` as a *candidate* removable uniqueness suffix, not a settled accident | Treat the four-part key as compatible now; simplify only after populated proof, duplicate/ID reconciliation and an explicit decision by parameters + module owners. |
| Explicit binding/change-request version pins | "latest version by numeric version" lookups in Agent perception, log-analysis context and write-lock schema-default loading | Route through the canonical selection seam and add migration tests; Agent/logs/topology owners. |
| One current definitions page; matching review queue; revision/audit history in definition detail | Peer effective/governance navigation, public raw/governance projection, raw `specification_key` parsing and `driverModule` fallbacks | Keep only a bounded/internal migration and audit adapter until #677 defines exact removal; do not recreate peer governance UI or organization overlay mutations. |
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

## 9. G0.1 closed replacement registries

The 2026-09-02 owner-authorized G0.1 amendment turns the following inventory facts into closed implementation inputs. It does not claim that current production code already enforces them.

### Legacy identity registries

The public API union `LegacyLookupIdentifierType` contains only `parameter-spec`, `parameter-spec-version`, `project-parameter-binding`, `project-parameter-binding-revision`, `parameter-subject`, `parameter-placement`, and `parameter-module`.

The internal cutover union `LegacyMappingSourceKind` contains exactly 49 entries:

1. `parameter-spec`
2. `parameter-spec-version`
3. `driver-schema`
4. `driver-schema-version`
5. `dts-property-spec`
6. `parameter-subject`
7. `parameter-module`
8. `parameter-placement`
9. `parameter-module-mapping`
10. `parameter-module-dismissed-compatible`
11. `driver-schema-overlay`
12. `driver-schema-overlay-property`
13. `driver-schema-overlay-promotion`
14. `dts-config-revision`
15. `dts-logical-node`
16. `dts-logical-node-revision`
17. `dts-node-occurrence`
18. `dts-property-occurrence`
19. `dts-occurrence-effect`
20. `dts-property-occurrence-spec-decision`
21. `project-parameter-binding`
22. `project-parameter-binding-revision`
23. `legacy-flat-parameter-definition`
24. `legacy-flat-project-parameter-value`
25. `parameter-draft`
26. `parameter-submission-round`
27. `parameter-submission-item`
28. `parameter-change-request`
29. `parameter-review-decision`
30. `parameter-spec-review-task`
31. `parameter-spec-matcher-override`
32. `parameter-file-sync-conflict`
33. `parameter-import-batch`
34. `project-parameter-initialization-draft`
35. `project-parameter-initialization-review`
36. `parameter-definition-reconciliation-run`
37. `parameter-definition-reconciliation-item`
38. `parameter-spec-version-cutover-run`
39. `parameter-spec-version-cutover-item`
40. `parameter-spec-property-key-cutover-run`
41. `parameter-spec-property-key-cutover-item`
42. `parameter-identity-migration-run`
43. `parameter-identity-migration-phase`
44. `parameter-identity-cutover`
45. `parameter-history-entry`
46. `legacy-parameter-migration-evidence`
47. `parameter-policy-target`
48. `audit-subject-link`
49. `unresolved-protected-reference`

The active #668 specification groups these into eleven exhaustive mapping classes and fixes each owner extractor and target-or-Archive disposition. Public lookup and internal migration kind are deliberately different types. An internal mapping target must represent Observation/Match, Review, Publication, Policy, Audit, and MigrationHistory rather than erasing those rows into a public seven-kind lookup.

### Exact ratchet additions

The S0-RAT registry must add these exact 28 paths to its production census. Existing/future status is recorded per path; a future provider test remains `required: false` until its owner creates it.

| Owner | Paths |
| --- | --- |
| S12-CGH | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` |
| S12-TOP | `src/infrastructure/http/parameterTopologyClient.test.ts`; `e2e/acceptance/parameter-topology.acceptance.spec.ts` |
| S12-PRJ | `src/infrastructure/http/parameterClient.test.ts`; `src/infrastructure/http/parameterDtos.test.ts`; `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |
| S12-FIL | `src/infrastructure/http/parameterFileClient.test.ts`; `e2e/acceptance/parameter-files.acceptance.spec.ts` |
| S12-AGT | `server/modules/agent/tools/actionTools.test.ts`; `server/modules/agent/tools/actionTools.integration.test.ts`; `server/modules/agent/toolRegistry.test.ts`; `server/modules/agent/parameterCatalogComparisonContribution.test.ts`; `e2e/acceptance/xiaoze-action.acceptance.spec.ts`; `server/modules/agent/tools/perceptionTools.ts`; `server/modules/agent/tools/perceptionTools.test.ts` |
| S12-LOG | `src/infrastructure/http/logClient.test.ts`; `src/infrastructure/http/logDtos.test.ts`; `e2e/acceptance/log-analysis.acceptance.spec.ts` |
| S12-DBG | `src/infrastructure/http/debuggingClient.test.ts`; `src/infrastructure/http/debuggingDtos.test.ts`; `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
| S12-DTS | `src/infrastructure/http/dtsReloadClient.test.ts`; `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts` |
| S12-KNW | `src/infrastructure/http/knowledgeClient.test.ts`; `e2e/acceptance/knowledge.acceptance.spec.ts` |
| S12-MOD | `src/infrastructure/http/parameterModuleRegistryClient.test.ts`; `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` |
| S12-OPS | `scripts/reconcile-parameter-definitions.test.ts` |

The checker recognizes the complete 37-relation canonical schema only by schema-qualified name:

`parameter_catalog.catalog_releases`, `parameter_catalog.catalog_subjects`, `parameter_catalog.catalog_drivers`, `parameter_catalog.catalog_node_types`, `parameter_catalog.catalog_release_subjects`, `parameter_catalog.catalog_subject_aliases`, `parameter_catalog.catalog_release_subject_aliases`, `parameter_catalog.parameter_definitions`, `parameter_catalog.definition_revisions`, `parameter_catalog.catalog_release_definition_heads`, `parameter_catalog.catalog_materializations`, `parameter_catalog.catalog_state`, `parameter_catalog.project_parameter_bindings`, `parameter_catalog.project_parameter_values`, `parameter_catalog.binding_history_events`, `parameter_catalog.legacy_identities`, `parameter_catalog.parameter_catalog_cutover_runs`, `parameter_catalog.parameter_catalog_cutover_events`, `parameter_catalog.parameter_catalog_cutover_checkpoints`, `parameter_catalog.parameter_catalog_archives`, `parameter_catalog.legacy_mapping_versions`, `parameter_catalog.legacy_mapping_heads`, `parameter_catalog.parameter_catalog_classification_ledger`, `parameter_catalog.parameter_catalog_comparison_cases`, `parameter_catalog.parameter_catalog_comparison_results`, `parameter_catalog.catalog_command_idempotency`, `parameter_catalog.organization_subject_registrations`, `parameter_catalog.subject_placements`, `parameter_catalog.parameter_observations`, `parameter_catalog.parameter_review_evidence`, `parameter_catalog.parameter_review_items`, `parameter_catalog.definition_proposals`, `parameter_catalog.definition_proposal_revisions`, `parameter_catalog.catalog_publication_intents`, `parameter_catalog.parameter_review_resolutions`, `parameter_catalog.governance_command_idempotency`, and `parameter_catalog.parameter_observation_matches`.

Raw relation access, legacy identifiers/routes, and private module imports are default-deny. Violation identity binds a mandatory trusted base SHA, baseline blob OID, byte span, token/evidence, path, owner family, and rule, and is compared as a complete multiset. This prevents same-looking delete/add replacement. CI must fetch and verify the named trusted base; local mutable `origin/main` is not a trust anchor.

## 10. Replacement compatibility checklist

Before implementation tickets may call a replacement compatible, the named
owners need to demonstrate:

- **Catalog owner:** one complete current Platform definition revision per formal
  subject + property key; fail-closed blockers for zero/multiple/incomplete
  identities; version-pinned semantic/lifecycle history retained. Current
  organization overlays/overrides are classified and migrated or archived, not
  carried into steady-state selection.
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
- **API/frontend owners:** one current definitions page, matching review queue
  and detail history pass with stable retained identifiers. Peer
  effective/governance navigation is absent; raw/governance and overlay routes
  follow #677's bounded/internal transition and reject retired new writes.
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
5. #677 still must settle the exact `/api/v2` transition and removal behavior
   for current raw/governance queries and organization overlay mutations,
   including external DTO stability, rejection responses and any bounded
   internal migration/audit adapter. The peer UI is already out of target scope.
6. Current-version and current-binding-revision pointers coexist with local
   "latest" queries. The replacement must choose and enforce one canonical
   pointer policy before consumer migration.
7. It is unknown which pinned/vendor/platform schema digests and which legacy
   organization overlay artifacts must be retained solely for historical/audit
   replay. Those legacy artifacts are not target structural-truth inputs.
8. Any changed ID scheme still needs an approved translation and audit policy;
   repository evidence establishes stable references but not permission to
   rewrite their public/audit identity.
9. The long-term replacement for the legacy debug behavioural-verification
   bridge and the absence of a normal production writer for
   `parameter_policy_targets` require owner decisions rather than inference.
10. TD-042 remains the documented semantic-cutover readiness blocker, but this
    repository-only inventory cannot establish its deployed-environment state or
    closure evidence.
