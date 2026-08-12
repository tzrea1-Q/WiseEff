# Drop synthesised-anchor reload candidacy gate

> Status: **Active**
> Date: 2026-08-12
> Branch: `fix/dts-reload-drop-synthesised-anchor-gate`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md`](../../zh-CN/exec-plans/active/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md)
> Supersedes locked decision in [`docs/exec-plans/completed/2026-08-10-dts-reload-debugging.md`](../completed/2026-08-10-dts-reload-debugging.md) (degraded locator / synthesised `/label` refuse)

## Goal

Abolish the asymmetric reload candidacy rule that blocks a parameter when its own locator is a single-segment `/label` synthesised anchor while allowing descendants under the same parent. Parent and child absolute paths are treated equally: nonempty `nodePath` + supported value shape + baseline value ⇒ debuggable. Path applicability remains a preflight / `fdtoverlay` concern against the project reload base (including the ephemeral dangling-label stub).

## Non-goals

- Rewriting L1 dangling `&label` self-anchoring or ephemeral stub synthesis for overlay-only boards.
- Guaranteeing live-device FDT paths match the project tree (descendants already accepted the same risk).
- Widening unsupported value shapes (TD-065).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `fix/dts-reload-drop-synthesised-anchor-gate`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `fix/dts-reload-drop-synthesised-anchor-gate`, checked out from the latest `main`.

## Tasks

1. Remove `isSynthesisedAnchorLocator` and its `classifyBlockReason` branch from `server/modules/dts-reload/candidates.ts`.
2. Drop `"synthesised-anchor"` from server and frontend block-reason unions, `BLOCK_REASON_MESSAGES`, and `dtsReloadBlockReasonLabels`.
3. Rewrite unit tests that expected the gate (`candidates.test.ts`, `service.test.ts`, `DtsReloadPage.test.tsx`).
4. Annotate the superseded locked decision in the #280 completed plan; update domain-model EN/ZH candidacy wording; review FRONTEND / api-contract / OpenAPI.
5. Verify: reload server tests, Aurora `battery_tbl` debuggable, `npm run build`, `npm run docs:check`.

## Success criteria

- No `synthesised-anchor` / `isSynthesisedAnchorLocator` in code or types.
- Living docs no longer state parent-blocked / child-allowed as current policy.
- Aurora `battery_tbl` (`nodePath=/battery_cccv`) is `debuggable: true` when shape and baseline qualify.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan; `docs/PLANS.md` + `docs/zh-CN/PLANS.md`; zh companion plan |
| Domain / ADR | Update | `docs/design-docs/domain-model.md` + zh (reload candidacy); supersession note on completed #280 plan |
| Product specs | No change | No product-spec wording for this gate |
| Architecture | No change | Absolute `target-path` rule unchanged |
| Frontend | Review | `docs/FRONTEND.md` + zh — no blockReason enum today → unchanged with evidence |
| API / generated | Review | `docs/design-docs/api-contract.md` + zh; OpenAPI — no `synthesised-anchor` literal → unchanged |
| Security | No change | Sensitive/confirm gates unchanged |
| Reliability / runbooks | No change | Preflight still validates paths |
| Quality / acceptance | No change | No acceptance ID tied to this gate |
| Tech debt | No change | No new TD |

## Documentation Update Gate

- [x] Completed #280 plan carries a superseded note for the degraded-locator decision
- [x] Domain-model EN + zh state equal parent/child candidacy and preflight ownership of path applicability
- [x] FRONTEND EN/zh reviewed — no blockReason enum / synthesised-anchor copy; unchanged
- [x] api-contract EN + zh updated for candidacy wording; OpenAPI has no `synthesised-anchor` literal — unchanged
- [x] PLANS EN + zh list this active plan
- [x] `npm run docs:check` green before moving this plan to `completed/`
