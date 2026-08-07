# Project configuration workbench release readiness (#237)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-release-readiness`
> Issue: [#237](https://github.com/tzrea1-Q/WiseEff/issues/237), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#234](https://github.com/tzrea1-Q/WiseEff/issues/234), [#235](https://github.com/tzrea1-Q/WiseEff/issues/235), [#236](https://github.com/tzrea1-Q/WiseEff/issues/236) (CLOSED)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-release-readiness.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.5 / §11.3 / PCW-D7
> Starts at: `2e74829f87448894e4ee1dd183e3eee85f399834` (`origin/main` including #250/#251)

## Goal

Introduce one **server-owned Release readiness** result for the selected Config set and connect every item to corrective source context. The command bar summarizes overall readiness; the issues task dock lists ordered blockers and warnings with target locators and remediation actions; baseline creation and release **fail closed** when the gate is blocked, unavailable, or stale.

## Scope and success criteria

1. Readiness contract returns overall level, ordered blockers/warnings, stable file/node/property/source targets, remediation action, and a gate revision/token.
2. Server evaluation covers missing primary/member versions, server-visible pending changes, open conflicts, hard validation errors, publish-blocking governance tasks, and policy-allowed warnings.
3. Frontend renders the authoritative result and does **not** reconstruct release permission from unrelated client counts.
4. Active local session changes remain visibly distinguished and prevent starting snapshot/release while unsaved work is in context.
5. Selecting a blocker or warning opens the appropriate task evidence and positions the relevant source or inspector context.
6. Blocked or unavailable readiness disables baseline creation and release and provides a scoped retry; it never assumes ready.
7. Policy-allowed warnings remain reviewable and carry the acknowledgement state required by later release actions.
8. Baseline/release writes reject stale gate evidence even if the UI previously displayed ready.
9. Real-database/API integration covers every gate level, stale token, authorization and target locator; browser acceptance `PROJ-CONFIG-READINESS-001` covers summary, remediation, fail-closed, and partial-load behavior.

## Non-goals

- Baseline history/compare/export/restore command flows beyond create/release gating (#238 / Phase 5).
- Cutover / legacy dialog removal (#240).
- Reconstructing readiness on the client from session-draft / conflict / validation counts.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Application service | `evaluateReleaseReadiness` → level, ordered issues, locators, remediation, gateToken; authz fail-closed | `releaseReadinessService.test.ts` + integration |
| Baseline writes | `createBaseline` / `releaseBaseline` require current `gateToken` (+ acknowledged warnings when policy requires); reject stale/blocked | baselineService + integration |
| HTTP / contracts | `GET .../config-sets/:id/release-readiness`; create/release bodies accept `gateToken` / `acknowledgedWarningIds` | route + OpenAPI/schema |
| Ports | `getReleaseReadiness`; create/release pass gate evidence; mock + HTTP parity | port + mock + client tests |
| Workbench UI | Command-bar summary; Issues dock; local-session distinction; select → locate; fail-closed create/release + retry | component tests |
| Browser acceptance | `PROJ-CONFIG-READINESS-001` | EN/ZH maps + requirements + operationMatrix + e2e |

## Git & PR Workflow

- Branch from latest `origin/main` in an isolated worktree.
- Claim #237; PR title/body Related to #237; merge when CI green; close #237.

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan / 关键阅读点 lists.
- [x] Claim issue #237 (`gh issue edit 237 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Server readiness evaluation

- [x] Red/Green: evaluate returns level + ordered blockers/warnings + locators + remediation + gateToken.
- [x] Cover missing primary/member version, pending CRs, open conflicts, hard validation, governance blockers, policy warnings.
- [x] Unavailable evaluation path never claims ready.

### B. Fail-closed baseline create/release

- [x] Red/Green: create/release require matching gateToken; reject blocked/stale/unavailable.
- [x] Warnings requiring acknowledgement block release until acknowledged ids are presented.

### C. Ports + mock/HTTP parity

- [x] Extend `DtsStructuredRepository`; mock + HTTP client parity tests.
- [x] Route + schema + routeManifest/OpenAPI.

### D. Workbench UI

- [x] Command bar readiness summary from server result only.
- [x] Issues task dock with ordered items; select → source/inspector; local session changes distinguished.
- [x] Enable create/release only when server allows **and** no dirty local session; scoped retry on unavailable.

### E. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-READINESS-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND/API (and ZH); verification matrix + three-viewport UI evidence.
- [x] Dual-axis Standards vs Spec review vs `2e74829f`; fix; re-run impacted tests.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-READINESS-001` | `PROJ-CONFIG-READINESS-001` | Admin sees server readiness summary; Issues dock lists ordered blockers/warnings with remediation; selecting opens source evidence; create/release fail-closed when blocked/unavailable/stale or local session dirty; frontend does not invent permission from client counts; partial-load preserves retry | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-release-readiness/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench src/application/ports src/infrastructure/mock/mockDtsStructuredRepository.test.ts src/infrastructure/http/dtsStructuredClient.test.ts
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files/releaseReadinessService.test.ts server/modules/parameter-files/baselineService.test.ts server/modules/parameter-files/configSetBaselineRoutes.test.ts
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

Frontend-visible: three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-release-readiness/`.

Review gate: Standards vs Spec against `2e74829f87448894e4ee1dd183e3eee85f399834` and issue #237.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — readiness summary + Issues dock |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) — release-readiness DTO, gateToken on create/release |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Reliability | Review | fail-closed / stale-token handling — update only if current wording is stale |
| Security | Review | Admin gate + authz fail-closed already required; note if unchanged |
| Generated artifacts | Update | schema summary / OpenAPI when readiness routes change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | design §11.3 already locked; CONTEXT if terminology drifts |
| Environment | Review | no new env vars expected |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence. (AGENTS / ARCHITECTURE / product-spec / CONTEXT / RELIABILITY / SECURITY / env unchanged; readiness authz fail-closed covered by Admin gate + API 403 acceptance.)
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #237 acceptance remains; follow-ups belong to #238/#240 as listed in Non-goals.

## Outcomes / Residual risk

Completed 2026-08-07 on `feat/project-configuration-workbench-release-readiness`.

**Delivered**

- Server-owned `evaluateReleaseReadiness` / `assertReleaseGateAllows` with ordered blockers/warnings, locators, remediation, `gateToken`, and fail-closed create/release.
- Workbench command-bar readiness summary + Issues task dock; local session dirty blocks create/release; selecting issues locates source; warnings carry acknowledgement.
- Ports/mock/HTTP parity; OpenAPI `parameters.getConfigSetReleaseReadiness`; acceptance `PROJ-CONFIG-READINESS-001`.

**Review**

- Standards vs Spec vs merge-base `2e74829f` / issue #237: OpenAPI route registration and ParameterAdmin release `gateToken` expectation fixed during review; no remaining hard Spec gaps for #237 AC. Follow-ups #238/#240 intentionally out of scope.

**Residual**

- Full baseline history/compare/export/restore command flows remain #238.
- Legacy dialog cutover remains #240.

