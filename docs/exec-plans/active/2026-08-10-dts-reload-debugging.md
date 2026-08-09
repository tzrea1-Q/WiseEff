# DTS reload debugging (#280 series)

> Status: **Active** — #281 merged; #282 reload configuration on `feat/dts-reload-configuration`
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
| #281 | Reload run skeleton: one scalar u32 → validated downloadable overlay (merged) |
| #282 | Reload configuration governance + resolution entry point (`feat/dts-reload-configuration`) |
| #283–#289 | Bridge deploy, multi-parameter, kernel log, residue, restore, history, sensitive-node, etc. |
| #290 | Series closeout / archive this plan |

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on feature branch; no PR open/merge; no push to `main` |
| Parent agent | Review, open PR, merge, sync local `main` |

## Locked decisions already recorded

- Debug values never mutate the library — [ADR-0019](../../adr/0019-debug-values-never-mutate-the-parameter-library.md)
- Glossary terms in [`CONTEXT.md`](../../../CONTEXT.md)
- Permission: `debugging:dts-reload` (committer + admin); configuration gated by `debugging:admin`
- Overlay addresses nodes by absolute `target-path` inside `fragment@N`, never `&label`
- Pre-flight uses the real pinned `dtc` / `fdtoverlay` toolchain
- Mock mode: static unavailable only — no mock repository / fixtures / reducer actions
- Degraded locator: refuse only when the parameter's own locator *is* a synthesised `/label` anchor, not when it is a descendant hanging under one
- Kernel log command allowlist prefixes (server save + later bridge re-validate): `dmesg`, `hilog`, `cat /proc/kmsg`

## #282 progress

- Migration `0097_dts_reload_configuration.sql` + `schemaMigration.test.ts` enablement list
- Resolution entry point: `resolveReloadConfiguration(db, { organizationId, deviceId })`
- Admin CRUD under `/api/v1/dts-reload/configuration*` with audit; panel on `/debugging-admin`
- Contract registry + OpenAPI regenerated
- Browser evidence: `work/ui-checks/282-reload-config-{desktop-1440,tablet-768,mobile-390}.png`

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan; stays in `active/` until #290 |
| Domain / ADR | Update | `CONTEXT.md` glossary (reload configuration allowlist note); ADR-0019 already landed with #281 |
| Product specs | Review | Defer full product-spec update until device deploy tickets |
| Architecture | Review | No structural rewrite; revisit when bridge deploy lands |
| Frontend | Review | `/debugging-admin` panel wiring is local; defer deep FRONTEND.md until surface complete |
| API / generated | Update | `docs/generated/openapi.json` via `npm run contract:openapi` |
| Security | Review | Snapshot / sensitive-node belong to later tickets; this ticket adds configuration audit kinds |
| Reliability / runbooks | No change | Device deploy not in #282 |
| Quality / acceptance | Review | Browser evidence under `work/ui-checks/`; acceptance IDs deferred to #290 |
| Chinese companions | Review | Optional until #290 archives |

## Documentation Update Gate

- [x] CONTEXT glossary allowlist note present
- [x] OpenAPI regenerated and `npm run contract:check` green
- [x] Plan Documentation Impact Matrix / Update Gate retained
- [ ] Deferred product/architecture/frontend doc rows either updated or carried to #290 / tech-debt with evidence
- [ ] Plan moves to `completed/` only from #290

## Success criteria for #282

- [x] Org defaults + device overrides, device wins
- [x] `debugging:admin` only
- [x] Kernel log allowlist + absolute path validation
- [x] Editable on `/debugging-admin`
- [x] Audit on change
- [x] Resolution never consults request body
- [x] Seeded defaults for fresh org
- [x] Routes + OpenAPI
- [x] Mock not extended
