# Phase 8 Report — Real Topology Browser Acceptance

**Branch:** `fix/parameter-topology-e2e-review-blockers`  
**Date:** 2026-07-16  
**Verdict:** Topology real-path acceptance **PASSED**. Full-matrix `acceptance:browser` / `acceptance:evidence` **FAILED**. **Not production cutover ready** (TD-042). Request parent review.

## What changed (Task 8)

- Rewrote `e2e/acceptance/parameter-topology.acceptance.spec.ts` for one coherent UI+API+DB+audit flow:
  - upload base+overlay → Config Set ingest → topology API **must 200**
  - `amba` → `i2c@FDF5E000` → `sc8562@6E` → `gpio_int`
  - two distinct `gpio_int` specs (sc8562 vs mt5788)
  - typed edit, stale revision **409**, schema/compiler/identity-mapping blockers, resolve + audit
  - validate/publish fail-closed (`schema-failed` on golden power seed — **not force-passed**)
  - reload persists `bindingId` + value from DB
- Removed forbidden patterns: `[200,404]` topology allowances, teaching-data production path, stub validate pass, static-array reload.
- Supporting product/test fixes (edit cell-count diagnostics, three-segment spec keys, cutover probe fake-DB isolation, ingest test timeouts, etc.).
- Docs/plan/coverage maps updated; TD-042 remains open (no clean snapshot rehearsal).

## Gate results (exact)

| Command | Result | Notes |
| --- | --- | --- |
| `npm run contract:check` | **PASSED** | OpenAPI contract artifact current |
| `npm run docs:check` | **PASSED** | Documentation governance check passed |
| `npm run build` | **PASSED** | Vite build ok (~8s) |
| `npm run test:server` | **PASSED** | 197 files / 1379 passed / 1 skipped |
| `npm test` | **PASSED** | 507 files / 3524 passed / 1 skipped |
| `npm run test:all` | **PASSED** | After ingest `60_000` timeouts |
| `npm run dts:toolchain:check` | **PASSED** | `"ok": true`, versionsMatch |
| `npm run dtc:seed:compile` | **PASSED** | Exit 0; seed still emits real `schema-failed` diagnostics |
| `npm run selfhost:check` | **PASSED** | `"status": "passed"` |
| `git diff --check` | **PASSED** | exit 0 |
| `npm run db:seed:m1` ×2 | **PASSED** | Seeded M1 + DTS baselines |
| Focused topology e2e | **PASSED** | 1 passed in ~12.5s |
| `npm run acceptance:browser -- --no-start-runtime` | **FAILED** | Playwright: 51 passed / 4 skipped / **30 unexpected**; preflight blocked (`deviceGateway, backups`) + earlier ingest timeout during that run's preflight `test:all` |
| `npm run acceptance:evidence` | **FAILED** | `status=failed`, covered=5 (topology ops only), missing=49 |

### Focused topology evidence (regenerated)

- `PARAM-TOPOLOGY-BROWSE-001`
- `PARAM-TOPOLOGY-EDIT-001`
- `PARAM-CONFIG-PUBLISH-GATE-001`
- `PARAM-IDENTITY-MAP-001`
- `PARAM-SPEC-GOVERN-001`

Artifacts under `test-results/acceptance/operation-evidence/`.

### Full `acceptance:browser` FAIL themes (honest)

Not claimed fixed in Phase 8; representative failures from `test-results/acceptance/results.json`:

- **FK pollution:** deleting/updating `project_parameter_file_versions` blocked by `dts_config_revision_members_file_version_id_fkey` (parameter-files / DTS structured specs).
- **Authz/UI:** Permission denied headings missing; unauthenticated xiaoze/user APIs returning **200** instead of **401**.
- **Debugging:** device pill stuck on HDC detect / “已保存” strict-mode duplicates.
- **Parameters happy/negative:** missing seeded keys / review detail timeouts.
- **Xiaoze:** approval/resume/planning chain assertions failing.
- **Preflight:** pilot outcome `blocked` by `deviceGateway, backups` (local non-HDC not accepted for that combination); during the long run, preflight `test:all` also hit ingest 5s timeout (subsequently fixed; re-verified via later `test:all` PASS).

**Note:** Playwright `outputDir=test-results/acceptance` clears that tree (including `operation-evidence/`) on each run. Focused topology e2e after the full suite therefore left only the five topology evidence records — contributing to `acceptance:evidence` FAIL.

## Browser UI checks (playwright-cli)

Routes: `http://127.0.0.1:5173/parameters`, `http://127.0.0.1:5173/parameter-admin`  
Viewports: `1440x900`, `768x1024`, `390x844`  
Console errors: **0** (warnings only)  
API: `http://127.0.0.1:8787` healthy during checks.

Canonical screenshots:

- `work/ui-checks/topology-phase8-parameters-desktop-1440x900.png`
- `work/ui-checks/topology-phase8-parameters-tablet-768x1024.png`
- `work/ui-checks/topology-phase8-parameters-mobile-390x844.png`
- `work/ui-checks/topology-phase8-parameter-admin-desktop-1440x900.png`
- `work/ui-checks/topology-phase8-parameter-admin-tablet-768x1024.png`
- `work/ui-checks/topology-phase8-parameter-admin-mobile-390x844.png`

## Production cutover

**Do not claim production cutover ready.** TD-042: no legal clean non-customer snapshot + maintenance-window rehearsal of apply → cutover → whole-DB restore.

## Parent review requested

Please review this branch for Task 8 merge readiness knowing:

1. Real topology acceptance path is green and documented.
2. Full browser acceptance matrix / evidence checker are **not** green.
3. Publish validate remains fail-closed on golden seed (`schema-failed`).
4. TD-042 blocks production cutover claims.
