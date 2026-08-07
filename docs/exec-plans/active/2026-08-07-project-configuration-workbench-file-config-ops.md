# Project configuration workbench file and Config set operations (#236)

> Status: **Active**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-file-config-ops`
> Worktree: `/Users/tzrea1/Develop/_codex_worktrees/WiseEff-file-config-ops`
> Issue: [#236](https://github.com/tzrea1-Q/WiseEff/issues/236), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#230](https://github.com/tzrea1-Q/WiseEff/issues/230) (merged; inspector/history available)
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-07-project-configuration-workbench-file-config-ops.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> Starts at: `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## Goal

Rehouse remaining project file and Config set operations into contextual workbench regions. An Admin can create and configure Config sets, add or remove member files with explicit roles and order, understand ungrouped files, trigger manual sync, and export the selected Config set without returning to legacy pages.

## Scope and success criteria

1. Config set selector and inspector support create/configure with visible validation and duplicate-name handling.
2. Member files can be added with a valid role and order, or removed through an explicit blast-radius confirmation.
3. Ungrouped project files remain visibly outside Working configuration and Release readiness until explicitly assigned.
4. File inspection exposes manual sync; results appear in contextual task evidence and refresh related conflicts or drafts as applicable.
5. Config set export is available from the command context and returns selected members, roles, ordering, and validation metadata.
6. Empty Config sets present one focused Candidate upload/assignment path and explain that upload does not activate automatically.
7. Mutation, export, and removal retain Admin authorization and durable audit behavior; allowed read context remains visible on denial.
8. API and mock modes expose the same semantic operations through application ports (no page-level HTTP).
9. Targeted integration/component tests and API-mode browser acceptance `PROJ-CONFIG-OPS-001` prove membership, role, sync, export, empty state, confirmation, and permission behavior.

## Non-goals

- Activation (#232), structured EDIT submit (#233), activity timeline (#239), conflicts arbitration beyond sync-related refresh, release readiness, cutover.
- Free-form DTS text editing.
- Embedding legacy `ConfigSetBaselinePanel` / `ProjectParameterFilesPanel` wholesale.
- Touching parallel epic branches (`structured-edit`, `candidate-activation`, `activity-timeline`).

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Workbench command bar | Create Config set (validate + duplicate); Export selected Config set | `ProjectConfigurationWorkbench` tests |
| Config-set inspector | Add member (file + role + sortOrder); list members; remove with ConfirmDialog blast-radius | component tests |
| Ungrouped tree | Visible outside Working/Release; assign into current Config set | component tests |
| File inspector | Manual sync via `ParameterFileRepository.syncFile`; evidence in task dock; refresh drafts/conflicts when returned | component tests |
| Empty Config set | One focused Candidate upload/assignment path; upload does not auto-activate | component + acceptance |
| Ports | `DtsStructuredRepository` create/add/remove/export; `ParameterFileRepository.syncFile`; mock + HTTP parity already present — wire UI only unless gaps | existing port tests + workbench |
| Authz | Admin-gated mutations; non-admin keeps read context + denial message | component tests with `canAdmin=false` |
| Browser acceptance | `PROJ-CONFIG-OPS-001` | EN/ZH maps + requirements + operationMatrix + e2e + playwright-cli |

Reuse validation/export helpers patterns from `ConfigSetBaselinePanel` without nesting the panel. Prefer extracting a tiny shared `downloadExportBundle` only if duplication would otherwise land in two call sites on this branch; otherwise keep a local helper next to the workbench wiring.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-file-config-ops` in the dedicated worktree; push/PR/merge/close as directed by the owning end-to-end workflow for #236 |
| Parallel agents | Must not edit this worktree or force-push this branch |

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active / 关键阅读点 lists.
- [x] Claim issue #236 (`gh issue edit 236 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Create / configure Config set

- [x] Red: empty name and duplicate-name validation visible in selector/inspector create path.
- [x] Green: `dtsRepository.createConfigSet`; refresh selector; select new set.

### B. Member add / remove / roles / order

- [x] Red/Green: add member with role + sortOrder via `addConfigSetFile`.
- [x] Red/Green: remove requires ConfirmDialog describing blast radius; then `removeConfigSetFile`.
- [x] Ungrouped files stay outside Working/Release until assigned; assignment path from ungrouped row or inspector.

### C. Manual sync + task evidence

- [x] Red/Green: file inspector Manual sync → `fileRepository.syncFile`; summary in task dock evidence; refresh drafts/conflicts when applicable.

### D. Export from command context

- [x] Red/Green: Export uses `exportConfigSet`; downloads/returns members, roles, ordering, validation metadata (manifest + files).

### E. Empty Config set focused path

- [x] Red/Green: empty set shows Candidate upload/assignment path; copy explains upload does not activate; remove legacy-only “open old config-sets” as the primary empty path when create is available.

### F. Authz + acceptance + docs

- [x] Admin gate for mutations; denial keeps read context.
- [x] Register `PROJ-CONFIG-OPS-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, e2e.
- [x] Update FRONTEND (+ ZH) for file/config-set ops in contextual inspectors.
- [x] Verification matrix + three-viewport evidence under `work/ui-checks/project-configuration-workbench-file-config-ops/`.
- [x] Standards vs Spec review vs `4f1c25b9`; fix; move plans to `completed/`.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-OPS-001` | `PROJ-CONFIG-OPS-001` | Admin creates Config set (validation/duplicate), adds/removes members with role/order + confirmation, sees ungrouped outside Working/Release, runs manual sync with task evidence, exports Config set from command context, empty set shows focused upload/assignment without auto-activation; non-admin denial keeps read context | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-file-config-ops/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench
npm test -- src/components/admin/ConfigSetBaselinePanel.test.tsx
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

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` under `work/ui-checks/project-configuration-workbench-file-config-ops/`; console error check. Use `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true`.

Review gate: Standards vs Spec against `4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39` and issue #236.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — create/configure, members, ungrouped, sync, export, empty path |
| API contract | Review | No new public fields expected; record unchanged if ports already cover ops |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Review | OpenAPI/db-schema only if contracts change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | update only if delivered workflow stale |
| Architecture / domain / ADR | Review | design doc already covers Phase 2 ops |
| Reliability / security | Review | authz/audit already on server routes; UI Admin gate |
| Environment | Review | existing workbench flag only |

## Outcomes

- Spec-review fix: `ProjectsOperationsPanel` derives `canAdmin` from `canPerform(activeRoleId, "admin.access")` and passes it to the workbench + ConfigSetBaselinePanel (no hardcoded `true`).
- Export download now prepends `result.manifest` JSON (members/roles/order/validation) before file contents.
- `PROJ-CONFIG-OPS-001` e2e extended for empty Config set focused upload/assignment copy and non-admin mutation denial (API 403) while Admin read context remains visible.
- Acceptance e2e green (5/5). Three-viewport evidence under `work/ui-checks/project-configuration-workbench-file-config-ops/`.
- Plan remains **Active** pending Documentation Update Gate / move to `completed/` after final docs:check if needed.

## Documentation Update Gate

- [ ] Every `Update` row is delivered in English and Chinese where applicable.
- [ ] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [ ] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [ ] `npm run docs:check` passes.
- [ ] No deferred #236 acceptance remains; follow-ups belong to later child issues of #227.
