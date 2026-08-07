# Project configuration workbench activity timeline (#239)

> Status: **Active**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-activity-timeline`
> Issue: [#239](https://github.com/tzrea1-Q/WiseEff/issues/239), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#230](https://github.com/tzrea1-Q/WiseEff/issues/230) (merged; latest main includes candidate upload #231)
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-07-project-configuration-workbench-activity-timeline.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) (PCW-D11)
> Starts at: `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`
> Worktree: `/Users/tzrea1/Develop/_codex_worktrees/WiseEff-activity-timeline`

## Goal

Replace any permanent audit-banner pattern above the configuration workbench source with a contextual Activity inspector. An Admin opens a project-scoped timeline of durable server-authored audit projections, reads events in product language, and returns from a targetable event to its Config set, file, candidate, node, property, conflict, or Release baseline when that target still exists. Immediate mutation feedback stays a toast; the timeline refreshes from server evidence.

## Scope and success criteria

1. Command bar exposes a contextual Activity entry; no permanent audit banner reserves space above source.
2. Activity inspector reads server audit projections scoped to the current organization and project (parameter-management apps).
3. Events state actor, action, target identity, outcome, and time using product terminology rather than raw permission or event slugs.
4. Selecting a targetable event restores the relevant workbench context and source location when possible.
5. Missing or historical targets remain readable evidence and fail gracefully (no fabricated objects).
6. Mutations continue to use toasts for immediate feedback while the timeline refreshes from server evidence.
7. Inspector back/focus behavior composes with file/node/property context and meets the overlay/persistent width rule (PCW-D15).
8. Permission, loading, empty, and scoped failure states preserve the rest of the workbench.
9. Audit projection, target navigation, accessibility, and API-mode browser tests prove external behavior via `PROJ-CONFIG-ACTIVITY-001`.

## Non-goals

- Candidate activation (#232), structured EDIT submit (#233), conflicts arbitration UI (#236), release readiness cutover.
- Rebuilding Audit Center or changing audit persistence/APIs beyond consuming `listAuditEvents`.
- Removing the project-operations dialog recent-audit strip (outside the workbench source composition).
- Copying from prototype `e941f236` / `codex/prototype-config-workbench`.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| `workbenchActivityModel` | Present actor/action/target/outcome/time in product language; resolve navigate targets; mark missing targets gracefully | pure unit tests |
| Workbench component | Command-bar Activity entry; activity inspector; toast on mutations; refresh from injected `listAuditEvents`; PCW-D15; loading/empty/failure preserve canvas | `ProjectConfigurationWorkbench` tests |
| Audit list dependency | Optional `listAuditEvents` prop (default HTTP client); scoped `projectId` + parameter apps | workbench tests |
| Product language | Extended `presentAuditEvent` kind/action labels for parameter-file / candidate / baseline kinds | `presentAuditEvent` tests |
| Browser acceptance | `PROJ-CONFIG-ACTIVITY-001` | coverage maps + requirements + operationMatrix + e2e + playwright-cli |

URL: `inspector=activity` opens the Activity inspector without clearing Config set / file identity.

## Git & PR Workflow

Work in isolated worktree. Commit/push feature branch, open PR Related to #239, wait for CI, merge, close #239, sync main. No force-push. Do not touch other agents' branches.

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md`.
- [x] Claim issue #239.
- [x] Lock TDD seams above.

### A. Activity presentation + target resolution

- [x] Red/Green: product-language fields; missing targets fail gracefully.

### B. Workbench Activity inspector

- [x] Command bar Activity entry; no permanent audit banner above source.
- [x] Inspector loads scoped audit projection; loading/empty/failure preserve workbench.
- [x] Selecting targetable event restores context when possible.
- [x] Mutations toast + timeline refresh.
- [x] Activity inspector obeys PCW-D15.

### C. Acceptance + docs + completion

- [ ] Register `PROJ-CONFIG-ACTIVITY-001`.
- [ ] Update FRONTEND (and ZH).
- [ ] Verification matrix + UI evidence + Standards/Spec review.
- [ ] Move plans to `completed/`.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-ACTIVITY-001` | `PROJ-CONFIG-ACTIVITY-001` | Admin opens Activity from command bar; scoped server audit in product language; target restore / graceful missing; mutation toast + refresh; failure preserves canvas; overlay/persistent ≥640px source | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-activity-timeline/` |

## Verification

```bash
npm test -- src/components/project-configuration-workbench
npm test -- src/domain/audit/presentAuditEvent.test.ts
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| API contract | Review | reuse `GET /api/v1/audit-events` — expected unchanged |
| Quality / testing | Update | EN/ZH acceptance map + operation matrix; requirements; operationMatrix; e2e |
| Generated artifacts | Review | unchanged unless contracts change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | update only if workflow stale |
| Architecture / domain / ADR | Review | design PCW-D11 |
| Reliability / security | Review | unchanged |
| Environment | Review | existing workbench flag only |

## Documentation Update Gate

- [ ] Every `Update` row delivered EN+ZH where applicable.
- [ ] Every `Review` row updated or recorded unchanged with evidence.
- [ ] Acceptance coverage registered.
- [ ] `npm run docs:check` passes.
