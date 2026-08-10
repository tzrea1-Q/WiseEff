# DTS reload debugging (#280 series)

> Status: **Active** — #281–#284 merged; #285 on `feat/dts-reload-deploy-trigger`
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
| #282 | Reload configuration governance + resolution entry point (merged) |
| #283 | Parameter breadth: multi-node fragments, u32 arrays, string lists, filters (merged) |
| #284 | Sensitive-node governance for reload (`feat/dts-reload-sensitive-node`) |
| #285–#289 | Bridge deploy, kernel log, residue, restore, history |
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

## #285 progress

- Prefactor: `BRIDGE_RPC_METHODS` shared via `@wiseeff/device-command-core/bridgeRpcMethods`; bridge capabilities advertise from that list
- New RPCs: `debug.mountTarget`, `debug.pushFile` (digest ladder `sha256sum` → `md5sum` → `wc -c`); trigger reuses `debug.writeNode` with `readBack: false`
- Deploy path: `POST /api/v1/dts-reload/runs/:runId/deploy` with `confirm-dts-reload`; lease via `debug_device_leases`; in-request (ADR-0020)
- Terminal `unverifiable` / `failed`; reload snapshot on run (ADR-0021); migration `0098`
- UI: confirm dialog + step progress; browser evidence under `work/ui-checks/285-dts-reload-deploy-*`
- Acceptance: `DTS-RELOAD-DEPLOY-001` automated (fake WS); `DTS-RELOAD-DEPLOY-HW-001` conditional
- #286 should capture kernel log after trigger and attach `reloadSnapshot.kernelSignal`

## #284 progress

- Gate in `startReloadRun` after resolve, before overlay: path + compatible via `dts_sensitive_node_rules`
- high → requires `parameter:edit-critical`; critical → elevated + `confirmationToken: "confirm-sensitive-reload"`
- Agent refused for any sensitive match; denials audited as `dts-reload-sensitive-node-denied`
- Candidates expose `sensitiveMatch`; `/dts-reload` marks badges + critical confirm before start
- No migration
- #285 should require `confirm-dts-reload` in addition; compose after this sensitive gate
- Browser evidence: `work/ui-checks/284-dts-reload-sensitive-{desktop-1440,tablet-768,mobile-390}.png`

## #283 progress

- Widened `isSupportedReloadValueShape` to u32 cell arrays + string lists
- Batch start body `{ targets: [{ bindingId, debugValue }, ...] }`; overlay groups by node into `fragment@N`
- Server refuses not-debuggable / constraint failures across the whole batch
- Preflight tests cover multi-fragment atomic block + array/string-list assert-effect
- `/dts-reload` multi-select + name/module/node filters; OpenAPI regenerated
- Fixed candidate SQL `psv.units` (was `psv.unit`) and preflight decompile parse catch (no 500)
- Browser evidence: `work/ui-checks/283-dts-reload-{desktop-1440,tablet-768,mobile-390}.png`
- No migration (existing `dts_reload_run_targets` already multi-row)

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
| Security | Update | Snapshot redefinition + confirm-dts-reload; ADR-0021; EN + zh-CN SECURITY |
| Reliability / runbooks | Review | In-request deploy (ADR-0020); no BullMQ path |
| Quality / acceptance | Update | `DTS-RELOAD-DEPLOY-001` + HW conditional; browser evidence `work/ui-checks/285-*` |
| Chinese companions | Update | `docs/zh-CN/SECURITY.md` for reload snapshot |

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
