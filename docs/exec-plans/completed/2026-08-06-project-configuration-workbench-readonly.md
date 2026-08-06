# Project configuration workbench read-only tracer (#228)

> Status: **Completed**
> Date: 2026-08-06
> Branch: `feat/project-configuration-workbench-readonly`
> Issue: [#228](https://github.com/tzrea1-Q/WiseEff/issues/228), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-06-project-configuration-workbench-readonly.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md)

## Goal

Deliver the Phase 1 read-only tracer behind a development-only frontend flag: an Admin enters the canonical project configuration route, resolves a valid URL-selected or deterministic default Config set, distinguishes member and ungrouped files, and reads the selected member's active DTS source in a source-dominant shell. The legacy four-view dialog remains reachable.

## Scope and success criteria

1. With `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` outside production, the project-list action is **Configuration workbench** and opens `/parameter-admin/projects/:projectId/configuration`; with the flag off, the legacy **Manage files** dialog entry remains.
2. A valid `?configSet=` wins. Invalid or absent selection resolves to the Config set named `default`, falling back deterministically only when the invariant is missing. A selected member file is synchronized to `?file=`.
3. The workbench reads Config sets, members, project files, baselines, and active version content through `DtsStructuredRepository` and `ParameterFileRepository` in mock and API runtimes. The page does not import an HTTP client.
4. The source tree separates members from ungrouped files and states member role, active file-version id, and version number. Selecting a source-bearing member loads the exact active version.
5. The command bar states project, selected Config set, Working configuration, and current released baseline. Phase 2+ mutations are visibly unavailable, not enabled placeholders.
6. At `1440x900`, source remains dominant beside a compact/collapsible tree; the inspector is an overlay shell and the collapsed task dock is exactly 44px. At `768x1024` and `390x844`, tree/inspector/tasks use sheets without page-level horizontal overflow.
7. Loading, no Config set, empty Config set, missing active source, and scoped file/source failures preserve recoverable context and offer a relevant retry.
8. Targeted frontend/server/port tests, API-mode browser acceptance, full repository gates, `npm run docs:check`, and `npm run build` pass.

## Non-goals

- Candidate upload/impact/activation (#229 onward), structured navigation/editing, source span synchronization, search, readiness contracts, conflict arbitration, release mutations, legacy redirects/cutover, or removal of the existing dialog.
- Merging, cherry-picking, or copying implementation from `codex/prototype-config-workbench` / `e941f236`.
- Adding a second data-access seam or making mock runtime a different product.

## Architecture and seams

| Seam | Tracer behavior | TDD evidence |
| --- | --- | --- |
| Route / visible component | Flagged canonical route, entry naming, URL selection, states and responsive shell | `ProjectConfigurationWorkbench.test.tsx`, `ParameterAdminNextPage.test.tsx`, `appConfig.test.ts` |
| Existing application ports | Config-set member read parity and active source download | `dtsStructuredClient.test.ts`, mock repository contract tests |
| Public HTTP | Tenant/project-scoped `GET .../config-sets/:configSetId/files` with role and active version identity | parameter-file route/service/repository tests |
| API-mode browser | Enter from project list, resolve config set, switch member source, open shells, verify requests/layout | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` |

Tests observe public component, port, HTTP, and browser behavior. They do not assert private reducers, effect call order, or CSS implementation details.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-readonly`; do not push/merge `main`, open a PR, or close #228 |
| Parent agent | Review the commit, open/merge the PR, sync local `main`, and close #228 when accepted |

The branch starts at `901d32e6`, the latest `main` merge commit containing PR #241.

## Tasks

### 1. Register plan and acceptance

- [x] Read #228/#227, verify no blocker, claim #228, and create the feature branch from `901d32e6`.
- [x] Lock the TDD seams above and register this bilingual active plan.
- [x] Register requirement `PROJ-CONFIG-READ-001` and operation `PROJ-CONFIG-READ-001` in the EN/ZH coverage maps and executable registries.

### 2. Port and API read tracer

- [x] Red: specify Config-set member reads through `DtsStructuredRepository` and public HTTP.
- [x] Green: add a tenant/project-scoped member list returning role, sort order, file identity, format, and active version identity; implement API and mock parity.
- [x] Preserve existing write semantics and current consumers.

### 3. Route and selection tracer

- [x] Red: specify the development flag, canonical route, project-list entry, valid URL selection, invalid/absent fallback, and file query synchronization.
- [x] Green: add the route and a shallow coordinator that resolves only read state through injected ports.
- [x] Keep the legacy dialog path and action when the flag is disabled.

### 4. Source-dominant shell and recoverable states

- [x] Red: specify identities, member/ungrouped distinction, source selection/download, disabled write affordances, inspector/task shells, and recoverable edge states.
- [x] Green: implement compact tree, read-only source canvas, overlay/sheet shells, 44px task dock, and scoped retries.
- [x] Verify responsive and accessibility contracts without adding Phase 2+ behavior.

### 5. Acceptance, review, and completion

- [x] Add API-mode Playwright acceptance for the canonical route and member read endpoint.
- [x] Run targeted tests regularly, then the verification matrix gates, docs gate, build, and three-viewport `playwright-cli` evidence.
- [x] Run `/code-review` from fixed point `901d32e6` on Standards and Spec axes in parallel, fix findings, and rerun impacted gates.
- [x] Complete the documentation update gate, move this bilingual plan to `completed/`, and commit all work on the feature branch.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-READ-001` | `PROJ-CONFIG-READ-001` | Admin enters from the project list; URL/default Config-set choice, member/ungrouped tree, active DTS source, released identity, recoverable states, and responsive sheets work in API mode | Dedicated acceptance spec plus `playwright-cli` snapshots/screenshots at `1440x900`, `768x1024`, `390x844`; request/console/overflow checks |

## Verification

Development loop:

```bash
npm test -- src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx
npm test -- src/ParameterAdminNextPage.test.tsx src/appConfig.test.ts
npm test -- src/infrastructure/http/dtsStructuredClient.test.ts src/infrastructure/mock/mockDtsStructuredRepository.test.ts
npm run test:server -- server/modules/parameter-files
```

Completion gates:

```bash
npm test
npm run test:server
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
git diff --check
```

The server suite was run against the isolated post-cutover-safe fixture database:
`TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server`.
Running the suite against the seeded acceptance database is not a valid gate because that database intentionally retires legacy tables.

Browser verification uses `http://127.0.0.1:5173/parameter-admin/projects/:projectId/configuration` in API mode with the development flag enabled. Each viewport gets a snapshot and screenshot; entry navigation, Config-set selection, member source selection, tree/inspector/task sheet interactions, retry states, console errors, relevant network requests, and `scrollWidth == clientWidth` are checked.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`; no map change unless the delivered boundary is absent |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`; update only delivered entry/route workflow if stale |
| Architecture / domain / ADR | Review | `CONTEXT.md`, ADR-0001/0012/0018, locked EN/ZH design; no candidate semantic changes |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `e2e/acceptance/requirements.ts`, `operationMatrix.ts`, dedicated spec |
| Reliability / runbooks | Review | `docs/RELIABILITY.md`; read-only scoped retry uses existing HTTP reliability boundary, no operational change expected |
| Security / governance | Review | `docs/SECURITY.md`; existing Admin route and server view authorization remain authoritative |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`; flag, canonical tracer, port ownership, legacy coexistence |
| API contract | Update | `docs/design-docs/api-contract.md` + ZH companion and OpenAPI artifact if the member-list GET is externally documented |
| Generated artifacts | Review | `docs/generated/db-schema.md` unchanged; no migration |
| References | Review | `docs/references/productization-api-contract-draft.md`; update only if it inventories the touched endpoint |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #228 acceptance remains; any true follow-up belongs to #229–#240 rather than the tech-debt tracker.

Review evidence for unchanged rows: `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, ADR-0001/0012/0018,
`docs/RELIABILITY.md`, `docs/SECURITY.md`, `docs/generated/db-schema.md`, and
`docs/references/productization-api-contract-draft.md` were checked against the delivered read-only boundary;
no architecture, domain, security, reliability, schema, or productization-reference contract changed.
The delivered route/flag/API/acceptance surfaces are documented in the EN/ZH frontend, API contract, product
prototype spec, browser coverage maps, operation matrix, OpenAPI artifact, and this bilingual plan.

Browser evidence is retained under `work/ui-checks/project-configuration-workbench-readonly/`:
`00-project-list-1440x900.png`, `01-workbench-1440x900.png`, `02-workbench-inspector-1440x900.png`,
`03-workbench-task-1440x900.png`, `04-workbench-768x1024.png`, `05-workbench-tree-sheet-768x1024.png`,
`06-workbench-inspector-sheet-768x1024.png`, `07-workbench-task-sheet-768x1024.png`,
`08-workbench-390x844.png`, `09-workbench-inspector-sheet-390x844.png`, `10-workbench-task-sheet-390x844.png`,
`11-workbench-768x1024-after-label-fix.png`, and `12-workbench-390x844-after-label-fix.png`.
