# Project configuration workbench structured DTS edit sessions (#233)

> Status: **Active**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-structured-edit`
> Issue: [#233](https://github.com/tzrea1-Q/WiseEff/issues/233), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#230](https://github.com/tzrea1-Q/WiseEff/issues/230) (merged)
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-07-project-configuration-workbench-structured-edit.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> Starts at: `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## Goal

Deliver governed Structured DTS edit sessions in source context. An authorized editor selects a property from tree, source, or search; edits through the typed inspector; reviews one or more changes in the task dock; validates all or selected edits; and submits them through the existing change-request flow while the source canvas remains read-only.

## Scope and success criteria

1. Selecting an editable property opens its typed editor with value kind, raw/normalized value, constraints, risk, reason requirements, permission state, and source location.
2. The source canvas never becomes a free-form editor; whole-file replacement remains the Candidate file version path.
3. A typed edit enters the session-changes dock and creates matching tree and source-gutter markers using the same property identity.
4. Editors can validate and submit all or a selected subset of session changes without forcing unrelated changes into the request.
5. Submission preserves the existing raw-value fidelity and governed change-request behavior.
6. Successful submission clears only submitted session changes and refreshes the active source/version mapping; failures preserve the draft and evidence.
7. Missing parameter edit or sensitive/critical capability disables the write action with product-language explanation while keeping read context visible.
8. Task-dock focus, source selection, confirmation, and keyboard behavior meet the accessibility contract.
9. Port-level/component tests and API-mode browser acceptance prove edit, partial submit, permission denial, and failure recovery; register `PROJ-CONFIG-EDIT-001`.

## Non-goals

- Candidate activation (#232), Activity timeline (#239), conflict arbitration (#236).
- Recoverable session drafts / stale-base (#234).
- Free-form DTS text editing on the canvas.
- Parallel change-request systems; reuse `submitStructuredEdits` / `aggregateLocalStructuredEdits`.
- Broad refactors of `ProjectConfigurationWorkbench` beyond the edit session seam.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Workbench component | Property inspector hosts `StructuredValueEditor`; session drafts → task dock; subset select/validate/submit; permission lock with product language; canvas stays read-only | `ProjectConfigurationWorkbench` tests |
| Session change markers | Tree nodes and source gutter share property identity with dock entries | workbench component tests |
| Ports | Reuse `DtsStructuredRepository.submitStructuredEdits`; no new public HTTP fields unless required | existing port tests + workbench submit tests |
| Aggregation | Reuse `aggregateLocalStructuredEdits` for raw-value fidelity | `structuredChangeSet` + workbench |
| API-mode browser | `PROJ-CONFIG-EDIT-001` | acceptance coverage + e2e |

Tests observe public behavior only (no private reducers / effect order / CSS internals).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-structured-edit`; push feature branch; open/merge PR and close #233 when parent workflow requires |
| Parallel agents | Do not touch other agents' branches; surgical edits only on workbench edit seam |

The branch starts at `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39` (latest `main` including #231 candidate upload).

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [x] Claim issue #233 (`gh issue edit 233 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Typed inspector editor + permission lock

- [x] Red: selecting a property opens typed editor fields (kind, raw/normalized, constraints, risk, reason, permission, source location).
- [x] Red: missing `parameter:edit` / critical capability disables write with product language; read context remains.
- [x] Green: wire `StructuredValueEditor` into property inspector; pass `canEdit` / `canEditCritical` from parent.

### B. Session-changes dock + markers

- [x] Red: typed edit enters session-changes dock with count; tree and source-gutter markers share property identity.
- [x] Green: replace task-dock stub with session draft list, selection, and markers.
- [x] Confirm canvas never becomes a free-form editor.

### C. Validate / subset submit via existing CR flow

- [x] Red: validate and submit all or selected subset; success clears only submitted drafts and refreshes mapping; failure preserves drafts.
- [x] Green: call `submitStructuredEdits` with filtered aggregate; preserve raw-value fidelity.

### D. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-EDIT-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND (and ZH); contracts only if new public fields.
- [ ] Run verification matrix, three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-structured-edit/`, Standards vs Spec review vs merge-base, fix findings.
- [ ] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-EDIT-001` | `PROJ-CONFIG-EDIT-001` | Admin opens flagged workbench; selects editable property → typed editor; session dock + markers; partial submit via CR; permission denial keeps read context; submit failure preserves draft | Dedicated acceptance coverage in `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-structured-edit/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench
npm test -- src/application/parameters/structuredChangeSet.test.ts
```

Completion gates:

```bash
npm test
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` with snapshot+screenshot under `work/ui-checks/project-configuration-workbench-structured-edit/`; console error check. Use `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` when starting/reusing local dev.

Review gate: Standards vs Spec against merge-base of this branch and issue #233; fix findings; re-run impacted tests.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — structured edit sessions, task dock, canvas remains read-only |
| API contract | Review | Update only if new public API fields appear |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Review | OpenAPI/db-schema only if contracts change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec / prototype-functional-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | `CONTEXT.md`, relevant ADRs, locked design |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` |
| Environment | Review | env docs only if new flag/vars beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence. (API contract / AGENTS / ARCHITECTURE / product-spec / CONTEXT / RELIABILITY / SECURITY / env unchanged — no new public fields or flags beyond existing workbench flag.)
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [ ] No deferred #233 acceptance remains; follow-ups belong to later child issues of #227 (e.g. #234 recoverable drafts).
