# Consolidated local UI feedback fixes

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-26-ui-fixes-batch.md)

**Status:** Completed 2026-08-26. Implementation, local verification, review, and browser evidence are complete; GitHub merge remains the parent-agent delivery step.
**Branch:** `codex/ui-fixes-batch-20260825`, based on the latest `main`
**Scope:** Consolidate the currently requested local UI repairs into one reviewable PR. Previously merged #631 and #633 are already in `main` and are not duplicated.

## Goal

Close the accumulated browser-test feedback across authentication, node debugging, debug-admin dialogs, product feedback, and DTS reload. Preserve existing API contracts and operation semantics while making the changed controls usable at desktop, tablet, and mobile widths.

## Scope and acceptance

- Auth login hides registration-only organization and username-format hints; registration keeps both hints and accessible descriptions.
- `/node-debugging` exposes a reusable module column and hierarchical filter. The filter remains available in the responsive card layout, parent selection includes descendants, and module labels stay one line with ellipsis.
- The module-management “更多” menu and module-tree menus cannot be clipped by table/dialog overflow; menus close on outside click, Escape, or scroll and remain viewport bounded.
- Protocol binding has one top-right close action and a non-duplicated footer action set; read-only API users can still close the dialog.
- Feedback dialog close control is positioned in the header; DTS reload action spacing is balanced; selecting a DTS row requires the row checkbox rather than row-body clicks.
- Existing metadata, permission, device-operation, and audit behavior remains unchanged.

## Architecture and files

- `src/App.tsx`, `src/App.test.tsx`: auth-only hint visibility and accessible descriptions.
- `src/NodeDebuggingPage.tsx`, `src/debugAdminModules.ts`, `src/components/common/ModuleTreeSelect.tsx`: module tree/filter behavior, responsive filter entry point, portal menus, and shared subtree filtering.
- `src/components/admin/DebugModuleManagementDialog.tsx`, `src/components/admin/ModuleManagementRowActions.tsx`, `src/components/admin/DebugNodeBindingsDialog.tsx`: dialog and menu interaction repairs.
- `src/styles.css`: tokenized responsive layout, menu stacking/portal styling, disabled states, and single-line module labels.
- `src/features/dts-reload/DtsReloadPage.tsx`, `src/components/FeedbackDialog.tsx`: checkbox-only DTS selection and feedback close placement.
- Focused tests beside the affected components plus the existing full frontend suite.

## Browser acceptance and operation coverage

The affected routes and existing coverage owners were reviewed before completion:

| Route | Existing acceptance / operation IDs | Manual browser evidence |
| --- | --- | --- |
| `/` / `/parameter-home` | `AUTH-RUNTIME-001`, `AUTH-LOCAL-SELF-REGISTER-001`, `AUTH-LOCAL-BOOTSTRAP-HINT-001` | Login/register hint visibility and accessible descriptions |
| `/node-debugging` | `DEBUG-SIM-001`, `DEBUG-PERM-001` | Module column, desktop/tablet/mobile filter, subtree filtering, no row-body selection |
| `/debugging-admin/nodes` | `DEBUG-ADMIN-001`, `MOD-TREE-DEBUG-001` | More menu, module move menu, protocol-binding close actions |
| `/feedback-admin` | Existing feedback-admin flow under the shared UI coverage | Header close placement at responsive widths |
| `/dts-reload` | `DTS-RELOAD-*` operation family | Action-column layout and checkbox-only selection |

Existing automated acceptance ownership remains valid; this batch changes presentation and entry mechanics without adding an API operation or state transition. Manual `playwright-cli` walkthroughs supplement, but do not replace, the repository acceptance suite.

## Git & PR Workflow

The parent agent owns review, commit, GitHub PR creation, CI waiting, merge, and synchronization of the clean local `main` worktree. The primary worktree contains unrelated user changes and must remain untouched. This integration worktree is the only edit/commit target.

## Verification plan

```bash
npm test -- --run <focused affected tests>
npm test -- --run
npm run ui:check
npm run lint
npm run build
npm run docs:check
git diff --check
```

Browser verification uses mock mode at `1440x900`, `768x1024`, and `390x844`; API-mode auth is checked separately for the expected unauthenticated probes. Each affected route gets a snapshot, screenshot, interaction check, console-error check, and network check where applicable. Mock/local evidence does not establish real deployment-machine HDC/ADB readiness.

## Documentation Impact Matrix

| Documentation area | Decision | Evidence / path |
| --- | --- | --- |
| Repository maps and onboarding | Review, no change | `AGENTS.md`, `docs/README.md`; existing seams remain sufficient. |
| Planning docs | Update | This active plan records scope, coverage, and verification; it moves to `completed/` only after the gate passes. |
| Product specs | Review, no change | `docs/product-specs/`; no workflow, permission, or API contract changes. |
| Architecture and domain | Review, no change | `ARCHITECTURE.md`, `docs/design-docs/`; no new seam, entity, or state transition. |
| API contracts | Review, no change | `docs/api/`, `docs/design-docs/api-contract.md`; no route or payload changes. |
| Quality and testing | Review, no change | `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md`, existing acceptance maps; coverage owners are recorded above. |
| Reliability and runbooks | No change | `docs/RELIABILITY.md`, `docs/runbooks/`; no deployment or device-readiness claim. |
| Security and governance | Review, no change | `docs/SECURITY.md`, `docs/security/`; opaque runtime identifiers remain out of ordinary UI copy. |
| Frontend and design | Review, no change | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md`; existing tokens and shared components are reused. |
| Generated artifacts | No change | No schema, contract, or generated acceptance artifact is changed. |
| References | No change | `docs/references/`; no external convention is introduced. |

## Documentation Update Gate

The gate passed with `npm run docs:check`. Repository maps, product, architecture, API, quality, reliability, security, frontend/design, generated-artifact, and reference rows were reviewed and remain unchanged; the planning row is fulfilled by this completed plan. No deferred documentation work was created. The check reports that pgvector canonical-artifact verification is skipped locally because the extension is unavailable; CI remains authoritative for that independent database artifact.

## Completion evidence

- Focused affected tests: 85 passed across 6 files.
- Full frontend tests: `npm test -- --run` passed, 415 files / 3072 tests.
- `npm run ui:check` passed at raw-color 1013, raw-spacing 1244, raw-z-index 46; all other ratchets were at or below baseline.
- `npm run lint` passed with 0 errors and 300 pre-existing warnings.
- `npm run build` passed; only the existing `@segment/analytics-node` browser-externalization and large-chunk warnings remain.
- `git diff --check` passed.
- Browser routes `/`, `/node-debugging`, `/debugging-admin/nodes`, `/feedback-admin`, and `/dts-reload` were exercised at `1440x900`, `768x1024`, and `390x844`. Mock console errors/warnings were 0; API auth loaded the expected unauthenticated screen without browser console errors.
- Screenshots are under `work/ui-checks/ui-fixes-batch/`, including the final node-debugging, module-management, feedback-dialog, DTS, and auth captures.
