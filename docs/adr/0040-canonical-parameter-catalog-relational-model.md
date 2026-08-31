# ADR-0040: The canonical parameter catalog separates definition truth from organization use

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0040-canonical-parameter-catalog-relational-model.md)

Date: 2026-08-31

## Status

Accepted for the replacement architecture described by [Wayfinder: replace the parameter catalog with one canonical definition model](https://github.com/tzrea1-Q/WiseEff/issues/668). This is a target-model decision, not a claim that the current operational schema has already been cut over.

## Context

The current catalog spreads one property contract across `parameter_specs`, `parameter_spec_versions`, attribution subjects, schema roots/properties, organization overlays, placements, review rows, bindings, and duplicated lifecycle/current flags. That shape can make an organization override, an unmatched DTS occurrence, a draft proposal, or a historical row look like a second current definition. The replacement must instead preserve stable externally referenced identities and exact historical interpretation while making the Platform schema catalog the only structural truth source.

[Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) established the compatibility duties. [Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) established that legacy rows must be classified by their complete relational graph and that R6/R7/R8 evidence cannot become a current definition by name or property key. [Choose the canonical parameter-catalog relational model](https://github.com/tzrea1-Q/WiseEff/issues/672) resolved the target relationships and the remaining product choices.

## Decision

### Core relationships

- `CatalogSubject` is the Platform-owned formal identity. It has exactly one immutable kind: `driver` or `node-type`. `Driver` and `NodeType` are disjoint sibling subtypes; neither owns or contains the other.
- A `ParameterDefinition` belongs to exactly one CatalogSubject and is uniquely identified in the catalog by `(subject_id, property_key)`. Its opaque `id` is the stable reference used by consumers.
- A `DefinitionRevision` is an immutable content snapshot of one ParameterDefinition. Every definition, including a retired one, has exactly one current revision pointer. All other revisions are history and never compete in current catalog reads.
- An Organization does not own definitions. It relates to a CatalogSubject through one `SubjectRegistration`, and that registration has one authoritative `SubjectPlacement` in the Organization taxonomy.
- A `ParameterObservation` is immutable project/source evidence. A successful match records the exact definition and revision used; unmatched or ambiguous evidence creates review work only.
- A `ParameterBinding` is the stable association between a project logical node and a matched ParameterDefinition through the Organization's registration. Placement is derived from the registration and is not part of binding identity.
- A `ProjectValue` is an immutable value fact under one binding and pins the exact DefinitionRevision that interpreted it. It never updates definition content.
- A `DefinitionProposal` is pending governed intent. It may target an existing definition/revision or propose a new subject/property identity, but it is not a definition, revision, observation, or project value. Acceptance is the only operation that may materialize a new definition or revision.

One logical node resolves to one formal subject: a unique Driver `compatible` match wins; NodeType matching is the fallback only when no Driver matches. Driver and NodeType definitions are never unioned on the same observation. Unknown or ambiguous matches fail closed.

### Logical relational responsibilities

Names below state the target responsibilities. Final physical names may be chosen by the implementation specification only if the same constraints remain explicit.

| Relation                                 | Responsibility and minimum keys                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog_subjects`                       | Platform subject root: opaque `id`, `kind`, stable catalog `canonical_key`, `status`. `UNIQUE (kind, canonical_key)` is permanent across retirement. No `organization_id`.                                                                                                                                                       |
| `catalog_drivers` / `catalog_node_types` | Exactly one subtype row matching `catalog_subjects.kind`. Driver-only nature/cardinality and compatible-matcher semantics live on the Driver side; normalized node-name fallback semantics live on the NodeType side. Publication artifacts, aliases, and matcher lifecycle are governed separately by the publication decision. |
| `parameter_definitions`                  | Opaque `id`, `subject_id`, normalized `property_key`, `current_revision_id`, `status`. Permanent `UNIQUE (subject_id, property_key)`; also `UNIQUE (id, subject_id)` for composite ownership FKs. No organization, module, source-precedence, proposal, or observation columns.                                                  |
| `definition_revisions`                   | Opaque `id`, `definition_id`, monotonic `revision_number`, immutable shape/constraints/units/documentation and publication provenance. `UNIQUE (definition_id, revision_number)` and `UNIQUE (definition_id, id)`. It has no `current`, lifecycle, or precedence flag.                                                           |
| `definition_proposals`                   | Opaque proposal `id`, proposed identity/content, optional target definition, optional exact base revision, review state, author/provenance, and optional accepted revision. Existing-definition proposals pin the base head so acceptance can compare-and-swap rather than overwrite concurrent catalog changes.                 |
| existing DTS occurrence relations        | `dts_property_occurrences` and their logical-node/config-revision provenance remain the immutable ParameterObservation source. They are not copied into the catalog or promoted into definitions.                                                                                                                                |
| `parameter_observation_matches`          | At most one accepted match per immutable occurrence, linking the observation to the exact definition, definition revision, registration, and binding plus match evidence. Absence means not recognized; ambiguity is review evidence, not a nullable pseudo-definition.                                                          |
| `organization_subject_registrations`     | Opaque `id`, `organization_id`, `subject_id`, origin/proof, status. Permanent `UNIQUE (organization_id, subject_id)`; retirement never permits a second registration identity.                                                                                                                                                   |
| `subject_placements`                     | Opaque `id`, `registration_id`, taxonomy module, placement provenance. `UNIQUE (registration_id)` and `UNIQUE (organization_id, module_id)` enforce one current authoritative placement and prevent a module from placing two subjects.                                                                                          |
| `project_parameter_bindings`             | Opaque stable `id`, organization/project/logical-node identity, `definition_id`, `subject_id`, `registration_id`, and explicit `current_value_id`. `UNIQUE (project_id, logical_node_id, definition_id)`. No `module_id`; placement is reached through registration.                                                             |
| project-value revisions                  | The current `project_parameter_binding_revisions` responsibility becomes ProjectValue: immutable value/source/config facts with opaque `id`, `binding_id`, `definition_id`, and exact `definition_revision_id`. `UNIQUE (binding_id, config_revision_id)`; no query may infer the tip by maximum row/version.                    |
| typed legacy-ID maps and archive ledger  | Definition, revision, binding, subject, registration, and placement identifiers that cannot be retained verbatim receive kind-specific lookup rows. Every retained legacy ID maps exactly once; an unprovable object maps to immutable archive evidence, never an operational definition.                                        |
| existing audit relations                 | Governance and migration mutations continue to use the shared trusted audit model. Revision history and audit history remain distinct: revisions say what the contract was; audit says who or what changed catalog state and why.                                                                                                |

### Stable IDs, current heads, and retirement

- Every domain entity uses an opaque, generated stable ID. Hashes of `canonical_key`, `subject_id`, `property_key`, module paths, content, or organization are not entity IDs. Natural-key correction therefore does not force foreign-key rewrites.
- The definition's only current-revision truth is `parameter_definitions.current_revision_id`. A deferrable composite FK `(id, current_revision_id) → definition_revisions(definition_id, id)` proves that the head belongs to that definition. `current_revision_id` is non-null at transaction commit.
- The binding's only current-value truth is its explicit `current_value_id`, protected by the equivalent composite FK to a ProjectValue owned by that binding. Readers must not select a “latest” row by numeric order or timestamp.
- Retiring a CatalogSubject or ParameterDefinition disables new recognition, registration, binding, and publication as applicable; it does not delete the row, clear the current revision, release a unique key, rewrite a binding, or reinterpret a ProjectValue. Restore reactivates the same stable identity.
- A retired subject transitively makes its definitions unavailable for new matches. A retired definition affects only that property. Existing registrations, placements, bindings, observations, values, revisions, citations, and audits remain readable.

### Database constraints

The database, not only HTTP writers, enforces these invariants:

1. Catalog subjects are Platform-owned, kind-disjoint, and have exactly one matching subtype. Subject kind cannot change in place.
2. Definition identity is globally unique by subject/property for all statuses. Retirement is not a partial-index escape hatch.
3. Revision and ProjectValue rows are append-only. Normal application roles cannot update or delete them; bounded migration roles operate only during the verified cutover.
4. Composite FKs prove revision→definition, binding→definition/subject/registration, ProjectValue→binding/definition/revision, and observation-match→definition/revision/registration/binding agreement. Tenant-bearing relations use organization-inclusive candidate keys so a cross-Organization reference cannot satisfy an FK accidentally.
5. Placement references a module in the same Organization as the registration. A Driver registration may use only a driver-group module; a NodeType registration may use only a node-type module. This cross-table kind rule is a constraint trigger if it cannot be expressed by composite FK plus `CHECK` without duplicating authority.
6. A recognized observation must reference one active, non-retired subject/definition head and the Organization's registration. Unknown or ambiguous evidence has no match row and cannot satisfy binding creation.
7. Deletion is restricted for every retained subject, definition, revision, registration, placement, binding, ProjectValue, match, legacy map, and audit reference. Operational retirement is status change, never cascading history deletion.

### Transaction invariants

- **Publish:** lock the definition natural key or existing definition head; validate the proposal/base revision and publication artifact; insert one immutable revision; compare-and-swap the current pointer; resolve the proposal; write trusted audit; commit all or none. A new definition inserts its root, first revision, and non-null head in the same deferrable transaction.
- **Recognize and bind:** lock the observation plus `(organization, subject)` registration key and `(project, logical node, definition)` binding key. Only a unique Driver-or-fallback-NodeType match may create/reuse registration and placement, create/reuse the binding, insert its initial ProjectValue, record the observation match, advance the explicit value head, and audit. Any ambiguity rolls the whole mutation back and leaves only observation/review evidence.
- **Change project value:** lock the binding head; revalidate the exact definition revision and write lock; insert one immutable ProjectValue; compare-and-swap `current_value_id`; audit the governed workflow result; commit all or none.
- **Retire or restore:** lock the subject/definition, change status without changing identity or head, and commit the audit atomically. Existing references are never rewritten as a retirement side effect.
- **Move placement:** lock registration and source/destination taxonomy keys; update the single placement and audit in one transaction. The detailed move/adoption policy remains with the registration-and-placement decision, not with bindings.
- **Migrate:** a retained object, all of its foreign-key consumers, its typed legacy-ID mapping/archive disposition, and migration audit evidence become visible together. A partial mapping or guessed identity cannot commit.

### Where Driver and NodeType differ

The difference lives in the CatalogSubject subtype, schema-publication matcher, and placement validation layers:

- Driver identity is selected by a unique authoritative `compatible` match and carries Driver-only nature/cardinality facts.
- NodeType identity is selected by normalized node name only as a fallback when no Driver matches.
- Their organization modules have different allowed kinds.

ParameterDefinition, DefinitionRevision, Proposal, registration identity, retirement, stable-ID handling, audit, Binding, and ProjectValue use the same interfaces for both subject kinds. A Driver/NodeType conditional in definition content or project-value storage is therefore a misplaced concern.

### Current structures that do not survive as operational truth

The cutover/archive decision controls when physical removal is safe, but the destination has no steady-state equivalent of:

- organization-owned `parameter_specs`, organization-over-Platform precedence, or `parameter_specs.organization_id` as definition ownership;
- `source_kind`, `specification_key`, denormalized subject/property/module identity, duplicated definition/version lifecycle, duplicated current flags, or hash-derived IDs on the current definition path;
- DriverSchema roots represented as ParameterDefinitions, or `dts_property_specs` as a second mutable property-contract store beside DefinitionRevision;
- `driver_schema_overlays`, `driver_schema_overlay_properties`, organization schema promotion, and new organization definition overrides;
- organization-shadow `attribution_subjects`; current `driver_registrations`/`node_type_definitions` are migrated into Platform subject/subtype identities instead;
- `driver_registration_placements` as Driver-only placement; it is replaced by generic registration plus subject placement for both subject kinds;
- `parameter_modules.attribution_subject_id` and `project_parameter_bindings.module_id` as competing placement/identity facts;
- provisional unmatched-surface definitions and definition-shaped `parameter_spec_review_tasks`; observations and proposals replace those responsibilities;
- “latest revision/version” reads or long-lived dual-write/trigger bridges between legacy and canonical stores.

These rows may remain temporarily in the migration archive or bounded compatibility adapter, but they never participate in target current-definition selection.

## Consequences

- The catalog kernel can present one small definition/revision interface for both Drivers and NodeTypes while hiding publication, locking, ID translation, and invariant checks behind the seam.
- Organization use cannot alter structural truth. Registration and placement may evolve without creating, copying, or changing definitions; moving a placement does not change binding identity.
- Historical ProjectValues remain interpretable by exact revision even after semantic publication, identity correction, placement movement, or retirement.
- More joins and explicit transaction orchestration are accepted in exchange for eliminating polymorphic foreign keys, row-order selection, nullable pseudo-definitions, and duplicated current/lifecycle truth.
- Publication artifact/lifecycle, catalog-module interface, registration edge cases, API transition, populated-data mapping/archive, and release gates remain owned by their existing Wayfinder tickets. They may refine workflows, but may not weaken the identities, separations, constraints, or transaction invariants above.
