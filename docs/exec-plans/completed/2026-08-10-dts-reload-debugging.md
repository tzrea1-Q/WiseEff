# DTS reload debugging (#280 series)

> Status: **Completed** — #281–#289 implemented and merged; #290 closeout on `feat/dts-reload-closeout` (implementation complete; parent PR pending)
> Date: 2026-08-10
> Parent: GitHub [#280](https://github.com/tzrea1-Q/WiseEff/issues/280)
> Tickets: #281–#290
> Chinese: none (English plan only; bilingual companions updated for developer-facing docs touched in #290)

## Goal

Ship DTS reload debugging so hardware engineers can validate candidate library parameter values on a real device as a device-tree overlay, with audit evidence, without mutating the parameter library (ADR-0019).

## Non-goals (this plan / series boundary)

- Promoting a proven debug value back into the library as a change request. → **TD-063**
- Server-side device execution (bridge-only).
- Value shapes beyond the shapes each ticket explicitly unlocks. → **TD-065**
- Reviving the retired parameter-reload HTTP surface.
- Workbench hand-off into `/dts-reload`. → **TD-064**
- Artifact retention cleanup beyond the 90-day download `410` gate. → **TD-066**
- Multi-replica bridge routing. → **TD-067**

## Ticket map

| Ticket | Scope |
| --- | --- |
| #281 | Reload run skeleton: one scalar u32 → validated downloadable overlay (merged) |
| #282 | Reload configuration governance + resolution entry point (merged) |
| #283 | Parameter breadth: multi-node fragments, u32 arrays, string lists, filters (merged) |
| #284 | Sensitive-node governance for reload (merged) |
| #285–#289 | Bridge deploy, kernel log, residue, restore, history (merged) |
| #290 | Series closeout / archive this plan (this branch) |

## Locked decisions already recorded

- Debug values never mutate the library — [ADR-0019](../../adr/0019-debug-values-never-mutate-the-parameter-library.md)
- Glossary terms in [`CONTEXT.md`](../../../CONTEXT.md)
- Permission: `debugging:dts-reload` (committer + admin); configuration gated by `debugging:admin`
- Overlay addresses nodes by absolute `target-path` inside `fragment@N`, never `&label`
- Pre-flight uses the real pinned `dtc` / `fdtoverlay` toolchain
- Mock mode: static unavailable only — no mock repository / fixtures / reducer actions
- Degraded locator: refuse only when the parameter's own locator *is* a synthesised `/label` anchor, not when it is a descendant hanging under one — **superseded 2026-08-12** by [`docs/exec-plans/active/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md`](../active/2026-08-12-dts-reload-drop-synthesised-anchor-gate.md) (parent and descendant absolute paths are classified equally; path applicability stays with preflight)
- Kernel log command allowlist (server save + bridge re-validate): exact entries via `@wiseeff/device-command-core/kernelLogCommand`
- In-request deploy — [ADR-0020](../../adr/0020-reload-runs-execute-in-request-on-bridge-holding-process.md)
- Reload snapshot — [ADR-0021](../../adr/0021-reload-snapshot-satisfies-device-write-snapshot-non-negotiable.md)

## Unverified hardware assumptions (explicitly open)

Four facts about the target kernel mechanism could not be established from the repository (from parent #280). The design proceeded on the most pessimistic reading: single fixed destination filename overwritten each run, cumulative application, no clear entry point, loss on reboot. Confirmed as settled separately: destination is a single fixed file; trigger node path and payload format are configurable.

| # | Assumption (unverified) | If it turns out otherwise |
| --- | --- | --- |
| 1 | Trigger applies overlays **cumulatively** (not replace) | Restore-baseline becomes a genuinely clean revert instead of a compensating layer; residue warning can be softened |
| 2 | **No clear/unload** entry point exists | A dedicated unload path could clear residue without a compensating reload; restore UX would change |
| 3 | A reload **does not survive reboot** | Residue warning after reboot could be stronger/automatic; restore messaging would change if overlays persist across reboot |
| 4 | Running kernel's exposed device tree **does not** reflect a runtime overlay (no practical read-back) | If a read-back path appears, unverifiable/verified terminals and reload-snapshot semantics would need redesign |

These remain open after #285–#289; automated coverage uses a fake bridge. Hardware confirmation is `DTS-RELOAD-DEPLOY-HW-001` (conditional).

## Documentation Impact Matrix (discharged in #290)

| Area | Action | Discharge evidence |
| --- | --- | --- |
| Planning | Update | This plan archived to `completed/`; PLANS EN/ZH updated |
| Domain / ADR | Update | `CONTEXT.md` glossary (+ restore-baseline, purpose, sensitive reload); `docs/design-docs/domain-model.md` + zh DTS reload section; ADR-0019/0020/0021 already landed |
| Product specs | Update | `docs/product-specs/product-spec.md` + zh: `/dts-reload` vs offline `/debugging` |
| Architecture | Update | `ARCHITECTURE.md` + zh root; `docs/design-docs/full-stack-architecture.md` + zh note for dts-reload module |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` `/dts-reload` section |
| API / generated | Update | `docs/design-docs/api-contract.md` + zh; `docs/generated/openapi.json` regenerated; `docs/generated/db-schema.md` summary for 0096–0100 |
| Security | Update | Already reflected EN + zh (`reload snapshot`, `confirm-dts-reload`, sensitive-node extension, residue, history); verified in #290 — no further prose change required |
| Reliability / runbooks | Update | `docs/RELIABILITY.md` + zh; `docs/runbooks/local-device-bridge.md` + zh DTS reload checks |
| Quality / acceptance | Update | Browser coverage map EN/ZH; operation matrix already had DTS-RELOAD-* (regenerated docs); requirements.ts already registered |
| Chinese companions | Update | All developer-facing EN docs touched above have zh companions updated as separate files |
| Tech debt | Update | TD-033 corrected (dropped `parameter_reload_bindings`); zh TD-032/TD-033 aligned; TD-063–TD-067 opened with owners |
| Retired concept cleanup | Update | Removed dead `ParameterReload*` domain/DTO/client methods and unused `reloadManaged`; retired contract entries use `successStatus: 410` (no spurious OpenAPI 200) |

## Documentation Update Gate

- [x] CONTEXT glossary matches shipped vocabulary (incl. restore-baseline / purpose / sensitive reload)
- [x] OpenAPI regenerated and `npm run contract:check` green
- [x] Database schema summary includes migrations `0096`–`0100`
- [x] Every Documentation Impact Matrix Update/Review row discharged with evidence
- [x] Deferred residual work recorded as TD-063–TD-067 with owners
- [x] Four hardware assumptions recorded as explicitly open
- [x] Acceptance / browser coverage maps include DTS-RELOAD-* operations
- [x] Dead parameter-reload client/domain/contract types removed (HTTP remains `410 Gone`)
- [x] Plan moved to `completed/`

## Series progress summary (#281–#289)

See prior ticket sections retained in git history on `main`. Closeout (#290) does not rebuild the feature; it discharges documentation, debt, coverage, and retired-concept cleanup only.

## Post-closeout decisions (#304)

Recorded on `feat/dts-reload-round2-followups` after round-2 review:

1. **Agent gate completeness:** Apply `assertDtsReloadHumanActor` to admin reload-configuration writes (`configure` action) as well as start / deploy / restore. #280's outright Agent refusal covers the configuration surface; #301's narrower AC did not create an exemption. See `docs/SECURITY.md`.
2. **Actor-type trust boundary:** Do not redesign `AuthContext` here. Track as **TD-068**: the gate binds in-process callers that pass `actorType: "agent"`; an agent with a user HTTP token is indistinguishable — same as parameters `SensitiveWriteActorType`.
3. **Page size:** `DtsReloadPage.tsx` at 2188 lines tracked as **TD-069**; do not split in this ticket.
