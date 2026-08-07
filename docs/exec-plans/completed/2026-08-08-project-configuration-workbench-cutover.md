# Project configuration workbench cutover (#240)

> Status: **Completed**
> Date: 2026-08-08
> Branch: `feat/project-configuration-workbench-cutover`
> Issue: [#240](https://github.com/tzrea1-Q/WiseEff/issues/240), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-08-project-configuration-workbench-cutover.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) Phase 6

## Goal

Make the Project configuration workbench the **canonical** project-operations experience: retire the development flag, redirect the four legacy routes, remove the obsolete four-view dialog and page-shaped composition, migrate acceptance/operation IDs, and close bilingual documentation gates.

## Scope and success criteria

1. Workbench is always on (`parseProjectConfigurationWorkbenchEnabled` returns true; env ignored).
2. Legacy `/files` `/config-sets` `/structure` `/conflicts` redirect to equivalent workbench contexts with preserved focus query params.
3. New navigation generates only `/parameter-admin/projects/:projectId/configuration`.
4. `ProjectOperationsDialog` and unused page-shaped panels are removed after workbench owns the behaviors.
5. `PROJ-OPS-001/002/003` are explicitly mapped; `PROJ-CONFIG-CUTOVER-001` covers cutover acceptance.
6. EN+ZH docs and `docs:check` pass; targeted tests, acceptance coverage, build, and browser acceptance pass.

## Non-goals

- Merging or cherry-picking the throwaway prototype.
- Redesigning workbench IA beyond cutover redirects and empty-state CTA cleanup.

## Tasks

- [x] Pure cutover helper + unit tests
- [x] Flag retirement + env/docs
- [x] ProjectsOperationsPanel cutover; remove dialog composition
- [x] Workbench URL contexts (`inspector=file|config-set`, `tasks=conflicts`); remove legacy config-sets CTA
- [x] Delete obsolete panels; keep `isCriticalDtsNodePath`
- [x] Page/workbench unit tests
- [x] Acceptance/operation ID migration + e2e route updates + CUTOVER case
- [x] EN+ZH plans/docs complete; `docs:check`
- [x] Full verification (unit/docs/build/cutover e2e); PR/merge pending

## Verification

```bash
npm test -- src/infrastructure/http/runtimeMode.test.ts
npm test -- src/components/parameter-admin-next/projectOperationsCutover.test.ts
npm test -- src/ParameterAdminNextPage.test.tsx
npm test -- src/components/project-configuration-workbench
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run docs:check
npm run build
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
```

Evidence: `work/ui-checks/project-configuration-workbench-cutover/`

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / env | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `.env.example`, `docs/developer/environment-variables.md` (+ ZH) — flag retired; canonical route; legacy redirects |
| Product / design | Update | `docs/product-specs/prototype-functional-spec.md` (+ ZH); design doc Phase 6 status; ADR-0001 note |
| Acceptance | Update | `e2e/acceptance/operationMatrix.ts`, `requirements.ts`, EN/ZH coverage maps; `PROJ-CONFIG-CUTOVER-001` |
| Generated evidence | Update | acceptance operation evidence after e2e |

## Documentation Update Gate

- [x] EN/ZH companions updated together
- [x] `npm run docs:check` passes
- [x] Acceptance coverage/operations include `PROJ-CONFIG-CUTOVER-001` and mapped `PROJ-OPS-*`
- [x] Dual-language plans moved to `completed/` after merge gates
