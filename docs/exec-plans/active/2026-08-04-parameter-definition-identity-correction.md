# Parameter definition identity correction

> Status: **Active** — Batches 1–4 implemented 2026-08-17; awaiting parent archive
> Date: 2026-08-04
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-04-parameter-definition-identity-correction.md`](../../zh-CN/exec-plans/active/2026-08-04-parameter-definition-identity-correction.md)
> Governing decision: [ADR-0017](../../adr/0017-definition-identity-is-correctable.md)
> Amends: [ADR-0013](../../adr/0013-attribution-subjects-are-stable-catalog-entities.md), [ADR-0014](../../adr/0014-parameter-definitions-are-versioned-subjects.md)
> Predecessor: [`2026-08-03-parameter-spec-editor-fidelity.md`](../completed/2026-08-03-parameter-spec-editor-fidelity.md)

## Context

The predecessor plan closed SE-7 by collapsing 驱动模块 and 所属模块 into one read-only attribution field with a link to 模块管理, and listed re-attribution from the editor as an explicit non-goal on the grounds that "under ADR-0010 the subject's placement is changed in 模块管理; this plan only makes that discoverable."

Reviewing that field on 2026-08-04 showed the non-goal rested on a false premise. 模块管理 can rename and move modules, edit compatible / node-type mappings, recompute a binding's `module_id`, and edit registration metadata. It holds **no path that writes `parameter_specs.attribution_subject_id`** — no route, no service, no SQL outside migration backfill. So an operator who selected the wrong attribution subject at creation is directed to a page that cannot fix it, and discovers only by exhaustion that the real recourse is deprecate and recreate.

That recourse is worse than it sounds. There is no delete route for a definition, and deprecation is soft (ADR-0011), so every correction leaves the wrong row in the catalog permanently — still audited, still releasable for parsing, still competing in library search. ADR-0014 already rejected identity churn for exactly this reason when it declined to "mint a new ParameterSpec identity on every semantic change".

The reason both fields are read-only is not UI conservatism. `parameter_specs.id` is a hash of the identity triple, and three find-or-create paths locate an existing definition by re-deriving that hash. Changing a stored identity field while the row keeps its id makes those paths conclude the definition is absent and insert a duplicate. Making the fields editable therefore requires demoting the id to a surrogate first, which is what ADR-0017 settles.

## Goal

An Admin can correct a wrongly authored parameter definition identity from the definition library, in place, with an audit trail — without deprecating the definition, without losing its version history or bindings, and without any possibility of silently splitting one property across two catalog rows.

## Non-goals

- Renaming a `property_key` that projects already reference. Under D-ID-2 that stays refused; ADR-0017 records it as a staged-cutover question, not an editor field.
- Changing owner scope. Promoting an organization definition to platform remains the separate promotion path (ADR-0009 parallel).
- Hard delete of a definition. Still out of scope, unchanged from ADR-0011.
- Retiring `specification_key` as a display source. D-ID-3 keeps it correct by rewriting it; removing the roughly two dozen parsing sites is ADR-0017 follow-up.
- Re-pointing existing bindings on re-attribution. A binding's `module_id` keeps resolving by mapping under ADR-0010.
- Reopening cell-array layout governance, settled in [ADR-0016](../../adr/0016-cell-arrays-are-governed-by-column-width-only.md).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/parameter-definition-identity-correction`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch cut from `main` after the editor-fidelity branch merges. Batch 1 is a behavior-preserving refactor with its own verification gate and should be a separate reviewable commit from Batch 2, because a defect in Batch 1 manifests as duplicate rows rather than as a failure.

## Findings this plan must close

Evidence collected 2026-08-04 from the sources named below.

| ID | Finding | Evidence |
| --- | --- | --- |
| ID-1 | **`attribution_subject_id` has no writer after creation.** Neither `updateParameterSpecBodySchema` nor `activateParameterSpecBodySchema` accepts it; neither service UPDATE touches it. Ingest upsert uses `coalesce(…, excluded.…)`, which fills a null but never overwrites. | `schemas.ts:159-208`; `service.ts:1154-1161,1241-1287`; `repository.ts:1325-1326` |
| ID-2 | **`property_key` has no writer after creation.** Same absence in both bodies; the only `property_key` update is the ingest upsert keyed by an id that is itself derived from the key, so it cannot change it. | `schemas.ts:159-208`; `repository.ts:1372-1384`; `specIdentity.ts:149-151` |
| ID-3 | **The read-only hint sends the operator to a page that cannot help.** 「归属在 模块管理 中调整」 links to `/parameter-admin/modules`, which writes `parameter_modules`, `parameter_module_mappings`, `driver_registrations`, and binding `module_id` — never `parameter_specs.attribution_subject_id`. | `ParameterSpecDetail.tsx:304-307`; `parameter-modules/service.ts:512-716`; `parameterModuleRepository.ts:311-407` |
| ID-4 | **Identity is the row address, not just a stored fact.** Three find-or-create paths re-derive `buildSubjectScopedManualSpecIds` to decide whether a definition exists. | `provisionalSurfaceBinding.ts:22`; `reviewApply.ts:483`; `driverSchemaOverlayService.ts:110`; generator at `specIdentity.ts:139-144` |
| ID-5 | **Identity uniqueness is enforced only indirectly.** The constraint is `unique nulls not distinct (organization_id, source_kind, specification_key)` over a derived string; there is no constraint on the triple itself. | `0048_parameter_topology_schema_shadow.sql:15`; derivation at `specIdentity.ts:137-138` |
| ID-6 | **`property_key` and `attribution_subject_id` live on different tables.** The key is on `dts_property_specs` (one-to-one via a unique `parameter_spec_id`), the subject on `parameter_specs`, so a triple constraint is not expressible on one table as it stands. | `0048_parameter_topology_schema_shadow.sql:9-16,53-64` |
| ID-7 | **`specification_key` is parsed as fact by roughly two dozen read sites.** Most now prefer `dps.property_key` via `coalesce`, but module filtering, the migration matcher, semantic identity naming, the module repository, and agent perception still parse it directly. | `semanticParameterReads.ts:58`; `migration.ts:230-252`; `semanticParameterIdentityNames.ts:17-30`; `parameter-modules/repository.ts:379-381`; `perceptionTools.ts:90-93` |
| ID-8 | **The editor cannot even show which subject was chosen.** `attributionSubjectId` is present in the detail DTO but unrendered; 所属模块 shows observed bindings first and falls back to the subject *display name* plus 「（未实测）」, so a wrong subject with a plausible name is indistinguishable from a right one. | `schemas.ts:35`; `formatSpecAttributionLabel` at `ParameterSpecLibrary.tsx:110-121`; `repository.ts:1077-1138,1186-1188` |

## Decisions (settled 2026-08-04)

### D-ID-1 — the row id becomes a surrogate; lookups resolve by columns

Rejected alternative was keeping `id` as the identity hash and cascading an id rewrite across the roughly twelve tables carrying `parameter_spec_id`. That is mechanically possible in one transaction but audit rows reference the old id as `target_id`, so the correction would erase its own trail. Full reasoning in ADR-0017.

The three find-or-create paths resolve an existing definition with a query on `(organization_id, attribution_subject_id, property_key)` and call `buildSubjectScopedManualSpecIds` only to mint ids for a row they are about to insert. Existing rows keep their historical ids untouched.

### D-ID-2 — the two fields get different gates

Re-attribution changes where a definition is classified and claimed. It never changes the bytes written to a device, so it is allowed in any lifecycle state, including active with references.

A `property_key` rename changes the property name emitted into every bound project's DTS. With references present that is a semantic change to shipped configuration, not a correction, and belongs to staged cutover (ADR-0014) rather than an inline field. Allowed only while `referenceCount = 0`, computed by the existing `loadReferenceCountsBySpecIds` (`repository.ts:1056-1075`).

### D-ID-3 — `specification_key` is rewritten in step

Freezing it would make a corrected definition filter and match under its wrong identity at the five direct-parsing sites in ID-7. It stays derived, is recomputed from the new triple in the same transaction, and keeps its existing unique constraint as a second guard alongside the new triple index.

`dts_property_specs.schema_namespace` is derived from the same subject and is rewritten with it.

### D-ID-4 — correction is a secondary action, not an inline field

Identity correction is not content editing: it has different authorization consequences, different gates per field, and a failure mode (duplicate rows) that ordinary field edits do not have. Presenting it as one more editable input invites it to be changed by accident while adjusting documentation.

Each field gets an explicit 修正 action opening a confirmation that states the before and after identity, the reference count, and — for a rename — why it is refused when references exist. The subject picker reuses `SpecCreateDialog`'s existing subject tree (`subjectsFromModules` + the 归属主体 control) rather than authoring a second one.

### D-ID-5 — the observed / declared distinction becomes visible

ID-8 means the operator cannot verify the thing they are being asked to correct. 所属模块 keeps reporting observed bindings, because that is a real and useful fact, but the declared attribution subject is surfaced alongside it as its own labelled read-only row with the 修正 action attached. This also removes the ambiguity where 「（未实测）」 silently switches the field's meaning from observed to declared.

## Risks

| ID | Risk | Required handling |
| --- | --- | --- |
| ID-R1 | **A defect in the lookup refactor produces duplicate definitions silently.** Nothing raises: ingest simply creates a second row for one property, splitting bindings. | Batch 1 lands and verifies alone, before any write path exists. Integration coverage must assert that repeated ingest of one identity yields exactly one row, and that ingest after a correction resolves to the corrected row rather than recreating the old one. |
| ID-R2 | **The triple unique index may fail to create on existing data.** If any historical pair of rows already shares a triple — possible because uniqueness was only ever enforced on the derived key, and the legacy hash formulas were lossy (`findLegacyManualSpecIdentityCollisions` exists for exactly this) — migration `0090` aborts. | Run a pre-flight duplicate query before writing the migration. If duplicates exist, the migration must fail closed with a report, matching how `0088` handled unresolvable rows; do not silently pick a winner. |
| ID-R3 | **Correcting a subject can collide with an existing definition.** The target triple may already be taken, possibly by a deprecated row that is invisible in the default library view. | Return 409 with the conflicting definition's id and lifecycle so the operator can see a deprecated blocker rather than an unexplained failure. |
| ID-R4 | **Rewriting `specification_key` changes derived display and match behavior.** The migration matcher (`migration.ts:230-252`) ranks candidates by it. | Accept as intended under D-ID-3, but verify that the matcher's ranking is unaffected for uncorrected rows, and note in the API contract that the field is derived and may change. |
| ID-R5 | **Platform-global definitions must not be correctable by an ordinary org Admin.** | Reuse the deprecate/restore ownership split: `requireOrgOrGlobalSpec` only for `platform-admin`, otherwise `requireOrgOwnedSpec`. |
| ID-R6 | **The mock runtime will not know about the new capability**, leaving component tests green on behavior the API lacks — the same trap the predecessor plan hit as SE-R2. | Change `mockParameterTopologyRepository.ts` in the same batch as the server, not after. |
| ID-R7 | **Re-attribution leaves `attributionModules` disagreeing with the declared subject** until the next ingest. | Correct by design (ADR-0017), but D-ID-5's labelling must make observed-versus-declared legible so the disagreement does not read as a bug. |

## Delivery batches

### Batch 1 — decouple lookup from the identity hash (no behavior change)

1. [x] Pre-flight duplicate query on `(organization_id, attribution_subject_id, property_key)` across existing rows (ID-R2).
2. [x] Migration `0090`: unique index on the identity triple, fail-closed on duplicates, resolving the cross-table problem in ID-6.
3. [x] Add a single `findParameterSpecByIdentity` helper and route all three find-or-create paths through it, keeping `buildSubjectScopedManualSpecIds` for insert-time id generation only (ID-4, D-ID-1).
4. [x] Integration coverage per ID-R1: repeated ingest of one identity yields one row; the resolver finds rows whose historical id does not match the current hash formula.
5. [x] Verification gate: full `npm run test:server -- parameter-specs` plus the topology suites, green before Batch 2 starts.

### Batch 2 — identity correction service

6. [x] `reattributeParameterSpec`: any lifecycle, rewrites `attribution_subject_id`, `specification_key`, `schema_namespace`; 409 on triple collision with the blocker's id and lifecycle (D-ID-2, ID-R3).
7. [x] `renameParameterSpecPropertyKey`: refuses when `referenceCount > 0` with a message naming the count; rewrites `property_key` plus the same derived columns (D-ID-2).
8. [x] Authorization per ID-R5; audit via two new `GovernanceAuditAction` members `spec-reattributed` and `spec-property-key-changed` (`governanceAudit.ts:8-23`), carrying before/after identity and `reasonHash`.
9. [x] Routes, `routeManifest`, and OpenAPI entries for both actions.
10. [x] Mock parity in the same batch (ID-R6).

### Batch 3 — editor surface

11. [x] Surface the declared attribution subject as its own read-only row, distinct from observed 所属模块 (D-ID-5, ID-8).
12. [x] 修正归属 action with the reused subject tree picker and a before/after confirmation (D-ID-4).
13. [x] 修正属性键 action, disabled with an explanatory reason when references exist (D-ID-2, D-ID-4).
14. [x] Replace the misleading 模块管理 hint with copy that separates placement from attribution (ID-3).
15. [x] Component coverage for both actions including the refusal and collision paths.

### Batch 4 — documentation and acceptance

16. [x] Work the Documentation Impact Matrix below.
17. [x] Register and cover the new acceptance IDs.
18. [x] playwright-cli evidence at 1440×900 / 768×1024 / 390×844 with 0 console errors, covering a successful re-attribution, a refused rename, and a collision.

Session `identity-batch4` (plus `identity-batch4-clean` for the post-fix console check) against `VITE_WISEEFF_RUNTIME_MODE=mock` Vite on `http://localhost:5181/parameter-admin/specs` as Admin Xu Yun.

Screenshots (gitignored) under `work/ui-checks/param-spec-identity/`:

- `desktop-1440-library.png` — library with `gpio_int` ×2 and `mystery_prop`
- `desktop-1440-rename-refused.png` — referenced `gpio_int` (充电策略 / spec-sc8562-gpio-int), 「修正属性键」 disabled, 引用数：1
- `desktop-1440-collision-blocker.png` — reattribute onto MT5788; product copy `目标身份已被定义「spec-mt5788-gpio-int」（已启用）占用，无法覆盖。`
- `desktop-1440-reattribute-success.png` — charger subject (`asub:nodetype:charger`), toast 「已修正归属主体」
- `desktop-1440-reattribute-reopen.png` — reopen: declared subject still charger, lifecycle 已启用, 引用数 1, still two `gpio_int` rows
- `desktop-1440-rename-offered.png` — `mystery_prop` usageCount 0, 「修正属性键」 enabled
- `tablet-768-library.png` / `tablet-768-editor.png`
- `mobile-390-library.png` / `mobile-390-editor.png`

Clean-session `console error` after a successful re-attribution: 0 errors (React DevTools info only). Mock audit refresh no longer fetches `127.0.0.1:8787`.

## Key seams (starting points)

- Id generation and formulas: `server/modules/parameter-specs/specIdentity.ts:111-160`.
- Find-or-create paths: `provisionalSurfaceBinding.ts:12-60`; `reviewApply.ts:470-560`; `driverSchemaOverlayService.ts:100-140`; create at `service.ts:809-900`.
- Write contract and DTOs: `server/modules/parameter-specs/schemas.ts:27-208`.
- Reference count and detail read: `server/modules/parameter-specs/repository.ts:1056-1075,1178-1270`.
- Audit action union: `server/modules/parameter-topology/governanceAudit.ts:8-23`.
- Attribution label helpers: `src/components/parameter-topology/ParameterSpecLibrary.tsx:110-152`.
- Read-only identity fields and the hint: `src/components/parameter-topology/ParameterSpecDetail.tsx:290-310`.
- Reusable subject picker: `src/components/parameter-topology/SpecCreateDialog.tsx` (`subjectsFromModules`, 归属主体 control).
- Mock parity: `src/infrastructure/mock/mockParameterTopologyRepository.ts`.

## Documentation Impact Matrix

| Area | Action | Paths | Evidence |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — confirm neither states identity is immutable | Unchanged 2026-08-17: neither file claims definition identity is immutable or creation-only. |
| Planning | Update | this plan; ZH companion; `docs/exec-plans/tech-debt-tracker.md` (+ ZH) for the deferred referenced-rename cutover | This plan Batch 4 checked off; **TD-117** appended (highest Open id on origin/main was TD-116; TD-044 / TD-079 untouched). |
| Architecture / ADR | Done | [ADR-0017](../../adr/0017-definition-identity-is-correctable.md) added and indexed; supersession notes appended to ADR-0013 and ADR-0014 | Written 2026-08-04; not reopened. |
| Domain glossary | Update | `CONTEXT.md` — 「Attribution subject」 must stop implying identity can only be set at creation; add 「Identity correction」 | Already on origin/main: Attribution subject notes in-place correction (ADR-0017); Identity correction row present. Unchanged this batch. |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) for the two new routes, the 409 collision shape, and `specification_key` being derived (ID-R4) | Added `POST .../reattribute` and `POST .../rename-property-key`; 409 `{ parameterSpecId, lifecycle }`; identity paragraph states derived `specification_key` and surrogate id. |
| Design docs | Update | `docs/design-docs/domain-model.md` where it states spec identity; `2026-07-30-parameter-governance-deferred-questions.md` if it recorded re-attribution as deferred | ParameterSpec / global / manual-identity rows updated EN+ZH. Deferred-questions docs do not record re-attribution as deferred — unchanged. |
| Frontend / design | Update | `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` for the declared-versus-observed attribution split | Spec-library paragraph now states observed vs declared, 修正归属 / 修正属性键 gates, and collision copy. |
| Security / governance | Update | `docs/SECURITY.md` — two new audit actions and their ownership split (ID-R5) | EN+ZH: `spec-reattributed` / `spec-property-key-changed`; org Admin vs `platform-admin` same as deprecate/restore. |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) and `docs/developer/user-operation-coverage-matrix.md` (+ ZH) | `PARAM-SPEC-IDENTITY-001` / `002` registered (`required: false`, operations `future`, TD-079). |
| Generated artifacts | Update | `docs/generated/db-schema.md` for migration `0090` | Index `parameter_specs_identity_triple_uidx` already in the artifact. `npm run db:schema-doc` skipped: server lacks pgvector (`docs:check` already skips). |
| Reliability / runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` — it may need the correction path noted alongside cutover | Unchanged: runbook is the maintenance-window path-identity cutover, not catalog identity correction. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` for the definition-editing description | Unchanged: high-level spec-library governance; does not claim identity is immutable. |
| References | Review | `docs/references/productization-api-contract-draft.md` for quoted spec bodies | Unchanged: draft does not quote parameter-spec write bodies. |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix row is updated or recorded unchanged with evidence.
2. All eight ID findings are closed or explicitly deferred into `exec-plans/tech-debt-tracker.md`.
3. All seven ID-R risks are closed with evidence, ID-R1 and ID-R2 with test or query output rather than assertion.
4. The deferred referenced-rename cutover is filed as tech debt with a pointer to ADR-0017 § Follow-up.
5. `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` are green.

## UI interaction coverage

This plan adds write paths that change visible governance state, so the UI Interaction Automation Rule applies.

New IDs to register in `docs/developer/browser-acceptance-coverage-map.md` **before** implementation is claimed complete:

- `PARAM-SPEC-IDENTITY-001` — an Admin corrects a definition's attribution subject from the library, the declared subject updates on reopen, the definition keeps its lifecycle and reference count, and no second definition appears for the same property.
- `PARAM-SPEC-IDENTITY-002` — a rename is offered on a zero-reference definition and refused with a stated reason on a referenced one; a correction that collides with an existing (including deprecated) definition surfaces the blocker.

## Verification

```bash
npm run test:server -- parameter-specs
npm run test:server -- parameter-topology
npm test -- src/components/parameter-topology
npm test -- src/ParameterAdminNextPage.test.tsx
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# Browser evidence under work/ui-checks/param-spec-identity/
```
