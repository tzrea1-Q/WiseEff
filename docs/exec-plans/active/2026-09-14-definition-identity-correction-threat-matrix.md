# Definition identity correction migration — frozen threat matrix and interface design (R3, sealed)

Lane: `feat/847-parameter-definition-ux-restoration`, worktree `../WiseEff-worktrees/issue-847-parameter-definition-ux`, base `6d72e17cb`.
Issue: [#847](https://github.com/tzrea1-Q/WiseEff/issues/847). Plan of record: `docs/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md`.
Status: **frozen design**. This document is the only artifact of the R3 sealed lane. No product source file is modified by it. Every claim cites a file and line actually read in this worktree.

Execution status (2026-09-15, implementation lane). The frozen table below still names the *planned* evidence file per row; the implemented suite consolidated those cases into fewer files. Executed rows and their real evidence:

- `server/modules/parameter-catalog-migration/preview.integration.test.ts` — ID-01, ID-02, VL-08, VL-09, TN-02.
- `server/modules/parameter-catalog-migration/execute.integration.test.ts` — RT-02, RT-03, RT-04, SR-01, SR-02, SR-04, ST-02, ST-04, VL-05, VL-06, IV-06, IV-09, IV-10, RC-01, TN-03, TN-04, AU-03.
- `server/modules/parameter-catalog-migration/guards.integration.test.ts` — IV-03, IV-05, IV-09, IV-10, RC-02, RC-03, RC-04, RC-05, RC-06, TN-03, TN-04, AU-03, ST-04.
- `server/modules/parameter-catalog-migration/provenance.integration.test.ts` (new) — SR-02, SR-03, SR-05/ID-02 for opaque `config-set:` provenance, and VL-06 for a review item captured for a superseded release.
- `server/modules/parameter-catalog-migration/evaluate.test.ts` (new) — SR-01, SR-02, SR-03, SR-05 pure resolution rules.

Rows whose planned evidence file does not exist and whose scenario is not reachable on the local lane (HTTP-surface governance rows, second-tenant rows, object-store byte-rewrite rows) stay unexecuted and are listed in the plan of record's verification section.

Line-number provenance: every citation was read against this worktree during the freeze. A concurrent Wave-1 implementation lane was mutating `server/modules/catalog-kernel/interface.ts` and `server/modules/catalog-kernel/runtime/currentSnapshot.ts` at freeze time; the only `catalog-kernel` citation in this document (`interface.ts:61`, `DefinitionLifecycle`) precedes that edit region, and every `server/modules/parameter-catalog-api/**` and migration citation is against the base `6d72e17cb` blob. If a later rebase shifts a cited line, treat the named symbol as authoritative over the number.

---

## 1. Scope and authority statement

**One new high-level contract: Definition identity correction migration.** It publishes an approved replacement identity for an existing canonical `ParameterDefinition`, then migrates the *current* references of an explicitly selected, authorized project manifest from the old identity to the new identity, reporting per-project progress and allowing continuation of blocked projects.

**It is coordination, not a new engine.** The capability orchestrates six capabilities that already exist and already own their own transaction boundaries:

| Coordinated capability | Existing owner read in this worktree |
| --- | --- |
| Typed authoring, complete-successor build, Candidate/Artifact/Authorization, publication job | `server/modules/catalog-publication/preview.ts:321-450`, `server/modules/catalog-publication/builder/completeSuccessor.ts:455-560,926-984`, `server/modules/catalog-publication/enqueue.ts:52-153` |
| Catalog materialization and head advancement | unique synchronizer / `installPublishedRelease`, ADR-0040 `docs/adr/0040-canonical-parameter-catalog-relational-model.md:28`, `:441` |
| Organization registration and retained placement | `server/modules/parameter-governance/registration/internalGuardedRegistrationWriter.ts:278-334`, ADR-0042 `docs/adr/0042-organizations-register-canonical-subjects-once.md:24-26` |
| Source-candidate rewrite (DTS source-preserving) | `server/modules/parameter-specs/propertyKeyCutover.ts:1-7,899-903,938-939` |
| Binding and immutable ProjectValue mutation | `server/modules/parameter-bindings/binding/repositories.ts:126-163`, `server/modules/parameter-bindings/values/repositories.ts:177-231` |
| Trusted audit | `server/modules/parameter-bindings/values/repositories.ts:233-263`, ADR-0042 `:104` |

**It is not a generic workflow framework.** No arbitrary step graph, no user-defined states, no second scheduler. The only lifecycle is `pending | executing | completed | blocked | failed` (plan `docs/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md:113-115`).

**It is not a second Catalog writer.** It never inserts or updates `parameter_catalog.parameter_definitions`, `definition_revisions`, `catalog_release_definition_heads`, `catalog_state`, `catalog_subjects`, release membership, aliases, or `catalog_activation_receipts`. The replacement identity only becomes real through the existing complete-successor Builder, Candidate Authorization and synchronizer (ADR-0040 `:28-29`, ADR-0043 `docs/adr/0043-catalog-authoring-and-online-publication.md:57,65`). The replacement record *references* the published candidate/job; it never authors catalog truth. ADR-0043 `:74` is explicit that a later registration failure must not present a successful Catalog publish as rolled back — the capability therefore records `blocked`, not a catalog rollback.

**Public contract shape.** `POST /api/v2/catalog/definition-replacements/preview`, `POST /api/v2/catalog/definition-replacements`, `GET /api/v2/catalog/definition-replacements/:replacementId`, `POST /api/v2/catalog/definition-replacements/:replacementId/continue`, `GET /api/v2/catalog/definition-replacements` (proposed route ids, §6). Progress is expressed as the per-project manifest plus a replacement-level status; continuation is explicit.

**Compatibility.** Old identity, old revision, old binding, old value and old history bytes remain readable and interpretable; historical pinned reads never consult the replacement relation (§4). New reads and writes of a completed project resolve the replacement's new binding. Migration never deprecates the old definition (§2).

---

## 2. Confirmed defaults (verbatim from the confirmed issue spec, decision 17)

Carried verbatim into this freeze; the same objects are named in the plan of record at `docs/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md:44-47` and `:113-115`.

1. Reference migration is limited to explicitly selected projects the actor can manage **in the current organization**; other organizations are unchanged.
2. After an exact impact confirmation, eligible projects advance automatically; blocked projects are retained for correction/continuation.
3. The old definition stays available during migration; migration never automatically deprecates it.
4. Separate deprecation is offered only after authoritative evidence shows the relevant current references are migrated; an incomplete scoped usage count does not prove global completion.
5. Incompatible values and pending/conflicting work block the affected project: no automatic conversion, truncation, default substitution, draft discard, or approval repinning.
6. Property-key correction retains the established DTS source-preserving capability; other source formats are not silently declared supported.

Default 6 is grounded in the existing gate: only `.dts` files are rewritten, everything else returns `unsupported-format` (`server/modules/parameter-specs/propertyKeyCutover.ts:899-903`), and the rewrite preserves the raw value while changing only the key (`:938-939`). Default 5 is grounded in the immutable value rule (ADR-0040 `:90`, `:131`) and the append-only trigger (§3).

---

## 3. Proposed persisted model — migration `0144`

New relations live in the existing `parameter_catalog` schema and follow its physical style: `text` ids with `id <> '' and btrim(id) = id and id !~ '[[:cntrl:]]'`, `unique` constraints, `on delete restrict`, deferrable FKs, append-only triggers via `parameter_catalog.reject_immutable_catalog_change()` (`server/migrations/0137_canonical_parameter_catalog_schema.sql:10-20`).

### 3.1 `parameter_catalog.definition_replacements` (the approved replacement record)

| Column | Type and constraint | Reads from / proves |
| --- | --- | --- |
| `id` | `text primary key check (id like 'drep_%' and id <> '' and btrim(id)=id and id !~ '[[:cntrl:]]')` | opaque stable id (ADR-0040 `:121`) |
| `status` | `text not null check (status in ('pending','executing','completed','blocked','failed'))` | replacement-level progress |
| `replacement_version` | `bigint not null check (replacement_version > 0)` | ETag/If-Match version; mirrors `definition_proposals.etag_version` (0137:3062) |
| `old_definition_id`, `old_subject_id`, `old_property_key`, `old_revision_id` | all `text not null`, non-empty/btrim/control checks | frozen old identity triple + base revision |
| `new_definition_id`, `new_subject_id`, `new_property_key`, `new_revision_id` | all `text not null`, non-empty/btrim/control checks | frozen replacement identity + revision |
| `preview_fingerprint` | `text not null check (preview_fingerprint ~ '^sha256:[0-9a-f]{64}$')` | frozen preview fingerprint (§7 risk 4) |
| `preview_catalog_release_id`, `preview_catalog_release_digest` | `text not null`, digest check | predecessor release the preview was computed against |
| `candidate_id`, `publication_job_id`, `authorization_id` | `text`, non-empty when present | authorization evidence reference |
| `approval_principal_id`, `approver_principal_id` | `text not null` control-free | approval/authorization evidence; approver ≠ author for non-self-approval (`server/modules/parameter-catalog-api/governance/errors.ts:93-102` is the existing self-approval precedent) |
| `reason`, `success_audit_ref` | `text not null` control-free | governance reason and success audit reference |
| `superseded_at` | `timestamptz` | a `failed` replacement may be superseded by a fresh preview |
| `created_at`, `updated_at` | `timestamptz not null default now()` | ordering only, never head selection (ADR-0040 `:127`) |

Keys and FKs:

- `unique (id, old_definition_id)` — lets the manifest and the partial index prove ownership.
- `unique (id, new_definition_id)` — lets the manifest FK prove the new binding belongs to this replacement.
- `foreign key (old_definition_id, old_subject_id) references parameter_definitions(id, subject_id) on delete restrict deferrable initially deferred` — uses the existing candidate key `unique (id, subject_id)` (0137:384).
- `foreign key (old_definition_id, old_revision_id) references definition_revisions(definition_id, id) on delete restrict deferrable initially deferred` — uses `unique (definition_id, id)` (0137:401).
- The same two composite FKs for `(new_definition_id, new_subject_id)` and `(new_definition_id, new_revision_id)`.
- `check (old_definition_id <> new_definition_id)` — identity correction always mints a distinct definition row because `(subject_id, property_key)` is permanent and unique (ADR-0040 `:126`, 0137:383).
- `foreign key (publication_job_id, candidate_id, authorization_id) references catalog_publication.publication_jobs(id, candidate_id, authorization_id) on delete restrict deferrable initially deferred` — reuses the existing candidate key (0140:618) exactly as `catalog_activation_receipts` does (`server/migrations/0140_catalog_publication_control_plane.sql:720-722`).
- **One-current-successor partial unique index**: `create unique index definition_replacements_current_successor_unique on parameter_catalog.definition_replacements (old_definition_id) where status in ('pending','executing','completed','blocked');` A `failed` row is excluded so a fresh preview may retry; `blocked` deliberately holds the slot so continuation, not a second replacement, is the correction path (default 2).

Immutability: a `before update or delete` trigger modelled on `protect_binding_identity()` (0137:1300-1324) freezes `id`, all `old_*`/`new_*` columns, `preview_fingerprint`, `preview_catalog_release_*`, `candidate_id`, `publication_job_id`, `authorization_id`, `approval_principal_id`, `reason`, `created_at`; `DELETE` raises `55000`. Mutable: `status`, `replacement_version`, `success_audit_ref`, `superseded_at`, `updated_at`.

### 3.2 `parameter_catalog.definition_replacement_projects` (per-project scope manifest with old→new pairing)

| Column | Type and constraint |
| --- | --- |
| `id` | `text primary key check (id like 'drepp_%' ...)` |
| `replacement_id` | `text not null references definition_replacements(id) on delete restrict` |
| `organization_id`, `project_id` | `text not null` |
| `status` | `text not null check (status in ('completed','blocked','failed','pending'))` |
| `blocker_reason` | `text check (blocker_reason is null or (blocker_reason <> '' and btrim(blocker_reason)=blocker_reason))` |
| `blocked_evidence` | `jsonb check (blocked_evidence is null or jsonb_typeof(blocked_evidence)='object')` |
| `old_binding_id`, `old_value_id` | `text not null` |
| `new_binding_id`, `new_value_id` | `text` (null until the project transaction commits) |
| `old_definition_id`, `new_definition_id` | `text not null` (denormalized so composite FKs can prove ownership) |
| `attempt_count` | `integer not null default 0 check (attempt_count >= 0)` |
| `last_error_class`, `last_error_reason` | `text` control-free when present |
| `created_at`, `updated_at` | `timestamptz not null default now()` |

Keys and FKs:

- `unique (replacement_id, project_id)`, `unique (id, replacement_id)`.
- `check ((status = 'completed' and new_binding_id is not null and new_value_id is not null and blocker_reason is null) or (status <> 'completed' and new_binding_id is null and new_value_id is null))` — a binding/value pair is written only inside the project's completing transaction, so retries cannot duplicate values or bindings (plan `:46`).
- `foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete restrict` — uses `projects_id_organization_unique` (0137:1127-1128). This is the database-level barrier against cross-organization project selection (default 1).
- `foreign key (replacement_id, new_definition_id) references definition_replacements(id, new_definition_id)`.
- `foreign key (old_binding_id, old_definition_id) references project_parameter_bindings(id, definition_id) on delete restrict` — uses `unique (id, definition_id)` (0137:1149).
- `foreign key (new_binding_id, new_definition_id) references project_parameter_bindings(id, definition_id) on delete restrict deferrable initially deferred`.
- `foreign key (old_binding_id, old_value_id) references project_parameter_values(binding_id, id) on delete restrict` and the deferred `(new_binding_id, new_value_id)` twin — uses `unique (binding_id, id)` (0137:1217).
- `alter table parameter_catalog.project_parameter_bindings add constraint project_parameter_bindings_id_org_project_unique unique (id, organization_id, project_id)` (new in 0144) so the manifest can additionally prove `(old_binding_id, organization_id, project_id)` agreement with one composite FK.

A trigger modelled on `protect_registration_identity()` (0137:3283-3306) freezes `id`, `replacement_id`, `organization_id`, `project_id`, `old_binding_id`, `old_value_id`, `old_definition_id`, `new_definition_id`; `DELETE` raises `55000`.

### 3.3 Value provenance on the immutable `project_parameter_values` relation

New immutable rows carry the old→new linkage. 0144 adds two nullable columns and one candidate key, without touching any existing row:

- `alter table parameter_catalog.project_parameter_values add column replaced_from_value_id text references parameter_catalog.project_parameter_values(id) on delete restrict;`
- `alter table parameter_catalog.project_parameter_values add constraint project_parameter_value_replacement_source_fk foreign key (replaced_from_value_id, definition_id) references parameter_catalog.project_parameter_values(id, definition_id) on delete restrict;` together with the new `unique (id, definition_id)` — this proves the carried-forward source value is a real value row (the old definition's row), not an arbitrary pointer.
- `check (replaced_from_value_id is null or replaced_from_value_id <> id)`.

The existing append-only trigger already rejects `UPDATE` and `DELETE` (0137:1326-1328 → raise at 0137:16-19); new columns are populated only at `INSERT`. A carried-forward row keeps `value`, `value_digest`, `value_kind`, `source_ref` and `config_revision_id` byte-identical to the old row (default 5) and pins the new `definition_id` and approved `definition_revision_id`. Incompatible rows are never inserted; the project goes `blocked`.

### 3.4 Idempotent execute/continue identity

Follow the **organization-scoped** governance pattern, `parameter_catalog.governance_command_idempotency` (0137:3180-3194), not the instance-scoped `catalog_command_idempotency` (0137:2628-2641), because the capability is organization-scoped and the manifest is organization-scoped. Primary key `(organization_id, command_family, idempotency_key)` (0137:3189); `command_family` is free-text non-empty (0137:3182) so no schema change is needed. Families: `'definition-replacement-execute'` and `'definition-replacement-continue'`. The existing `protect_command_idempotency()` trigger (0137:2690-2692, body 2643-2688) already enforces identity immutability for the governance table at 2666-2671 and "pending may only commit" at 2680-2684. `request_fingerprint` is `sha256:` over the canonical command model excluding the idempotency key — the same construction as `registrationCommandFamily` (`server/modules/parameter-governance/registration/command.ts:16,166-214`).

### 3.5 Existing constraints and triggers that must be respected — and exceptions

**No existing constraint needs an exception. The design never relaxes a trigger.** The one place where the frozen design must *split* a write instead of relaxing a check is the binding history event.

| Existing constraint / trigger (source) | Effect on the replacement | Failure mode if violated | Exception |
| --- | --- | --- | --- |
| `parameter_definitions unique (subject_id, property_key)` (0137:383) | The new identity must not collide with any existing definition, including a retired one (ADR-0040 `:126`) | `23505`; Builder already returns `conflict / duplicate-natural-key` (`builder/completeSuccessor.ts:476-484`) | none — target conflict is rejected, never auto-merged |
| `definition_revisions unique (definition_id, revision_number)` (0137:397) | The successor release mints the next number for the new definition | `23505`; kernel compile returns `invalid-release` (`completeSuccessor.ts:957-964`) | none |
| `definition_revision_release_unique unique (definition_id, catalog_release_id)` deferrable (0137:398-400) | One revision per definition per release; the new definition's first revision belongs to the successor release | deferred `23505` at `COMMIT` | none |
| `parameter_definition_current_revision_fk` + `catalog_current_definition_head_ck` (0137:406-411, 1053) | Only the synchronizer advances the head; the replacement reads it | `23503` / constraint trigger `23514` | none |
| `project_parameter_bindings unique (project_id, logical_node_id, definition_id)` (0137:1147) | A new row per project is required and legal because the new identity is a different definition; the insert uses `on conflict ... do nothing` (`binding/repositories.ts:146`) | `23505` if the code tried to reuse the old row identity | none |
| `project_parameter_binding_identity_immutable` → `protect_binding_identity()` (0137:1300-1324) | The replacement must `INSERT` a new binding, never `UPDATE` `definition_id`/`subject_id`/`registration_id` | `55000` "Project parameter binding identity is immutable" (0137:1315-1316) | none — identity reassignment is forbidden |
| `project_parameter_binding_current_value_fk` (0137:1227-1232) | New binding and its first value commit under deferred constraints | deferred `23503` at `COMMIT` | none |
| `project_parameter_binding_release_revision_fk` (0137:1166-1172) and `assert_binding_effective_revision_is_verified_head()` → `project_parameter_binding_effective_revision_head_fk` (0137:1175-1204) | A new binding may exist only after the successor release is published **and** has a `catalog_materializations` row; the effective revision must be that release's head | `23503` "Binding effective revision must be a head of a verified Catalog release" (0137:1190-1193) | none — this is what forces publish-then-migrate ordering |
| `project_parameter_values_immutable` → `reject_immutable_catalog_change()` (0137:1326-1328, 16-19) | New rows are appended; existing value bytes never change | `55000` "%I.%I is append-only" (0137:18) | none |
| `binding_history_events_immutable` (0137:1330-1332) | History is append-only; the change-check at 0137:1246 forbids a no-op event | `55000` | none |
| `assert_binding_history_event_owners()` → `binding_history_event_owner_fk` (0137:1249-1298) | Every referenced revision/value must belong to the **same** binding and definition (0137:1261-1283). An old→new pair spans two bindings, so one event cannot carry it | `23503` "Binding history pointers must belong to the same Binding and Definition" (0137:1284-1287) | **no trigger exception**; the design writes two events — one on the old binding when its value pointer changes, one on the new binding — each internally consistent |
| `organization_subject_registrations unique (organization_id, subject_id)` (0137:2859), `subject_placements unique (registration_id)` (0137:2872), `registration_current_placement_fk` (0137:2908-2913), `subject_placement_kind_ck` (0137:2947-2951) | The new subject must already be registered with its one retained placement in the affected organization; the replacement never creates or moves a registration/placement | `23505` / `23503` / `23514` | none — the project is `blocked` with `registration-required`, matching ADR-0042 `:43,45` (agent cannot register) |
| `catalog_subject_selector_cross_root_unique` / `catalog_subject_alias_selector_cross_root_unique` → `reject_cross_root_selector_collision()` (0137:281-345) and `unique (kind, canonical_key)` (0137:212-224) | Selectors and aliases are never reassigned; a target selector collision is a typed conflict | `23505` / trigger exception | none — forbidden selector reassignment is always rejected |
| `governance_command_idempotency` shape and trigger (0137:3180-3198) | Two new `command_family` values are used; no check change | `55000` on identity mutation | none; 0144 must not add a family check that excludes the new values |

---

## 4. Current-selection rule

**The rule.** For a current operation on `(organization_id, project_id, logical_node_id, definition_id)`, the effective binding is resolved through the replacement projection: if a `definition_replacement_projects` row exists with `status = 'completed'` and `old_binding_id` matching the queried binding, the **new** binding is effective and the queried old binding is historical; otherwise the queried binding itself is effective. Historical, pinned and revision-addressed queries never consult the projection — they address the exact binding id and the exact `definition_revision_id` they were pinned to.

**Where it is enforced.** One SQL seam in 0144:

```sql
create view parameter_catalog.current_project_parameter_bindings as
select binding.*
from parameter_catalog.project_parameter_bindings binding
where not exists (
  select 1
  from parameter_catalog.definition_replacement_projects replacement
  where replacement.status = 'completed'
    and replacement.old_binding_id = binding.id
);
```

with the exact-id resolution helper `parameter_catalog.resolve_current_binding(p_project_id text, p_logical_node_id text, p_definition_id text) returns text` that follows the completed replacement edge exactly once (no chains: 0144 rejects a new replacement whose target definition is itself an `old_definition_id` of another non-`failed` replacement).

**Consumer alignment (must use the rule).**

| Consumer class | Exact current code to redirect |
| --- | --- |
| Current project reads (device and UI) | `server/modules/parameter-bindings/adapters/projectReadAdapter.ts:59-66` |
| Current-value writes | `server/modules/parameter-bindings/values/repositories.ts:115-129` (`loadBindingById`), `:214-231` (`casCurrentTip`), reached through `writebackAdapter.ts:78-85` |
| Binding resolution/insert | `server/modules/parameter-bindings/binding/repositories.ts:105-124`, `:126-163` |
| Imports and value sync | `server/modules/parameter-bindings/catalogProjectValueSync.ts:398,554,723` |
| Usage counts | `server/modules/parameter-bindings/usage/query.ts:107-128` (must count only `current_project_parameter_bindings`, otherwise the old definition keeps a phantom count) |
| Catalog read surfaces that display usage | `server/modules/parameter-catalog-api/read/handlers.ts:436-441,500-505` through `ports.usage` |
| Device / debugging reads | `server/modules/debugging/canonicalProtectedReference.ts:44` |
| Agent tools | `server/modules/agent/tools/perceptionTools.ts:50`, `server/modules/agent/parameterCatalogComparisonContribution.ts:371,399` |
| Source-candidate / draft / review comparison contributions | `server/modules/parameter-files/parameterCatalogComparisonContribution.ts:338`, `server/modules/parameter-topology/parameterCatalogComparisonContribution.ts:448` |

**Deliberately historical consumers (keep the pinned read contract).** Documented historical replay reads the pinned release membership and pinned definition head and never joins `catalog_state` (ADR-0040 `:125`, `:365-376`); the canonical read surface resolves a named release and then reads that snapshot's `selectedRevision` (`server/modules/parameter-catalog-api/read/handlers.ts:179-182`, `:220-223`; `read/dto.ts:115-117,131-132`). `readProjectValueHistory` / `loadHistoryByRevision` read by exact binding and revision (`server/modules/parameter-bindings/values/repositories.ts:160-175`). The legacy `public.project_parameter_bindings` consumers (`server/modules/parameter-drafts/repository.ts:201`, `server/modules/dts-reload/repository.ts:292`, `server/modules/parameter-topology/bindingService.ts:267`) are a different relation and are out of scope.

**How a write to a replaced current binding is rejected.** Three layers:

1. Port layer: the resolver returns the new binding, so an operation naming the old binding gets `{kind:"typed-block", reason:"binding-replaced"}` through the existing block shape (`server/modules/parameter-bindings/adapters/dto.ts` via `writebackAdapter.ts:18-49`).
2. Lock layer: `loadBindingById(..., "update")` and `casCurrentTip` are constrained to the view, so a stale writer loses its row lock rather than appending.
3. Database layer: new constraint trigger in 0144, `parameter_catalog.assert_value_target_binding_is_current()`, `after insert on parameter_catalog.project_parameter_values`, `deferrable initially deferred`, raising `55000` with `constraint = 'project_value_current_binding_ck'` when `new.binding_id` is the `old_binding_id` of a `completed` replacement project. This mirrors the existing `assert_binding_effective_revision_is_verified_head()` pattern (0137:1175-1204).

---

## 5. Threat matrix (frozen)

Legend — **Sealed**: `yes` = a frozen acceptance requirement of this R3 lane; `no` = an existing invariant this lane must not regress.
**Executable now**: `EXEC-NOW` = the named evidence owner exists in this tree today and can run against the provisioned lane PostgreSQL; `NON-EXEC` = the owner is the new module/migration test that does not exist before implementation. This environment has the lane port open (`127.0.0.1:55438`), and the harness asserts a real PostgreSQL URL (`server/testing/parameterCatalog/database.ts:81`, `sessions.ts:22-31`).

| Case ID | Dimension | Setup | Exact action | Expected observable result | Evidence owner | Sealed? |
| --- | --- | --- | --- | --- | --- | --- |
| RT-01 | zero references | old definition with no `project_parameter_bindings` row in the selected organization | preview then execute the replacement | Preview reports an empty authorized manifest and `usage.currentValueCount = 0`; execute commits with zero project rows and the replacement reaches `completed` without touching any binding or value | `server/modules/parameter-bindings/usage/usageQuery.integration.test.ts` (**EXEC-NOW**) | no |
| RT-02 | one project | one project, one binding, one compatible value tip | preview then execute | Exactly one `definition_replacement_projects` row goes `completed`; a new binding and one appended value exist; the old binding and old value still exist unmodified | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| RT-03 | multiple projects, all eligible | three projects each with a compatible value | execute | All three project rows are `completed` in one execute response; `attempt_count` is 1 for each; the replacement is `completed` | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| RT-04 | multiple projects, mixed outcomes | three projects: one compatible, one incompatible value, one with a pending draft | execute | The compatible project is `completed`; the other two are `blocked` with distinct `blocker_reason`; the replacement is `blocked`; exactly one new binding exists | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| PA-01 | publication succeeded, registration failed | successor release is current and materialized; new subject has no `organization_subject_registrations` row in the selected organization | execute | Replacement is `blocked`; every selected project is `blocked` with `registration-required`; `catalog_state.current_catalog_release_id` and the Activation Receipt are unchanged and zero registration rows exist (existing proof: `server/modules/catalog-publication/revision.integration.test.ts:511-585` asserts T21 "catalog success plus registration failure keeps Catalog/Receipt"; the replacement-manifest variant is `NON-EXEC` at `server/modules/parameter-catalog-migration/registrationFailure.integration.test.ts`) | `server/modules/catalog-publication/revision.integration.test.ts:511-585` (**EXEC-NOW** for the catalog-side observation) | yes |
| PA-02 | execution failed mid-way | three compatible projects; failure injected after project 1 commits | execute | Project 1 is `completed` with its new binding committed; projects 2 and 3 remain `pending`; the replacement is `failed` or `pending` but never `completed`; a subsequent continue completes only 2 and 3 | `server/modules/parameter-catalog-migration/recovery.integration.test.ts` (**NON-EXEC**) | yes |
| PA-03 | publication job needs rebase | a second Candidate commits first so the prepared replacement job returns `needs-rebase` | execute | Replacement is `blocked` with a rebase blocker; no binding, value or history row is created; the input selection is retained | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| PA-04 | successor not materialized | successor release row exists but `catalog_materializations` has no row for it | execute | Deferred check raises `23503` on `project_parameter_binding_effective_revision_head_fk`; the whole transaction rolls back; zero residue | `server/modules/parameter-catalog-migration/schema.integration.test.ts` (**NON-EXEC**) | yes |
| PA-05 | concurrent execute | two independent sessions execute the same replacement identity at the same time | execute in both | Exactly one session commits; the other observes `outcome: "replayed"` or a typed conflict; exactly one binding and one value per project exist (independent sessions required, `server/testing/parameterCatalog/sessions.ts:48-53`) | `server/modules/parameter-catalog-migration/concurrency.integration.test.ts` (**NON-EXEC**) | yes |
| ID-01 | subject change | replacement moves the definition to a different `subject_id`, same property key | preview then execute | Preview reports both identities and the target subject's registration and placement per organization; after execute the new definition carries the new `subject_id` and the old definition is unchanged | `server/modules/parameter-catalog-migration/preview.test.ts` (**NON-EXEC**) | yes |
| ID-02 | property-key-only change | same `subject_id`, new `property_key` | preview then execute | The new definition has the same subject and the new key; the DTS source rewrite path is used for every affected binding; no alias is created for the old key | `server/modules/parameter-catalog-migration/preview.test.ts` (**NON-EXEC**) | yes |
| ID-03 | subject and key both change | both identity fields differ | execute | Both `old_*` and `new_*` identity columns differ; the partial unique index still admits exactly one non-`failed` replacement per old definition | `server/modules/parameter-catalog-migration/schema.integration.test.ts` (**NON-EXEC**) | yes |
| ID-04 | target natural-key conflict | a definition already exists for `(new_subject_id, new_property_key)` | preview then execute | Successor build returns `conflict / duplicate-natural-key`; preview fails closed with no Candidate; the existing definition is not merged, modified or reused | `server/modules/catalog-publication/builder/completeSuccessor.test.ts:156-171` (**EXEC-NOW**) | no |
| ID-05 | forbidden selector reassignment | target subject's canonical key or selector is owned by another subject | preview | Preview fails with `duplicate-selector` or `duplicate-canonical-key`; no alias row is re-pointed; ADR-0042 alias ownership is unchanged | `server/modules/catalog-publication/builder/completeSuccessor.test.ts:679,721` (**EXEC-NOW**) | no |
| ID-06 | alias collision | a proposed alias equals an existing stable alias of another subject | preview | `duplicate-alias` typed conflict; zero alias rows written | `server/modules/catalog-publication/builder/completeSuccessor.test.ts:721` (**EXEC-NOW**) | no |
| ID-07 | forbidden auto-merge | target identity is already bound in the same project | execute | The project is `blocked` with `target-identity-conflict`; no value rows are copied into the pre-existing binding; the pre-existing definition and value are unchanged | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| VL-01 | compatible value carried forward | old value `integer 5` satisfies the new revision's `valueSchema` | execute | The new value row has identical `value`, `value_digest`, `value_kind`, `source_ref`, `config_revision_id`; `replaced_from_value_id` points at the old value; the old value row is unmodified | `server/modules/parameter-catalog-migration/values.integration.test.ts` (**NON-EXEC**) | yes |
| VL-02 | incompatible value | old value `integer 5000` violates the new revision's `maximum` | execute | The project is `blocked` with `incompatible-value`; no conversion, truncation, clamp or default substitution row is inserted; the old value is untouched | `server/modules/parameter-catalog-migration/values.integration.test.ts` (**NON-EXEC**) | yes |
| VL-03 | conflicting concurrent edit | a new value is appended to the old current binding between preview and execute | execute | The project is `blocked` with a conflict blocker; the value tip recorded in the preview is compared with the live tip and the mismatch prevents any binding write; the concurrent append survives | `server/modules/parameter-catalog-migration/concurrency.integration.test.ts` (**NON-EXEC**) | yes |
| VL-04 | placeholder value only | the only value row has `source_ref = 'canonical-binding-identity'` | preview then execute | The preview marks the project as having no real configured value; execute either skips it honestly or reports `pending`; no placeholder is treated as a configured value | `server/modules/parameter-bindings/values/values.integration.test.ts` (**EXEC-NOW**) | no |
| VL-05 | pending draft | an open canonical draft exists on the project binding | execute | The project is `blocked` with `pending-work-conflict`; the draft row is neither discarded nor re-pinned; the draft's binding and revision references are byte-identical after the attempt | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| VL-06 | pending review | an open `parameter_review_items` row (`status = 'open'`) exists for the release under correction | execute | The project is `blocked`; the review item keeps `status = 'open'` and its `etag_version`; no resolution row is written. A row captured for a **superseded** release is no longer listed or resolvable, so it does not block the correction and stays untouched (`provenance.integration.test.ts`, executed) | `server/modules/parameter-catalog-migration/execute.integration.test.ts` + `provenance.integration.test.ts` (**EXEC**) | yes |
| VL-07 | pending execution conflict | an in-flight governed write lock exists on the project binding | execute | The project is `blocked` with an execution-conflict blocker; no partial value or binding is written | `server/modules/parameter-catalog-migration/concurrency.integration.test.ts` (**NON-EXEC**) | yes |
| VL-08 | open version cutover | an open version cutover exists on the same definition | preview | Preview is refused with a typed conflict; no replacement row is created and the open cutover is unchanged | `server/modules/parameter-catalog-migration/preview.test.ts` (**NON-EXEC**) | yes |
| VL-09 | open property-key cutover | an open property-key cutover exists on the same definition | preview | Preview is refused; only one identity-changing process may be open per definition (ADR-0034 `:19`, `docs/adr/0034-referenced-property-key-rename-is-a-source-cutover.md:33`) | `server/modules/parameter-catalog-migration/preview.test.ts` (**NON-EXEC**) | yes |
| SR-01 | missing source provenance | a selected binding has no `source_ref`/`config_revision_id` occurrence, or the recorded ref is the identity placeholder | preview then execute | The project is `blocked` with `missing-source-provenance`; no source rewrite is attempted; the value rows are unchanged | `server/modules/parameter-catalog-migration/evaluate.test.ts` + `execute.integration.test.ts` (**EXEC**) | yes |
| SR-02 | unsupported source format | the binding's source file is not `.dts`, either named directly or resolved from the opaque `config-set:` ref through its DTS occurrence | preview then execute | The project is `blocked` with `unsupported-source-format`; the source bytes are unchanged; no other format is silently declared supported (default 6; gate at `server/modules/parameter-specs/propertyKeyCutover.ts:899-903`) | `server/modules/parameter-catalog-migration/provenance.integration.test.ts` (**EXEC**) | yes |
| SR-03 | ambiguous match | two source occurrences match the same key at the same file and logical node | preview then execute | The project is `blocked` with `ambiguous-source-match`; no occurrence is rewritten; `source_ref` values remain as recorded | `server/modules/parameter-catalog-migration/provenance.integration.test.ts` (**EXEC**) | yes |
| SR-04 | coupled source impact outside the manifest | another definition in the same project shares the source location and would also change | execute | The affected project is `blocked` with `coupled-source-impact` listing the coupled binding ids; nothing outside the approved manifest is rewritten | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| SR-05 | source provenance resolved, no file row | the DTS occurrence exists but no `project_parameter_files` row owns its file version | preview then execute | The project is `blocked` with `missing-source-provenance`; no value or binding row is written; blocked evidence records the frozen source ref | `server/modules/parameter-catalog-migration/evaluate.test.ts` (**EXEC**) | yes |
| ST-01 | stale preview after ETag change | the replacement record's `replacement_version` changed after preview | execute with the old If-Match | `409 CONFLICT reason=revision-conflict`; the replacement is not re-executed; a fresh preview is required (`server/modules/parameter-catalog-api/governance/errors.ts:135-144`) | `server/modules/parameter-catalog-api/definitionReplacements.http.integration.test.ts` (**NON-EXEC**) | yes |
| ST-02 | stale preview after source change | `config_revision_id` of a manifest binding changed after preview | execute | The project is `blocked` with a stale-preview blocker; the stored `preview_fingerprint` no longer matches the recomputed fingerprint; no write | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| ST-03 | stale preview after catalog change | the current catalog release advanced after preview | execute | `409 CONFLICT reason=release-drift` with `expectedCatalogReleaseId` and `currentCatalogReleaseId`; zero replacement, binding or value mutation | `server/modules/parameter-catalog-api/definitionReplacements.http.integration.test.ts` (**NON-EXEC**) | yes |
| ST-04 | stale preview after authorization change | the approving authorization is revoked, or the actor's capability is removed, after preview | execute | `403 FORBIDDEN` or a typed `preview-unavailable`; the replacement stays `pending` with no binding rows | `server/modules/parameter-catalog-migration/authorization.test.ts` (**NON-EXEC**) | yes |
| RC-01 | interruption and restart | the executing transaction is aborted after the first project commits | re-run continue after process restart | Committed projects stay `completed` with exactly one binding and one value each; uncommitted projects are `pending`; a restart does not duplicate any value, binding or history event | `server/modules/parameter-catalog-migration/recovery.integration.test.ts` (**NON-EXEC**) | yes |
| RC-02 | repeated execute, same identity | execute succeeds; the same idempotency key and body are replayed | execute again | `outcome: "replayed"`; row counts for `project_parameter_bindings`, `project_parameter_values` and `binding_history_events` are identical to the first response | `server/modules/parameter-catalog-migration/replay.integration.test.ts` (**NON-EXEC**) | yes |
| RC-03 | repeated execute, same key different body | the same idempotency key with a changed manifest | execute | `409 CONFLICT reason=revision-conflict` with `storedFingerprint` and `attemptedFingerprint`; no rows written (pattern at `server/modules/parameter-governance/registration/internalGuardedRegistrationWriter.ts:288-295`) | `server/modules/parameter-catalog-migration/replay.integration.test.ts` (**NON-EXEC**) | yes |
| RC-04 | repeated continue | continue is invoked twice with the same idempotency key | continue twice | Second call returns `outcome: "replayed"`; the set of `completed` projects is unchanged and no additional value row exists | `server/modules/parameter-catalog-migration/replay.integration.test.ts` (**NON-EXEC**) | yes |
| RC-05 | continue with nothing blocked | every project is already `completed` | continue | A typed no-op or replay response; the replacement remains `completed`; no new rows | `server/modules/parameter-catalog-migration/continue.integration.test.ts` (**NON-EXEC**) | yes |
| RC-06 | continue outside the approved manifest | a project id that was never in the approved manifest | continue naming that project | `404 NOT_FOUND` or a typed `invalid-command`; the project id is not added to the manifest and no binding is created | `server/modules/parameter-catalog-migration/continue.integration.test.ts` (**NON-EXEC**) | yes |
| TN-01 | cross-tenant access | a replacement owned by another organization | GET and execute with the caller's own organization scope | `404 NOT_FOUND` (the read gate hides cross-organization resources, `server/modules/parameter-catalog-api/governance/handlers.ts:317-320`); no existence disclosure; no rows change | `server/modules/parameter-catalog-api/definitionReplacements.http.integration.test.ts` (**NON-EXEC**) | yes |
| TN-02 | cross-organization project selection | manifest names a project of a different organization | preview then execute | Preview rejects the manifest; if forced, the composite FK `(project_id, organization_id)` fails `23503` at commit and the whole transaction rolls back | `server/modules/parameter-catalog-migration/schema.integration.test.ts` (**NON-EXEC**) | yes |
| TN-03 | cross-organization platform-admin write | platform-admin names another organization's projects | execute | `403 FORBIDDEN`; the organization-write gate requires `actorKind = 'org-admin'` and a matching `organizationId` (`governance/handlers.ts:324-334`) | `server/modules/parameter-catalog-api/definitionReplacements.http.integration.test.ts` (**NON-EXEC**) | yes |
| TN-04 | cross-tenant binding reference | manifest names a binding owned by another organization | execute | Composite FK `(old_binding_id, organization_id, project_id)` fails; zero rows committed | `server/modules/parameter-catalog-migration/schema.integration.test.ts` (**NON-EXEC**) | yes |
| AU-01 | unauthorized actor kind: user | authenticated actor whose kind is not `org-admin` (`org-member`, or `platform-admin`) acting on the organization scope | preview and execute | `403 FORBIDDEN` and zero domain command invocations, so no replacement row exists (the identical gate at `server/modules/parameter-catalog-api/governance/handlers.ts:324-334` covers `org-member`) | `server/modules/parameter-catalog-api/governance/handlers.test.ts:451-463` (**EXEC-NOW** for the non-org-admin gate; the `org-member` variant is owned by `definitionReplacements.http.integration.test.ts`, **NON-EXEC**) | no |
| AU-02 | unauthorized actor kind: agent | agent-initiator request (including a spoofed `X-WiseEff-Actor-Kind`) | preview and execute | Spoof header stripped before auth; `403 FORBIDDEN`; Agent stays read-only (`governance/threatMatrix.ts:34`) | `server/modules/parameter-catalog-api/governance/http.integration.test.ts:336` (**EXEC-NOW**) | no |
| AU-03 | missing capability | actor without `catalog:author` and `catalog:publish` (ADR-0043 `:87-93`) | preview and execute | `403 FORBIDDEN` with reason `publication-not-authorized` or `publication-capability-missing`; no Candidate is created | `server/modules/parameter-catalog-api/definitionReplacements.http.integration.test.ts` (**NON-EXEC**) | yes |
| AU-04 | self-approval | the same non-admin principal authors and approves a high-risk replacement | execute | `403 FORBIDDEN` reason `publication-self-approval-forbidden` (existing helper `governance/errors.ts:93-102`); no execution | `server/modules/parameter-catalog-migration/authorization.test.ts` (**NON-EXEC**) | yes |
| IV-01 | old identity and revision bytes interpretable | replacement completed for one project | read the old definition, old revisions and old timeline | The old definition id, property key, revision ids, revision numbers and content digests are byte-identical to their pre-migration values | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| IV-02 | old value and history bytes interpretable | replacement completed | read the old binding's value history at its exact revision pin | Every historical `project_parameter_values` row is byte-identical; `readProjectValueHistory` still returns them for the old binding and revision (`values/repositories.ts:160-175`) | `server/modules/parameter-bindings/values/values.integration.test.ts` (**EXEC-NOW**) | no |
| IV-03 | exactly one current replacement selected | two previews for the same old definition, both non-`failed` | attempt to execute both | The second non-`failed` replacement insert is rejected by `definition_replacements_current_successor_unique`; a `failed` row may be superseded | `server/modules/parameter-catalog-migration/schema.integration.test.ts` (**NON-EXEC**) | yes |
| IV-04 | current reads and usage agree | one project migrated, one not | read usage for the old and new definitions and read the project's protected parameters | Usage for the old definition drops that project and the new definition gains it; the project read returns exactly one effective binding and it is the new one; the counts and the read agree | `server/modules/parameter-catalog-api/rootUsageScope.integration.test.ts` (**EXEC-NOW**) | no |
| IV-05 | old-reference writes fail | a project is `completed` | append a value naming the old binding | Typed block `binding-replaced` at the port layer and `55000 constraint = project_value_current_binding_ck` at the database layer; zero new value rows | `server/modules/parameter-catalog-migration/values.integration.test.ts` (**NON-EXEC**) | yes |
| IV-06 | unrelated projects and values unchanged | two projects, only one selected | execute | Every row of the unselected project is byte-identical; untouched definitions, subjects and releases keep their row counts | `server/modules/parameter-catalog-migration/execute.integration.test.ts` (**NON-EXEC**) | yes |
| IV-07 | canonical re-import resolves the approved identity | a DTS source already showing the new key is ingested after the replacement | run canonical recognize/bind | The matcher resolves the approved current definition (the new identity) and creates no duplicate definition; the old definition is not re-matched from the live source | `server/modules/parameter-catalog-migration/reimport.integration.test.ts` (**NON-EXEC**) | yes |
| IV-08 | old definition stays available, never auto-deprecated | replacement is `blocked` and again after `completed` | read the old definition lifecycle in every state | The old definition's lifecycle is unchanged by preview, execute and continue; no revision is minted to deprecate it (default 3) | `server/modules/parameter-catalog-migration/lifecycle.integration.test.ts` (**NON-EXEC**) | yes |
| IV-09 | deprecation needs authoritative evidence | usage was computed with a project scope that excludes some projects | offer deprecation for the old definition | Deprecation is not offered while any current reference outside the counted scope may exist; a scoped count alone is not accepted as proof (default 4) | `server/modules/parameter-catalog-migration/lifecycle.integration.test.ts` (**NON-EXEC**) | yes |
| IV-10 | incomplete count does not prove completion | the manifest covers project A, another project B still binds the old definition | request deprecation | The request is refused with the remaining-reference evidence; the old definition stays `active` and project B is unchanged (defaults 3 and 4) | `server/modules/parameter-catalog-migration/lifecycle.integration.test.ts` (**NON-EXEC**) | yes |
| IV-11 | coherent state across application failure | failure injected before `COMMIT` with `application-before-commit` (`server/testing/parameterCatalog/failureInjection.ts:5-16,28-53`) | execute inside the injected failure | Zero new replacement-project, binding, value or history rows; the previously committed projects keep their exact state | `server/modules/parameter-catalog-migration/failureInjection.integration.test.ts` (**NON-EXEC**) | yes |
| IV-12 | coherent state across deferred-constraint failure | failure injected as `deferred-constraint-at-commit` | execute inside the injected failure | `SET CONSTRAINTS ALL IMMEDIATE` / `COMMIT` raises a `pg.DatabaseError`; all catalog writes roll back together; the session observes no mixed state | `server/modules/parameter-catalog-migration/failureInjection.integration.test.ts` (**NON-EXEC**) | yes |
| IV-13 | tenant-inclusive composite keys | mismatch between binding, project and organization in the manifest | attempt the manifest insert | Composite FK failure `23503`; the manifest row is not written | `server/modules/catalog-kernel/schema/catalogSchema.integration.test.ts:1127-1140` (**EXEC-NOW**) | no |
| IV-14 | deferrable trigger set preserved | migration 0144 applied to a checked-empty lane database | inspect `pg_trigger` for the canonical constraint triggers | `binding_history_event_owner_fk` and `project_parameter_binding_effective_revision_head_fk` remain deferrable and initially deferred (asserted today at `catalogSchema.integration.test.ts:1141-1164`) | `server/modules/catalog-kernel/schema/catalogSchema.integration.test.ts` (**EXEC-NOW**) | no |
| IV-15 | successor revision does not silently cut over bindings | a definition with a seeded binding receives a successor revision (documentation-only and semantic) | install the successor release, then compare Binding and value rows | The definition head advances to the new revision while every Binding `effective_revision_id` and every project value row is byte-identical for the documentation class, and the old Binding pin is retained for the semantic class unless a governed cutover runs | `server/modules/catalog-publication/revision.integration.test.ts:381-452` (**EXEC-NOW**) | no |

**Counts.** 63 rows: 13 rows (RT-01, PA-01, ID-04, ID-05, ID-06, VL-04, AU-01, AU-02, IV-02, IV-04, IV-13, IV-14, IV-15) carry at least one evidence owner that exists in this tree today and runs against the provisioned lane PostgreSQL; 50 rows are `NON-EXEC` because their owner is the new module/migration test that cannot exist before implementation. `NON-EXEC` rows name that owner explicitly; none is silently dropped. Two rows (PA-01, AU-01) prove part of their observation on an existing surface and name a separate `NON-EXEC` owner for the replacement-specific half; those halves are stated in the cells. No row proves the new capability end to end before the module and migration exist — every executable owner is an existing-surface invariant this lane must not regress.

---

## 6. Interface design

Placement follows the plan of record: new module `server/modules/parameter-catalog-migration/` (plan `:114`), surfaced through the existing governance boundary (`server/modules/parameter-catalog-api/governance/`). Naming and error codes follow `governance/types.ts`, `governance/errors.ts`, `governance/ports.ts`, `governance/mapping.ts` and `catalogApiFailureReasons` (`server/modules/contracts/dtoSchemas/parameterCatalog.ts:33-71`).

### 6.1 Commands and failures (`parameter-catalog-migration/command.ts`, `failures.ts`, `result.ts`)

```ts
export type TrustedMigrationContext =
  | { readonly actorKind: "org-admin"; readonly principalId: string; readonly organizationId: string }
  | { readonly actorKind: "platform-admin"; readonly principalId: string }
  | { readonly actorKind: "agent"; readonly principalId: string }
  | { readonly actorKind: "org-member"; readonly principalId: string; readonly organizationId: string };

export type PreviewDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly oldDefinitionId: ParameterDefinitionId;
  readonly expectedOldRevisionId: DefinitionRevisionId;   // compare-and-swap on the old head
  readonly newSubjectId: CatalogSubjectId;
  readonly newPropertyKey: PropertyKey;
  readonly proposedContent: SupportedDefinitionContent;     // builder/types.ts:88-94
  readonly projectIds: readonly string[];                   // the exact authorized manifest
  readonly reason: string;
  readonly expectedRelease: { readonly id: CatalogReleaseId; readonly digest: CatalogReleaseDigest };
  readonly context: TrustedMigrationContext;
};

export type ExecuteDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly replacementId: DefinitionReplacementId;
  readonly previewFingerprint: string;                      // the frozen preview identity
  readonly approvedProjectIds: readonly string[];
  readonly idempotencyKey: string;
  readonly expectedRelease: { readonly id: CatalogReleaseId; readonly digest: CatalogReleaseDigest };
  readonly context: TrustedMigrationContext;
};

export type ContinueDefinitionReplacementCommand = {
  readonly organizationId: string;
  readonly replacementId: DefinitionReplacementId;
  readonly projectIds: readonly string[];                   // blocked subset only
  readonly idempotencyKey: string;
  readonly expectedRelease: { readonly id: CatalogReleaseId; readonly digest: CatalogReleaseDigest };
  readonly context: TrustedMigrationContext;
};

export type GetDefinitionReplacementQuery = {
  readonly organizationId: string;
  readonly replacementId: DefinitionReplacementId;
  readonly authScope: { readonly organizationId: string; readonly principalId: string };
};

export type DefinitionReplacementFailure =
  | { readonly kind: "not-found" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "invalid-command"; readonly reason: string }
  | { readonly kind: "release-drift"; readonly expected: CatalogReleasePin; readonly actual: CatalogReleasePin }
  | { readonly kind: "catalog-drift"; readonly expected: CatalogReleasePin }
  | { readonly kind: "synchronization-busy" }
  | { readonly kind: "stale-preview"; readonly expectedFingerprint: string; readonly actualFingerprint: string }
  | { readonly kind: "preview-unavailable"; readonly reason:
      | "artifact-missing" | "predecessor-incomplete" | "subject-not-found" | "subject-not-active"
      | "unsupported-catalog-capability" | "publication-policy-disabled" | "publication-frozen" | "needs-rebase" }
  | { readonly kind: "target-identity-conflict"; readonly reason:
      "duplicate-natural-key" | "duplicate-canonical-key" | "duplicate-selector" | "duplicate-alias" }
  | { readonly kind: "forbidden-selector-reassignment"; readonly selector: string }
  | { readonly kind: "registration-required"; readonly organizationId: string }
  | { readonly kind: "incompatible-value"; readonly bindingId: string; readonly detail: string }
  | { readonly kind: "pending-work-conflict"; readonly bindingId: string; readonly reason: string }
  | { readonly kind: "unsupported-source-format"; readonly bindingId: string }
  | { readonly kind: "missing-source-provenance"; readonly bindingId: string }
  | { readonly kind: "ambiguous-source-match"; readonly bindingId: string }
  | { readonly kind: "coupled-source-impact"; readonly bindingIds: readonly string[] }
  | { readonly kind: "revision-conflict"; readonly idempotencyKey: string;
      readonly storedFingerprint: string; readonly attemptedFingerprint: string }
  | { readonly kind: "registration-followup-failed"; readonly registrationId: string };

export type DefinitionReplacementResult = {
  readonly replacementId: string;
  readonly status: "pending" | "executing" | "completed" | "blocked" | "failed";
  readonly replacementVersion: number;
  readonly previewFingerprint: string;
  readonly oldIdentity: { readonly definitionId: string; readonly subjectId: string;
    readonly propertyKey: string; readonly revisionId: string };
  readonly newIdentity: { readonly definitionId: string; readonly subjectId: string;
    readonly propertyKey: string; readonly revisionId: string };
  readonly projects: readonly {
    readonly projectId: string;
    readonly status: "completed" | "blocked" | "failed" | "pending";
    readonly blockerReason: string | null;
    readonly oldBindingId: string; readonly newBindingId: string | null;
    readonly oldValueId: string; readonly newValueId: string | null;
  }[];
  readonly release: CatalogReleasePin;
  readonly outcome: "committed" | "replayed";
};
```

### 6.2 Ports (`parameter-catalog-migration/service.ts`, wired in `governance/ports.ts`)

```ts
export type CatalogDefinitionMigrationPorts = {
  readonly previewDefinitionReplacement: (
    command: PreviewDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementPreview, DefinitionReplacementFailure>>;
  readonly executeDefinitionReplacement: (
    command: ExecuteDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementResult, DefinitionReplacementFailure>>;
  readonly continueDefinitionReplacement: (
    command: ContinueDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementResult, DefinitionReplacementFailure>>;
  readonly getDefinitionReplacement: (
    query: GetDefinitionReplacementQuery,
  ) => Promise<Result<DefinitionReplacementResult, DefinitionReplacementFailure>>;
  readonly listDefinitionReplacements: (
    query: { readonly organizationId: string; readonly catalogReleaseId: string;
      readonly authScope: { readonly organizationId: string; readonly principalId: string } },
  ) => Promise<Result<{ readonly items: readonly DefinitionReplacementResult[] }, DefinitionReplacementFailure>>;
};
```

`CatalogGovernancePorts` (`governance/types.ts:111-160`) gains these five members; `bindCatalogMigrationCommands` mirrors `bindCatalogGovernanceCommands` (`governance/ports.ts:55-72`); `handleCatalogGovernance` (`governance/handlers.ts:1140-1143`) gains five `switch` branches and five `catalogGovernanceCommandByRouteId` entries (`governance/mapping.ts:7-27`). `requireWriteHeaders` (`governance/handlers.ts:291-306`) is extended: preview and execute require `X-WiseEff-Catalog-Release`; execute and continue require `Idempotency-Key`; execute and continue require `If-Match` carrying the frozen preview fingerprint (`CATALOG_IF_MATCH_HEADER`, `dtoSchemas/parameterCatalog.ts:126`).

### 6.3 Routes (proposed under `/api/v2/catalog/definition-replacements`)

| Route id | Method and path | Command | Success | Required headers |
| --- | --- | --- | --- | --- |
| `catalog.previewDefinitionReplacement` | `POST /api/v2/catalog/definition-replacements/preview` | `previewDefinitionReplacement` | `201` + Candidate-backed preview | `X-WiseEff-Catalog-Release` |
| `catalog.executeDefinitionReplacement` | `POST /api/v2/catalog/definition-replacements` | `executeDefinitionReplacement` | `202` + manifest status | release + `Idempotency-Key` + `If-Match` |
| `catalog.getDefinitionReplacement` | `GET /api/v2/catalog/definition-replacements/:replacementId` | `getDefinitionReplacement` | `200` + `ETag: "<replacementId>-v<version>"` | release (validated when present) |
| `catalog.continueDefinitionReplacement` | `POST /api/v2/catalog/definition-replacements/:replacementId/continue` | `continueDefinitionReplacement` | `202` + manifest status | release + `Idempotency-Key` + `If-Match` |
| `catalog.listDefinitionReplacements` | `GET /api/v2/catalog/definition-replacements` | `listDefinitionReplacements` | `200` list envelope | release (validated when present) |

Add `"PCAT-API-13"` to `pcatApiGates` (`dtoSchemas/parameterCatalog.ts:17-31`) and a `definitionReplacementRoutes` set filtered on that gate, so the existing `GOVERNANCE_GATES` filter for `PCAT-API-04/05/06` (`governance/mapping.ts:32-36`) is untouched. Error responses reuse `catalogGovernanceError`, `validationFailed`, `releaseDrift`, `revisionConflict`, `conflict`, `forbidden`, `notFound` and `catalogNotReady` (`governance/errors.ts:40-200`) with these `catalogApiFailureReasons`: `release-drift`, `revision-conflict`, `registration-required`, `subject-not-published`, `subject-retired`, `definition-not-found`, `publication-not-authorized`, `publication-capability-missing`, `publication-policy-disabled`, `publication-frozen`, `candidate-stale`, `needs-rebase`, `unsupported-catalog-capability`, `idempotency-key-conflict`, `forbidden` (`dtoSchemas/parameterCatalog.ts:33-71`).

### 6.4 Preview response fields required by decision 13, with their source

| Preview field | Reads from |
| --- | --- |
| `oldIdentity.{definitionId,subjectId,propertyKey,currentRevisionId}` | `parameter_definitions.id/subject_id/property_key/current_revision_id` (0137:376-387) |
| `replacement.{newDefinitionId,newSubjectId,newPropertyKey,newRevisionId}` and per-definition revision | built by `completeSuccessor` and frozen in `catalog_publication.candidates.identity_allocation` (0140:500-501; `completeSuccessor.ts:975-984`) |
| `selectedAuthorizedOrganization.projects[]` | `public.projects(id, organization_id)` (0137:1127-1128), filtered by the trusted actor's manageable projects |
| `currentBindings[].{bindingId,definitionId,effectiveRevisionId,currentValueId}` | `parameter_catalog.project_parameter_bindings` via `loadBindingByComposite` (`binding/repositories.ts:105-124`) |
| `valueTips[].{valueId,valueKind,valueDigest}` | `parameter_catalog.project_parameter_values` joined on `binding.current_value_id` (0137:1206-1225; pattern at `usage/query.ts:116-117`) |
| `sourceVersions[].{sourceRef,configRevisionId,occurrenceId,nodePath}` and `diffs[]` | `project_parameter_values.source_ref/config_revision_id` (0137:1211-1212) plus DTS occurrence joins (`propertyKeyCutover.ts:251-290`) |
| `targetRegistrations[].{registrationId,status,placementId,moduleId,origin}` | `organization_subject_registrations` (0137:2849-2862) + `subject_placements` (0137:2864-2882) |
| `coupledAffectedParameters[]` | `parameter_definitions` + `project_parameter_bindings` + DTS occurrence joins for the same source location |
| `compatibility[].{projectId,compatible,reason}` | old `project_parameter_values.value` (0137:1215) compared with the new `definition_revisions.content.valueSchema` (0137:395) |
| `unresolvedDrafts[]` | `parameter_catalog.definition_proposals` with `status in ('draft','submitted')` (0137:3054-3067) |
| `unresolvedApprovals[]` | `parameter_catalog.parameter_review_items` with `status = 'open'` (0137:3031-3052, index 3050) |
| `executionConflicts[]` | in-flight governed binding write locks and `catalog_publication.publication_jobs` in `queued`/`running` (0140:572-622) |
| `impact.{previewFingerprint,impactReportDigest,capabilityContractDigest,policyRevision}` | `catalog_publication.candidates.impact_report_digest`/`capability_contract` (0140:502-505) and `publication_authorizations` (0140:523-570) |
| `authorizationEvidence.{authorizationId,approvalPrincipalId,approverPrincipalId}` | `catalog_publication.publication_authorizations` (0140:523-570); frozen again on `definition_replacements` (§3.1) |

---

## 7. Open design risks

1. **Does `deprecated` participate?** The canonical lifecycle is already `active | deprecated | retired` (`server/modules/parameter-catalog-contract/enums.ts:25`; `server/modules/catalog-kernel/interface.ts:61`; DTO counts at `dtoSchemas/parameterCatalog.ts:303`). **Recommended decision:** a replacement may *source* from an `active` or `deprecated` old definition, but never from `retired`, and the replacement never writes `deprecated`. Migration and deprecation stay separate governance acts (default 3). Reason: deprecation is an evidence-gated lifecycle write, and mixing it into migration would make a blocked migration look like a lifecycle change.
2. **How does a replacement interact with an already-published successor revision?** The old definition may already have a newer head than the preview's `expectedOldRevisionId`. **Recommended decision:** compare-and-swap on `expectedOldRevisionId`; a mismatch fails the preview with `stale-preview`/`revision-conflict` and requires a new preview. Reason: ADR-0040 `:127` and `:130` make the definition head the only head truth and forbid revision rewriting, so silently retargeting a newer revision would migrate values against a contract the approver never saw.
3. **How is continuation driven — explicit HTTP or a publication manager job?** **Recommended decision:** explicit HTTP `continue` through the governance boundary only, with no background manager step. Reason: a manager job would need its own authorization re-check and would duplicate `installPublishedRelease`'s transaction ownership (ADR-0043 `:117-128`); the plan already sequences continuation as a user action (`plan:121`). A future job may exist only as a thin caller of the same command.
4. **How does the frozen preview detect staleness?** **Recommended decision:** a single `preview_fingerprint` = `sha256:` over the canonical model of `{oldDefinitionId, expectedOldRevisionId, newSubjectId, newPropertyKey, newRevisionId, approvedProjectIds sorted, per-project (bindingId, currentValueId, configRevisionId, sourceRef), previewReleaseId, capabilityContractDigest, policyRevision}`; recompute it inside the execute/continue transaction and reject any mismatch. Reason: the existing Candidate already freezes `impact_report_digest` and `capability_contract` (0140:502-505), and `publicationRequestDigest` shows the established digest construction (`catalog-publication/enqueue.ts:26-33`); an ETag/version alone would not detect a source or per-project tip change.
5. **What if the new definition's subject is not registered/placed in an affected organization?** **Recommended decision:** never auto-register; mark the affected projects `blocked` with `registration-required` and keep the replacement `blocked`, leaving the Catalog publish untouched. Reason: ADR-0042 `:43` allows only an Org Admin explicit registration or one uniquely proven observation, and `:45` forbids an agent from standing in; ADR-0043 `:74` forbids presenting a successful publish as rolled back. Add a risk 5a: if the new subject's current release membership is `retired`, preview itself must fail with `subject-retired` before any Candidate is created (ADR-0042 `:84`).

---

### Freeze statement

This matrix and interface are frozen before implementation of the R3 lane. Any change to a `Sealed? = yes` row, to migration `0144`'s relation names, or to the current-selection rule requires an explicit re-freeze recorded in this file; the plan's stop boundary forbids PR creation, merge, and production operations for this run (`plan:165-169`).

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Repository map | `AGENTS.md`, `ARCHITECTURE.md` | No change |
| Planning docs | `docs/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md` | Update |
| ADR | `docs/adr/0044-definition-replacement-preserves-historical-identity.md` (to be written before sealing migration `0144`) | Update |
| Architecture / design docs | `docs/design-docs/catalog-authoring-and-publication-control-plane.md`, `docs/design-docs/domain-model.md` | Review |
| Security / governance | `docs/SECURITY.md`, `docs/security/README.md` | Review |
| Generated artifacts | `docs/generated/db-schema.md`, `docs/generated/openapi.json` | Update |
| References | `docs/references/parameter-catalog-contract-inventory.md` | Update |
| Quality / testing docs | `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Review |
| Chinese developer docs | companion page for this document | Update |

## Documentation Update Gate

Blocking. This design document cannot be treated as discharged until:

1. Every `Update` row is written, and every `Review` row is either updated or explicitly recorded unchanged with evidence.
2. `npm run docs:check`, `npm run contract:check`, and `npm run db:schema-doc:check` pass on the candidate that implements migration `0144`.
3. The ADR recording persisted replacement semantics and recovery trade-offs is merged in the same change as migration `0144`, per issue decision 18.
4. Executed threat-matrix rows report their observed result; non-executable rows stay labelled with their future evidence owner.
5. Any deferred row is added to `docs/exec-plans/tech-debt-tracker.md`.
