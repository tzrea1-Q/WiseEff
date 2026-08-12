# Test Foundation Deepening (Architecture Review Candidates 1 + 7)

Date: 2026-08-12
Status: in progress
Branch: `refactor/test-foundation-deepening`

## Goal

Deepen the automated-test foundation identified by the 2026-08-12 test-architecture review:

1. **Candidate 7 — suite partition repair.** `packages/**` tests ran twice (jsdom via `npm test`, node via `bridge:test`) and only the jsdom run was enforced in CI; `scripts/**` and `ops/**` governance tests ran inside the frontend jsdom suite with React DOM patches applied. Documented gate commands such as `npm run test:server -- scripts/check-doc-governance.test.ts` silently ran zero tests (`passWithNoTests` masked the empty filter).
2. **Candidate 1 — one deep `server/testing` module.** Server suites re-implemented the same test infrastructure per file: 6 verbatim temp-database harnesses, ~45 local `makeAuth` factories, ~30 in-memory ObjectStore fakes, 42 seed functions with 726 hand-written INSERT lines, and a cluster-wide advisory lock (`4_201_658`) that serialized all shared-database suites and capped `vitest` at 2 workers. The shared-database strategy also depended on the developer database's cutover state: on a cut-over local database, 9 tests in `migration.test.ts` failed (`relation "parameter_definitions" does not exist`) while CI stayed green.

## Architecture

- `server/testing/tempDatabase.ts` — the disposable-database seam: `withTempDatabase({ prefix, migrate? }, fn)`, `withAdminClient`, `openDatabaseConnection`, `adminConnectionString`, `resolveTestDatabaseUrl`, exported `migrationsDir`. Suites keep a 2–4 line local adapter that binds their prefix and callback shape; the 54-line copies are deleted.
- `server/testing/testDatabase.ts` — `createInMemoryTestDatabase()` keeps its exact interface but now runs each vitest fork in its own database cloned from a migrations-fingerprinted template (`wiseeff_test_tpl_<fp>` → `wiseeff_test_wk_<fp>_<pid>`). The per-suite cluster lock is gone; a lock remains only around the rare template build/clone moment. Local suites now see the same fresh schema as CI regardless of the dev database's cutover state. Stale templates/worker databases from older fingerprints are dropped opportunistically.
- `server/testing/authContext.ts` — `makeTestAuthContext(overrides)`; permissions default to `permissionsForRoles` over the bound roles so fixtures track the production RBAC policy instead of hand-copied arrays.
- `server/testing/objectStore.ts` — `createMemoryObjectStore()` for the `ObjectStore` seam (checksum/storage-key behavior of the local adapter, no disk).
- `server/testing/fixtures.ts` — `seedOrganization` / `seedUser` / `seedProject` / `seedCoreGraph` upserts for the org→users→projects spine; domain-specific rows stay in suites.
- Vitest partition: `vite.config.ts` excludes `packages/**`, `scripts/**`, `ops/**`; new `vitest.scripts.config.ts` runs `scripts/**` + `ops/**` in node; `vitest.bridge.config.ts` keeps `packages/**`; `test:all` chains all four suites; CI runs `test:scripts` and `bridge:test` explicitly.

## Files

- `server/testing/tempDatabase.ts` (new), `server/testing/testDatabase.ts` (worker-database rewrite), `server/testing/authContext.ts` (new), `server/testing/objectStore.ts` (new), `server/testing/fixtures.ts` (new)
- Migrated suites: `parameter-topology/{postCutoverWorkflow.integration,migration,schemaMigration,manifestBackfillMigration}.test.ts`, `parameter-specs/specReviewTenantEvidence.integration.test.ts`, `parameters/dashboard/postCutoverDashboard.integration.test.ts`, pilot `parameter-files/integration.test.ts`
- `vite.config.ts`, `vitest.scripts.config.ts` (new), `vitest.bridge.config.ts`, `vitest.server.config.ts`, `package.json`, `.github/workflows/ci.yml`
- `packages/device-bridge/src/ensureBridgeRunning.test.ts` — the Windows bundled-node expectation encoded the mock-not-applied jsdom behavior; fixed to assert the bundled `node.exe` the production resolver and the test's own fs mock intend.

## Tasks

- [x] Partition suites; add `test:scripts`; wire `bridge:test` + `test:scripts` into CI; extend `test:all`.
- [x] Fix `ensureBridgeRunning.test.ts` Windows expectation surfaced by running `packages/**` in node.
- [x] Create `server/testing` modules (tempDatabase, authContext, objectStore, fixtures).
- [x] Migrate the 6 temp-database harness copies onto `withTempDatabase`.
- [x] Pilot-migrate `parameter-files/integration.test.ts` (auth + object store + core graph).
- [x] Replace the shared-DB advisory-lock strategy with per-worker template-cloned databases; raise default `maxWorkers` 2 → ≤4.
- [x] Full `npm run test:server` green under the worker-database scheme — 277 files / 2012 tests in 104.9s on a quiet machine (2026-08-12 19:52); the 9 cutover-state environment failures in `migration.test.ts` are gone because worker databases always start from migrations only.
- [x] Clean `npm test` baseline after partition — 326/327 files in 86s. The one remaining failure (`ParametersPage · 提交契约` source-regex assertion on `App.tsx`) is owned by the concurrent app-shell-decomposition workstream (`2026-08-12-app-shell-decomposition.md`), which is actively moving that reducer code; `work/**` (gitignored scratch) is excluded from collection.
- [x] Bulk migration (2026-08-12 evening, three parallel implementation agents): 49 auth factories across 10 modules delegate to `makeTestAuthContext` with identities and permission arrays preserved verbatim; behavior-identical ObjectStore fakes replaced; 12 org/user/project seed spines on `seedCoreGraph`; deliberately-different fakes and const-literal auth objects skipped by rule; `parameters/seedM1*.integration.test.ts` reverted (pre-existing 30s-borderline timing, see TD-071). Full `test:server` re-verified green (277 files / 2012 tests).
- [x] Worker-database run lifecycle: `server/testing/globalSetup.ts` stamps a run token, pre-builds the template (no suite pays the build in its test budget), reaps orphaned worker databases from crashed runs, and drops this run's databases on teardown; worker databases are keyed by run token + pool slot and reused across files, so a run holds at most `maxWorkers` clones and leaves only the template behind.
- [x] TD-072 (review candidate 2) landed 2026-08-12 evening: all 23 order-queued fake-DB suites converted to real-PostgreSQL behavior tests (reference conversions in `logs/{repository,service}.test.ts` and `parameters/projectService.test.ts`; remaining 20 files converted by four parallel implementation agents). `QueuedResult` is gone repo-wide, ~360 SQL-text assertions replaced by behavioral/state assertions, and full `test:server` is green (277 files / 2012 tests, 63s warm).
- [x] TD-075 phase 1 (review candidate 5) landed 2026-08-12 night: planned-marker convention (`@acceptance-planned`/`@operation-planned`) so skip stubs stop counting as coverage; 19 stub-only requirements truthfully `required: false`; coverage map machine-reconciled both directions (16 rows added, 3 orphan IDs registered, dead spec ref fixed); matrix `specFiles` disk-existence gate; recursive spec collection; map reconciliation enforced in the browser-acceptance run. Gates: `acceptance:coverage`, `acceptance:operations`, `test:scripts` (37 files / 353 tests), `docs:check` all green.
- [x] TD-076 phase 1 (review candidate 6, branch `feat/acceptance-cast-seam`): the ChargeLab cast consolidated into data-only `e2e/acceptance/helpers/cast.ts` (4 verbatim copies retired, including the platform-operator title divergence between copies resolved to the only seeder's value); `runNpmScript` consolidated into `helpers/database.ts` with the win32 spawn handling the local copies had and the canonical copy lacked (also severs the spec→run-browser-acceptance dead `npmCommand` dependency edge).
- [ ] Follow-up (tracked as TD-071–TD-077, not this plan): seedM1 borderline timing; simple-fake repository suites still holding ~99 SQL-text assertions (TD-072 remainder); frontend render harness (candidate 3); TD-075 phase 2 (registry unification + results-based coverage judgment); TD-076 phase 2 (auth entry unification, seeding/cleanup seam, runtime-boot consolidation); CSS text assertions (candidate 8).

## Verification

```bash
npm run test:scripts
npm run bridge:test
npm run test:server -- server/modules/parameter-topology/migration.test.ts server/modules/parameter-files/integration.test.ts server/modules/parameter-topology/editService.test.ts --run
npm run test:server
npm test
npm run build
npm run docs:check
```

Expected outcomes:

- `test:scripts` 37 files green in node; `bridge:test` 21 files green (was 1 real failure hidden by the jsdom double-run).
- `migration.test.ts` passes on a cut-over local database (was 9 failures) because worker databases always start from migrations only.
- No suite takes cluster lock `4_201_658`; server suite parallelizes at up to 4 workers.
- Interface compatibility: `createInMemoryTestDatabase` callers unchanged (33 files).

## Git & PR Workflow

- Feature branch `refactor/test-foundation-deepening` from latest `main`; one plan → one branch.
- Parent agent reviews, opens the GitHub PR, merges, and syncs local `main` per `docs/PLANS.md`.

## Documentation Impact Matrix

| Area | File | Action | Notes |
| --- | --- | --- | --- |
| Repository map | `AGENTS.md` | No change | Commands section already routes through `test:all`, which now covers the new suites. |
| Planning | `docs/PLANS.md` | Update | Register this plan under Current Active Plan. |
| Developer verification | `docs/developer/verification-matrix.md` | Update | New `test:scripts`/`bridge:test` rows; `test:all` scope; fixed two silently-empty `test:server -- scripts/...` commands. |
| Developer verification (zh) | `docs/zh-CN/developer/verification-matrix.md` | Update | Same rows and the vendor dt-schema command fix. |
| Quality gates | `docs/QUALITY_SCORE.md` | Update | Doc-governance gate command now `test:scripts`; new suite gates listed. |
| Quality gates (zh) | `docs/zh-CN/QUALITY_SCORE.md` | No change | Chinese page has no per-command gate list affected by this change. |
| Testing strategy | `docs/design-docs/testing-strategy.md` | Update | Key Commands include `test:scripts` and `bridge:test`. |
| Testing strategy (zh) | `docs/zh-CN/design-docs/testing-strategy.md` | Update | M6.1/M6.5/M6.6 gate commands moved off `npm test -- scripts/...` (now silently empty) onto `test:scripts` / `test:server`. |
| Product specs | `docs/product-specs/` | No change | No product behavior change. |
| Architecture docs | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | No change | Test-infrastructure-only change. |
| Security | `docs/SECURITY.md`, `docs/security/` | No change | No authz/audit behavior change; auth fixture factory derives from the same production policy. |
| Reliability/runbooks | `docs/RELIABILITY.md`, `docs/runbooks/` | No change | No runtime behavior change. |
| Generated artifacts | `docs/generated/` | No change | No contract or schema change. |
| References | `docs/references/` | No change | — |
| Exec plans | `docs/exec-plans/completed/*` | No change | Historical evidence records intentionally keep the old commands they actually ran. |

## Documentation Update Gate

Blocking before this plan moves to `completed/`:

- [x] `docs/PLANS.md` registered.
- [x] `docs/developer/verification-matrix.md` + zh companion updated.
- [x] `docs/QUALITY_SCORE.md` updated.
- [x] `docs/design-docs/testing-strategy.md` + zh companion updated.
- [x] `npm run docs:check` green (2026-08-12).
- [x] Deferred follow-ups recorded as TD-071–TD-077 in `docs/exec-plans/tech-debt-tracker.md`.
