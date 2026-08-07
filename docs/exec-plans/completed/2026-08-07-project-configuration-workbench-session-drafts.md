# Project configuration workbench recoverable session drafts (#234)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-session-drafts`
> Issue: [#234](https://github.com/tzrea1-Q/WiseEff/issues/234), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#233](https://github.com/tzrea1-Q/WiseEff/issues/233) (merged)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-session-drafts.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md) (PCW-D12, §11.2)
> Starts at: `3b421093` (latest `origin/main` including #233)

## Goal

Make Structured DTS edit sessions recoverable without weakening stale-base safety. Navigation or refresh restores compatible session drafts for the same user and source base; a changed base preserves draft content for inspection/copy but blocks validation and submission until the editor explicitly reconfirms against the current base.

## Scope and success criteria

1. Session drafts are scoped by authenticated user, organization, project, Config set, file, and base file version.
2. Persistence stores patches, reasons, and stable source identities — not duplicate project source files.
3. Compatible session changes, selected task subset, and reason restore after navigation or refresh.
4. A changed base marks recovered changes stale and prevents validation/submission against the new source.
5. Stale content remains inspectable and copyable; return to a valid dirty state only through explicit reconfirm/rebase.
6. Closing or navigating away with unsubmitted changes uses the shared leave-confirmation contract (`ConfirmDialog`).
7. Logout clears recoverable drafts; drafts never restore across users, organizations, projects, or Config sets.
8. Late async responses from a previous project or source base cannot populate the current session.
9. Browser reload/navigation and targeted state tests prove compatible restore, stale-base guard, isolation, and discard; register `PROJ-CONFIG-DRAFT-001`.

## Non-goals

- Candidate activation / conflict arbitration / activity timeline / file-config ops follow-ups (#232/#235/#236/#239 already separate).
- Free-form DTS canvas editing.
- New HTTP APIs or server-side draft stores.
- Broad refactors of `ProjectConfigurationWorkbench` beyond the draft persistence / leave / stale seam.
- Issue #235.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| `sessionDraftStorage` | Scoped local persistence of patches/reason/selection; classify compatible vs stale-base vs mismatch; logout clear | `sessionDraftStorage.test.ts` |
| Workbench hydrate/persist | Restore on mount/file scope; persist on edit; replace hard file-clear; generation guard against late async | `ProjectConfigurationWorkbench` tests |
| Stale-base guard | Block validate/submit; inspect/copy; explicit reconfirm → dirty | component tests |
| Leave confirmation | Dirty back-navigation uses shared `ConfirmDialog` | component tests |
| Logout | `clearSessionDraftsForLogout` from App logout path | unit + App wiring |
| API-mode browser | `PROJ-CONFIG-DRAFT-001` | acceptance coverage + e2e |

Tests observe public behavior only (no private reducers / effect order / CSS internals).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-session-drafts`; push; open/merge PR and close #234 when parent workflow requires |
| Parallel agents | Do not touch other agents' branches; surgical edits only on draft seam |

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [x] Claim issue #234 (`gh issue edit 234 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Scoped draft storage

- [x] Red: persist/load by user/org/project/configSet/file/baseVersion; store patches+reason+identities only.
- [x] Red: classify compatible / stale-base / mismatch; logout clear; no cross-scope restore.
- [x] Green: implement `sessionDraftStorage.ts` with injectable `Storage`.

### B. Workbench hydrate, leave, stale guard

- [x] Red: compatible restore after remount; stale blocks validate/submit; reconfirm restores dirty; leave ConfirmDialog; late async ignored.
- [x] Green: thin wiring in `ProjectConfigurationWorkbench`; pass `currentUserId` from panel; use Config set `organizationId`; clear on logout from App.

### C. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-DRAFT-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND (and ZH) for restore / stale / leave / logout.
- [x] Run verification matrix, three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-session-drafts/`, Standards vs Spec review vs merge-base, fix findings.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-DRAFT-001` | `PROJ-CONFIG-DRAFT-001` | Admin session drafts restore after reload when base matches; changed base → stale (inspectable, validate/submit blocked); logout clears; no cross-user restore | Dedicated acceptance coverage in `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-session-drafts/` + component/storage tests |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench
```

Completion gates:

```bash
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` with snapshot+screenshot under `work/ui-checks/project-configuration-workbench-session-drafts/`; console error check. Use `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` when starting/reusing local dev.

Review gate: Standards vs Spec against merge-base of this branch and issue #234; fix findings; re-run impacted tests.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — recoverable drafts, stale-base, leave confirmation, logout clear |
| API contract | No change | Local persistence only; no new public HTTP fields |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | No change | No OpenAPI/db-schema change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec / prototype-functional-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | locked design PCW-D12 / §11.2 already specifies behavior |
| Reliability / security | Review | `docs/SECURITY.md` — confirm local draft isolation language if needed |
| Environment | No change | No new flag/vars beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #234 acceptance remains; follow-ups belong to later child issues of #227 (e.g. #235).

Review evidence for unchanged rows:
- **API contract / Generated artifacts**: No change — local `sessionDraftStorage` only; no new public HTTP fields, OpenAPI, or db-schema updates.
- **Reliability / security**: `docs/SECURITY.md` unchanged — draft isolation is client-scoped; auth token localStorage handling is already documented elsewhere and was not altered by this ticket.
- **Repository maps**: `AGENTS.md` / `ARCHITECTURE.md` unchanged — no new module boundaries beyond the existing workbench package.
- **Product specs**: product-spec / prototype-functional-spec unchanged — delivered workflow matches locked design.
- **Architecture / domain / ADR**: design PCW-D12 / §11.2 already specified recoverable drafts, stale-base, leave confirmation, and logout clear; no ADR update required.
- **Environment**: No new flags/vars beyond existing `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED`.

## Completion notes

Completed 2026-08-07 on `feat/project-configuration-workbench-session-drafts`.

**Delivered**
- `sessionDraftStorage.ts` (+ tests): scoped persist/load by user/org/project/configSet/file/baseVersion; patches+reason+identities only; classify compatible / stale-base / mismatch; logout clear; no cross-scope restore.
- Workbench hydrate/persist/stale/leave: restore on remount/file scope; persist on edit; stale blocks validate/submit while remaining inspectable; explicit reconfirm → dirty; leave uses shared `ConfirmDialog`; generation guard ignores late async.
- App logout wiring: `clearSessionDraftsForLogout` from App logout path; panel passes `currentUserId`; Config set `organizationId` used for scope.
- Acceptance: `PROJ-CONFIG-DRAFT-001` registered in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e; FRONTEND (+ ZH) updated for restore / stale / leave / logout.

**Verification passed locally**
- `npm test -- src/components/project-configuration-workbench`
- `npm test`
- `npm run acceptance:coverage` && `npm run acceptance:operations`
- `npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`
- `npm run docs:check`
- `npm run build`
- playwright-cli three viewports under `work/ui-checks/project-configuration-workbench-session-drafts/` (gitignored evidence)

**Known gaps**
- e2e logout UI path avoided: AUTH logout returned 404 and a cpk overlay interfered; covered instead by storage clear contract tests + App logout wiring.
- Source-context deep-link restore of node/property is partial — file identity restores via URL; finer node/property deep-link restore remains limited.
