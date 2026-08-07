# Project configuration workbench conflict arbitration (#235)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-conflict-arbitration`
> Issue: [#235](https://github.com/tzrea1-Q/WiseEff/issues/235), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#231](https://github.com/tzrea1-Q/WiseEff/issues/231), [#233](https://github.com/tzrea1-Q/WiseEff/issues/233) (CLOSED)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-conflict-arbitration.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.4 / PCW-D9
> Starts at: `3b421093f266603d08117c6e6d02f41ff943c7fa`
> Closes: TD-058 (bulk resolve + human version label on conflict payload)

## Goal

Move file-sync and candidate disagreements into one source-located three-way Conflict arbitration workflow. An Admin opens a conflict from its count or source marker, compares the shared base with the file/candidate value and pending UI draft value, chooses an equal-weight outcome, confirms the data that will be retained or removed (optional reason → server audit), and continues through the queue without leaving source context. Eligible bulk resolution requires an impact preview. Open conflicts continue to block Candidate activation and remain exposed for later baseline/release gates.

## Scope and success criteria

1. Each conflict identifies the affected Config set/file/node/property and locates the evidence in source (locator + navigation).
2. The task dock presents base, file-sync or candidate value, and pending UI draft value with provenance and version/time evidence.
3. “Use file value” and “Keep UI value” have equal visual weight; neither is styled as the safe default.
4. Confirmation explains the draft/value effect and accepts an optional reason that reaches server audit evidence.
5. Resolution is server-authorized, persists atomically, refreshes counts/markers, and advances to the next conflict without losing source context.
6. Eligible bulk resolution requires an impact preview and excludes conflicts that cannot be resolved under one safe decision.
7. Relevant open conflicts prevent Candidate activation and are exposed for later baseline/release gating (#237).
8. Empty queues keep the dock collapsed rather than rendering a dedicated empty page.
9. API/database integration and API-mode browser acceptance `PROJ-CONFIG-CONFLICT-001` prove both outcomes, audit, authorization, continuous processing, and source positioning.

## Non-goals

- Recoverable session drafts / stale-base submit gating (#234) — do not persist session drafts or change leave/logout draft FSM.
- Release readiness / baseline create gating UI (#237) — only keep open conflicts exposed as activation blockers and list evidence for later gates.
- Free-form DTS editing; nesting the legacy full-page `ParameterFileConflictPanel` inside the workbench.
- Broad refactors of `ProjectConfigurationWorkbench.tsx` beyond surgical conflict-dock wiring (minimize sibling #234 conflicts).

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Persistence / DTO | Enriched open-conflict list: baseValue, human version label/time, parameter name/module, fileId/configSetId, node/property, optional `DtsSourceLocator` | repository + service tests |
| Application service | `resolve` (+ optional reason → audit); bulk preview + bulk resolve; authz fail-closed; atomic draft discard | conflictService + integration tests |
| HTTP / contracts | resolve body `{ resolution, reason? }`; bulk preview/resolve endpoints | route tests |
| Ports | `resolveConflict(..., { resolution, reason? })`; `previewBulkConflictResolution` / `resolveConflictsBulk`; mock + HTTP parity | port + mock + client tests |
| Workbench UI | Conflicts task-dock three-way equal-weight UI; ConfirmDialog; source locate; queue advance; empty → collapsed; bulk impact preview | component tests |
| Activation gate | Existing `open-conflict` blockers retained; acceptance proves blocked activation | candidate + acceptance |
| Browser acceptance | `PROJ-CONFIG-CONFLICT-001` | EN/ZH maps + requirements + operationMatrix + e2e |

## Git & PR Workflow

- Branch from latest `origin/main` in an isolated worktree.
- Claim #235; PR title/body Related to #235; merge when CI green; close #235.

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan / 关键阅读点 lists.
- [x] Claim issue #235 (`gh issue edit 235 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Enriched conflict DTO + list

- [x] Red/Green: list conflicts returns baseValue, version label/time, name/module, source identities, optional locator.
- [x] Enrich `listOpenConflicts` (or dedicated mapper) via joins; no schema migration unless required.

### B. Resolve + reason + bulk

- [x] Red/Green: resolve accepts optional reason → audit metadata.
- [x] Red/Green: bulk preview returns eligible/ineligible + impact summary; bulk resolve applies one resolution only to eligible ids atomically per conflict.
- [x] Routes: extend resolve body; add preview + bulk resolve endpoints.

### C. Ports + mock/HTTP parity

- [x] Extend `ParameterFileRepository` conflict surface; mock + HTTP client parity tests.
- [x] Update legacy `ParameterFileConflictPanel` to pass reason through the port (surgical).

### D. Workbench UI

- [x] Extract/add workbench Conflicts dock module (prefer separate component to limit workbench churn).
- [x] Three-way equal-weight outcomes; ConfirmDialog + reason; locate in source; advance queue; collapse when empty.
- [x] Bulk affordance with impact preview for eligible set only.
- [x] Replace “use old conflict view” placeholder; keep Activity conflict restore pointing at dock.

### E. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-CONFLICT-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Close TD-058 in EN/ZH tech-debt trackers.
- [x] Update FRONTEND/API (and ZH) as needed; OpenAPI/schema when contracts change.
- [x] Verification matrix + three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-conflict-arbitration/`.
- [x] Dual-axis Standards vs Spec review vs `3b421093`; fix; re-run impacted tests.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-CONFLICT-001` | `PROJ-CONFIG-CONFLICT-001` | Admin opens source-located three-way conflict from workbench dock; both equal-weight outcomes with confirm + optional audit reason; queue advances in source context; eligible bulk with impact preview; open conflicts block candidate activation; empty queue keeps dock collapsed | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright capture under `work/ui-checks/project-configuration-workbench-conflict-arbitration/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench src/components/admin/ParameterFileConflictPanel src/application/ports src/infrastructure/mock/mockParameterFileRepository.test.ts src/infrastructure/http/parameterFileClient.test.ts
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
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

Frontend-visible: three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-conflict-arbitration/`.

Review gate: Standards vs Spec against `3b421093f266603d08117c6e6d02f41ff943c7fa` and issue #235.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; close TD-058 EN/ZH |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — conflict dock three-way UX |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) — enriched conflict DTO, reason, bulk endpoints |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Update | schema summary / OpenAPI when conflict routes change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | CONTEXT.md Conflict arbitration; design §10.4 already locked |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` — resolve authz / audit reason |
| Environment | Review | no new env vars expected beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence. (AGENTS / ARCHITECTURE / product-spec / CONTEXT / RELIABILITY / SECURITY / env unchanged beyond existing workbench flag and conflict authz/audit already covered.)
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes (prior implementation gate; this completion pass focused on e2e + UI evidence).
- [x] No deferred #235 acceptance remains; follow-ups belong to #234/#237/#240 as listed in Non-goals.

## Outcomes / Residual risk

Completed 2026-08-07 on `feat/project-configuration-workbench-conflict-arbitration`.

**Passed locally**

- `PROJ-CONFIG-CONFLICT-001` acceptance e2e green against dedicated pre-cutover DB `wiseeff_acceptance` seeded with `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` / `WISEEFF_LOCAL_POST_CUTOVER=0`.
- `npm run acceptance:coverage` / `acceptance:operations` include `PROJ-CONFIG-CONFLICT-001` with no missing ids.
- Three-viewport UI evidence + empty `console-errors.json` under `work/ui-checks/project-configuration-workbench-conflict-arbitration/`.
- Dock clickability fix: `.configuration-workbench__tasks.is-open { z-index: 10 }` so conflict actions are not intercepted by inspector/body stacking.

**CI command (parity with `acceptance-local-non-hdc`)**

```bash
WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1
WISEEFF_LOCAL_POST_CUTOVER=0
npm run db:migrate && npm run db:seed:all
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts -g "arbitrates file/UI conflicts"
```

**Residual**

- Default local `wiseeff` DB remains post-cutover (`project_parameter_values` retired). CONFLICT/EDIT fixtures that seed flat PPV need the CI/acceptance flat-identity host (or recreate `wiseeff_acceptance` as documented in NOTES). Cutover-aware conflict seeding is out of #235 scope.
- Full `npm test` / `npm run build` suite not re-run in this verification pass; focused CONFLICT e2e + coverage/operations + UI capture.
