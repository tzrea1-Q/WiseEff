# T1.1 source-occurrence schema contract

> Chinese companion: [中文设计契约](../../../zh-CN/exec-plans/active/849-inventory/source-occurrence-schema-contract.md)

Status: design-only contract for T1.1. No migration or application implementation is certified by this document.

Contract sources:

- [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md)
- [B1 threat matrix](source-occurrence-threat-matrix.md)
- Current canonical schema: `server/migrations/0137_canonical_parameter_catalog_schema.sql:1133-1324,2991-3249`
- Current DTS source graph: `server/migrations/0041_project_parameter_files.sql:1-27`, `0043_dts_config_set_baseline.sql:1-42`, and `0048_parameter_topology_schema_shadow.sql:91-195`
- Current replacement projection and resolver: `server/migrations/0144_definition_replacement.sql:352-530`

The user accepted both T1.1 identity decisions: JSON instance identity is server-owned and scoped to the immutable ownership tuple below; and any unprovable existing Binding, observation or match aborts the complete backfill transaction. This document fixes the implementation shape of those decisions. It does not start T1.2 or define a new product capability.

## 1. Invariants

1. A Binding identifies one Catalog Definition at one source root occurrence. A source revision, file version or parameter locator is a ProjectValue/source-pin fact, not Binding identity.
2. DTS occurrences use the existing genuine `dts_logical_nodes.id`; JSON occurrences use a server-generated `configuration_instance_id`. No JSON row receives a fabricated DTS logical node.
3. A JSON instance identity is the tuple `(organization_id, project_id, config_set_id, file_id, configuration_instance_id, configuration_schema_subject_id, root_pointer)`. The server reuses the instance only when the immutable tuple is proven. A file-name rename with the same `file_id` preserves it. A config-set move, file replacement/new `file_id`, schema/model change or root move creates a new instance and does not transfer history automatically.
4. The occurrence root is distinct from a parameter locator. The root belongs to the source-occurrence relation; the exact property/pointer locator belongs to an immutable ProjectValue source pin and to the frozen draft/change request.
5. `source_ref` remains a display/audit label for compatibility. It is never used as the authority for writeback, export, ownership or identity resolution.
6. Identity-only placeholder **values** are historical, non-draftable values. They have no source pin. Every Binding must still receive a proven source occurrence during backfill; a placeholder current value does not excuse an unproven Binding root.
7. Existing DTS Binding IDs, ProjectValue IDs, history IDs, observation IDs and match IDs are not re-derived or rewritten. The backfill only adds links and immutable pin rows after provenance is proven.
8. Parent moves/deletes cannot rehome or erase a referenced source occurrence, source pin or history. A deliberate move creates a new file/instance occurrence; it is not an in-place identity update.

## 2. Relations and keys

### 2.1 Unified source occurrence

Add `parameter_catalog.project_parameter_source_occurrences`:

| Column | Contract |
| --- | --- |
| `id` | Opaque server ID, primary key; generated once and stable across source revisions. |
| `organization_id`, `project_id` | `not null`; composite owner key to `public.projects`. |
| `config_set_id` | `not null`; existing `dts_config_set` is the project configuration-set store for both formats. |
| `file_id` | `not null`; immutable source-file identity, not `current_version_id`. |
| `occurrence_kind` | `not null`, exactly `dts` or `json`. |
| `logical_node_id` | Nullable only for `json`; required for `dts`, and a tenant-complete FK to `dts_logical_nodes`. |
| `configuration_instance_id` | Nullable only for `dts`; required for `json`, opaque and server-generated. Globally unique. |
| `configuration_schema_subject_id` | Nullable only for `dts`; required for `json`, FK to `parameter_catalog.catalog_configuration_schemas(subject_id)`. |
| `root_pointer` | Nullable only for `dts`; required for `json`, canonical RFC 6901 pointer. |
| `root_pointer_digest` | Nullable only for `dts`; required for `json`. |
| `created_at` | Append-only creation timestamp. |

Required keys and FKs:

- Unique `(id, organization_id, project_id)` for tenant-complete Binding and pin FKs. Add the missing tenant-complete unique keys on existing parent tables before relying on them.
- A partial unique key for DTS is `(organization_id, project_id, config_set_id, file_id, logical_node_id) where occurrence_kind = 'dts'`. JSON has both a natural replay key `(organization_id, project_id, config_set_id, file_id, configuration_schema_subject_id, root_pointer)` and `unique (configuration_instance_id)`. A fresh instance ID therefore cannot hide a duplicate natural root, and an instance ID cannot be reused in another scope.
- FK `(project_id, organization_id)` to `public.projects`; FK `(config_set_id, organization_id, project_id)` to `dts_config_set`; FK `(file_id, organization_id, project_id, config_set_id)` to `project_parameter_files`; and, for DTS, `(logical_node_id, organization_id, project_id, config_set_id)` to `dts_logical_nodes`. Add the missing tenant-complete unique keys on existing parent tables before relying on these FKs.
- All three parent FKs use `on delete restrict`; no source occurrence uses cascade. `file_name` may be renamed, but changing a referenced file's organization, project or config set is rejected. A move requires a new file identity and therefore a new occurrence.
- Kind checks are part of the table contract: DTS requires `logical_node_id` and all JSON columns null; JSON requires `configuration_instance_id`, schema, root pointer and digest and `logical_node_id` null. The pointer grammar is checked syntactically in SQL and semantically against the parsed file by the source service. A deferred owner trigger checks the JSON schema registration for the same organization.
- The application must use an explicit reviewed ConfigurationSchema-to-pointer mapping; it must not infer identity from the filename or Definition property key. The root pointer `''` is allowed; `~0` and `~1` are the only escapes, and array tokens are validated on the parsed document.

Node paths and property occurrences are revision-specific and do not belong in this identity table. The exact historical `dts_property_occurrences.id` and its node/file locator are stored in the source-pin relation below.

### 2.2 Binding identity transition

Add `source_occurrence_id` to `parameter_catalog.project_parameter_bindings`:

- The expansion column is nullable only until the all-or-nothing backfill completes. Every existing Binding must then have a non-null, proven source occurrence; a placeholder current value is allowed only as a value-history state, never as an unproven Binding identity.
- Add tenant-complete FK `(source_occurrence_id, organization_id, project_id)` to the unified occurrence relation and preserve existing owner/Definition FKs.
- Add a unique `(project_id, source_occurrence_id, definition_id)`, plus the tenant-complete equivalent needed by observation/match FKs. The old `(project_id, logical_node_id, definition_id)` key remains during expansion and dual-read.
- Keep `logical_node_id` as a compatibility projection: it remains the proven DTS logical node for DTS rows and is null for JSON rows only after the switch has fenced old writers. No JSON-specific columns are added to Binding. The old DTS resolver continues to use this projection until the full B1 matrix passes.
- Extend `protect_binding_identity()` to reject changes to `source_occurrence_id` (and to reject deletion). It must not be extended until backfill has completed and the new links have been validated.

Placeholder ProjectValues remain explicit non-source values: they are not draftable, writable, exportable or reimportable until a later real source-backed value is appended. The Binding still has a source occurrence; no placeholder is used to satisfy the Binding FK.

### 2.3 Immutable ProjectValue source pins

Do not add mutable source columns to immutable `parameter_catalog.project_parameter_values` rows. Add an adjunct relation `parameter_catalog.project_value_source_pins`:

| Column | Contract |
| --- | --- |
| `id` | Opaque immutable pin ID, primary key. |
| `project_value_id` | `not null`, unique; FK to the immutable ProjectValue with `on delete restrict`. |
| `binding_id`, `organization_id`, `project_id` | Tenant-complete Binding ownership proof. |
| `source_occurrence_id` | Root occurrence pin. |
| `config_revision_id` | Exact revision used for the value. |
| `file_id`, `file_version_id` | Exact immutable source object; FK through a tenant-complete file/version key. Never resolve through `project_parameter_files.current_version_id`. |
| `format` | `dts` or `json`; must equal the occurrence kind. |
| `property_occurrence_id` | Nullable only for JSON; required for DTS and FK to the exact historical `dts_property_occurrences` row. |
| `locator` | `jsonb not null`; typed locator object. DTS requires `kind='dts-property'` and the pinned property/node locator; JSON requires `kind='json-pointer'` and the canonical pointer. |
| `locator_digest` | Digest of the format-specific pin payload and source checksum. |
| `created_at` | Append-only timestamp. |

The `locator` CHECK requires the exact typed object shape for the selected format. A deferred trigger checks that the DTS property belongs to the pinned `config_revision_id` and `file_version_id`, that its property key matches the Binding Definition, and that its node belongs to the Binding occurrence. For JSON, the service validates decoded-key uniqueness, array-index rules, pointer containment inside the occurrence root, parsed-index membership and the pinned file checksum before insertion. The pin trigger also proves `file_id` is the file owning `file_version_id` and the revision member.

The base pin and its JSONB locator are immutable. A new source revision appends a new ProjectValue and a new pin; it never updates an old pin. The `locator` CHECK and deferred owner trigger are the single typed-pin seam; no second format-specific pin table is required.

The exact persisted DTS pin keys are `kind, propertyOccurrenceId, nodeOccurrenceId, fileVersionId, propertyName`; JSON pins use only `kind, pointer` because the exact file version is already a separate owned pin column. Every locator value is a JSON string, with no extra keys or coercion. Observation provenance differs: its JSON locator includes `fileVersionId` alongside `kind, pointer`, as required by §2.5. Do not change existing pin digest preimages by adding observation-only fields.

`project_parameter_values.source_ref` and `config_revision_id` remain for compatibility/display and existing history queries. The source-pin relation is authoritative for writeback, export, stale checks and ownership. Placeholder ProjectValues intentionally have no pin.

The source pin has a tenant-complete composite FK to its ProjectValue and Binding, and a deferred ownership check that the pin's `(binding_id, project_id, organization_id)` and `source_occurrence_id` exactly equal the ProjectValue's Binding and occurrence. A historical pin need not equal the current tip; the deferred current-tip guard applies only when the value is the Binding's current non-placeholder tip. Such a tip must have exactly one matching pin, and the pin must match the same Binding, occurrence, immutable file/version and revision member. A placeholder current tip has no pin and blocks upgrade/workflow enablement; a transient placeholder may exist only inside the one atomic append transaction that immediately installs its proven source-backed replacement.

### 2.4 Draft, candidate and change-request pins

Revision-member alias correction: add nullable `source_name` to the existing `dts_config_revision_members`, not a new relation. It is a stable parser/export alias rather than file identity or live display metadata. Non-null aliases must obey relative logical-path rules and be unique across all formats within a revision. Every member of any revision referenced by a canonical source pin must have a proven alias; the existing pinned-member immutability guard covers this column too. Backfill uses only unique historical manifest or immutable naming evidence cross-proven against historical file/version/member ownership. Missing/conflicting evidence aborts the whole upgrade; current `file_name` and storage keys are not evidence. Unreferenced old members may remain null. Runtime `sourceName` remains separate from display `fileName`; canonical load/prepare/commit/export reject null aliases and future canonical revisions retain the pinned alias. See the workflow's exact-export section for the full proof boundary.

Add `source_pin_id` to `project_parameter_value_drafts` and `project_parameter_value_change_requests`. The draft may be edited before submission; the submitted request is a frozen server-owned record.

- Expansion permits null only for existing rows; the switched canonical workflow requires non-null for every source-backed draft/request.
- Composite FKs prove `(source_pin_id, organization_id, project_id, binding_id)` ownership. A deferred trigger proves that the pin's `project_value_id` equals `base_current_value_id`.
- Submit copies the exact draft pin ID into the change request. `source_ref` remains a display snapshot only. Review rechecks the pin, file checksum, config-revision membership, occurrence identity and current-value CAS before any append/writeback.
- A Binding whose current value is a placeholder cannot create a draft or request because it has no source pin. Existing unpinned pending rows are a migration blocker; they are not silently converted to another identity state.

The source-edit artifact reuses `public.project_parameter_file_candidates`; do not add a generic artifact or second candidate table. Add these server-owned fields to the existing candidate row:

| Column | Contract |
| --- | --- |
| `base_digest`, `proposed_digest`, `diff_digest` | `text`, nullable only for legacy/unprepared candidates during expansion; canonical SHA-256 digests and an all-or-none group for a prepared source artifact. `base_digest` is the exact candidate-file base bytes (empty bytes for a new file), `proposed_digest` is the candidate bytes (and equals the existing stored `checksum` after normalization), and `diff_digest` is the digest of the canonical reviewed diff. |
| `frozen_member_manifest` | `jsonb`, nullable only for legacy/unprepared candidates during expansion; otherwise a complete array sorted by `fileId` of `{configSetId,memberId,fileId,fileVersionId,sourceName,checksum,sizeBytes,format,role,sortOrder,isCandidateFile}`. It contains every member of the affected config set, not only the changed file, and is the CAS source for commit. |
| tenant key | Add `unique (id, organization_id, project_id)` so every request FK proves the candidate belongs to the authenticated tenant. The existing candidate `file_id` ownership must be tenant-complete and must not cascade away a referenced candidate. |
| `frozen_binding_manifest` | `jsonb`, complete ordered affected Binding cohort described below; part of the same prepared artifact group and immutable after submission. |

`base_version_id`, `file_id`, `file_name`, `format`, `storage_key`, `checksum`, `size_bytes`, `parsed_index`, `diagnostics`, `impact`, `blockers`, the three digests and both manifests are payload/base fields. Existing legacy candidates may keep the new digest/manifest group null; a source-backed candidate fills all five prepared fields together, and a draft/request may reference it only after the group is complete. A trigger rejects changes once any submitted change request references the candidate (pending, approved, rejected or withdrawn); lifecycle status follows the existing state machine. Candidate deletion is restricted while referenced. Immutable canonical manifest bytes participate in the reviewed artifact, so retry cannot silently replace its source or cohort.

Add nullable `candidate_id`, `candidate_base_digest`, `candidate_proposed_digest`, `candidate_diff_digest`, `candidate_member_manifest` and `candidate_binding_manifest` to both draft and request rows so existing rows need no invented artifact. Draft copies are mutable only before submit. A submitted source-backed request stores the candidate ID plus all five immutable snapshots, with a tenant-complete FK `(candidate_id, organization_id, project_id)` to the candidate row; it never trusts a later candidate re-read. A deferred trigger requires snapshots to equal the candidate at submit time and rejects edits thereafter. Both request manifests must be complete and canonically identical to the candidate manifests.

The candidate row must be `ready`, all member file versions must still match the frozen manifest, and the object-store bytes must match `proposed_digest` before commit. The writer locks every affected config-set ID in sorted order, then every member file ID in sorted order, then every affected Binding ID in sorted order, then every request ID in sorted order. It compares all frozen member version IDs and digests, candidate digests, source-pin locators and request/base CAS under those locks before writing. It never resolves a current-only snapshot.

JSON locators stored alongside the candidate manifest, source pin, draft and request are document-absolute RFC 6901 pointers. Containment compares decoded token arrays and accepts root equality; textual or encoded-string prefix checks are forbidden. If an import changes array position or otherwise makes the old root unprovable, activation refuses in place. The caller must register a new file identity/instance or submit an explicit different root mapping; the old instance and history are never silently reused.

Freeze the affected Binding cohort at preparation, not approval. Add candidate `frozen_binding_manifest` and draft/request `candidate_binding_manifest` JSON arrays to the same all-or-none prepared artifact group and immutable snapshot checks. Canonically order by Binding ID; include `bindingId, oldValueId, sourcePinId, sourceOccurrenceId, definitionId, effectiveRevisionId, catalogReleaseId, locator, valueKind, valueDigest, configSetId` for every existing source-backed Binding in the affected tenant/project/config sets. Display the cohort with the reviewed diff. Approval locks and compares the exact cohort, including membership; an added/removed Binding, placeholder, changed value/pin/locator/Definition/release or unproven member aborts with stale-cohort, rather than silently including new work. New DTS property occurrences are revision-specific: resolve the semantic property within the same source occurrence in the new revision, never reuse the old offset/property-occurrence ID. Non-target typed business values must remain equal. Existing pending drafts/requests for all propagated siblings stay immutable and stale.

Apply idempotency reuses `parameter_catalog.binding_history_events` as the applied-event ledger; no generic idempotency table is introduced. Add nullable `applied_request_id` to that existing immutable history relation, FK to the request `id`, and `unique (applied_request_id)` for non-null rows. Only the target history event carries this key. A deferred owner check proves the request's organization/project equals the event Binding's tenant. Add immutable request result fields `applied_history_event_id`, `applied_audit_ref`, ordered `applied_file_version_ids` and `applied_source_result jsonb` alongside existing target `applied_value_id`, `apply_outcome` and `applied_at`. The result object contains ordered `bindings` entries with `ordinal, bindingId, oldValueId, newValueId, sourcePinId, configRevisionId, fileVersionId, historyEventId, kind` (`target` or `sibling-derived`), unique Binding IDs and ordinals. This immutable structured result links every sibling history to its request; a reason string alone is insufficient. One approved batch appends one value/pin/history per affected Binding, one revision per config set, and one user-applied audit referenced by every history event. Do not loop the existing independently audited append without adapting it to the shared audit boundary. The applied audit includes target, cohort/result digest/count and new revision metadata. Authorized retry returns the stored complete result with no additional version/value/history/applied audit. A different request ID is never an idempotent replay.

### 2.5 Observations and matches

Add `source_occurrence_id` to `parameter_catalog.parameter_observations` and `parameter_catalog.parameter_observation_matches` during expansion:

- For observations, make `(observation_id, organization_id, catalog_release_id, matcher_revision, project_id, source_occurrence_id)` the tenant-complete FK target. Keep `logical_node_id` as a DTS projection until switch; new source-backed rows must carry the same occurrence as the source.
- Replace the current uniqueness assumption `(organization_id, source_identity)` with the exact replay key `(organization_id, project_id, source_occurrence_id, config_revision_id, parameter_locator_digest, catalog_release_id, matcher_revision)`. `parameter_locator_digest` is the SHA-256 of the canonical format-tagged **parameter** locator (DTS exact property occurrence/file-version, or document-absolute JSON Pointer/file-version), not the root occurrence; persist that locator in `source_locator` and validate its digest and occurrence ownership. Replays compare the full locator and evidence payload and reject contradictions, rather than treating digest equality alone as proof. Two different parameters within one occurrence must both survive. Keep `source_identity` as an idempotency/evidence digest, not as ownership identity.
- For matches, add a composite FK `(binding_id, organization_id, project_id, source_occurrence_id, registration_id, subject_id, definition_id)` to Binding and a matching occurrence FK to Observation. A matching Definition in a different occurrence must fail even when subject and IDs are equal.
- Existing `parameter_review_evidence` rows retain their IDs; their observation FK follows the expanded observation key.

### 2.6 Replacement projection and resolvers

`definition_replacement_projects` remains the historical old/new Binding projection (`server/migrations/0144_definition_replacement.sql:352-412`). Add a deferred completion guard requiring the old and new Bindings to have the same `source_occurrence_id`; a definition replacement that moves the source root is blocked and must use a new occurrence workflow. The existing current-binding view continues to hide completed old Bindings.

Add a new resolver with a distinct name, for example:

`parameter_catalog.resolve_current_binding_by_source_occurrence(text project_id, text source_occurrence_id, text definition_id) returns text`

It must:

- resolve the completed replacement projection first, then the unsuperseded source-backed Binding;
- return no result for zero candidates;
- raise a typed ambiguity error for more than one candidate or for a replacement whose occurrence differs from the old Binding;
- never use `limit 1` to hide duplicate ownership;
- preserve the existing three-text-argument `resolve_current_binding(project, logical_node, definition)` as the DTS compatibility projection until B1 completes, but remove its current arbitrary `limit 1`: zero candidates return no result and multiple replacement/base candidates raise the same typed ambiguity error.

### 2.7 Parent ownership and deletion rules

Before occurrence FKs are validated, add tenant-complete unique keys to the existing project/config-set/file/version/revision-member tables that are used as composite FK targets. Then enforce:

- source occurrence → config set/file: `on delete restrict`;
- source pin → occurrence/file version/config revision: `on delete restrict`;
- Binding, ProjectValue, observations, matches, drafts, requests and replacement history: existing `on delete restrict` semantics remain;
- file rename is allowed when `file_id` is stable;
- file/config-set/project/organization reassignment is rejected once referenced; creating a new file/instance is the required move operation;
- JSON root/schema relocation creates a new `configuration_instance_id` and has no automatic history transfer.

### 2.8 Additive pinned-graph correction proposal (2026-09-17)

Historical design gate: both independent Spec (`t06_status_audit`) and Standards (`t11_design_spec`) reviewers approved the concrete design below on 2026-09-17 before implementation authorization. Both found that row-selected protection did not freeze the complete exported graph and an unpinned DELETE incorrectly returned NEW. This was subsequently implemented as 0152; its frozen bytes are preserved. The later [accepted repair contract](source-occurrence-review-repair-design.md) authorizes only the separate unpublished-0151 repair and additive 0153 guards. Recheck migration numbering against current main before integration.

The invariant is revision-wide after the first pin, not limited to the selected property: all revision members, logical-node revisions, node/property occurrences and ordered effects (including null-property delete effects) remain immutable. A prepared new revision is built completely before its first pin; new versions/revisions remain the supported write path. The successor replaces the existing protection function without changing its owner, SECURITY DEFINER, fixed search_path or restricted EXECUTE ACL. Six source-graph triggers cover INSERT/UPDATE/DELETE, checking the union of OLD and NEW affected revision IDs (revision rows use id; child rows use config_revision_id). If any affected revision has a pin, return SQLSTATE 55000. For permitted unpinned deletion return OLD; for permitted inserts/updates return NEW. Do not disable FK/trigger checks or rewrite existing pin/history identities.

A transaction-only source lock does not protect history after commit. On every file-version referenced by any member of a pinned revision, reject every UPDATE/DELETE, not only changes to the target pin's version. On pinned-member file rows, reject DELETE and allow UPDATE changes only to `file_name`, `current_version_id` and `updated_at`; all other columns, including identity/organization/project/config-set/format, stay unchanged. This does not freeze a current tip or display name into historical identity. New unreferenced versions remain allowed. Keep source objects content-addressed; this SQL does not claim cross-store atomicity or protect an administrator replacing object bytes outside the store contract.

Concurrent first-pin creation and legacy graph/version mutation use this concrete protocol:

1. Every initial pin owner (`catalogProjectValueSync`, JSON registration, migration adapter, replacement and approved source commit) discovers the whole source graph, acquires the workflow's complete ordered source-prefix locks, rechecks membership, and only then reads authoritative bytes/facts. Discovery of an existing pin may precede locks; loading its source bytes may not. A newly prepared revision is built fully in the owning transaction before its first pin. Reuse the source owner lock operation; do not invent a trusted caller flag or SQL proxy.
2. The pin BEFORE INSERT trigger locks its revision `FOR UPDATE NOWAIT`. If no pin yet exists, it executes a real `UPDATE dts_config_revisions SET id=id`, then rechecks ownership and inserts the pin. Subsequent pins do not touch the tuple again. This tuple-version barrier makes a writer with an older REPEATABLE READ snapshot fail with `40001` instead of treating the revision as unpinned. The successor also touches every existing pinned revision once, under its migration fence. A revision UPDATE with every value unchanged is the only pinned-graph no-op exception; every actual field change still fails with `55000`.
3. Graph mutation triggers derive OLD/NEW affected revisions, lock them lexically with `FOR UPDATE NOWAIT`, then read pins. A legacy writer already holding a child row must immediately refuse contention; it must never wait for an earlier-rank revision. File/version triggers discover *all* members referring to either OLD/NEW identity before inspecting pin state, lock their revisions in the same way, then re-read the complete member-ID/identity set and pins. Changed membership refuses rather than adding previously undiscovered locks. Version membership recheck also belongs in the source-prefix owner fence.
4. SQL triggers only lock/touch revisions, not an undocumented full prefix. Grant only `UPDATE(id)` on `public.dts_config_revisions` to the existing `NOLOGIN catalog_migration_owner`, retaining its SELECT and fixed SECURITY DEFINER search path. No runtime synchronizer/governance/coordinator role receives authority. New trigger functions retain owner-only EXECUTE ACL. Verify with the actual owner, not test-superuser privilege.
5. `55P03` and `40001` are retryable conflicts with whole-transaction rollback; never continue using a failed transaction. Keep reservation/publication/finalization separate and never hold source locks across network/publication. No new runtime table locks or generic locking framework.

Required real PostgreSQL cases: a two-member/two-node graph with unselected properties and a null-property delete effect; each table's pinned insert, old-unpinned to new-pinned move, unselected-row update/delete; every member's version metadata drift; allowed display rename/current-tip change; real unpinned DELETE RETURNING plus committed absence and rollback restoration; mixed pinned/unpinned statement rollback; pin-versus-mutation two-connection races in both directions; exact historical export remains byte-identical; owner/ACL negatives remain unchanged. These cases are additive to the existing migration, source-proof and workflow tests. A local superuser structural test alone is not role-faithful acceptance.

## 3. Backfill and cutover order

Phases A/B/C/D are logical checkpoints inside one transaction; no gap may leave an old writer able to race the proof.

### Phase A — expand without behavior change

1. Create the unified occurrence table and the unified typed source-pin table, both owned by `catalog_migration_owner`.
2. Add nullable `source_occurrence_id` and pin references to existing tables. Add tenant-complete candidate keys and `NOT VALID` FKs where PostgreSQL ordering requires it.
3. Add the occurrence resolver, deferred ownership/one-of/placeholder triggers, and exact ACLs. Existing logical-node writers and resolver remain active; no JSON writer is enabled.

### Phase B — read-only provenance preflight

The migration first acquires an actual PostgreSQL writer fence in the same transaction, before reading provenance. In this exact order, issue `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` for `dts_config_set`, `project_parameter_files`, `project_parameter_file_versions`, `dts_config_revisions`, `dts_config_revision_members`, `dts_node_occurrences`, `dts_property_occurrences`, `dts_logical_nodes`, `dts_logical_node_revisions`, `dts_occurrence_effects`, `parameter_catalog.project_parameter_bindings`, `parameter_catalog.project_parameter_values`, `parameter_catalog.parameter_observations`, `parameter_catalog.parameter_observation_matches`, `project_parameter_value_drafts`, `project_parameter_value_change_requests` and `parameter_catalog.definition_replacement_projects`; then lock the affected rows in each table by sorted ID. Hold the locks through preflight, backfill, compare and switch; Phase A/B/C/D are one atomic transaction with no gap in which an old writer can race the proof. The fence is a database `LOCK`/`FOR UPDATE` boundary, not an advisory-only application convention.

For every existing canonical Binding, current ProjectValue, observation, match and pending canonical draft/request:

1. Prove organization → project → config set → immutable file ID ownership.
2. Resolve DTS provenance through the historical `config_revision_id` and `dts_config_revision_members.file_version_id`, then `dts_property_occurrences.file_version_id`; never use the current file version. An explicit DTS source reference must resolve to exactly one historical member/locator. An opaque `config-set:<id>` reference must resolve to exactly one matching effect.
3. Reject a placeholder source as a value pin, missing revision, missing file/version, cross-tenant owner, contradictory locator, zero match or more-than-one match. A placeholder current value is a preflight blocker even when the Binding root is proven: abort the whole upgrade because no current source pin exists, retaining the old schema/data. Historical non-current placeholder values may remain as immutable lineage after the root is proven; a runtime transient placeholder is permitted only inside the same atomic append that installs its proven source-backed replacement.
4. For any existing JSON canonical identity, require an already persisted reviewed ConfigurationSchema, instance ID, file ID and root pointer. No filename or Definition-key inference is accepted.
5. Emit an actionable blocker tuple `(table, row_id, organization_id, project_id, reason, candidate source rows)` and abort the whole migration if any existing Binding, observation or match is unproven. The old schema/data remain usable. An unpinned current tip or pending draft/request blocks enabling the workflow; an unpinned non-current historical placeholder may remain immutable lineage only after the Binding root is proven.

### Phase C — all-or-nothing backfill

Inside one migration transaction, after a clean preflight:

- Insert one source occurrence per proven root natural key and verify replayed metadata exactly agrees.
- Set Binding `source_occurrence_id` while preserving every existing Binding ID and `logical_node_id` value. The deferred current-tip guard must pass for every non-placeholder current value; historical pins are not incorrectly forced to match the current tip.
- Insert source pins for every proven current ProjectValue; retain placeholder ProjectValue rows without pins as explicit non-source history only after the Binding root is proven.
- Set observation/match occurrence links and validate all composite FKs.
- Add source-pin IDs to existing pending rows only when their exact base value is proven.

Any contradiction raises an error and rolls back every new relation row and every link. It must not partially quarantine data or claim completion.

### Phase D — compare, fence, switch

1. Compare old DTS resolver results with occurrence resolver results for unmodified rows, completed replacements and duplicate/ambiguous cases. Compare Binding IDs, current tips, observation/match IDs and source-pin digests. Remove arbitrary `limit 1` behavior from the retained compatibility resolver: zero candidates returns no result, while multiple base/replacement candidates raise a typed ambiguity error.
2. Extend identity immutability and validate the new FKs only after the backfill is complete. Fence logical-node-only writers; new source-backed writes require an occurrence and exact source pin.
3. Add the source-occurrence uniqueness index and switch canonical reads/writes to it. Keep `logical_node_id`, the old resolver and old projection queries until the full B1 matrix passes.
4. On a post-switch runtime defect, fence new writes and revert readers to the retained DTS projection. Do not rewrite an applied migration or perform an ad hoc downgrade.

## 4. ACL and trigger contract

Follow the existing role model in `server/migrations/0138_canonical_parameter_catalog_roles.sql:1-33,233-322` and publication roles in `0140_catalog_publication_control_plane.sql:1041-1107`:

- `catalog_migration_owner` owns all new relations/functions and performs preflight/backfill. It is `NOLOGIN`; no production login can `SET ROLE` to it.
- `catalog_synchronizer_role` receives no new direct source-occurrence, source-pin, Binding or ProjectValue authority. Existing canonical writer boundaries remain the only application write path; any required owner-mediated insert is covered by the existing owner/security-definer contract, not by a new role grant.
- `parameter_governance_writer_role` retains its existing observation/match `SELECT/INSERT` grants. It receives no direct source-occurrence, Binding or ProjectValue DML; security-definer deferred checks enforce occurrence ownership.
- `catalog_publication_coordinator_role` and `catalog_baseline_reader_role` receive no new source-occurrence or pin authority. Any required read is through an already-authorized owner/security-definer boundary; neither can mutate occurrence, pin or Binding identity.
- `PUBLIC` receives no schema/table/function access. The new resolver is owner-only: explicitly revoke `EXECUTE` from `PUBLIC`, `catalog_synchronizer_role`, `parameter_governance_writer_role`, `catalog_publication_coordinator_role` and `catalog_baseline_reader_role`, matching `0144`'s existing resolver policy. No same-signature overload is added.
- Identity triggers are `SECURITY DEFINER`, owned by `catalog_migration_owner`, with search paths fixed to `pg_catalog, parameter_catalog`. No writer role receives trigger-function `EXECUTE`.

## 5. Focused evidence required before implementation can claim green

- Real PostgreSQL migration tests: `server/modules/parameter-topology/schemaMigration.test.ts`, `server/modules/parameter-bindings/binding/binding.integration.test.ts`, `binding/concurrency.integration.test.ts`, and a populated upgrade case covering placeholders, missing/duplicate provenance and preserved IDs.
- Observation/replacement tests: `server/modules/parameter-catalog-migration/evaluate.test.ts`, `provenance.integration.test.ts`, `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts`, plus explicit occurrence-resolver equality and ambiguity cases.
- Source-pin/workflow tests: `server/modules/parameter-bindings/drafts/drafts.integration.test.ts`, `catalogProjectValueSync.integration.test.ts`, and authenticated route tests. Existing DTS export/reimport at `drafts/drafts.integration.test.ts:572-606` must be extended to assert historical file-version pinning, not current-snapshot selection.
- JSON seam tests: `server/modules/parameter-files/parseIndex.test.ts`, `writebackService.test.ts`, candidate tests, and strict pointer/duplicate-key/precision/array negatives. These tests prove parser/writeback behavior; they do not replace migration or auth evidence.
- ACL canaries must assert exact role grants and SQLSTATE `42501` negatives. Counts, failures, skips, dedicated database identity and the independent Spec/Standards review remain explicit evidence fields.

This contract is the T1.1 design boundary only. It does not authorize schema implementation, T1.2, migration execution, PR, merge or target qualification.
