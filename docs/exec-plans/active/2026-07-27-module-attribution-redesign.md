# Module attribution redesign — execution plan

> Chinese: [`docs/zh-CN/exec-plans/active/2026-07-27-module-attribution-redesign.md`](../../zh-CN/exec-plans/active/2026-07-27-module-attribution-redesign.md)  
> ADRs: [`0004`](../../adr/0004-module-tree-states-kind-and-origin.md), [`0005`](../../adr/0005-compatible-and-instance-are-the-only-attribution-levers.md)  
> Branches: `feat/module-attribution-model` (PR1), `feat/module-attribution-ui` (PR2)

## Goal

Turn the parameter-admin attribution surface from four undifferentiated cards into a queue an Admin can work to empty. The module tree states what each module is instead of guessing from its name, attribution rules only exist in the two flavours that actually decide anything, and applying a rule shows its impact before it moves a single parameter.

## Problem

The surface is `src/components/parameter-topology/ParameterModuleMappingPanel.tsx`, composed by `src/components/parameter-admin-next/OrganizationModuleGovernancePanel.tsx` and reachable at `/parameter-admin` → 组织配置 → 驱动归属配置. Five defects compound into "you cannot see what this page is doing".

**One tree, three unlabelled populations.** Curated business modules, ingest-created driver groups and device instances, and `未分类 · {driver}` buckets all render as one flat list titled 业务模块. The only separator is a "显示自动发现" checkbox backed by the name regex in `src/domain/parameter-topology/moduleProvenance.ts`, which catches `i2c@FDF5E000` but not `cccv_para0`. See ADR-0004.

**The driver queue does nothing.** `server/modules/parameter-modules/ensureInstanceModuleForBinding.ts:231` reads instance and compatible mappings only; a driver mapping is reachable only through the `resolveModuleIdForBinding` fallback at line 341, which requires the binding to have neither an instance name nor a compatible. DTS bindings always have an instance name. Clicking 归属到「Power」 in the driver queue therefore writes a rule, clears the entry, and changes nothing. See ADR-0005.

**Two queues, two different definitions.** The compatible queue comes from the server (`listObservedCompatiblesForDiscovery`, binding-scoped). The driver queue is aggregated in the browser from `application.listSpecs({})` (spec-library-scoped) in `OrganizationModuleGovernancePanel.tsx:38-63`. They sit side by side under the same heading.

**The queue cannot reach empty, and its buttons act at a distance.** `listObservedCompatiblesForDiscovery` applies no scaffolding filter, so `amba` / `gic` / `gpio` / `spmi` compatibles — which `modulePlacement.ts` explicitly keeps out of the product tree — appear as work items. There is no dismiss. Worse, both queues' action buttons target whatever is selected in the 目标模块 `<select>` that belongs to a *different* card, and the button label is the only hint.

**Applying a rule is inconsistent and unbounded.** `createMapping` does not recompute. `mapUnmappedCompatible` creates a module, creates a mapping, and then triggers a full recompute. The recompute itself (`server/modules/parameter-modules/service.ts:96`) walks every binding in the organization inside one transaction with no batching and no progress, and a single unique-key collision aborts everything with a 409 the UI renders as a raw string.

Secondary: v2 mapping and recompute endpoints emit no server-side audit while v1 module CRUD does, which contradicts the backend-writes rule in `AGENTS.md`; v2 routes are absent from `server/modules/contracts/routeManifest.ts`; `discovery-hints` has no limit; module rows print the raw `medium` instead of 中; importance is set once at creation and never editable, so every machine-created module keeps the default and the M5 importance filter partitions almost nothing.

## Domain decisions

Recorded in [`CONTEXT.md`](../../../CONTEXT.md), ADR-0004, and ADR-0005.

- **Three layers, stated not inferred.** Business category → driver group → device instance, with parameters on the instance. Each module states `kind` and `origin`, and the two are orthogonal.
- **Adoption is a side effect.** Renaming, moving, or re-weighting an auto-discovered module makes it curated; ingest never renames or moves a curated module afterwards. This requires ingest to match on a stable `source_key` rather than on `(parent_id, name)`.
- **Compatible and instance are the only levers.** `driver` is retired as a match kind.
- **The queue is expected to reach empty.** Scaffolding compatibles never enter it, and an Admin can dismiss an entry with a reversible, audited decision.
- **Preview, then scoped apply.** Submitting a rule returns its impact first; confirming recomputes only the bindings that rule matches. Full-organization recompute survives as an operations tool with a dry-run mode, not as the everyday path.
- **Empty buckets are collected on apply.** A `未分类 · x` module that is now empty, has `origin = auto`, `kind = unclassified`, and no children is deleted in the same transaction, with audit.
- **Kind-scoped operations.** Business categories are fully editable; driver groups can be renamed, moved, or unmatched, and deleting one disbands it and returns its compatible to the queue; device instances can only be renamed; the `未分类` root is read-only.
- **Importance lives on business categories.** Driver groups and instances inherit from the nearest ancestor business category, and the workbench reads the inherited value.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Work on `feat/module-attribution-model` (PR1), then `feat/module-attribution-ui` (PR2), each cut from the latest `main`; commit on the feature branch |
| Implementation | Must not push to `main`, open/merge PRs, or fast-forward local `main` |
| Parent / session owner | Review, open PR, merge, sync local `main` |

PR2 starts only after PR1 merges, because the UI is written against the real `kind` / `origin` / preview fields rather than against a transitional shim. PR1 leaves the existing page working unchanged.

## Pre-flight facts

Recorded 2026-07-27 against the local seeded database (`wiseeff` via `compose.yaml`). Heuristic share is acceptable — not nearly-all-instance.

| Fact | Count |
| --- | --- |
| Inert `driver` mappings to delete | **3** |
| Modules targeted by a `compatible` mapping → driver-group | **3** (`hl7603`, `mt5788`, `sc8562`) |
| Modules targeted by an `instance` mapping → instance | **44** |
| Names starting with `未分类` → unclassified | **1** (the org root only; no `未分类 · x` buckets today) |
| Address-like names (`@hex`) | **9** (all have bindings) |
| Scaffolding-ish names (`i2c\|spi\|pmic\|batt\|scharger…`) | **18** |
| Total modules | **72** |
| Distinct modules with bindings | **46** |
| Empty modules (no bindings) | **26** |
| Instance-mapped modules keyable via bindings | **42** |
| Match-kind breakdown | compatible 3 / driver 3 / instance 45 |

Refined backfill claim (order: compatible → instance mapping → `未分类%` → remaining address/scaffolding names → rest):

| Branch | Count |
| --- | --- |
| `driver-group` / `auto` | 3 |
| `instance` / `auto` (via instance mapping) | 44 |
| `unclassified` / `auto` | 1 |
| Remaining name-heuristic instances (`i2c@…`, `pmic@0`) | 3 |
| `business` / `curated` | **21** (real business categories: Power, Battery Gauge, …) |

Migration 0072 therefore also claims modules targeted by an `instance` mapping as `instance` / `auto` — the original descendant-name-only branch alone would leave ~24 leftovers including machine names.
## PR1 — data model and server semantics

Branch `feat/module-attribution-model`. No frontend changes; the existing panel keeps working against the unchanged read shape.

### Batch 1 — Migrations

- [x] `server/migrations/0072_module_kind_origin.sql`
  - `parameter_modules.kind text not null default 'business'` with a check over `business | driver-group | instance | unclassified`.
  - `parameter_modules.origin text not null default 'curated'` with a check over `curated | auto`.
  - `parameter_modules.source_key text null`, plus a partial unique index on `(organization_id, source_key) where source_key is not null`. Format: `compatible:{normalized}` for driver groups, `node:{nodePath}` for instances.
  - Backfill in this order, each branch overriding none of the previous ones: (1) modules targeted by a `compatible` mapping → `driver-group` / `auto` with `source_key = 'compatible:' || lower(match_value)`; (2) modules targeted by an `instance` mapping → `instance` / `auto`; (3) names starting with `未分类` → `unclassified` / `auto`; (4) remaining names matching `@[0-9a-fA-F]+` or `^(i2c|spi|pmic|batt|scharger)[@_0-9a-z]*$` → `instance` / `auto`; (5) everything else stays `business` / `curated`.
  - Best-effort `source_key` for instance modules that own bindings, derived by joining `project_parameter_bindings` to the latest `dts_logical_node_revisions` for the node path. Empty instance modules keep `source_key = null` and are re-keyed by ingest on next touch.
  - Delete `parameter_module_mappings where match_kind = 'driver'` and drop `driver` from the `match_kind` check constraint.
- [x] `server/migrations/0073_dismissed_compatibles.sql` — `parameter_module_dismissed_compatibles (id, organization_id, compatible, reason, dismissed_by, dismissed_at)` with a unique index on `(organization_id, lower(compatible))`.
- [x] Extend `server/shared/database/migrationInvariant.test.ts` with the 0072/0073 invariants, matching the existing 0066/0067 assertions.

### Batch 2 — Stable identity for ingest

- [x] `ensureNamedModule` and `resolveBindingInstanceModuleId` in `server/modules/parameter-modules/ensureInstanceModuleForBinding.ts` resolve by `source_key` first. On a miss, fall back once to the current `(organization_id, parent_id, name)` lookup and, when it hits an unkeyed row, adopt it by writing `source_key`. Only when both miss is a module created, and creation sets `kind`, `origin = 'auto'`, and `source_key`.
- [x] Ingest never writes `name` or `parent_id` on a module whose `origin = 'curated'`; it may still file bindings into it.
- [x] Test: rename an auto instance module, re-run ingest for the same node, and assert one module, the human name preserved, and `origin = 'curated'`. This is the regression that the whole adoption decision rests on.

### Batch 3 — Retire the driver lever

- [x] Narrow `ModuleMatchKind` to `compatible | instance` in `src/domain/parameter-topology/moduleRegistry.ts`, `server/modules/parameter-modules/schemas.ts`, `resolveModuleForBinding.ts`, and the port/HTTP client types.
- [x] Drop the driver arm from `deriveModuleAssignment` and delete `filterUnmappedDrivers` / `mappedDriverValues` / `UnmappedDriverHint` from `src/domain/parameter-topology/moduleDiscovery.ts`.
- [x] Update `MODULE_MATCH_PRIORITY` and the tests in `moduleRegistry.test.ts` / `resolveModuleForBinding.test.ts`.

### Batch 4 — A queue that can be emptied

- [x] `listObservedCompatiblesForDiscovery` in `server/modules/parameter-modules/repository.ts` excludes scaffolding compatibles via the existing `isScaffoldingDriverLabel`, excludes dismissed ones, takes a limit with a deterministic tiebreak, and returns a total alongside the page.
- [x] Each hint carries the impact the UI needs: binding count, distinct project count, and the suggested driver-group name.
- [x] `POST /api/v2/parameter-modules/discovery-hints/dismissals` and `DELETE .../dismissals/:compatible`, both `admin:access`, both audited, both returning the refreshed queue.

### Batch 5 — Preview and scoped apply

- [x] `POST /api/v2/parameter-modules/mappings/preview` returns `{ affectedBindings, byProject[], fromModules[], toModuleId, emptiedModules[], conflicts[] }` and writes nothing. Conflicts against the `(project_id, logical_node_id, parameter_spec_id, module_id)` unique key are surfaced here as blockers rather than as a 409 after the fact.
- [x] `POST /mappings` and `DELETE /mappings/:id` recompute only the bindings the rule matches, in one transaction, and return the applied result in the preview shape.
- [x] Same transaction collects emptied buckets: `origin = 'auto'`, `kind = 'unclassified'`, no children, no bindings.
- [x] Full `recompute-bindings` gains `dryRun`, keeps the existing conflict semantics, and is documented as an operations tool.

### Batch 6 — Governance and inheritance

- [x] Server-side audit for every v2 write — mapping created/deleted, compatible dismissed/restored, scoped apply, bucket collected, full recompute — following the `createParameterModuleAudit` pattern in `server/modules/parameters/service.ts:2215`.
- [x] Register the v2 routes in `server/modules/contracts/routeManifest.ts`.
- [x] `PATCH /api/v1/parameter-modules/:id` rejects an `importance` change on a module whose `kind` is not `business`.
- [x] The registry DTO carries `effectiveImportance`, resolved by walking to the nearest ancestor business category, and `parameterCount` per module.
- [x] Kind-scoped write guards on the server, so the UI's restrictions are enforced rather than merely displayed: no delete on `instance`, no writes at all on the `未分类` root. Driver-group delete disbands the group: drop mappings (compatible returns to the queue), re-park bindings, remove empty auto descendants, then delete the group.

## PR2 — frontend

Branch `feat/module-attribution-ui`, cut after PR1 merges.

### Batch 7 — Queue

- [x] New `src/components/parameter-topology/UnclassifiedCompatibleQueue.tsx`: table with compatible, affected parameters, projects, and suggested driver group; column filters per `docs/design-docs/ux-table-column-filter.md`; row checkboxes for bulk selection; dismiss and restore actions.
- [x] New `ClassifyCompatibleDialog.tsx`: target business category via `ModuleTreeSelect` restricted to `kind = business` with inline create, editable driver-group name prefilled from the suggestion, impact preview from the preview endpoint, and blockers rendered as blockers. Bulk mode files several compatibles into one business category through the same dialog.
- [x] Delete the `observedDrivers` prop and the `listSpecs({})` aggregation in `OrganizationModuleGovernancePanel.tsx`.

### Batch 8 — Tree

- [x] Rewrite the tree as `ModuleAttributionTree.tsx`: one line per module carrying name, kind badge, parameter count, matched compatible where present, and importance only on business rows in 高/中/低. Actions appear per kind, and only the ones the server will accept. Default expansion stops at the driver-group layer with instance counts shown; instances expand on demand.
- [x] Retire the 显示自动发现 checkbox in favour of filters over real `origin` and `kind`. Delete `isAutoDiscoveredModuleName` if nothing else consumes it.
- [x] Drop the standalone 归属规则 card; rules render on the module they point at, and removing a rule is an action on that module.
- [x] Move-target selection excludes non-business modules.

### Batch 9 — Copy, parity, and cleanup

- [x] Rename the surface in `src/application/parameters/parameterAdminUiCopy.ts`. Proposal: tab 模块归属, blurb rewritten around the three layers and the queue. Keys `moduleMapping`, `moduleMappingBlurb`, `moduleDiscoveryDriver`, `mappingRules`, `addMapping`, `deleteMapping` all change or disappear; `adminSubtitle` and the three `xiaoze*` strings mention 驱动归属 and must follow.
- [x] `OrganizationSpecGovernancePanel.tsx` consumes the narrowed `deriveModuleAssignment`; label the spec-library module column as a prediction rather than an assignment.
- [x] Mock parity per ADR-0002: `mockParameterTopologyRepository` and the module-registry mock serve `kind`, `origin`, `effectiveImportance`, `parameterCount`, preview, and dismissals.
- [x] Update `src/ParameterAdminNextPage.test.tsx` and add component tests for the queue, the dialog, and kind-scoped tree actions.
- [x] Retire the inline `style={{...}}` block in the old panel header; the new components use `src/styles.css` classes only.

## UI Interaction Automation

New requirement IDs for `docs/developer/browser-acceptance-coverage-map.md` and operation IDs for `docs/developer/user-operation-coverage-matrix.md`, all in `e2e/acceptance/parameter-topology.acceptance.spec.ts`:

| ID | PR | Behavior |
| --- | --- | --- |
| `MOD-ATTR-QUEUE-001` | 2 | The queue lists only non-scaffolding, non-dismissed compatibles with parameter and project counts; dismissing removes an entry and restoring brings it back, both audited |
| `MOD-ATTR-CLASSIFY-001` | 2 | Classifying a compatible shows the impact preview, applies on confirm, moves the parameters into the new driver group, and removes the emptied `未分类 · x` bucket |
| `MOD-ATTR-BULK-001` | 2 | Several selected compatibles are filed into one business category in a single confirmed action |
| `MOD-ATTR-TREE-001` | 2 | Tree actions are kind-scoped: an instance module offers no delete, renaming an auto module adopts it, and the adopted name survives a re-ingest |
| `MOD-ATTR-IMPORTANCE-001` | 2 | Importance set on a business category is inherited by its driver groups and instances and drives the workbench importance filter |

Existing IDs to re-verify: `MOD-TREE-PARAM-001` and `MOD-TREE-PARAM-002` (module CRUD and move now kind-scoped), `MOD-TREE-AUTHZ-001` (delete semantics change for driver groups and instances), `PARAM-TOPOLOGY-BROWSE-001` (module path names and inherited importance reach the workbench).

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Domain glossary | Update | `CONTEXT.md` (done: module kind, business category, driver group, device instance module, module origin, curated/auto-discovered module, module adoption, unclassified queue, dismissed compatible) |
| ADR | Update | `docs/adr/0004-module-tree-states-kind-and-origin.md` (done), `docs/adr/0005-compatible-and-instance-are-the-only-attribution-levers.md` (done), `CONTEXT.md` ADR index (done) |
| Planning | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan + zh companion |
| Domain model | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` — three-layer attribution, kind/origin, adoption |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md` — preview endpoint, dismissals, narrowed match kinds, registry DTO fields, scoped apply response |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — the panel is replaced; both currently document `ParameterModuleMappingPanel` and `deriveModuleAssignment` |
| Security / governance | Update | `docs/SECURITY.md` — new v2 audit event kinds and the kind-scoped write guards |
| Instance submodule plan | Update | `docs/exec-plans/active/2026-07-21-instance-submodule-seed.md` and its zh companion — its Admin discovery section describes the driver queue this plan deletes |
| Module refocus plan | Review | `docs/exec-plans/active/2026-07-20-dts-workbench-module-refocus.md` — M7 shipped the panel being replaced; mark superseded |
| Acceptance coverage | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts` |
| Generated schema summary | Update | `docs/generated/` database schema summary — three new columns and one new table |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` — the admin attribution workflow changes shape |
| Testing strategy | Review | `docs/design-docs/testing-strategy.md` — no strategy change expected |
| Runbooks | Review | `docs/runbooks/` — full recompute becomes an operations tool and may need a note |
| Architecture / AGENTS | Review | `ARCHITECTURE.md` — confirm the module registry description still holds |
| Reliability | No change | — |
| References | No change | — |

## Documentation Update Gate

Blocking. Neither PR merges with its documentation rows unaddressed, and the plan cannot move to `completed/` until every Update and Review row is done or recorded as unchanged with evidence, and the five new requirement and operation IDs exist. Run `npm run docs:check`. Deferred items go to `docs/exec-plans/tech-debt-tracker.md`.

## Verification

```bash
# PR1
npm run test:server -- --run server/modules/parameter-modules
npm run test:server -- --run server/modules/parameters
npm run test:server -- --run server/shared/database/migrationInvariant.test.ts
npm test -- --run src/domain/parameter-topology
npm run build

# PR2
npm test -- --run src/components/parameter-topology src/components/parameter-admin-next
npm test -- --run src/ParameterAdminNextPage.test.tsx
npm run test:all
npm run build
npm run docs:check
npm run acceptance:browser
```

PR1 also needs a manual check against a seeded local database: run ingest twice with a human rename in between and confirm no duplicate module appears, then create a compatible rule and confirm the preview count matches what the apply reports.

PR2 requires `playwright-cli` against `npm run dev` at 1440x900, 768x1024, and 390x844, covering the queue table and its column filters, single and bulk classification dialogs including the impact preview, dismiss and restore, kind-scoped tree actions, and the importance edit. `console error` must be clean and screenshots go under `work/ui-checks/`.

## Risks

The stable-identity change in Batch 2 is the highest risk in the plan. Ingest currently finds modules by name, so the migration's `source_key` backfill and the one-time name fallback have to agree, or a re-ingest creates duplicate modules next to the curated ones. It gets its own regression test and should be the last thing reviewed before PR1 merges.

Second risk: the 0072 backfill is a heuristic over live data. The pre-flight counts exist to catch the case where it claims an implausible share of the tree — for example if nearly every module turns out to be an instance, the ordering of the branches needs revisiting before the migration runs anywhere real.
