# Parameter Topology Round 4 Review Blockers

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-round4-review-blockers.md)
> Prior: [round3](./2026-07-16-parameter-topology-semantic-cutover-round3.md)

**Goal:** Close parent-agent Round 3 Review blockers: real dt-validate schemas, durable stage→finalize, exact locked merge writeback, scoped matcher/review, honest manifest backfill, global-spec hotspots, unmatched review UI+audit, regression/acceptance gates.

**Branch:** `fix/parameter-topology-round4-review-blockers`  
**Preserved baseline:** `a94d0f57` (merge `fix/parameter-topology-semantic-cutover-round3`). **TD-042 remains BLOCKER.**

## Success criteria

1. Vendor linux-bindings pass real `dt-validate` on golden DTBs; negative DTB fixtures fail with expected diagnostics.
2. Seed compile (`aurora`/`nebula`/`atlas`) passes with `failOnSchema: true` and zero structural warnings.
3. CLI exposes `dry-run` | `stage-review` | `finalize`; stage persists across reconnect; finalize is atomic; cutover only accepts finalized runs.
4. Merge/writeback locks occurrence identity (revision, binding revision, occurrence, file version, checksum, CST span); never mutates base revision; stale → 409.
5. Matcher override lookup includes node locator fingerprint; review blockers honor `blocker_scope`.
6. Manifest backfill from `dts_config_revision_members`; `needs_review` fail-closed on edit/validate/release/writeback.
7. Dashboard/hotspots include global (`organization_id IS NULL`) vendor specs for tenant-bound projects.
8. Unmatched review: create-spec wired; `confirmPropertyMismatch` end-to-end with audit.
9. Golden counts / `git diff --check` / Playwright / acceptance evidence gates green or accurately reported.

## Task dependencies

```text
Plan
  → T1 schema (P0-1) ──┐
  → T2 stage/finalize (P0-4) ──┤
  → T3 exact writeback (P0-2/3) ┤→ T8 regression + browser + docs
  → T4 matcher/review scope ───┤
  → T5 manifest gates ─────────┤
  → T6 dashboard global specs ─┤
  → T7 unmatched UI+audit ─────┘
```

## Phase commits (suggested)

1. `docs(parameters): add round4 active execution plan`
2. `fix(dts): generate valid deterministic vendor dt-schema`
3. `test(dts): validate positive and negative DTB fixtures`
4. `fix(parameters): expose durable stage review finalize workflow`
5. `test(parameters): prove stage finalize across postgres transactions`
6. `fix(parameters): lock merge writeback to exact occurrence`
7. `test(parameters): prove immutable and stale-safe writeback`
8. `fix(parameters): scope matcher overrides and review blockers`
9. `fix(parameters): backfill and gate revision manifests`
10. `fix(parameters): include global specs in semantic hotspots`
11. `fix(frontend): complete unmatched spec creation and mismatch governance`
12. `test(parameters): strict browser acceptance and regression gates`
13. `docs(parameters): update bilingual contracts runbooks and evidence`

## Test matrix

| Area | Command / artifact |
| --- | --- |
| Contract/docs/build | `npm run contract:check` `docs:check` `build` |
| Server/frontend | `npm run test:server` `npm test` `npm run test:all` |
| Toolchain | `dts:toolchain:check` `dtc:seed:compile` (`failOnSchema`) |
| Schema ± | Real dt-validate DTB fixtures |
| Stage/finalize | Temp PostgreSQL + reconnect + inject-fail |
| Writeback | Exact occurrence + stale 409 + immutable base |
| Scope | Two-node override isolation; cross-project review |
| Manifest | Upgrade from pre-0054; needs_review fail-closed |
| Hotspots | Global + org-owned + tenant isolation |
| Browser | playwright-cli `/parameters` `/parameter-admin` 3 viewports |
| Acceptance | topology focused + `acceptance:browser` + `acceptance:evidence` |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Planning | this plan, PLANS.md, tech-debt TD-042 | Update |
| Domain/API | domain-model, api-contract + zh-CN | Update |
| Testing | testing-strategy, verification-matrix + zh-CN | Update |
| Frontend | FRONTEND.md + zh-CN | Update |
| Runbooks | parameter-identity-cutover + zh-CN | Update |
| Reliability/Security | RELIABILITY, SECURITY + zh-CN | Review |

## Documentation Update Gate

- [ ] EN+zh-CN pairs updated where required
- [ ] `npm run docs:check` passes
- [ ] TD-042 explicit BLOCKER (not closed)
- [ ] Plan stays active until parent review
- [ ] `git diff --check` clean (no trailing whitespace)

## Risk & rollback

| Risk | Mitigation |
| --- | --- |
| Schema too strict breaks seed | Fix vendor schemas / fixtures; never disable failOnSchema |
| Stage/finalize complexity | Separate transactions; temp-DB reconnect tests |
| Writeback identity gaps | Fail-closed 409; reuse typed-edit CST path |

Rollback: feature branch only. No production cutover. TD-042 unrehearsed.

## Verification (final)

```bash
npm run contract:check && npm run docs:check && npm run build
npm run test:server && npm test && npm run test:all
PATH="$HOME/Library/Python/3.9/bin:$PATH" npm run dts:toolchain:check
PATH="$HOME/Library/Python/3.9/bin:$PATH" npm run dtc:seed:compile
npm run selfhost:check && git diff --check && git status --short --branch
```
