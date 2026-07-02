# Parameter Debugging Platform Redesign & Reload Capability

**Status:** Completed 2026-07-01 (interim hide scope).

**Goal:** Document why the legacy `/debugging` (参数调试) workspace is temporarily hidden, capture the product/domain gaps between parameter debugging and node debugging, and define the work required before the page can return with real device parameter reload support.

**Branch:** `feat/hide-parameter-debugging-page` (interim hide; merged or pending PR per repository workflow).

---

## Outcome Summary

This plan **completed the interim hide scope** on 2026-07-01. Phases A–D (domain split, admin separation, reload runtime, workspace return) remain open as **TD-032**.

| Scope | Status |
| --- | --- |
| Interim UX hide (`/debugging` off nav + `NoEntryPage`) | Done |
| Product/domain gap documentation | Done |
| Phase A — domain split + schema | Deferred → TD-032 |
| Phase B — admin separation | Deferred → TD-032 |
| Phase C — reload runtime | Deferred → TD-032 |
| Phase D — re-enable `/debugging` | Deferred → TD-032 |

## Why The Page Is Hidden Now

The current `/debugging` workspace exposes connect → edit target value → push → rollback flows in the UI, but the product does **not** yet implement the underlying **device parameter reload** pipeline that would make those actions trustworthy on real hardware.

Until that capability exists end-to-end (catalog alignment, gateway write semantics, readback verification, snapshot/rollback binding, audit), keeping the page visible misleads users into thinking parameter reload is production-ready.

## Interim UX — Completed Tasks

- [x] Remove `/debugging` from `navigationItems` in `src/appConfig.ts`.
- [x] Resolve `/debugging` via `getPageByPath()` with retired-page metadata.
- [x] Route `case "debugging"` to `NoEntryPage` → `/node-debugging` in `src/app/routes.tsx`.
- [x] Point homepage/template debugging entry cards to `/node-debugging`.
- [x] Keep `src/DebuggingPage.tsx` for future reactivation and component tests.
- [x] Update unit tests, responsive quality spec, and `e2e/debugging.api.spec.ts` rollback UI path.
- [x] Update product spec, frontend map, and tech-debt tracker (TD-032, TD-015 note).

## Product Problems To Fix (Future — TD-032)

### 1. Parameter debugging vs node debugging are not separated in management

Today the debugging admin catalog and the parameter-debugging workspace reuse a single “debug parameter” shape (name, unit, target value, range, risk, etc.). That model fits **parameter management** parameters, not **device nodes**.

| Concern | Parameter debugging (future) | Node debugging (current focus) |
| --- | --- | --- |
| Source of truth | Parameter management library (1:1) | Device node catalog (paths, protocols, access mode) |
| User-facing fields | Same schema as parameter admin (value, unit, range, risk, module) | Node path, protocol binding, access mode (RO/RW/WO), value type |
| Write semantics | Reload approved parameter value onto device | Read/write raw node value with readback checks |
| Admin surface | Reuse parameter definitions + reload bindings | Dedicated node registry, separate from parameter library |

### 2. Parameter catalog is not aligned with parameter management

Parameter debugging entries should map **one-to-one** to the parameter management library: same identifiers, display names, units, ranges, and governance metadata. The current `debug_parameters` catalog is a parallel mock/admin dataset with overlapping but inconsistent fields.

### 3. Node model still carries parameter-only attributes

Nodes should **not** inherit parameter-only concepts such as “目标值 / 单位 / 范围” as first-class admin fields. Node administration needs a dedicated type (path, protocol, value encoding, access policy) and optional linkage to a parameter definition when a node backs a managed parameter.

## Missing Backend / Runtime Capabilities (Future — TD-032)

Before re-enabling `/debugging`, implement at minimum:

1. **Parameter reload pipeline** — given a managed parameter ID and project context, resolve device binding(s), read current device value, apply target reload, verify readback, and persist operation + snapshot records.
2. **Catalog federation** — debugging parameters sourced from parameter management definitions; admin CRUD for reload bindings only (not duplicate parameter metadata).
3. **Session semantics** — distinguish parameter-reload sessions from node read/write sessions in API, audit, and UI history.
4. **Safety gates** — approval/audit hooks for high-risk reloads; rollback tied to verified snapshots.
5. **Evidence** — simulator + HDC/ADB acceptance proving reload, mismatch handling, and rollback on supported gateways.

Reference implementations today:

- Node path: `/node-debugging`, `POST /api/v1/debugging/nodes/read|write`, Device Bridge execution.
- Legacy parameter page UI: `src/DebuggingPage.tsx` (kept for future reactivation, not routed).

## Proposed Delivery Phases (Deferred)

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| A — Domain split (design + schema) | Define `DebugNode` vs `ParameterReloadTarget` types; document admin IA | Approved domain doc + migration sketch |
| B — Admin separation | Split debugging admin into parameter-reload bindings vs node registry | Admin UI/API no longer mixes node paths into parameter rows |
| C — Reload runtime | Gateway + service implementation for parameter reload | API tests + simulator/HDC evidence |
| D — Workspace return | Re-enable `/debugging` nav route wired to reload runtime | Browser acceptance + docs update gate |

Track as **TD-032** in `docs/exec-plans/tech-debt-tracker.md`.

## Documentation Impact Matrix

| Area | Action | Files | Gate |
| --- | --- | --- | --- |
| Active/completed plans | Update | `docs/PLANS.md`, this file | Done |
| Product spec | Update | `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | Done |
| Frontend map | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Done |
| Domain model | Update (Phase A+) | `docs/design-docs/domain-model.md` | Deferred → TD-032 |
| Browser acceptance | Update (Phase D) | `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, coverage map | Deferred → TD-032 |
| Architecture | Review | `ARCHITECTURE.md` | No change (interim hide only) |
| Generated artifacts | No change | — | Done |
| Security / audit | Review (Phase C+) | `docs/SECURITY.md` | Deferred → TD-032 |
| Runbooks | Review (Phase C+) | `docs/runbooks/hdc-device-lab.md` | Deferred → TD-032 |
| Tech debt | Update | `docs/exec-plans/tech-debt-tracker.md` | Done |

## Documentation Update Gate

- [x] This plan documents the temporary `/debugging` hide and rationale.
- [x] Product spec §7 / debugging prototype sections updated for hidden `/debugging`.
- [x] Frontend map documents retired nav route and `/node-debugging` as primary entry.
- [x] TD-032 opened for Phase A–D follow-up; TD-015 annotated for hidden page.
- [x] `npm run docs:check` passes.

## Verification

```bash
npm test -- src/appConfig.test.ts src/App.test.tsx src/permissionRouting.test.tsx src/linear-template/SubAppEntryRow.test.tsx
npx tsc -b --noEmit
npm run docs:check
```

**Evidence (2026-07-01):**

- Unit tests: 143 passed (`appConfig`, `App`, permission routing, SubAppEntryRow).
- Browser (mock `http://127.0.0.1:5174/debugging`): sidebar shows **节点调试** only; `/debugging` shows **页面暂时不可用**; console 0 errors; screenshot `work/ui-checks/debugging-unavailable-desktop.png`.
- Manual: sidebar shows **节点调试** but not **参数调试**; visiting `/debugging` shows unavailable page with link to `/node-debugging`.
