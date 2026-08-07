# Project configuration workbench release baselines (#238)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-release-baselines`
> Issue: [#238](https://github.com/tzrea1-Q/WiseEff/issues/238), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#237](https://github.com/tzrea1-Q/WiseEff/issues/237) (CLOSED / merged)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-release-baselines.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.5 / §10.6 / Phase 5 / PCW-D6
> Starts at: `39d98958` (`origin/main` including #253 readiness)

## Goal

Complete the **Release baseline lifecycle inside source context**. An Admin creates a draft snapshot from ready Working configuration, compares it with working or released source, acknowledges allowed warnings, releases with explicit impact confirmation, or restores a historical baseline atomically **without silently changing the released identity**.

## Scope and success criteria

1. Baseline creation snapshots the selected Config set's active member file versions and does not upload or mutate source files.
2. Creation and release consume current server readiness evidence and reject blocked, unavailable, or stale gates.
3. Draft, released, and historical baseline identities and pinned member versions are visible in command, inspector, and source contexts.
4. Baseline compare renders member and structural differences in unified or side-by-side source mode and restores the previous Working-source position on exit.
5. Policy-allowed warnings require explicit acknowledgement before release when the gate permits proceeding.
6. Release uses an impact confirmation, writes durable audit evidence, and refreshes released identity and working-versus-released drift.
7. Restore previews the exact member/version blast radius and applies atomically.
8. Restore creates rollback-origin versions only for drifted members, recomputes readiness, and leaves the currently released baseline unchanged.
9. API/database integration and API-mode browser acceptance prove create, compare, warning, release, restore, rollback history, atomic failure, and unchanged released identity (`PROJ-CONFIG-BASELINE-001`).

## Non-goals

- Legacy four-view / `ProjectOperationsDialog` / `ConfigSetBaselinePanel` cutover (#240).
- Reconstructing readiness on the client from unrelated counts (#237 already owns the gate).
- Git export integration beyond existing config-set export.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Application service | create (snapshot only); compare vs working/released; release tip + demote prior tip to historical; restore preview + atomic rollback; readiness in-sync from real member drift | `baselineService.test.ts` + readiness tests |
| HTTP / contracts | GET baseline; compare `against`; restore preview; OpenAPI/routeManifest | routes + openapi tests |
| Ports | previewRestore; compare options; mock + HTTP parity | port + mock + client tests |
| Workbench UI | history/identity; compare modes; warning ack; release impact; restore preview; exit restores Working position; refresh readiness/drift | component tests |
| Browser acceptance | `PROJ-CONFIG-BASELINE-001` | EN/ZH maps + requirements + operationMatrix + e2e |

## Git & PR Workflow

- Branch from latest `origin/main` in isolated worktree.
- Claim #238; PR Related to #238; merge when CI green; close #238.

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md`.
- [x] Claim issue #238.
- [x] Lock the TDD seams above.

### A. Server baseline lifecycle

- [x] Red/Green: restore preview returns drifted member blast radius (from/to versions).
- [x] Red/Green: compare supports `against=working|released`.
- [x] Red/Green: release demotes previous tip to `historical`, sets new tip `released`, audits, refreshes tip identity.
- [x] Red/Green: readiness `in-sync` uses real working-vs-released member compare (not mere presence of a released row).
- [x] Red/Green: rollback leaves released tip unchanged; only drifted members get `origin=rollback`; atomic abort on missing file.

### B. Ports + HTTP + OpenAPI

- [x] Extend `DtsStructuredRepository` with preview + compare options; mock/HTTP parity.
- [x] Routes for GET baseline, compare query, restore preview; register contracts.

### C. Workbench source-context UI

- [x] Command/inspector baseline history with draft/released/historical identities and pinned members.
- [x] Compare enters unified/side-by-side; exit restores Working selection/scroll.
- [x] Release impact ConfirmDialog + warning acknowledgement + gateToken; refresh chip/drift/readiness.
- [x] Restore preview ConfirmDialog → apply → Working mode + readiness recompute; released tip unchanged.

### D. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-BASELINE-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND/API (and ZH); verification matrix + three-viewport UI evidence.
- [x] Dual-axis Standards vs Spec review vs `39d98958`; fix; re-run impacted tests.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-BASELINE-001` | `PROJ-CONFIG-BASELINE-001` | Admin create/compare/ack/release/restore in workbench source context; preview blast radius; atomic restore; released tip unchanged; readiness refreshed | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-release-baselines/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench src/application/ports src/infrastructure/mock/mockDtsStructuredRepository.test.ts src/infrastructure/http/dtsStructuredClient.test.ts
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files/baselineService.test.ts server/modules/parameter-files/releaseReadinessService.test.ts server/modules/parameter-files/configSetBaselineRoutes.test.ts
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

Frontend-visible: three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-release-baselines/`.

Review gate: Standards vs Spec against `39d98958` and issue #238.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — baseline history/compare/release/restore in source context |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) — baseline GET/compare against/restore preview; historical status |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Reliability | Review | atomic restore / unchanged released tip — update only if wording stale |
| Security | Review | Admin gate + audit already required; note if unchanged |
| Generated artifacts | Update | schema summary / OpenAPI when baseline routes change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Update | domain-model baseline status includes `historical`; design Phase 5 remains authoritative |
| Environment | Review | no new env vars expected |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #238 acceptance remains; follow-ups belong to #240 as listed in Non-goals.


## Outcomes / Residual risk

Completed 2026-08-07 on `feat/project-configuration-workbench-release-baselines`.

**Delivered**

- Restore preview, compare `against=working|released`, release tip demotion to `historical`, and real working-vs-released `in-sync` readiness.
- Workbench source-context baseline dock with draft/released/historical identities, compare modes, warning-gated release impact confirm, restore preview/apply leaving released tip unchanged.
- Ports/mock/HTTP/OpenAPI coverage; acceptance `PROJ-CONFIG-BASELINE-001`.

**Review**

- Standards vs Spec vs merge-base `39d98958` / issue #238: AC covered; legacy panel cutover remains #240.

**Residual**

- #240 cutover of legacy four-view / `ConfigSetBaselinePanel`.
- Playwright-cli three-viewport screenshot capture under `work/ui-checks/project-configuration-workbench-release-baselines/` should be refreshed when the workbench flag is exercised in a long-lived UI session (e2e records viewport overflow checks).
