# DTS reload debugging (#280 series)

> Status: **Active** — ticket #281 skeleton in progress on `feat/dts-reload-run-skeleton`
> Date: 2026-08-10
> Parent: GitHub [#280](https://github.com/tzrea1-Q/WiseEff/issues/280)
> Tickets: #281–#290

## Goal

Ship DTS reload debugging so hardware engineers can validate candidate library parameter values on a real device as a device-tree overlay, with audit evidence, without mutating the parameter library (ADR-0019).

## Non-goals (this plan / series boundary)

- Promoting a proven debug value back into the library as a change request.
- Server-side device execution (bridge-only).
- Value shapes beyond the shapes each ticket explicitly unlocks.
- Reviving the retired parameter-reload HTTP surface.

## Ticket map

| Ticket | Scope |
| --- | --- |
| #281 | Reload run skeleton: one scalar u32 → validated downloadable overlay (this branch) |
| #282–#289 | Bridge deploy, multi-parameter, kernel log, residue, restore, history, sensitive-node, etc. |
| #290 | Series closeout / archive this plan |

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/dts-reload-run-skeleton`; no PR open/merge; no push to `main` |
| Parent agent | Review, open PR, merge, sync local `main` |

Branch: `feat/dts-reload-run-skeleton` from latest `main`.

## Locked decisions already recorded

- Debug values never mutate the library — [ADR-0019](../../adr/0019-debug-values-never-mutate-the-parameter-library.md)
- Glossary terms in [`CONTEXT.md`](../../../CONTEXT.md)
- Permission: `debugging:dts-reload` (committer + admin)
- Overlay addresses nodes by absolute `target-path` inside `fragment@N`, never `&label`
- Pre-flight uses the real pinned `dtc` / `fdtoverlay` toolchain
- Mock mode: static unavailable only — no mock repository / fixtures / reducer actions
- Degraded locator: refuse only when the parameter's own locator *is* a synthesised `/label` anchor, not when it is a descendant hanging under one

## #281 file map

| Area | Paths |
| --- | --- |
| Overlay / preflight | `server/modules/dts-reload/{debugOverlay,preflight,baseSource,candidates,constraints}.*` |
| Persistence | `server/migrations/0096_dts_reload_runs.sql`, `repository.ts`, `service.ts` |
| HTTP | `routes.ts`, `schemas.ts`, `policy.ts`, `server/app.ts` |
| Contract | `server/modules/contracts/{routeManifest,schemaRegistry}.ts`, `docs/generated/openapi.json` |
| Frontend | `src/features/dts-reload/`, ports + HTTP client, `appConfig` / `routes` / `App` / `permissions` |
| Docs | this plan, ADR-0019, CONTEXT glossary |

## Verification (#281)

```bash
npm run test:server -- server/modules/dts-reload/
npm run test:server
npm test -- src/features/dts-reload/
npm run contract:check
npm run build
# playwright-cli on /dts-reload at 1440×900 / 768×1024 / 390×844
```

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan; stays in `active/` until #290 |
| Domain / ADR | Update | `CONTEXT.md` glossary; `docs/adr/0019-…`; `docs/adr/README.md` |
| Product specs | Review | Reload surface not yet in prototype-functional-spec — defer full product-spec update to later tickets that ship device deploy |
| Architecture | Review | `ARCHITECTURE.md` — no structural rewrite for skeleton; revisit when bridge deploy lands |
| Frontend | Review | `docs/FRONTEND.md` / zh-CN — page wiring is local; defer deep frontend doc until surface is complete |
| API / generated | Update | `docs/generated/openapi.json` via `npm run contract:openapi` |
| Security | Review | Snapshot redefinition and sensitive-node extension belong to later tickets; skeleton only adds audit kinds |
| Reliability / runbooks | No change | Device deploy not in #281 |
| Quality / acceptance | Review | Add acceptance IDs when browser acceptance coverage is expanded (#290 or device tickets) |
| Chinese companions | Review | ADR/CONTEXT are English; zh-CN companion for this plan optional until #290 archives |

## Documentation Update Gate

- [ ] ADR-0019 accepted and indexed
- [ ] CONTEXT glossary terms present
- [ ] OpenAPI regenerated and `npm run contract:check` green
- [ ] Deferred product/architecture/frontend doc rows either updated or carried to #290 / tech-debt with evidence
- [ ] Plan moves to `completed/` only from #290

## Success criteria for #281

- Engineer with `debugging:dts-reload` can list candidates, start one u32 run, preview overlay source, download `.dtbo`
- Wrong path / misspelled property → blocked run with diagnostics
- Library fingerprint unchanged
- Mock mode shows static unavailable
- Browser evidence under `work/ui-checks/`
