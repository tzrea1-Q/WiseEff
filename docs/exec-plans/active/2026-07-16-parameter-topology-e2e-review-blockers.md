# Parameter Topology E2E Review Blockers Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-e2e-review-blockers.md)
> Design: [Topology- and Schema-Aware Parameter Management](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)
> Prior implementation plan: [2026-07-16-parameter-topology-schema-management.md](./2026-07-16-parameter-topology-schema-management.md)

**Goal:** Convert the reviewed topology/schema implementation from partially wired teaching/unit paths into a real end-to-end production path: Config Set ingest → schema match → stable identity/bindings → typed edit → fail-closed toolchain → review/publish → reload persistence, with migration/cutover and browser acceptance that exercise the same business operation.

**Architecture:** Keep the additive semantic model from migration `0048` and the reviewed module layout. Fix production call sites so ingest, validation, edit, frontend, review queues, and migration all share one identity contract. Do not squash the reviewed history; land fixes as sequential commits on a new branch created from `main` that merges the reviewed implementation.

**Tech Stack:** TypeScript 5.9, Node.js/tsx, PostgreSQL 16, Zod, React 19/Vite, Vitest, Playwright, dtc/fdtoverlay 1.8.1, dtschema 2026.6.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| **Implementation agent** | Branch from local `main`, merge reviewed `feat/parameter-topology-schema-management` without squash, implement, test, commit on the feature branch |
| **Implementation agent** | Must not push, open GitHub PRs, merge PRs, or fast-forward local `main` |
| **Parent agent** | Review, open PR, merge when approved, sync local `main` |

**Required branch:** `fix/parameter-topology-e2e-review-blockers`

**Reviewed baseline preserved:** `a55b8d8248034add8f70083d60764ca83cf5571f` (and its 23 implementation commits). Do not rewrite or flatten them.

## Global Constraints

- Production call paths only — no teaching-data fallback in API mode.
- Fail-closed release/validate: missing tools, version mismatch, empty config set, open mapping/review, compile/schema failure → not validated.
- No weakening assertions (`[200,404]`, `failOnSchema:false` as a pass strategy, mock compiler).
- Dry-run migration must be read-only.
- Do not claim production cutover ready without clean-snapshot dry-run → apply → cutover → API smoke → whole-DB restore evidence.
- Use `apply_patch`; no destructive git; preserve unrelated worktree changes.
- One logical problem per commit (suggested phases below).

## Phase commits (suggested order)

1. ingest + matcher + stable binding
2. mapping resolution transaction
3. fail-closed validation + toolchain pin
4. typed edit/writeback API
5. frontend/API integration
6. spec review queue
7. migration/cutover
8. acceptance/docs/final gates

---

### Task 1: Wire semantic ingest end-to-end

**Files:** `server/modules/parameter-topology/ingestService.ts`, `bindingService.ts`, `repository.ts`, tests; use `server/modules/dts/identity.ts`, `server/modules/parameter-specs/matcher.ts`

- [ ] Fail with integration test: two consecutive full-config-set revisons keep `sc8562@6E.gpio_int` bindingId; sc8562 vs mt5788 gpio_int are distinct specs
- [ ] Implement: resolve → occurrences → schema match → logical continuity → mapping tasks → bindings/revisions → status
- [ ] Stable logicalNodeId/bindingId reuse; no locator-alone; open mapping → `needs_mapping`; never mark `resolved` early
- [ ] Commit: `fix(parameters): wire ingest to schema match and stable bindings`

### Task 2: Apply identity mapping resolution correctly

**Files:** `service.ts`, `bindingService.ts`, routes/tests

- [ ] Multi-task revision: resolving one task does not clear publish block
- [ ] Transaction: lock task, validate candidate, apply continuity + bindings, recompute revisions, audit, leave `needs_mapping` if any open
- [ ] Dismiss cannot make ambiguous revision releasable
- [ ] Commit: `fix(parameters): apply identity mapping in transaction`

### Task 3: Real fail-closed validate + pinned toolchain versions

**Files:** `service.ts`, `dtsToolchain.ts`, `check-dts-toolchain.ts`, `validationGate.ts`, docs EN/zh-CN

- [ ] validate loads manifest + object store; runs resolve/dtc/fdtoverlay/dt-validate + blockers
- [ ] Pin check compares actual vs `tools/dts-toolchain/versions.json`
- [ ] Tests: empty set, dtc missing, fdtoverlay fail, schema fail, compile fail, open mapping, success
- [ ] Commit: `fix(dts): fail-closed validate and pin toolchain versions`

### Task 4: Typed edit API and precise Config Set writeback

**Files:** `editService.ts`, routes, writeback, object store loaders, tests

- [ ] Authz/audit/org-scoped v2 draft API; object-store source; binding-targeted CST write
- [ ] Preserve entry/includes/overlays/order/unmodified versions; re-ingest + fail-closed validate
- [ ] Schema enforcement default on; multi-overlay/include/phandle/bits tests
- [ ] Commit: `fix(parameters): precise typed edit and config-set writeback`

### Task 5: Frontend real topology/bindings/edit/publish

**Files:** `ParametersPage.tsx`, `ProjectTopologyWorkspace.tsx`, clients/runtime, tests

- [ ] Load real config set/revision/trees/bindings/tasks/diagnostics; ban teaching fallback in API mode
- [ ] Edit/publish call real APIs; reload persistence of bindingId + value; loading/empty/error states
- [ ] Commit: `fix(frontend): load real topology and semantic edit APIs`

### Task 6: Spec review queue API + UI

**Files:** `parameter-specs/routes|service`, `ParameterAdminPage.tsx`, `SpecReviewQueue.tsx`

- [ ] List/resolve APIs with org isolation; frontend loads/refreshes; cross-org 404; audit
- [ ] Commit: `fix(parameters): wire parameter spec review queue`

### Task 7: Migration dry-run read-only + cutover runtime sync

**Files:** `migration.ts`, cutover SQL, repositories, checker, smoke tests

- [ ] Deterministic matching via source path/property/compatible/spec/revision; dry-run read-only
- [ ] Production paths on semantic IDs before rename; no legacy PPV FK after cutover; checker must not swallow SQL errors
- [ ] Cutover API smoke; clean-snapshot rehearsal evidence or explicit blocker
- [ ] Commit: `fix(parameters): read-only migration dry-run and cutover sync`

### Task 8: Browser acceptance + docs + final gates

**Files:** `e2e/acceptance/parameter-topology.acceptance.spec.ts`, coverage maps, plan checkboxes, runbooks

- [ ] Remove 404/teaching/stub acceptance; one real business flow UI+API+DB+audit
- [ ] Three viewports + screenshots + console/network; regenerate acceptance:evidence
- [ ] `docs:check`, contract/build/test/toolchain/selfhost gates; update this plan
- [ ] Commit: `test(parameters): e2e real topology acceptance and docs`

## Documentation Impact Matrix

| Area | Exact paths | Action |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md`, zh-CN companions | Review; update if runtime maps change |
| Planning | this plan, `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, tech-debt tracker | Update |
| Product truth | `docs/product-specs/prototype-functional-spec.md` | Review |
| Domain/API | `docs/design-docs/domain-model.md`, `api-contract.md` + zh-CN | Update for validate/edit/review APIs |
| Frontend | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update real topology loading |
| Security | `docs/SECURITY.md` + zh-CN | Review untrusted compile / audit |
| Reliability/runbooks | `docs/runbooks/parameter-identity-cutover.md` + zh-CN, `docs/RELIABILITY.md` | Update PATH/version pin / dry-run read-only |
| Developer setup/env | local-development, environment-variables, verification-matrix + zh-CN | Update toolchain pin check |
| Quality/acceptance | coverage map, operation matrix, acceptance specs + zh-CN | Update |
| Generated | OpenAPI, db-schema, acceptance evidence | Regenerate |
| README/CONTRIBUTING | root + zh-CN | Review DTS prerequisites |

## Documentation Update Gate

- [ ] Every Update/Review row handled or recorded with evidence
- [ ] `npm run docs:check` passes
- [ ] OpenAPI matches implemented routes
- [ ] Acceptance/operation IDs have regenerated evidence
- [ ] Deferred cutover items recorded in tech-debt tracker if no clean snapshot
- [ ] Plan moves to `completed/` only after parent review and verified gates (not claimed production-ready without snapshot evidence)

## Verification commands

```bash
npm run contract:check
npm run docs:check
npm run build
npm run test:server
npm test
npm run test:all
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run selfhost:check
npm run acceptance:browser
npm run acceptance:evidence
git diff --check
```

Plus: double `db:seed:m1`, toolchain version mismatch tests, dry-run read-only proof, cutover API smoke, Playwright 1440/768/390.
