# Project configuration workbench candidate activation (#232)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-candidate-activation`
> Issue: [#232](https://github.com/tzrea1-Q/WiseEff/issues/232), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#231](https://github.com/tzrea1-Q/WiseEff/issues/231) (merged at `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-candidate-activation.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) · [ADR-0018](../../adr/0018-uploaded-file-versions-are-staged-before-activation.md)
> Starts at: `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## Goal

Complete the Candidate file version lifecycle with explicit activation. An Admin reviews a ready candidate, supplies Config set and member-role intent when needed, confirms blast radius, and activates against the exact active version that was reviewed. Concurrent source changes make the candidate stale and require recomputed impact rather than overwriting Working configuration.

## Scope and success criteria

1. Activation accepts an expected-current-version identity and fails atomically when the active base has changed (CAS).
2. A stale activation preserves Working configuration, marks the candidate `stale`, and requires impact recomputation before it can become `ready` again.
3. Activating a new file requires an explicit target Config set and valid member role; no implicit membership is created.
4. Activation verifies tenant/project scope, capability, parse state, hard blockers, relevant conflicts, membership intent, and current base in one transaction.
5. Successful activation updates active membership/version atomically, preserves the previous active version in history, and records durable audit evidence.
6. The UI shows a source-located impact confirmation and never presents blocked, failed, abandoned, or stale candidates as activatable.
7. Candidate activation with insufficient permission fails closed while retaining allowed read context.
8. Activation refreshes Working source, tree counts, file history, candidate identity, and downstream state without a full-page reset.
9. Real-database integration covers success, stale CAS, blocker, authorization, and atomic rollback; browser acceptance `PROJ-CONFIG-ACTIVATE-001` covers existing- and new-file activation.

## Non-goals

- Structured property edit submit (#233), conflicts arbitration UI beyond candidate evidence (#236), release readiness (#239).
- Free-form DTS editing.
- Broad refactors of `ProjectConfigurationWorkbench.tsx` beyond surgical candidate-activation wiring (minimize sibling PR conflicts).

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Persistence | Add `stale` + `active` candidate statuses; activate/stale transitions never leave Working half-applied | migration + repository tests |
| Application service | `activateCandidate` transactional CAS + membership intent + audit; stale preserves Working | service + integration tests |
| HTTP / contracts | `POST .../activate` with `expectedCurrentVersionId` + optional `configSetId`/`role` | route tests |
| Ports | `activateCandidate` on `ParameterFileRepository`; mock + HTTP parity | port + mock + client tests |
| Workbench UI | Impact confirmation; activate only when `ready`; refresh without full-page reset; fail-closed authz | component tests |
| Browser acceptance | `PROJ-CONFIG-ACTIVATE-001` | EN/ZH maps + requirements + operationMatrix + e2e |

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [x] Claim issue #232 (`gh issue edit 232 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Persistence + status model

- [x] Red/Green: migration extends candidate status to include `stale` and `active`.
- [x] Repository helpers: mark stale, mark active, update base/file linkage for recompute after stale.

### B. Service + routes (activate)

- [x] Red/Green: `activateCandidate` — success path for existing-file replacement.
- [x] Red/Green: new-file path requires Config set + role; no implicit membership.
- [x] Red/Green: stale CAS preserves Working; candidate becomes `stale`; recompute restores readiness against new base.
- [x] Red/Green: blocked/failed/abandoned/non-ready rejected; authz fail-closed; audit on success/stale.
- [x] Route `POST /api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate`.

### C. Ports + mock/HTTP parity

- [x] Extend `ParameterFileRepository.activateCandidate`; mock + HTTP client parity tests.

### D. Workbench UI

- [x] Surgical: activate control + ConfirmDialog impact confirmation; hide activate for non-ready; post-activate refresh without full-page reset; stale recompute affordance.

### E. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-ACTIVATE-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND/API (and ZH) as needed; OpenAPI/schema when contracts change.
- [x] Verification matrix + three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-candidate-activation/`.
- [x] Dual-axis Standards vs Spec review vs `4f1c25b9`; fix; re-run impacted tests.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-ACTIVATE-001` | `PROJ-CONFIG-ACTIVATE-001` | Admin activates ready existing-file and new-file candidates with impact confirmation; stale CAS preserves Working and requires recompute; blocked/failed/abandoned/stale never activatable; insufficient permission fails closed | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-candidate-activation/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench src/application/ports src/infrastructure/mock/mockParameterFileRepository.test.ts src/infrastructure/http/parameterFileClient.test.ts
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

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-candidate-activation/`.

Review gate: Standards vs Spec against `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39` and issue #232.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — activate confirmation, non-activatable states, refresh semantics |
| API contract | Update | `docs/design-docs/api-contract.md` (+ ZH) — activate endpoint/DTOs; regenerate OpenAPI if tooling requires |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Update | schema summary / OpenAPI when activate route lands |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | ADR-0018 already accepted; CONTEXT.md if vocabulary needs activate/stale |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` — activate authz / audit |
| Environment | Review | no new env vars expected beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #232 acceptance remains; follow-ups belong to later child issues of #227 (#233+).

## Outcomes / Residual risk

Delivered candidate activation (`0094` statuses `stale`/`active`), transactional `activateCandidate` with expected-current-version CAS, new-file Config set/role intent, workbench impact confirmation, `PROJ-CONFIG-ACTIVATE-001`, and docs. Structured edit (#233), conflict arbitration UI (#236), and activity/release follow-ons remain out of scope. Live playwright-cli viewport screenshots remain local under ignored `work/ui-checks/` (markdown notes present).

Review notes (Standards/Spec vs `4f1c25b9`):
- Spec: all #232 acceptance criteria covered by service/integration/component/acceptance evidence; browser e2e exercises API activation paths plus workbench load (UI confirm covered by component tests).
- Standards: surgical workbench wiring; no speculative activating intermediate status; fail-closed authz retained at service/route boundary.
