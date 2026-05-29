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

### M5.2 Blockers

- Staging environment secrets and URLs are required before migrations, live API smoke, worker/object-store readiness, Agent provider checks, HDC device-lab smoke, backup/restore, rollback rehearsal, or `npm run test:m5` can be executed honestly.
- No M5.2 external evidence checklist item is complete as of this entry.

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
- Live API smoke against a running API URL.
- Device-lab HDC smoke.
- Backup/restore drill.
- Staging deployment smoke and rollback rehearsal.
- Live Agent provider staging evidence.

## Evidence Notes

- `server/modules/operations/pilotReadiness.test.ts` covers the pure readiness reducer.
- `server/modules/operations/routes.test.ts` covers the admin gate, success path, and blocked dependency path.
- `server/modules/contracts/openapi.test.ts` covers the pilot readiness route in the generated contract.
- The acceptance gate should remain blocked until staging evidence is recorded alongside this file.
