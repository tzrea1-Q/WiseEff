# M5 Pilot Acceptance

Date: 2026-05-29

This checklist records the M5 commercial-pilot release gate. Local verification can prove the gate structure, but it does not replace staging, device-lab, or backup/restore evidence.

## Merge And CI Evidence

- PR #39, `M5 commercial pilot readiness`, merged on 2026-05-29.
- GitHub CI `Build and test` completed successfully for the merged M5 branch.
- This evidence proves repository gates passed; it does not replace staging live API, device-lab, backup/restore, rollback, or live provider evidence.

## M5.2 Staging Evidence

Date: 2026-05-29T13:10:38+08:00
Environment: staging evidence execution not started; external environment inputs are missing.
Branch: `codex/m5-2-staging-pilot-evidence`
Baseline commit: `0701b1a`

### Configuration Inventory

- PostgreSQL: blocked; no staging `DATABASE_URL` was available in this workspace.
- Auth: blocked; no production-mode staging issuer, HMAC secret, or admin smoke token was available in this workspace.
- Object storage: blocked; no S3/OSS-compatible staging endpoint, bucket, or credentials were available in this workspace.
- Device gateway: blocked; no `DEBUG_DEVICE_GATEWAY_MODE=hdc` staging runtime or `HDC_SMOKE_*` target values were available in this workspace.
- Agent provider: blocked; no live provider model, API key, or base URL was available in this workspace.
- Live API smoke: blocked; no `WISEEFF_API_BASE_URL` or `VITE_WISEEFF_API_BASE_URL` was available in this workspace.
- Backup/restore and rollback: blocked; no staging backup target, restore target, or approved rollback window was available in this workspace.

### Repository Gate Evidence

- `npm ci`: passed on 2026-05-29; npm reported non-fatal Node engine warnings because the workspace is using Node v22.12.0 while some packages declare `>=22.13.0`.
- `npm run docs:check`: passed on 2026-05-29.
- `npm run contract:check`: passed on 2026-05-29.
- `npm run test:all`: passed on 2026-05-29; frontend Vitest reported 175 files and 1639 tests passing, and server Vitest reported 60 files and 524 tests passing.
- `npm run build`: passed on 2026-05-29; existing Vite chunk-size warning observed.
- `git diff --check`: passed on 2026-05-29.

### Local PostgreSQL API-Mode E2E Evidence

Date: 2026-05-29T15:44:26+08:00
Environment: local Docker PostgreSQL on `127.0.0.1:5432`, database/user `wiseeff`; this is local evidence, not external staging evidence.
Runtime env: `DATABASE_URL` set to the local PostgreSQL URL, `OBJECT_STORE_ROOT=.wiseeff-object-store`, `DEBUG_DEVICE_GATEWAY_MODE=simulator`, `CI=1`.

- `npm run db:migrate`: passed; 0 migrations applied because the local schema was already current through `0010_m5_agent_provider_traces.sql`.
- `npm run db:seed:m0`: passed.
- `npm run db:seed:m1`: passed.
- `npm run db:seed:m2`: passed.
- `npm run db:seed:m3`: passed.
- `npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts e2e/agent.api.spec.ts`: passed after the fresh seed run; 6 passed and 1 skipped.
- The skipped test was the HDC device-lab smoke in `e2e/debugging.api.spec.ts`, which still requires real `DEBUG_DEVICE_GATEWAY_MODE=hdc` target inputs.
- Focused frontend regressions passed: `npm test -- src/components/ParametersTable.test.tsx src/ParametersPage.test.tsx src/application/parameters/parameterRuntime.test.ts src/App.test.tsx src/NodeDebuggingPage.test.tsx` reported 5 files and 215 tests passing.
- Focused server regressions passed: `npm run test:server -- server/modules/parameters/repository.test.ts server/modules/logs/repository.test.ts` reported 2 files and 37 tests passing.

### Local Non-HDC Real Environment Revalidation

Date: 2026-05-29T18:53:47+08:00
Environment: local `.env` with PostgreSQL, production-mode HMAC auth, local object store, simulator device gateway, and OpenAI-compatible live Agent provider; this is non-HDC local target evidence, not external staging or hardware-lab evidence.
Branch: `codex/m5-2-non-hdc-evidence-closure`
Commit: `5018764`

- `.env` inventory: database/API/auth/smoke token/local object store/live Agent/simulator gateway/local backup directories were present; S3/OSS cloud credentials, HDC smoke variables, and persisted `M5_BACKUP_RESTORE_DRILL_AT` were not present.
- `npm run test:all` passed with `VITE_WISEEFF_RUNTIME_MODE=mock` override: frontend Vitest reported 176 files and 1644 tests passing; server Vitest reported 61 files and 529 tests passing.
- `npm run docs:check`, `npm run contract:check`, `npm run build`, and `git diff --check` passed. The build retained the existing Vite chunk-size warning.
- `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, and `npm run db:seed:m3` passed against the local PostgreSQL database.
- `npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts e2e/agent.api.spec.ts` passed with `AUTH_MODE=development`, `AGENT_PROVIDER=deterministic`, and the local `.env` database/object-store settings: 6 passed and 1 HDC device-lab test skipped.
- The same E2E command failed under the production-auth `.env` because the frontend HTTP client does not inject `Authorization: Bearer ...` into API-mode business requests. Direct `/api/v1/me` with the smoke token passed; without a token it correctly returned 401.
- `/health/ready` passed with database, local object store, worker queue, and live Agent provider ready.
- Direct live Agent provider validation passed only after raising `AGENT_API_TIMEOUT_MS` from `5000` to `30000` for the local API process. The resulting trace recorded `provider=live`, `safety_status=safe`, token usage, and no fallback. With the default 5000 ms timeout, the chat completion path fell back after timeout even though provider health was ready.
- Local backup/restore drill passed using the Docker PostgreSQL tools in `wiseeff-postgres`: a custom dump was written to `.wiseeff-backups/wiseeff-db-2026-05-29T10-52-34-444Z.dump`, restored into a fresh temporary database, validated with 10 migrations, 4 users, 3 projects, 36 parameter values, 2 log records, 5 debugging parameters, and 14 agent sessions, then the temporary restore database was dropped. The local object-store directory was copied through `.wiseeff-backups/` and `.wiseeff-restore/` with 1 restored object file.
- With `M5_BACKUP_RESTORE_DRILL_AT=2026-05-29T18:52:34+08:00` set on the local API process, `/api/v1/operations/pilot-readiness` was blocked only by `deviceGateway`.
- `npm run smoke:m5` still failed, as designed, because strict pilot readiness requires HDC device-gateway evidence and the local process runs `DEBUG_DEVICE_GATEWAY_MODE=simulator`.

### Local Non-HDC Revalidation After `.env` Completion

Date: 2026-05-30T21:42:15+08:00
Environment: local `.env` with PostgreSQL, production-mode HMAC auth, local object store, simulator device gateway, OpenAI-compatible live Agent provider, and local backup/restore timestamp. This remains local non-HDC evidence, not external staging, cloud object-store, hardware-lab, or deployment rollback evidence.
Branch: `codex/manual-acceptance-guide`
Commit: `bd583cf3a80f98b1487f88f91f2bafdb5b2bf574`

- `.env` inventory was rechecked without printing secrets. Database/API/auth/smoke token/local object store/live Agent/simulator gateway/local backup timestamp were present. Cloud S3/OSS credentials and HDC smoke variables were still absent.
- `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, and `npm run db:seed:m3` passed against the local PostgreSQL database.
- `npm run smoke:m5 -- --allow-only-blocked=deviceGateway` passed against the local live API runtime. `/health/live` and `/health/ready` returned ready; database, local object store, worker queue, live Agent provider, auth, contract, and backup gates were ready; `/api/v1/operations/pilot-readiness` remained blocked only by `deviceGateway`.
- `npx tsx -- scripts/run-acceptance-preflight.ts --no-start-runtime --skip-gates --skip-frontend --evidence-out test-results/acceptance/live-api-preflight-evidence.md` passed against the local live API runtime. Health, readiness, current user, and non-HDC pilot readiness passed; gates and frontend were intentionally skipped for this focused live API probe.
- `npm run acceptance:browser` passed in local non-HDC browser automation mode: 16 passed and 1 HDC device-lab test skipped. Evidence was regenerated at `docs/generated/acceptance-browser-evidence.md`. This browser suite uses the deterministic Agent provider for stable UI approval-flow assertions; live Agent readiness is covered by the live smoke/preflight evidence above.
- `npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts e2e/agent.api.spec.ts` passed with production-mode HMAC auth, `VITE_WISEEFF_API_AUTHORIZATION` set from the smoke token, and `AGENT_PROVIDER=deterministic`: 6 passed and 1 HDC device-lab test skipped. The legacy E2E direct API assertions were updated to send the same smoke authorization headers as the UI runtime, closing the previous local static-bearer production-auth E2E gap.
- Strict `npm run smoke:m5` is still expected to fail for this local environment unless `--allow-only-blocked=deviceGateway` is provided, because simulator device gateway mode is not accepted as full pilot readiness.

### M5.2 Blockers

- External staging deployment evidence is still required before this environment can be called pilot-ready: deployed staging API/web/worker, target-environment PostgreSQL E2E, HDC device-lab smoke, cloud S3/OSS or explicitly approved local object-store policy, and rollback rehearsal.
- Target production-auth identity remains a deployment responsibility: the local static bearer-token path is now verified, but staging/prod still need provisioned users or an identity provider-backed token lifecycle.
- HDC device-lab evidence remains missing because `HDC_DEVICE_LAB_AVAILABLE` and the required `HDC_SMOKE_*` values were not configured.
- Target-environment rollback rehearsal remains unrun; the local backup/restore drill above does not replace deployment rollback evidence.

## Checklist

- [x] OpenAPI contract artifact is current.
- [x] `GET /api/v1/operations/pilot-readiness` exists and returns `pilot_ready` or `blocked`.
- [x] Admin access is required for the pilot readiness route.
- [x] Worker/dead-letter readiness is represented in the pilot readiness gate.
- [x] Object-store readiness is represented in the pilot readiness gate.
- [x] Agent provider readiness is represented in the pilot readiness gate.
- [x] Contract freshness evidence is represented in the pilot readiness gate.
- [ ] Device-lab HDC smoke was run in this environment.
- [ ] Backup/restore drill was run in this environment.
- [ ] Staging pilot smoke evidence is attached.

## Local Verification Results

- `npm run contract:check` passed.
- `npm run test:server -- server/modules/operations/pilotReadiness.test.ts server/modules/operations/routes.test.ts server/modules/contracts/openapi.test.ts` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npm run smoke:m5` failed by default when no API base URL was configured in this shell, then skipped cleanly when `M5_SMOKE_ALLOW_NO_API=true` was set for a local documentation-only run.
- `npm run test:m5` now invokes the smoke with `--require-api`, so the final pilot gate always probes the live API after `contract:check`, `test:all`, `build`, and Playwright.
- The pilot-readiness route requires recorded contract evidence via `M5_CONTRACT_CHECK_PASSED=true` or `M5_CONTRACT_ARTIFACT_CHECKED_AT=<timestamp>`.

## External Checks Not Run Locally

- External staging PostgreSQL-backed API-mode Playwright E2E.
- Live API smoke against a deployed target/staging API URL.
- Cloud S3/OSS object-store readiness and backup evidence.
- Device-lab HDC smoke.
- Target-environment backup/restore drill.
- Staging deployment smoke and rollback rehearsal.
- Live Agent provider staging evidence.

## Evidence Notes

- `server/modules/operations/pilotReadiness.test.ts` covers the pure readiness reducer.
- `server/modules/operations/routes.test.ts` covers the admin gate, success path, and blocked dependency path.
- `server/modules/contracts/openapi.test.ts` covers the pilot readiness route in the generated contract.
- The acceptance gate should remain blocked until staging evidence is recorded alongside this file.
