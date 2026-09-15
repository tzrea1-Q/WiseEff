# Parameter definition workspace restoration and governed identity migration (#847)

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md)

## Status

Active, **partially implemented**. Issue: [#847](https://github.com/tzrea1-Q/WiseEff/issues/847) (`ready-for-agent`, confirmed 2026-09-14 with S1/S2 seams and migration defaults).

### Implemented in this run (Scratch branch, no PR)

Wave 1 (collection contract, complete-name projection) and Wave 3 items 7–9 plus part of 11 are implemented and evidenced:

- **Collection contract (S1).** `CatalogPage.pageInfo` (`totalCount`, `hasMore`) in `server/modules/catalog-kernel/interface.ts` + `runtime/currentSnapshot.ts`; `DefinitionListScope.kind: "subjects"`; definition search now covers the established vocabulary (property key, id, display name, description, documentation, matching source property and notes, subject key/id and subject aliases); the `placementModuleId` module-subtree and repeated `subjectIds` scope parameters; the module subtree is resolved to a trusted subject selection **before** pagination through a new `selectPlacementSubtreeSubjectIds` governance query over `parameter_modules` + `subject_placements` + `organization_subject_registrations`; every catalog list envelope — read **and** governance — now carries `totalCount`/`hasMore`.
- **Complete-name projection.** `displayName` and `unit` reach the definition revision DTO (previously dropped, which returned HTTP 500 for the definitions collection on a real server). `description`, `schemaDefault`, `examples` and editable `constraints` remain **not implemented**.
- **Restored workspace (frontend).** `CatalogPage` is composed as module navigator + wide definition table + on-demand detail/history + count-bearing pending work; search, searchable module and lifecycle column filters, 20/50/100 page sizes, previous/next with an exact cursor trail, and a truthful scoped count applied before pagination; the permanent three-way peer grid that produced the 328 px table is gone, replaced by a readable table floor plus horizontal scroll.
- **Real evidence.** Dedicated lane `wiseeff_lane_847`; focused server tests green on it including the new `collectionQuery.integration.test.ts`; `typecheck`, `build`, `ui:check`, `contract:check`, `docs:check`; real-API browser acceptance on `/parameter-admin/specs` at three viewports.

### Implemented in this run — definitions and migration

- **Description content contract (decision 6, partial).** `description` is a first-class definition content field end to end: change-set contract, capability budgets (`maxDescriptionChars`), the compiler revision content pointers (`/description` in `schemas/dts/catalog-release/stable-id-rules.json`), the release JSON schema, the builder's revision digest model, and the publication draft. The remaining decision-6 fields (`schemaDefault`, `examples` round-trip through the draft but not the editor, editable `constraints`, explicit clear-vs-unchanged semantics) are still open.
- **Definition lifecycle (decision 10).** `retire-definition` and `restore-definition` are typed authoring operations on the existing complete-successor contract: canonical soft retirement blocks new matching/use while preserving the permanent identity, key, revisions, pinned historical references and project values; restoration publishes `active` for the same identity and key; `deprecated` remains a distinct existing state and is never written by these operations. `retiresIdentity` is now derived from the change set so the risk classifier sees a retire as an identity-affecting act. Evidence: `server/modules/catalog-publication/builder/definitionLifecycle.test.ts`.
- **Single-dialog lifecycle activation (decisions 7–8).** `DefinitionLifecycleDialog` captures the candidate, shows the shared impact plus the usage counts, requires a reason, publishes through the existing governed pipeline, polls the publication job, and reports the **actual** activation result including `active-superseded`. A rejected request keeps the input (`data-preserve-input`).
- **Identity correction preview/execute/continue (decisions 12–17, S2).** Shared HTTP contract (five routes, `PCAT-API-13`), `DefinitionCorrectionDialog` (explicit authorized project manifest, exact impact preview, per-project compatibility and blockers, single confirmed execute, per-project outcome reporting and a continuation path for blocked projects). The persistence layer, module, consumer alignment and threat-matrix execution are owned by the sealed R3 lane and reported separately.
- **Current-selection port surface (decision 14/18, frontend half).** `ParameterCatalogRepository` plus the API adapter expose `previewDefinitionReplacement`, `listDefinitionReplacements`, `createDefinitionReplacement`, `getDefinitionReplacement` and `continueDefinitionReplacement`; the explicit mock adapter fails closed with `unsupported-catalog-capability` so mock mode can never invent migration authority.

### Not implemented in this run

| Item | State |
| --- | --- |
| Remaining decision-6 content fields (`schemaDefault`, editable `constraints`, editor-level `examples`, clear-vs-unchanged semantics) | Not started |
| Browse-other-subjects, explicit placement intent, registration-only continuation (decision 5, stories 6–8) | Partial: registration/placement remain the existing dialogs and still never receive `placementOptions` |
| Reviewed replacement confirmation / high-risk approval reuse inside the correction dialog | Partial: the dialog relies on the existing publication risk classification and does not yet show a separate high-risk approval state |
| Browser acceptance for the lifecycle and correction dialogs at three viewports | Done for both dialogs: form, impact preview and per-project result captured at 1440×900 / 768×1024 / 390×844 (`work/ui-checks/847/`), including the completed identity-correction success path |

### R3 sealed lane result (identity correction migration)

- **Persistence.** `server/migrations/0144_definition_replacement.sql` adds `definition_replacement_previews`, `definition_replacements` and `definition_replacement_projects`, value provenance on `project_parameter_values` (`replaced_from_value_id` + `replaced_from_definition_id` and the composite provenance key), the `current_project_parameter_bindings` view, `resolve_current_binding`, the deferred `project_value_current_binding_ck` write guard, the no-chain guard, the immutability triggers and the one-current-successor partial unique index. Every new relation, view and function is owned by `catalog_migration_owner`; all DDL is idempotent so a fresh database and the stepwise 0137→0144 upgrade converge to the same ACL fingerprint.
- **Module.** `server/modules/parameter-catalog-migration/` implements preview / create / continue / get / list with the frozen fingerprint, value-schema compatibility, the source gate, coupled-source detection, organization-scoped idempotency and trusted audit, and publishes only through the existing complete-successor/Candidate/Authorization/synchronizer path.
- **Consumers aligned to the current-selection rule:** `usage/query.ts`, `adapters/projectReadAdapter.ts`, `values/repositories.ts` (including `casCurrentTip`), `values/service.ts`, `binding/repositories.ts`, `catalogProjectValueSync.ts`, and the `binding-replaced` typed block in `adapters/{dto,writebackAdapter}.ts`. Pinned historical reads (`readProjectValueHistory`, `loadHistoryByRevision`) deliberately keep the exact binding/revision contract.
- **Threat matrix executed (31 rows):** RT-02/03/04(partial), ID-01/02, VL-01/02/05/06/08/09, SR-01/02/04, ST-02, IV-01/03/05/06/09/10, RC-01..06, TN-02/03/04, AU-03, ST-04.
- **Not executed, with the concrete reason recorded in the module's report:** PA-02/PA-05 and the process-restart half of RC-01 (need independent sessions plus an in-flight fault hook at a project boundary), PA-04 (an un-materialized successor is not seeded), ID-07 (unreachable by construction), ST-01/ST-03/TN-01 (need the HTTP governance surface plus a second tenant/release), AU-04 and VL-03 (need a distinct concurrency/self-approval fixture).
- **Deviations accepted and recorded in ADR-0044:** a third `definition_replacement_previews` relation is required by the frozen HTTP contract's `previewId`/`expiresAt`; the §3.3 provenance FK needed an explicit `replaced_from_definition_id`; and the §3.1 FKs force "publish the successor, then persist the replacement", so `create` answers a retryable "catalog not ready" with the preview retained until the publication manager has installed and receipted the successor.

### Success path closed in the follow-up run (2026-09-15)

Walking the real browser flow against the real API and the real publication manager exposed three gaps that no seam test had covered. All three are fixed and covered by tests:

- **Source format was undecidable from the recorded ref.** The dts ingest path records `config-set:<id>`, which the `.dts`-only gate rejected, so every project blocked with `unsupported-source-format`. `resolveSourceLocation` (`parameter-catalog-migration/evaluate.ts`) now resolves the real `.dts` file and node locator from the DTS occurrence behind the value at preview **and** execute time — append-only value rows are never rewritten — while new writes record the resolved `.dts` location directly (`catalogProjectValueSync.ts`) and `resolveConfigRevisionForSource` accepts both ref shapes. Evidence: `provenance.integration.test.ts` (SR-02, SR-03, SR-05/ID-02), `evaluate.test.ts`, and the updated `catalogProjectValueSync.integration.test.ts`.
- **The browser could never reach the server's write route.** `apiAdapter` forwarded only the release pin and dropped the required `Idempotency-Key`/`If-Match`, so preview answered 409 `revision-conflict` before the command was read; `create` then could never persist because the API left activation to the manager and rejected the very release that publication produced. The adapter now forwards the write context, the dialog retries the same idempotent command with a refreshed release pin while the manager installs the successor, the API observes activation through the manager's Activation Receipt (never installing the release itself, CP-07), and the preflight accepts the preview's own successor release as current. Evidence: `DefinitionCorrectionDialog.test.tsx` (write context + activation retry), `provenance.integration.test.ts`, and the recorded browser walkthrough below.
- **Stale review work blocked corrections forever.** An open `parameter_review_items` row captured for a superseded release is neither listed nor resolvable, but counted as open work org-wide. `countOpenReviewItems` now counts open items for the release under correction, matching the reviewer queue's own rule (VL-06, ADR-0044 §9).

**Real-browser success path (recorded).** Dedicated lane `wiseeff_lane_847`; browser acceptance instance `wiseeff_i847lane_1_1` on the same pgvector server with `publicationEnabled=true`, `adopted=true`, `authoringAllowed=true`, `publishingAllowed=true`, `blockers=[]`; publication manager running as its own process with the dedicated manager LOGIN. On `/parameter-admin/specs` → subject `charger` → definition `iin_final_16660` → **身份纠错** with replacement subject `acme,correction`, a new property key, manifest `nebula` and a reason:

- impact preview: 选定项目 1 / 可迁移 1 / 被阻止 0 / 旧定义当前引用 1 / 源格式受支持 **是** / 新主体需要登记 否, no blockers, project 待处理/兼容;
- execute result: `data-correction-result="completed"`, 已完成 1 / 被阻止 0 / 失败 0 / 待处理 0, project Nebula 已完成;
- database after the run: `definition_replacements` `completed`, `definition_replacement_projects` `completed` with a new `pbind_*`/`pval_*` pair, the new value carrying `nebula-board.dts!/charger@0` and the carried value `1000`, and the old binding, value and definition untouched;
- screenshots at 1440×900 / 768×1024 / 390×844: `work/ui-checks/847/correction-{form,preview,result}-{desktop,tablet,mobile}.png` (gitignored `work/`);
- console: two expected transitional HTTP statuses during the handshake (503 `catalog-not-ready` on the first create, 409 `release-drift` on the retry that follows the manager's activation) and no UI error state; the flow ends in the completed result above.

Rows that stay unexecuted after this run: PA-02/PA-05 (independent-session fault hooks), PA-04, ID-07, ST-01/ST-03/TN-01 (HTTP governance surface plus a second tenant), AU-04, VL-03, IV-14, plus the object-store byte-rewrite rows (rewriting the source file bytes remains the property-key-cutover capability's job; this capability moves the value's provenance to the corrected identity, and the `.dts` location is now recorded honestly instead of the opaque config-set ref).


The evidence above establishes the S1 collection behaviour, the definition lifecycle contract, the correction workflow's interface, and the R3 migration's persistence, consumer alignment and executed threat-matrix rows. Rows listed as not executed remain open.

## Goal

Restore the mature pre-2026-09-05 organization parameter-definition workspace — module navigator beside a wide definition table, one Create action, compact search/filter/pagination, on-demand detail history and count-bearing pending work, and a row editor with fixed actions — while connecting it to the **current canonical Catalog** rather than the superseded parameter-spec application. The same change restores definition deprecation/restoration and adds a governed **definition identity correction** capability that publishes a replacement identity and migrates explicitly selected current references.

Acceptance is behavioral at the real seams: a reader/administrator can read, invoke, persist and reopen through the production HTTP surface, dedicated PostgreSQL database and real publication manager. Visual parity alone is explicitly insufficient.

## Non-goals

- Rolling back the canonical Catalog relational model, reopening legacy structural write contracts, private organization overlays, or a second Catalog materializer.
- Hard deletion or in-place reassignment of permanent definition/subject/binding/value/history identity.
- Changing project values or revision pins during ordinary shared definition publication.
- Rebuilding the project parameter import wizard, the separate node export/import initiative, or a generic workflow platform.

## Risk class and run profile

- Overall: **R2 — behavioral** (public API, UI workflow, persistence adapter).
- Sealed sub-lane: **R3 — sealed** for the identity-correction migration only (migration, concurrency, recovery, provenance, destructive action). Threat matrix is frozen before implementation of that lane.
- Development WIP: 2 for lanes sharing migrations/generated schema/OpenAPI; 4 for path-disjoint lanes.
- Merge: serial. Development: parallel. One final Hosted run.
- Dedicated lane database: `wiseeff_lane_847` on `127.0.0.1:55438` (`pgvector/pgvector:pg16`), provisioned by `npm run catalog:lane:env -- provision --issue 847`. The default compose app database is forbidden as catalog-lane evidence.

## Baseline

| Item | Value |
| --- | --- |
| Accepted `origin/main` | `6d72e17cb4c581e7235b181dbbfd45d92f4dee7b` |
| Historical UX reference | `0b2b769a5106b99a80db08fc381dbf16024efd77` |
| Replacement (regression source) | `f96fed3948a6d09f2afe372dbeb74f6a89b1ce30` |
| Scratch worktree | `../WiseEff-worktrees/issue-847-parameter-definition-ux` |
| Scratch branch | `feat/847-parameter-definition-ux-restoration` |
| Stop boundary | No PR creation, no merge, no push to `main`, no production/target operations, no new tracker issues |

Measured regression on `main`: the definition table occupies about 328 px of a 1136 px desktop workspace because `src/features/parameter-catalog/parameter-catalog.css` gives `.parameter-catalog__workspace` three permanent peer tracks (`minmax(0, 1.05fr) minmax(0, 1.2fr) minmax(0, 0.95fr)`) for list/detail/timeline. Arithmetic: `1440 − 256 (sidebar) − 48 (gutter) = 1136`; `(1136 − 32 gap) × 1.05/3.2 = 362.25`; minus pane padding/border 34 → **328.25 px**.

### Reconnaissance correction (recorded before implementation)

`f96fed394` (#809) did not delete the historical workspace — every historical specs component (`ParameterSpecLibrary`, `ParameterSpecDetailDialog`, `ParameterSpecDetail`, `SpecCreateDialog`, `SpecReviewQueue`, `PropertyKeyCutoverPanel`, `DtsTopologyNavigator`, `OrganizationSpecGovernancePanel`, `OrganizationIdentityMappingPanel`) and `src/styles.css` are **byte-identical** from `0b2b769a` to `main`. The historical composition is therefore intact but **unreachable at runtime**: `OrganizationSpecsArea` prefers its new `catalogLibrary` node, and `AppRuntime` always supplies both Catalog ports.

Two consequences change the implementation approach:

1. **The regression is the new mount, not a lost layout.** `CatalogPage` had no importer at the historical reference; its three-column workspace is latent unmounted code that #809 switched on. The measurable defect is the missing primary column, and the restored workspace must be composed on the **current Catalog** — decision 2 forbids reactivating the legacy parameter-spec application.
2. **The legacy orchestration is a superseded writer, not the target.** `docs/design-docs/parameter-catalog-api-transition.md` assigns `410` to `/api/v2/parameter-specs*` activate/deprecate/restore/reattribute/rename/cutover, and `docs/developer/browser-acceptance-coverage-map.md` already marks `PARAM-SPEC-IDENTITY-001/002` and the Effective/Governance peer views retired or superseded. Restoring that surface would revive a retired writer and is explicitly out of scope per the issue.

The historical **presentation and interaction** decisions remain the accepted baseline and are reused: module navigator at 240–520 px beside a table that takes all remaining width (`src/styles.css` `.dts-parameter-workbench__body { grid-template-columns: auto minmax(0,1fr) }`), URL as the source of truth for search/filter/module selection, 20/50/100 page sizes with a truthful result count, one row action opening a wide editor whose action footer is fixed and separated by `--border`, on-demand history, and a count-bearing pending-work action. The Catalog equivalents must be built on `CatalogPage` + `CatalogOrganizationSurface`.

## Architecture

### Existing seam to reuse (S1)

`server/modules/parameter-catalog-api/` is the closed canonical HTTP surface: `read/` (CatalogRead + timeline + legacy link), `governance/` (registration, placement, review, proposal), `publication/` (preview candidate, publish candidate, publication surface/jobs). `server/modules/catalog-kernel/interface.ts` owns immutable snapshots and cursor paging; `server/modules/catalog-publication/` owns typed authoring, complete-successor building and activation.

S1 evidence exercises the production-composed HTTP surface (`server/modules/parameter-catalog-api/productionComposition.integration.test.ts`, `productionWire.ts`) against real PostgreSQL, real publication manager and real synchronizer. Browser acceptance drives the real workspace through that same surface.

### New capability (S2)

One new high-level **Definition identity correction migration** contract at the existing governance boundary — preview, execute, status and continuation. It coordinates existing authoring, registration, source-candidate, binding, value and audit capabilities. It is not a generic workflow framework and not a second Catalog writer.

Its persisted model (migration `0144`) adds three relations in `parameter_catalog`: `definition_replacement_previews` (frozen preview evidence keyed by the preview fingerprint), `definition_replacements` (one row per approved replacement, carrying the old and new definition/subject/property/revision identity, the frozen manifest, the successor release, and the candidate/job/authorization evidence reference) and `definition_replacement_projects` (the per-project manifest with per-project status, blocker reason, and the old→new binding and value pairing). A partial unique index enforces at most one non-`failed` current successor per old definition. Value provenance is carried by new immutable `project_parameter_values` rows through `replaced_from_value_id` + `replaced_from_definition_id`. Current reads resolve exactly one effective binding through the `current_project_parameter_bindings` view and `resolve_current_binding`; a deferred `project_value_current_binding_ck` trigger rejects a write that names a replaced current binding.

Current-selection rule: current project reads, writes, imports and usage resolve the effective binding through the replacement relation; historical/pinned queries keep interpreting the original pins. Writes to a replaced current binding are rejected.

### Restored frontend composition

`/parameter-admin/specs` keeps one definition-management destination: organization module navigator + wide definition table + Create + search/column filters/pagination + compact secondary actions. Detail history opens inside the selected definition; pending review/mapping/proposal work opens on demand behind a count-bearing action; governance forms never occupy the main workspace by default. Effective/Governance peer views and automatic review expansion stay removed.

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Repository map | `AGENTS.md`, `ARCHITECTURE.md` | No change |
| Planning docs | `docs/PLANS.md`, this plan, `docs/zh-CN/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md` | Update |
| Product specs | `docs/product-specs/product-spec.md` | Review |
| Architecture / design docs | `docs/design-docs/catalog-authoring-and-publication-control-plane.md` | Update |
| Architecture / design docs | `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md` | Review |
| ADR | `docs/adr/0044-definition-replacement-preserves-historical-identity.md` (+ zh-CN companion) | Update |
| Frontend docs | `docs/FRONTEND.md` (+ `docs/zh-CN/frontend.md`) | Update |
| UI design system | `docs/design-docs/ui-design-system.md` | No change |
| Quality / testing docs | `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Review |
| Acceptance coverage | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` | Update |
| Security / governance | `docs/SECURITY.md`, `docs/security/README.md` | Review |
| Generated artifacts | `docs/generated/db-schema.md`, `docs/generated/openapi.json`-family artifacts | Update |
| References | `docs/references/parameter-catalog-contract-inventory.md` | Update |
| Runbooks | `docs/runbooks/README.md` | Review |
| Chinese developer docs | companion pages for every updated English developer page | Update |

## Documentation Update Gate

Blocking. Before this plan moves to `completed/`:

1. Every `Update` row above is written and every `Review` row is either updated or explicitly recorded unchanged with evidence.
2. `npm run docs:check` passes.
3. `npm run db:schema-doc` regenerates the schema summary and the diff is reviewed.
4. `npm run contract:openapi` regenerates the contract artifacts and `npm run contract:check` passes.
5. Bilingual pairs exist for every developer-facing page changed (separate files, linked at the top).
6. Any deferred row is added to `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation

| Item | Value |
| --- | --- |
| Affected specs | `e2e/acceptance/parameter-catalog.acceptance.spec.ts`, `parameter-catalog-governance.acceptance.spec.ts`, `parameter-catalog-negative.acceptance.spec.ts` |
| New requirement IDs | `PCAT-UI-16` (restored workspace + collection controls), `PCAT-UI-17` (same-dialog save/activate + lifecycle), `PCAT-UI-18` (governed identity correction) |
| New operation IDs | `PCAT-DEFINITION-COLLECTION-001`, `PCAT-DEFINITION-AUTHOR-001`, `PCAT-DEFINITION-LIFECYCLE-001`, `PCAT-IDENTITY-CORRECTION-001` |
| Operation evidence | Preserved through `npm run acceptance:browser` on the dedicated lane |

## Tasks

### Wave 1 — contracts and read surface

1. **Collection contract (R2).** Add placement-subtree and search coverage to the catalog read surface: count-bearing `CatalogPage` (`totalCount`), placement/module-subtree filter, and previous/next traversal over the existing opaque cursor with a consistent release + query fingerprint. Files: `server/modules/catalog-kernel/interface.ts`, `server/modules/catalog-kernel/runtime/currentSnapshot.ts`, `server/modules/catalog-kernel/runtime/pinnedSnapshot.ts`, `server/modules/parameter-catalog-api/read/{query,handlers,dto,types}.ts`, `server/modules/contracts/dtoSchemas/parameterCatalog.ts`.
2. **Complete content contract (R2).** Extend the supported authoring/revision projection so every editable field round-trips: `description`, `documentation`, `valueShape`, constraints, `unit`, `schemaDefault`, `examples`, `matching`. Explicit typed clear semantics (absent vs null). Files: `server/modules/catalog-publication/builder/types.ts`, `builder/completeSuccessor.ts`, `server/modules/parameter-catalog-api/read/dto.ts`.
3. **Definition lifecycle (R3-adjacent, R2).** Add reversible deactivation/restoration to the typed authoring contract: canonical `retired` blocks new matching/use, restoration republishes `active` for the same identity/key. `deprecated` stays a distinct state. Files: `server/modules/catalog-publication/preview.ts`, `builder/types.ts`, `builder/completeSuccessor.ts`, `server/modules/parameter-catalog-api/publication/*`.

### Wave 2 — identity correction (R3, sealed)

4. **Threat matrix first.** Freeze `docs/exec-plans/active/`-scoped or module-scoped threat matrix for: zero/one/many projects, mixed results, publication-then-registration failure, subject change, compatible/incompatible values, target key conflict, missing/unsupported source, coupled unapproved source impact, pending drafts/reviews, stale preview, interruption/restart, repeated execute/continue, cross-tenant attempt, forbidden selector reassignment.
5. **Migration capability.** New module `server/modules/parameter-catalog-migration/` with preview/execute/status/continue, portable contracts, authorization, exact project manifest, per-project progress, idempotent replay and resumable continuation. Migration `0144`. New routes under `/api/v2/catalog/definition-replacements*`.
6. **Consumer alignment.** Apply the shared current-selection rule to every enumerated current-binding consumer, and reject writes to replaced current references.

### Wave 3 — workspace restoration (R2, frontend)

7. **Layout.** Rebuild `/parameter-admin/specs` definition management as navigator + wide table; detail/history on selection; pending work behind a count-bearing action; remove permanent peer panels.
8. **Collection controls.** Real search, searchable module and lifecycle column filters applied before pagination, 20/50/100 page sizes, previous/next, truthful scoped counts, coherent selection across page/filter changes.
9. **Editor.** Wide row editor with fixed accessible actions, exact content initialization, clear-vs-unchanged semantics, identity fields read-only, structured/non-numeric preservation.
10. **Single-dialog activation.** Save validates intent, captures a server-computed candidate, shows impact confirmation, publishes through the existing pipeline and reports actual activation; edits after preview invalidate it; input retained on conflict; uncertain responses reconcile before retry; success returns to the effective definition in the correct release.
11. **Browse and introduce.** Organization-registered default scope, separate browse-other-subjects surface, explicit placement intent from the real taxonomy, subject-wide registration explanation, registration-only continuation after activation failure.
12. **Lifecycle and correction UI.** Deprecate/restore with impact confirmation; dedicated identity-correction action with frozen preview, authorized project selection, per-project outcome reporting and continuation.

### Wave 4 — evidence

13. Focused tests for collection/editor/authoring/lifecycle matrices.
14. Identity-correction matrix against real PostgreSQL lane with real publication activation.
15. Real conflict and replay matrix with two authenticated sessions.
16. Real API browser acceptance at 1440×900, 768×1024, 390×844 with snapshots, screenshots, console and network evidence.
17. Project import wizard regression.
18. Documentation, regenerated artifacts and `npm run docs:check`.

## Verification commands

```bash
# Lane
npm run catalog:lane:env -- provision --issue 847
npm run catalog:lane:env -- doctor --issue 847

# Focused server seams (real PostgreSQL lane)
DATABASE_URL=... TEST_DATABASE_URL=... npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-catalog-api/read/http.integration.test.ts \
  server/modules/parameter-catalog-api/productionComposition.integration.test.ts

# Contract + client/unit seams
npx vitest run src/features/parameter-catalog src/features/parameter-catalog-governance

# Candidate gates
npm run typecheck
npm run build
npm run ui:check
npm run contract:check
npm run docs:check

# Browser acceptance on the dedicated lane
WISEEFF_CATALOG_ACCEPTANCE_ISSUE=847 npm run acceptance:browser
```

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation subagents | commit on `feat/847-parameter-definition-ux-restoration`; focused tests only |
| Implementation subagents | must not push to `main`, open PRs, merge, or dispatch downstream work |
| Parent (this session owner) | consolidate reviews, seal exact candidate, report evidence; **no PR creation or merge in this run** |

One plan → one branch. Worktrees preserve unrelated in-flight edits: the parent worktree keeps its `feat/846-full-node-catalog-transfer` changes untouched, and this lane works only in `../WiseEff-worktrees/issue-847-parameter-definition-ux`.

## Evidence contract

| Level | What it proves |
| --- | --- |
| local unit/component (fake ports) | presentation branches only |
| real local PostgreSQL lane `wiseeff_lane_847` | persistence, authorization, migration, concurrency |
| browser-real on the lane | the actual workspace through the real API |
| typecheck/build/docs/contract | candidate gates |

Skipped, unsupported or failed subchecks are reported explicitly; a zero exit with a skipped subcheck is not a PASS. Hosted, target-host, release and production evidence are out of scope for this run.
