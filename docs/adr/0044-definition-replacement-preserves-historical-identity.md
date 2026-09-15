# ADR-0044: Definition replacement preserves historical identity while migrating current references

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0044-definition-replacement-preserves-historical-identity.md)

Date: 2026-09-14

## Status

Accepted as the contract freeze for the governed Definition identity correction migration of [#847](https://github.com/tzrea1-Q/WiseEff/issues/847) (issue decisions 17 and 18). This record is ADR-0044. The next unused ADR number in `docs/adr/` after ADR-0043 is 0044; 0040–0043 remain the canonical model, publication-integrity, registration, and catalog-authoring decisions.

This ADR records the frozen semantic contract that implementation must satisfy. It does **not** by itself certify that migration `0144`, the replacement relations, the current-selection projection, the HTTP routes, the new module, the UI, or any threat-matrix row are complete and verified; that certification comes from the executable matrix rows and the plan's gates, not from this record.

The plan of record is [Parameter definition workspace restoration and governed identity migration (#847)](../exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md). The frozen, row-by-row design is [Definition identity correction migration — frozen threat matrix and interface design (R3, sealed)](../exec-plans/active/2026-09-14-definition-identity-correction-threat-matrix.md); its sections 1–7 are the normative source for the names and rules recorded here.

The frozen freeze statement fixes migration `0144`'s relation names. Where the plan of record's earlier architecture sketch names the per-project relation `parameter_catalog.project_parameter_binding_replacements`, this ADR records the frozen name `parameter_catalog.definition_replacement_projects`. Renaming either relation requires an explicit re-freeze recorded in the matrix, not an implementation choice.

### Persisted relations

The frozen design names two relations. The implementation adds one more,
`parameter_catalog.definition_replacement_previews`, because the frozen HTTP
contract returns a `previewId` and an `expiresAt` from preview and `create`
binds to that exact preview identity; the preview therefore has to be persisted.
It is a preview-evidence relation only: it stores the frozen fingerprint, the
minted successor Candidate reference, the per-project frozen tips and the
computed impact/blockers, and it never holds Catalog truth.

## Context

[ADR-0017](0017-definition-identity-is-correctable.md) established that definition identity is correctable and that the identifier is a surrogate, not a meaning. [ADR-0033](0033-identity-mapping-uses-protected-re-resolve.md) established protected re-resolve for identity mistakes, and [ADR-0034](0034-referenced-property-key-rename-is-a-source-cutover.md) established that a referenced property-key rename is a staged source-rewriting cutover rather than an in-place edit.

[ADR-0040](0040-canonical-parameter-catalog-relational-model.md) then removed the room for an in-place correction: `(subject_id, property_key)` is permanent and unique across all history; a `ParameterDefinition` is an opaque stable identity; every persisted content change mints an immutable `DefinitionRevision`; a Binding's identity columns (`organization_id`, `project_id`, `logical_node_id`, `registration_id`, `subject_id`, `definition_id`) are immutable; a `ProjectValue` is immutable and pinned to the exact revision used to interpret it; and historical replay reads a pinned release membership and definition head instead of `catalog_state`. [ADR-0042](0042-organizations-register-canonical-subjects-once.md) makes registration and placement explicit organization acts, and [ADR-0043](0043-catalog-authoring-and-online-publication.md) makes a frozen Candidate plus bound Authorization plus the unique synchronizer the only way a definition identity becomes real — and states explicitly that a later registration failure must not present a successful Catalog publish as rolled back.

An operator who approved a wrong property key or the wrong Catalog subject therefore cannot fix it by editing the definition, reusing the key, or repointing existing bindings. The only lawful correction is to publish a **replacement identity** as a new definition through the existing publication pipeline, and then migrate the *current* references of an explicitly selected, authorized project manifest from the old identity to the new identity, per project, with explicit continuation of any project that cannot be migrated.

The capability is **coordination, not a new engine and not a second Catalog writer**. It orchestrates typed authoring and complete-successor building, Candidate/Artifact/Authorization and the publication job, synchronizer materialization, source-candidate rewrite, Binding/ProjectValue mutation, and trusted audit — each of which already owns its transaction boundary. It never inserts or updates `parameter_catalog.parameter_definitions`, `definition_revisions`, `catalog_release_definition_heads`, `catalog_state`, `catalog_subjects`, release membership, aliases, or `catalog_activation_receipts`; the replacement record only *references* the published Candidate and job.

The compatibility duty is absolute. The old definition, old revisions, old Binding, old ProjectValues and old `binding_history_events` bytes stay readable and interpretable for the lifetime of the data. Historical, pinned and revision-addressed reads never consult the replacement projection.

## Decision

### 1. The approved replacement record and its per-project manifest

The frozen design puts the approved replacement semantics in two relations in the existing `parameter_catalog` schema, and both follow its physical style (opaque `text` ids, `unique` constraints, `on delete restrict`, deferrable composite foreign keys, append-only triggers through `parameter_catalog.reject_immutable_catalog_change()` in `server/migrations/0137_canonical_parameter_catalog_schema.sql`). Both are added by migration `0144`.

`parameter_catalog.definition_replacements` is the approved replacement record. It freezes the old identity triple and base revision (`old_definition_id`, `old_subject_id`, `old_property_key`, `old_revision_id`) and the replacement identity triple and revision (`new_definition_id`, `new_subject_id`, `new_property_key`, `new_revision_id`), together with the frozen `preview_fingerprint`, the predecessor `preview_catalog_release_id` / `preview_catalog_release_digest`, the `candidate_id` / `publication_job_id` / `authorization_id` evidence reference, the approval and approver principals, the governance `reason`, and `created_at`. Composite foreign keys prove that each identity triple is a real `(id, subject_id)` definition and that each revision belongs to its definition; a `check` requires `old_definition_id <> new_definition_id`, because `(subject_id, property_key)` is permanent and unique.

A `before update or delete` trigger freezes `id`, every `old_*` and `new_*` column, `preview_fingerprint`, the preview release pins, the Candidate/job/Authorization reference, `approval_principal_id`, `reason` and `created_at`; `DELETE` raises `55000`. The **mutable** columns are only `status` (`pending | executing | completed | blocked | failed`), `replacement_version` (the ETag / `If-Match` version), `success_audit_ref`, `superseded_at`, and `updated_at`.

`parameter_catalog.definition_replacement_projects` is the per-project scope manifest. One row per `(replacement_id, project_id)` carries the old→new pairing — `old_binding_id`, `old_value_id`, `new_binding_id`, `new_value_id` — plus a denormalized `old_definition_id` / `new_definition_id` so composite foreign keys can prove ownership, and `status` (`pending | completed | blocked | failed`), `blocker_reason`, `blocked_evidence`, `attempt_count`, and the last error class and reason. A `check` requires that `new_binding_id` and `new_value_id` are non-null exactly when the row is `completed`, so the binding/value pair is written only inside the project's completing transaction and a retry cannot duplicate bindings or values. `foreign key (project_id, organization_id)` references `public.projects(id, organization_id)`; this is the database-level barrier against cross-organization project selection. A trigger freezes the manifest identity columns and forbids deletion.

### 2. The current-selection rule

A single SQL seam decides which binding is effective for a current operation. For a current operation on `(organization_id, project_id, logical_node_id, definition_id)`, the effective binding is resolved through the replacement projection: when a `definition_replacement_projects` row with `status = 'completed'` names the queried binding as its `old_binding_id`, the **new** binding is effective and the queried old binding is historical; otherwise the queried binding itself is effective.

Migration `0144` exposes that rule as `parameter_catalog.current_project_parameter_bindings`, a view over `parameter_catalog.project_parameter_bindings` that excludes every binding which is the `old_binding_id` of a `completed` replacement project, plus the exact-identity helper `parameter_catalog.resolve_current_binding(p_project_id, p_logical_node_id, p_definition_id)` returning the effective binding id. The helper follows the completed replacement edge exactly once; migration `0144` rejects a new replacement whose target definition is itself the `old_definition_id` of another non-`failed` replacement, so no chain can form.

**Historical, pinned and revision-addressed reads never consult the replacement projection.** They address the exact binding id and the exact `definition_revision_id` they were pinned to, so documented release replay, value-history reads by binding and revision, and the legacy `public.project_parameter_bindings` consumers keep their existing interpretation. The projection is a current-selection rule only.

### 3. Value provenance on the immutable `project_parameter_values` relation

A migrated project appends one new immutable row to `parameter_catalog.project_parameter_values` under the new binding, and that row records where its bytes came from. Migration `0144` adds the nullable `replaced_from_value_id` column plus the candidate key and composite foreign key that prove the referenced row is a real value row of the old definition — not an arbitrary pointer — and a `check` forbidding self-reference. The existing append-only trigger still rejects every `UPDATE` and `DELETE`, so the new columns are populated only at `INSERT`.

A carried-forward row keeps `value`, `value_digest`, `value_kind`, `source_ref` and `config_revision_id` byte-identical to the old row and pins the new `definition_id` and the approved `definition_revision_id`. A value that is incompatible with the replacement revision is never inserted, converted, truncated, clamped, or replaced by a default: the project goes `blocked` instead.

### 4. A write naming a replaced current binding is rejected

Three layers reject a write that names a binding which has been replaced:

1. **Port layer.** The resolver returns the new binding, so an operation naming the old binding is answered with the existing typed block shape carrying reason `binding-replaced` (`server/modules/parameter-bindings/adapters/dto.ts` through `writebackAdapter.ts`).
2. **Lock layer.** `loadBindingById(..., "update")` and `casCurrentTip` are constrained to the current-binding view, so a stale writer loses its row lock rather than appending a value.
3. **Database layer.** Migration `0144` adds the deferrable, initially deferred constraint trigger `parameter_catalog.assert_value_target_binding_is_current()` on `after insert` of `parameter_catalog.project_parameter_values`, raising `55000` with `constraint = 'project_value_current_binding_ck'` when `new.binding_id` is the `old_binding_id` of a `completed` replacement project. It mirrors the existing `assert_binding_effective_revision_is_verified_head()` pattern in `server/migrations/0137_canonical_parameter_catalog_schema.sql`.

The database is therefore the last line: even a writer that bypassed the port and lock layers cannot append a current value to a replaced binding.

### 5. Exactly one current successor per old definition

A partial unique index — `definition_replacements_current_successor_unique` on `(old_definition_id)` `where status in ('pending','executing','completed','blocked')` — admits at most one non-`failed` replacement per old definition. A `failed` row is excluded so a fresh preview may retry after a genuine failure. A `blocked` row deliberately **holds the slot**: continuation of the blocked replacement, not a second replacement, is the correction path for that old definition.

### 6. Confirmed defaults

These are the confirmed issue-spec defaults (decision 17); the replacement semantics above must not weaken them.

1. Reference migration is limited to **explicitly selected projects the actor can manage in the current organization**. Other organizations are unchanged, and the manifest is the authorized scope — never a discovered or inferred one.
2. After an exact impact confirmation, eligible projects advance automatically; blocked projects are retained for continuation.
3. The old definition stays available during and after migration and is **never automatically deprecated** by preview, execute or continue.
4. Separate deprecation is offered only after authoritative evidence shows the relevant current references are migrated; an incomplete scoped usage count does not prove global completion.
5. Incompatible values and pending or conflicting work block the affected project: there is **no** automatic conversion, truncation, default substitution, draft discard, or approval repinning.
6. A property-key correction reuses the established DTS source-preserving capability (`server/modules/parameter-specs/propertyKeyCutover.ts`); other source formats are not silently declared supported.

### 7. Source format is decided by DTS provenance, not by string-sniffing the recorded ref

The dts ingest path records the write the operator approved — `config-set:<configSetId>` — on the canonical value row, while the actual `.dts` file and node the value came from live in `dts_property_occurrences`. Append-only value rows cannot be backfilled, so the capability resolves the source location from that provenance at preview and execute time (`server/modules/parameter-catalog-migration/evaluate.ts`, `resolveSourceLocation`):

- a recorded ref that already names a `.dts` location is used as-is;
- a recorded ref that names a real non-`.dts` file (`config/c.yaml`) blocks with `unsupported-source-format`;
- the opaque `config-set:` ref is resolved through the occurrence, and blocks with `missing-source-provenance` when nothing matched, `ambiguous-source-match` when two occurrences of the key exist at the same location in one file, and `unsupported-source-format` when the matched file is not `.dts`;
- a resolved location is `<file>.dts` or `<file>.dts!<node locator>`, and the property key stays separate so coupled-source detection compares file plus node.

The failure reasons above are evaluated identically at preview and at execute, and a resolved-at-preview source that no longer resolves is `stale-preview` rather than a silently accepted rewrite. New writes record the resolved `.dts` location directly (`server/modules/parameter-bindings/catalogProjectValueSync.ts`), and `resolveConfigRevisionForSource` accepts both ref shapes so a later canonical save still resolves its config set. Rewriting the source file bytes remains the property-key cutover capability's job; this capability moves the value's provenance to the corrected identity.

### 8. Create observes activation; it never performs the install

Publication of the successor identity stays with the publication manager (CP-07 isolation, ADR-0043 §5). The API enqueues the job through the existing Candidate/Authorization path and then **observes** the manager's Activation Receipt (`server/modules/parameter-catalog-api/productionWire.ts`):

- while no receipt exists the command answers the existing retryable `catalog-not-ready` with the frozen preview retained;
- once the receipt exists the same keyed command persists the approved replacement, because the preflight accepts the successor release this preview minted as the current release as well as the base release it was previewed against.

The frozen preview, its fingerprint, the manifest and the idempotency identity are unchanged across those attempts, so the retry is one command, not a second approval. The dialog performs that bounded retry itself (refreshing only the release pin) instead of reporting a failure the operator would have to guess about.

### 9. Only the release under correction has open review work

An open `parameter_review_items` row captured for a superseded release is no longer listed and can no longer be resolved through the current-release surface. Counting those leftovers as open work would block every correction on an upgraded instance forever, so `countOpenReviewItems` counts open items captured for the release being corrected, matching the reviewer queue's own rule. Drafts remain release-scoped through their base revision and release.


## Consequences

### Historical identity and the two history events

Migration of one project writes **two** `parameter_catalog.binding_history_events` rows: one on the old binding when its value pointer changes, and one on the new binding. This is forced by `parameter_catalog.assert_binding_history_event_owners()` (the `binding_history_event_owner_fk` constraint trigger in `server/migrations/0137_canonical_parameter_catalog_schema.sql`), which requires every referenced revision and value to belong to the same binding and the same definition. An old→new pair spans two bindings by construction, so one event cannot carry it. The design does **not** relax the trigger: each event is internally consistent, and the cross-identity linkage is read from `definition_replacement_projects` and `replaced_from_value_id`.

### A successful Catalog publish is never presented as rolled back

Publication of the replacement identity and migration of references are separate transaction boundaries. When the Catalog publish succeeds but registration, preparation or a per-project write fails afterwards, the replacement records `blocked` (or a project records `blocked` with its blocker reason) — **not** a rollback of the Catalog release. `catalog_state.current_catalog_release_id` and the Activation Receipt stay exactly as published. Presenting a successful publish as undone would contradict ADR-0043's rule that a later registration failure must not present a successful Catalog publish as rolled back, and it would leave the Catalog inconsistent with its own receipt.

### Recovery is explicit continuation

Recovery is an explicit HTTP `continue` through the governance boundary, not a second scheduler and not a background manager step. A manager job would need its own authorization re-check and would duplicate `installPublishedRelease`'s transaction ownership. Execution and continuation are idempotent per organization-scoped `parameter_catalog.governance_command_idempotency` family — `definition-replacement-execute` and `definition-replacement-continue` — keyed by `(organization_id, command_family, idempotency_key)` with a `request_fingerprint` over the canonical command model. A replayed command reports `outcome: "replayed"` with unchanged row counts; the same key with a different body is a typed conflict. Committed projects stay committed, uncommitted projects stay `pending`, and a restart duplicates nothing.

### Deprecation is a separate evidence-gated act

Retiring the old definition is not part of migration. Deprecation is a distinct governance act offered only after authoritative evidence shows the relevant current references are migrated. A usage count computed over a project scope cannot prove global completion, so a scoped count alone is refused, and the old definition stays `active` while any current reference outside the counted scope may exist.

### Trade-offs

- **The old definition keeps its current-reference count until every project is migrated.** Until the last project commits, the old identity remains genuinely current somewhere. That is why usage counts and catalog read surfaces must count only the current-binding view: counting raw `project_parameter_bindings` would keep a phantom count on the old definition after migration.
- **A blocked replacement holds the single-current-successor slot.** Because the partial unique index includes `blocked`, a different correction for the same old definition cannot start until the blocked replacement is continued to completion or explicitly failed and superseded. This is deliberate — two competing replacements for one identity would be worse than a serialized one — but it makes continuation a required operator action rather than an optional one.
- **Current reads pay one projection lookup.** Every current-binding read gains a lookup against the replacement projection. The design keeps this to one view predicate or one exact-identity helper call rather than a join chain, and confines the cost to current reads, since historical and pinned reads are untouched.

## Required verification owners

The executable matrix is the frozen threat matrix in `docs/exec-plans/active/2026-09-14-definition-identity-correction-threat-matrix.md` (63 rows). ADR-level invariants that must remain true:

- Old definition, revision, binding, value and history bytes remain byte-identical to their pre-migration values (matrix `IV-01`, `IV-02`, `IV-06`).
- A carried-forward value keeps `value`, `value_digest`, `value_kind`, `source_ref` and `config_revision_id` identical and records `replaced_from_value_id` (`VL-01`).
- An incompatible value blocks its project with no conversion, truncation or default substitution (`VL-02`).
- A current read returns exactly one effective binding, and usage counts agree with it (`IV-04`).
- A write naming a replaced current binding fails with `binding-replaced` at the port layer and `project_value_current_binding_ck` at the database layer (`IV-05`).
- At most one non-`failed` replacement exists per old definition, while a `failed` row may be superseded (`IV-03`).
- Catalog success followed by registration or preparation failure leaves the current Catalog release and Activation Receipt unchanged and records `blocked` (`PA-01`).
- Repeated execute or continue with the same idempotency key creates no duplicate binding, value or history row (`RC-01`–`RC-05`).
- A same-key create retried after the publication manager activated the successor persists exactly one replacement and migrates the manifest exactly once (`PA-02`, `RC-01`).
- Source format, ambiguity and missing provenance are decided from DTS provenance and block with the documented reason at both preview and execute (`SR-01`–`SR-05`).
- An open review item captured for a superseded release does not block a correction of the current release and stays untouched (`VL-05`).
- Cross-organization project, binding and actor selection fails closed (`TN-01`–`TN-04`, `AU-01`–`AU-04`).
- The old definition is never auto-deprecated, and a scoped usage count never proves global completion (`IV-08`, `IV-09`, `IV-10`).
- The deferrable constraint triggers inherited from migration `0137` — including `binding_history_event_owner_fk` and `project_parameter_binding_effective_revision_head_fk` — remain deferrable and initially deferred after `0144` (`IV-14`).
