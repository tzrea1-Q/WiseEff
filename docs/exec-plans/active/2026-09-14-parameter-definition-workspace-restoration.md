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

### Not implemented in this run

| Item | State |
| --- | --- |
| Complete editable content contract (`description`, `schemaDefault`, `examples`, editable `constraints`, clear-vs-unchanged semantics) | Not started |
| Definition lifecycle `retired` / restore / shared-impact confirmation (decision 10) | Not started; server lifecycle authoring and impact confirmation unimplemented |
| Single-dialog Save-and-activate inside the editor (decisions 7–9) | Not started; publication remains the existing two-step dialog |
| Definition identity correction migration (decisions 12–17, S2) | Design frozen only (`2026-09-14-definition-identity-correction-threat-matrix.md`): no migration `0144`, no route, no UI, and no threat-matrix row executed |
| Current-selection protection across binding consumers (decision 18) | Not started; consumer audit recorded in the threat matrix |
| Browse-other-subjects, explicit placement intent, registration-only continuation (decision 5, stories 6–8) | Partial: registration/placement remain the existing dialogs and still never receive `placementOptions` |

This plan is therefore **not** eligible for `completed/`. The evidence above establishes the S1 collection behaviour of the restored workspace; it does not establish the definition lifecycle, same-dialog activation, or governed identity migration that decision 10 and decisions 12–17 require.

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

Its persisted model (migration `0144`) adds a `parameter_catalog.definition_replacements` relation: one row per approved replacement, carrying old definition/subject/property identity, new definition/subject/property identity, the frozen preview fingerprint, the approved project manifest with per-project status, and the authorization evidence reference. A partial unique index enforces at most one **current** successor per old definition. A `parameter_catalog.project_parameter_binding_replacements` relation records the per-project old→new binding pairing and value provenance so retries cannot duplicate values or bindings, and current reads can select exactly one effective binding.

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
