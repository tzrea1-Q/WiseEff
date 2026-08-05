# Project operations modal restore

> Status: **Completed 2026-08-05** on `feat/project-operations-dialog-hardening`
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-05-project-operations-modal-restore.md)
> Preceded by: [`2026-08-05-project-operations-dialog-hardening.md`](2026-08-05-project-operations-dialog-hardening.md)
> Amends: [ADR-0001](../../adr/0001-parameter-admin-organized-by-governance-scope.md)

## Goal

Restore the deep-linked project-operations dialog over the project list, without undoing the hardening delivered by POD (shared `ModalDialog`, leave-with-drafts guard, irreversible-action confirmations, visited-view keep-alive, layout and copy honesty).

## Decision

Product overrides POD-D1's full-page presentation: routes still own `/parameter-admin/projects/:projectId/:view`; presentation is again a dialog over the inventory. ADR-0001 is amended so "route-addressable" no longer means "full-page only".

## Delivered

1. [x] Rebuild `ProjectOperationsDialog` on `ModalDialog` (title / description ids, close control, pill nav with arrow-key traversal).
2. [x] Keep the project list mounted; overlay the dialog when a project view route is active; close / Escape go through the leave-with-drafts guard.
3. [x] Fixed card height with a single scrolling body; full-viewport sheet at ≤768px; styles keyed off `.param-admin-modal-backdrop` for the portal.
4. [x] Update page tests, ADR-0001, `FRONTEND.md` (+ ZH), and `full-stack-architecture.md`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| ADR | Update | `docs/adr/0001-parameter-admin-organized-by-governance-scope.md` |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Architecture | Update | `docs/design-docs/full-stack-architecture.md` |
| Planning | Add / archive | this plan (+ ZH); `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |

## Verification

- `npx vitest run src/ParameterAdminNextPage.test.tsx`
- `npm test` (targeted as needed) + `npm run build` + `npm run docs:check`
- API-mode browser check: 管理文件 opens the dialog over the list; four tabs; close / Escape; dirty leave confirm; three viewports
