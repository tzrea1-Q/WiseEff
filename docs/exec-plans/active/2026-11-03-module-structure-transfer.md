# Module structure export, external editing and organization copy

> Chinese: [可落地方案](../../zh-CN/exec-plans/active/2026-11-03-module-structure-transfer.md)

Date: 2026-11-03. Status: implementation in progress. The user approved Q1–Q11, specification [#1493](https://github.com/tzrea1-Q/WiseEff/issues/1493) and tickets #1494–#1504, then authorized complete implementation and GitHub PR merge using GPT-6.1 Terra implementers. Original code inspection: `167361a1e`; integration branch `codex/module-structure-transfer` starts from `4037d9fef`. The approved planning documents are committed. Implementation acceptance and deployment verification remain pending.

## Outcome and confirmed decisions

From `/parameter-admin/modules`, export a complete organization structure, edit JSON externally, preview changes and conflicts, then commit the approved batch once. A second mode copies the retained structure into another organization in the same deployment.

| Decision | Confirmed behavior |
| --- | --- |
| Q1 Scope | Business modules and hierarchy; Subject registrations, placement, aliases and recognition settings. Catalog definitions and driver/child ownership are reference-only |
| Q2 Deployment | Same deployment; independent-deployment migration is excluded |
| Q3 Format | Versioned JSON with a separate editing guide suitable for people, scripts and agents |
| Q4 Deletion | Explicit delete instruction; omission is no operation |
| Q5 Source | Copy preserves the source organization |
| Q6 Existing targets | Preview suggests matches; user confirms reuse and resolves field/placement conflicts. Names are not identity |
| Q7 Occupied deletion | Explicitly handle every child module and choose each affected root Subject's destination or `unset`; no implicit recursive delete |
| Q8 Lifecycle | Explicit register, retire and restore, preserving authorization, impact review and driver-child cascades |
| Q9 Concurrent editing | Three-way, field-level merge against the export baseline. Conflicting edits require resolution; target changes after preview require another preview |
| Q10 Copy deletion | Source delete markers exclude those modules from the copied structure; they never delete matching target modules |
| Q11 Retired subjects | Copy their retained state and placement. Allow a governed placement change while keeping the registration retired; no temporary activation |

`unset` means no module target. It is different from selecting the reserved unclassified module. Owned children inherit their driver's placement and lifecycle rules; external editing cannot change Catalog ownership.

## Current code and actual gaps

| Owning source | Observed fact and consequence |
| --- | --- |
| [Module routes](../../../server/modules/parameters/routes.ts), [repository](../../../server/modules/parameters/parameterModuleRepository.ts) | Single-module CRUD/move exists. List returns all non-archived organization modules. Database `path` contains IDs and must be regenerated, not imported as authoritative text |
| [ADR-0053](../../adr/0053-business-modules-hold-subjects-and-drivers-own-child-nodes.md) | Modules are business taxonomy; multiple roots may share a module; owned children are not independently placed |
| [Leaf deletion migration](../../../server/migrations/0209_leaf_module_unset.sql), [current structure migration](../../../server/migrations/0324_module_structure_migration.sql) | A referenced business leaf can be deleted; retained placements become null. Active children block deletion. Some user documentation still describes an older prohibition |
| [Module service](../../../server/modules/parameters/service.ts), repository | Organization tree advisory lock currently covers moves, not all create/edit/delete writers. The new importer alone acquiring that lock would be insufficient |
| [Registration service](../../../server/modules/parameter-governance/registration/service.ts), [batch](../../../server/modules/parameter-governance/registration/batch.ts), [UoW](../../../server/modules/parameter-governance/registration/unitOfWork.ts) | Each public operation owns a transaction. Existing private batch writer demonstrates atomic registration/audit composition |
| [Recognition settings](../../../server/modules/parameter-modules/recognitionSettings.ts) | Own transaction, ETag, release pin, idempotency, and target-project singleton checks. Reuse those validations |
| [Registration command](../../../server/modules/parameter-governance/registration/command.ts), [guarded writer](../../../server/modules/parameter-governance/registration/internalGuardedRegistrationWriter.ts) | Existing aliases are not editable through a dedicated command; move rejects retired registrations. Add governed capabilities for both, and explicit `unset` placement where necessary |
| [Debug catalog transfer](../../../server/modules/debugging/catalogTransfer.ts) | Useful pattern: consistent snapshot, read-only preview, full conflict list, locked revalidation and one audited transaction. Its identity matching and no-delete semantics are not this feature's contract |

This cannot be implemented as a browser loop over existing CRUD APIs. Module writes, registration changes, recognition changes, audit and the import receipt must commit or roll back together.

## Export contract and JSON editing

Export includes all active business modules, active and retired organization registrations, current placements, aliases, explicit recognition overrides and their effective values. Include the reserved root and owned-child structure as reference information, with each retained child's status and `cascade_retired` fact: these determine which children a later driver restore restores. Legacy technical/archived rows needed to explain retained references are read-only history, not recreated modules. Do not export project values, source files, credentials, permissions, audit history or a copy of the Catalog schema.

Read the complete data set under one coherent snapshot and captured Catalog release. Do not apply the page's search, filters or pagination. Return explicit counts; never silently truncate. Reuse server byte limits, make the supported limit visible, and size-test the largest accepted package before release. An oversized package fails before mutation; it is not silently split into non-atomic batches.

Illustrative v1 envelope; endpoint/schema work freezes exact names in S1:

```json
{
  "format": "wiseeff-module-structure",
  "version": 1,
  "source": {
    "exportId": "msex_example",
    "organizationId": "org_source",
    "catalogReleaseId": "release_example"
  },
  "modules": [
    {
      "ref": "module_power",
      "sourceId": "pm_example",
      "operation": "upsert",
      "name": "Power",
      "parentRef": null,
      "description": "Power management",
      "scope": "Board",
      "sortOrder": 10,
      "importance": "high"
    }
  ],
  "subjects": [
    {
      "subjectId": "csub_example",
      "state": "active",
      "placement": { "kind": "module", "moduleRef": "module_power" },
      "displayAlias": "Power controller",
      "recognition": { "mode": "inherit" }
    }
  ]
}
```

- Existing same-organization modules use stable `sourceId`; a new module omits it and supplies a unique package-local `ref`. Parent references use `ref`, so renaming does not change identity.
- Use `operation: "delete"` for module deletion. A deleted module referenced by a surviving entry is a validation error, including in copy mode. Deleting a parent requires moving or explicitly deleting each child.
- `placement` distinguishes module, reserved unclassified, and `unset`. Owned children have no independently editable placement, state or root alias; their organization recognition settings may be edited only where the existing domain permits it.
- `state` is the requested root-registration state. Differences compile into explicit register/retire/restore operations displayed in preview. Missing Subject rows do not retire or unregister anything. No hard deletion of registrations.
- Preserve recognition inheritance versus explicit overrides; exporting effective values must not turn inheritance into an override on round trip. Arrays such as compatibles are a single conflict unit, not silently unioned. Clearing an override needs a governed operation if the current writer lacks one.
- For existing objects, missing editable fields mean unchanged; clearable fields use schema-defined empty/null values. Required fields of new objects must be supplied. IDs, kinds, owner relationships, provenance and counters are not editable authority.
- Strictly validate the envelope, version, duplicate refs/subject rows, field types, unknown writable fields, reference closure, final graph, sibling names and subject-specific settings. Reject malformed or unsupported input with a JSON field path. Human-readable names are supplementary labels.

The guide includes an editable-field dictionary, add/rename/reparent/delete examples, root-subject state/placement examples, inheritance, `unset` versus unclassified, and instructions for an agent to preserve identities and list uncertain edits instead of guessing. JSON contains data only; it is never executed or interpreted by an LLM during import.

## Baseline, merge and identity

**Same-organization update.** Save an immutable export baseline server-side and return its opaque `exportId`. The file's editable values are not a trusted baseline. Retrieve the baseline only under the authorized source organization; a modified source ID cannot redirect writes. A missing baseline fails clearly instead of silently switching to overwrite mode. Export baseline data has no short automatic expiration in v1; storage is organization-owned product state and follows organization retention, not an external evidence ledger.

For each provided editable field, let B = baseline, F = file, T = current target. If F = B, retain T; if T = B, use F; if F = T, no change; otherwise require an explicit resolution. Validate the complete resulting graph after merging. Concurrent object deletion, incompatible reparenting, new descendants and changed deletion impact are structural conflicts, not just scalar-field comparisons. A deleted source ID must never recreate a different object by matching its old name.

**Cross-organization copy.** Use the package's retained desired values, not the source baseline's change set. The importer must not fetch or reveal source-organization state using `exportId`; possession of a file grants no source API access. Reuse shared Catalog subject IDs after validating them against the current deployment/release. Missing, retired-at-Catalog or owner-mismatched subjects cannot be invented or silently matched by name.

Match module candidates by full path only as a suggestion. Freeze confirmed package-ref → target-ID mappings in the reviewed plan. New target modules receive new IDs; existing target modules retain theirs. Root unclassified maps to the target's reserved root. A target organization has at most one retained registration per Catalog subject: reuse it, explicitly resolve conflicting state/placement/settings, and never auto-restore it. Unmentioned target modules and registrations remain unchanged.

Import receipts retain created-ID mappings and approved results. Persist a unique mapping from `(target organization, source organization, exportId, package ref)` to each created target identity, with its initial accepted field snapshot. Reuse that identity even if a later request uses a different idempotency key and the target module was renamed; the creation snapshot supplies the baseline for same-organization package-created objects. A mapped target that has been deleted is a conflict, never a name-based recreation. Same request key and content returns the committed receipt; changed content with the same key fails. A deliberate later import is a new preview, not a continuing synchronization job. Entries without prior mappings require explicit target matching as before.

## Preview and confirmation UX

Add “Export complete structure”, “Import structure” and the editing-guide download to module management. Import mode is explicit: update this organization or copy into the current target organization. Show source and target prominently; target comes from authorized operating context, never from a file field.

1. Parse and validate without domain writes; summarize scope and read-only references.
2. Show module creates, edits, moves and deletes; registration/state/alias/recognition changes; unchanged/skipped reference entries; and affected subjects/project counts.
3. Resolve proposed target mappings and field conflicts. Show baseline/file/current values for update conflicts, and source/target values for copy conflicts. A changed choice produces a fresh server preview.
4. Show every deleted module's child disposition and affected root registrations, including retired ones. Require each root's target or explicit `unset`; also disclose retained legacy references that will be detached. No implicit child deletion or subject retirement.
5. Require the existing human permission/impact confirmation semantics and a common reason for the approved batch. An unresolved conflict disables submission. Submit once; show a durable receipt with counts, target and links after commit.

No new approval workflow is introduced. Agents may prepare JSON; they do not acquire direct execution rights. Keep errors and edits when retrying. Navigating away from a dirty import asks whether to discard it. Verify keyboard operation and the affected state at `1440x900`; add a compact PC window only for layout risk.

## Server implementation

Expose three operations behind the existing Catalog-governance API family: export, preview and apply. S1 registers concrete routes, DTOs and manifests alongside the existing module-management adapter. Export persists a baseline and an audit event, so use an explicit POST; preview has no domain writes; apply receives document, mode, mapping/conflict resolutions, preview token, idempotency key and reason.

**Ownership.** Add a feature-specific coordinator inside `parameter-governance`. It owns the private UnitOfWork and uses the existing guarded registration writer, transaction-aware taxonomy operations, recognition validation and audit. HTTP calls one public command. Do not export the private writer/UoW or build a generic import framework. Extract only transaction-aware pieces genuinely shared with existing single-item entry points; preserve their security checks and errors. Keep Catalog materialization inside Kernel/publication.

**Baseline and receipts.** Add a narrow organization-owned export-baseline table and durable package-ref mappings with the uniqueness constraint above. Reuse the governance idempotency persistence with a dedicated command family and an immutable result receipt if its current shape supports this; otherwise add the smallest receipt storage required. Stored request fingerprints bind target, actor/context, mode, document and explicit resolutions. Never store uploaded document bodies in generic audit logs. Baselines are created only by export, not accepted from the client.

**Concurrency.** Reuse pointer, organization-recognition, registration and tree locks in a single verified order. Before implementation, enumerate all single and batch module writes, registration-created categories, seed initialization, recognition edits and binding/materialization writers affecting validation. Make conflicting paths participate; move any pre-lock checks that determine validity into the transaction. Decide the exact common order from that call graph and prove it with independent PostgreSQL sessions. Adding a lock only to the importer does not satisfy the contract.

The #1494 implementation uses shared Catalog pointer → organization recognition → organization registration → module tree, before registration row locks. Module CRUD, registration and batch/category creation, seed placement and M1 seed module writes use that order. Recognition edits, canonical binding writes, DTS ingestion and ordinary project deletion hold the recognition fence; canonical JSON admission acquires it before source reads and writes. Project purge takes the Catalog pointer exclusively before its table locks. Module-structure migration already takes the same organization fences. The historical identity migrator requires a maintenance token, confirmed write lock and snapshots; quality reset and lab fixture scripts are operator/test tools, not concurrent runtime admission. SQL migrations run in their deployment context. Later apply work must use the same order and verify its own complete writer inventory and races.

Legacy upload, file and baseline rollback, candidate activation, review writeback and seed-plane disposal acquire the recognition fence before their source writes, including when semantic ingestion is disabled. Canonical source commits acquire it through their governed inspection or ingestion; initialization creates new source files before ingestion rather than replacing counted versions.

Apply authorizes first. It may return an already committed matching receipt as a fast path, but must atomically reserve or reread the idempotency record inside the locked transaction before target revalidation: two simultaneous identical requests must converge on the same receipt, not make the second fail stale after waiting. Then reread the target, reconstruct the approved plan and compare the preview token. Bind the token to target identity, mode, document, decisions, relevant field/structure versions, registration/recognition versions, current release and deletion/capacity impact. Changed evidence returns a stale-preview conflict. A token is not authorization.

**Execution.** Validate the final graph before writing. Create required parents, schedule renames/reparents, write registration/placement/alias/recognition changes, handle explicit detachments, then delete modules from leaves upward. Immediate sibling uniqueness means name swaps and moves into vacated paths need a tested collision-safe schedule; if temporary names/positions are required, keep them transaction-local and absent from business audit. No disabling constraints or publishing an intermediate graph. Check deferred constraints and commit audit plus receipt in the same transaction; any failure rolls back every change.

**Governance gaps.** Add alias edit/clear, explicit placement detach, and the Q11 retired-placement/copy capability as guarded operations, with version checks and audit. A retired registration stays retired and cannot create new project bindings. Never restore-retire as a hidden implementation trick. The copy writer must be able to create a retained retired root and its retained child registrations/structural placements directly, preserving per-child status and `cascade_retired`; the current `retire-unregistered` operation does not create missing children. Treat these child lifecycle facts as a validated snapshot, not independent child lifecycle commands, and list their effect in confirmation. Preserve an active root with a historically retired, non-cascade child. If source lifecycle facts cannot be represented under the current Catalog/cascade rules, return a precise conflict rather than inventing children or omitting state. Recognition copy reruns target-project capacity and selector validation; inheritance reset is explicit.

Authorization is the conjunction of permissions for every planned operation, not merely module `admin:access`. Use trusted human invocation and authorized operating organization. Export of the full admin package also checks access to its organization settings. Source metadata never grants target authority. Use normal audit provenance and no device or production writes.

## Delivery slices

The user invoked `implement-spec` after ticket publication: implement tickets #1494–#1504 in separate worktrees, integrate them on one branch based on current `main`, and merge one reviewed PR closing the specification and tickets. Preserve unrelated work. Internal foundations do not expose an incomplete import button.

| Slice | Deliverable | Evidence owned by that slice |
| --- | --- | --- |
| S1 Contract, snapshot and planner | Freeze JSON schema/guide, baseline persistence, complete export, three-way diff, final graph checks and copy matching | Contract/round-trip tests; real PostgreSQL coherent snapshot, baseline tenant isolation; malformed/conflict examples |
| S2 Governed writes and lock coverage | Shared transaction-aware mutations, alias/unset/retired-placement support, inheritance reset and common lock order | Existing single-item regressions, real-role PostgreSQL concurrent writers and Catalog constraints; independent review |
| S3 Atomic apply and retry | One UoW, preview binding, conflict resolutions, delete scheduling, receipt and audit | Mid-batch failure rollback, stale preview, rename swaps, lost-response replay, tenant/role checks; independent review |
| S4 Module-management UI | Export/import, mode and mapping choices, conflict/impact views, dirty state, receipts | Real API browser at `1440x900`; accessible controls; update and nonempty-target copy journeys |
| S5 Acceptance and documentation | Full populated-organization scenarios, user guide and existing stale deletion copy reconciled | Impact-selected regression, build, required CI; documented scale and evidence limits |

S1–S5 describe responsibility and acceptance areas. Execution follows the published ticket graph: #1494 and #1495 → #1496; #1496 → #1497/#1498/#1499; #1498 → #1500; #1497 + #1498 → #1501; #1497 → #1502; #1499 + #1500 + #1502 → #1503; #1501 + #1503 → #1504. Each vertical ticket includes its API, UI and verification where applicable. This feature does not adopt the sealed Wayfinder delivery protocol.

## Acceptance cases

1. An unchanged export imports as a domain no-op: IDs, inheritance and lifecycle remain identical. All current modules/registrations are exported despite filters or pagination.
2. One batch adds parents/children, changes metadata, moves a subtree, swaps sibling names and explicitly deletes old modules; the final tree is correct with no transient committed state.
3. Missing rows/fields preserve existing objects; explicit clears work only for clearable fields. Source IDs, local refs and subject IDs cannot be confused.
4. Deletion of a populated parent is blocked until all children and root placements are explicitly handled. `unset` differs from unclassified. Referenced parameters and history survive.
5. Nonempty-target copy supports confirmed reuse and new IDs, preserves unrelated target data and all source data, and never executes source delete markers.
6. Active/retired registrations, owned children, aliases and inherited/overridden recognition round-trip; retired placement changes never enable binding creation. After copying a retired driver, restore it and verify that only its original cascade-retired children restore. Preserve an active parent with a non-cascade retired child. Incompatible Catalog/lifecycle facts produce explicit conflicts.
7. Different-field concurrent edits merge; same-field differences require selection. Concurrent deletion, new children and changed project impact are conflicts. Invalid final merged graphs are rejected.
8. Preview/apply races against single create/edit/move/delete, registration, recognition, source ingestion and Catalog activation either serialize or fail stale; no deadlock-induced partial commit.
9. Cross-organization IDs, actor spoofing, read-only actors and Agent execution are refused; file metadata cannot read another organization's baseline or bypass permissions.
10. Concurrent duplicate requests and lost HTTP responses return the same committed receipt; same key/different content fails. Re-import the same file with a new key after renaming its newly created target module: reuse its mapped identity, merge or conflict as appropriate, and never create a second module/registration or repeat the original mutation audit.
11. Inject failures after module, registration, recognition, audit and receipt writes; verify all domain state rolls back using the actual runtime roles. Export baseline and import receipt access remain organization-scoped.
12. Malformed/unknown versions, duplicate rows, dangling references, cycles, reserved/legacy edits, invalid selectors and singleton conflicts fail with useful locations. Largest supported packages do not truncate, recurse without bounds or secretly partial-commit.

Use `npm run test:impact -- <changed-files>` and inspect both Vitest/browser fallback flags. Run the selected native checks, real PostgreSQL tests where invariants live, the TypeScript/build gates for implementation, and one independent review for the sensitive diff. Local unit, PostgreSQL, browser, CI and deployment evidence remain separate.

## Documentation Impact Matrix

| Document | Change and owner |
| --- | --- |
| This plan and Chinese companion | Coordinator keeps confirmed decisions, delivery and acceptance aligned |
| `CONTEXT.md` | Add structure package/update/copy vocabulary without claiming implementation |
| Accepted ADR-0054 and Chinese companion | Record organization-owned identity, explicit deletion, atomic governance and retired-placement extension; design accepted, implementation pending |
| Parameter user guide and organization-governance guide, English/Chinese | S5 explains JSON workflow and corrects stale module-deletion descriptions against the delivered contract |
| API DTO/route manifests and relevant security/domain docs | S1–S3 document actual public commands, scoped ownership and authorization; existing ADR status links the accepted amendment without claiming implementation |

## Documentation Update Gate

The user confirmed the complete plan on 2026-11-03; the public export/preview/apply test boundary, real PostgreSQL invariants and UI acceptance are carried into specification #1493. Before handoff, keep bilingual documents aligned, validate relative links and run the repository docs checks. Publishing this specification changed no product behavior, live data, tests or approval policy. The present record is not proof of implementation, CI, target-host or production acceptance.
