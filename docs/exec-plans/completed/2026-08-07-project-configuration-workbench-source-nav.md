# Project configuration workbench source-located navigation (#229)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-source-nav`
> Issue: [#229](https://github.com/tzrea1-Q/WiseEff/issues/229), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-source-nav.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> Starts at: `86428500`

## Goal

Make the read-only project configuration workbench source-located and shareable. Structural reads expose stable file/node/property source locators; the source tree, unified search, URL deep links, and DTS canvas use those identities to navigate across Config-set member files and restore exact context after reload.

## Scope and success criteria

1. Structural reads provide stable source spans (offsets + line/column) for nodes and properties related to a specific file version, persisted at ingest and returned without re-parse.
2. Selecting a node or property scrolls to and highlights its exact source span without changing the Working configuration.
3. Source scrolling updates the nearest visible tree selection without stealing keyboard focus.
4. Unified search covers file name, node path, unit address, label, compatible, property name, and property value; results are grouped by file in the UI.
5. A search result can cross files while preserving Config set context and updating the canonical URL.
6. Config set, file, node, property, source mode, and applicable inspector/task query state survive reload; invalid values fall back safely.
7. Tree metadata and source load independently; a source failure preserves tree selection and release identity and retries only the failed read.
8. Keyboard navigation supports search, next result, line jump, and tree/source focus without overriding browser or system shortcuts.
9. Public contract (OpenAPI/routeManifest/schemaRegistry), source-location mapping, route, accessibility, and API-mode browser acceptance `PROJ-CONFIG-SOURCE-001` prove external behavior.
10. Targeted and full verification gates, docs gate, build, three-viewport UI evidence, and Standards/Spec review against `86428500` pass.

## Non-goals

- Candidate upload/activation (#231+), structured property EDIT submit (#233), conflicts, release readiness, cutover.
- Free-form DTS text editing (canvas stays read-only).
- Putting topology workspace into this route; lift span into the structural read contract instead.
- Merging, cherry-picking, or copying implementation from `codex/prototype-config-workbench` / `e941f236`.
- Closing #229 or opening/merging a PR from the implementation agent.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Port / domain | `DtsStructuralNode` / `Property` / `DtsSearchHit` expose stable source locators; search includes filename + unified/all dimensions; hits grouped by file in UI | port types + mock/client contract tests; workbench search UI tests |
| Server structural | Persist spans on ingest; structure GET returns them without re-parse | `structuralIngest` / `structuralRepository` / read repository + route tests |
| Server search | Hits carry locators; filename match; keep org/project scope; optional `by` omit = all | `dtsSearchRepository` / route tests |
| HTTP + mock parity | Client and mock teaching fixtures include spans | `dtsStructuredClient` + mock repository tests |
| Workbench component | Nested tree under members; select → scroll+highlight; source scroll → nearest tree selection without stealing focus; URL `node`/`property`/`sourceMode` (+ keep configSet/file); unified search; independent load/retry; keyboard | `ProjectConfigurationWorkbench` / viewer component tests |
| Contracts | OpenAPI / routeManifest / schemaRegistry for structure + search with spans | contract tests + generated OpenAPI |
| API-mode browser | `PROJ-CONFIG-SOURCE-001` EN/ZH coverage + requirements + operationMatrix + e2e | acceptance spec + playwright-cli evidence |

Tests observe public behavior only (no private reducers / effect order / CSS internals).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-source-nav`; do **not** push/merge `main`, open a PR, or close #229 |
| Parent agent | Review commits, open/merge the PR, sync local `main`, and close #229 when accepted |

The branch starts at `86428500` (merge of PR #242 / read-only workbench).

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [x] Lock the TDD seams above (confirmed with parent).

### A. Persist structural spans (migration + ingest)

- [x] Red: assert ingest persists node/property `start_offset`/`end_offset`/`start_line`/`start_column`/`end_line`/`end_column` from CST spans.
- [x] Green: migration `0092_dts_structural_spans.sql`; extract shared `offsetToLineColumn`; update `replaceDtsStructuralModel` to write locators from `ResolvedNode`/`ResolvedProperty` CST spans.

### B. Expose spans on structural read + FE ports

- [x] Red/Green: extend `Structural*Dto`, zod schemas, FE port types, read repository SELECT, HTTP client, and mock teaching nodes with spans.

### C. Register contracts

- [x] Register structure + dts-search in routeManifest / schemaRegistry / OpenAPI with span fields.

### D. Search locators + filename + all dimensions

- [x] Red/Green: search hits carry locators; filename match; optional `by` omit = all; mock parity.

### E. Source viewer focus span

- [x] Red/Green: extend or wrap `ProjectPrimaryDtsViewer` for multi-line focus span highlight; keep find-next.

### F. Workbench wiring

- [x] Red/Green: `getStructure` nested tree, PrimaryDtsViewer, URL deep links, unified search grouped by file, scroll sync, independent retries, keyboard.

### G. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-SOURCE-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND, api-contract (and env if needed), bilingual plans.
- [x] Run verification matrix, three-viewport UI evidence, Standards vs Spec review vs `86428500`, fix findings.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-SOURCE-001` | `PROJ-CONFIG-SOURCE-001` | Admin opens flagged workbench; selects node/property → source scroll+highlight; source scroll updates tree without stealing focus; unified search groups by file and cross-file navigates with Config set preserved; URL deep links restore; independent source retry; keyboard search/next/line-jump/focus | Dedicated acceptance spec + playwright-cli under `work/ui-checks/project-configuration-workbench-source-nav/` |

## Verification

Development loop (targeted):

```bash
npm run test:server -- server/modules/parameter-files/structuralIngest.test.ts
npm run test:server -- server/modules/parameter-files
npm test -- src/components/project-configuration-workbench
npm test -- src/infrastructure/http/dtsStructuredClient.test.ts src/infrastructure/mock/mockDtsStructuredRepository.test.ts
```

Completion gates:

```bash
npm test
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` with snapshot+screenshot under `work/ui-checks/project-configuration-workbench-source-nav/`; console error check. Use `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` when starting/reusing local dev.

Review gate: two parallel generalPurpose reviews (Standards vs Spec) against fixed point `86428500` and issue #229; fix findings; re-run impacted tests.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — source nav, URL params, search |
| API contract | Update | `docs/design-docs/api-contract.md` + ZH; OpenAPI for structure + dts-search spans |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Update | `docs/generated/openapi.json`; `docs/generated/db-schema.md` if migration regenerates |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec / prototype-functional-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | `CONTEXT.md`, relevant ADRs, locked design — no topology-in-route |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` |
| Environment | Review | env docs only if new flag/vars beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #229 acceptance remains; follow-ups belong to later child issues of #227.

Review evidence for unchanged rows: `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, ADR set, `docs/RELIABILITY.md`, and `docs/SECURITY.md` were checked against the delivered source-nav boundary; no architecture/security/reliability map change was required beyond the structural span lift already documented in FRONTEND/api-contract/OpenAPI/db-schema and acceptance maps.
Browser evidence is retained under `work/ui-checks/project-configuration-workbench-source-nav/` (`workbench-1440x900.png`, `workbench-768x1024.png`, `workbench-390x844.png`, matching snapshots, overflow JSON, and empty `console-errors.json`).
