# M5 Pilot Acceptance

Date: 2026-05-29

This checklist records the M5 commercial-pilot release gate. Local verification can prove the gate structure, but it does not replace staging, device-lab, or backup/restore evidence.

## Checklist

- [x] OpenAPI contract artifact is current.
- [x] `GET /api/v1/operations/pilot-readiness` exists and returns `pilot_ready` or `blocked`.
- [x] Admin access is required for the pilot readiness route.
- [x] Worker/dead-letter readiness is represented in the pilot readiness gate.
- [x] Object-store readiness is represented in the pilot readiness gate.
- [x] Agent provider readiness is represented in the pilot readiness gate.
- [ ] Device-lab HDC smoke was run in this environment.
- [ ] Backup/restore drill was run in this environment.
- [ ] Staging pilot smoke evidence is attached.

## Local Verification Results

- `npm run contract:check` passed.
- `npm run test:server -- server/modules/operations/pilotReadiness.test.ts server/modules/operations/routes.test.ts server/modules/contracts/openapi.test.ts` passed.
- `npm run build` passed.
- `git diff --check` passed.
- `npm run smoke:m5` failed by default when no API base URL was configured in this shell, then skipped cleanly when `M5_SMOKE_ALLOW_NO_API=true` was set for a local documentation-only run.
- `npm run test:m5` passed `contract:check`, `test:all`, and `build`, then stopped in Playwright because `DATABASE_URL` was not set for the API-mode E2E suite.

## External Checks Not Run Locally

- PostgreSQL-backed API-mode Playwright E2E.
- Live API smoke against a running API URL.
- Device-lab HDC smoke.
- Backup/restore drill.
- Staging deployment smoke and rollback rehearsal.

## Evidence Notes

- `server/modules/operations/pilotReadiness.test.ts` covers the pure readiness reducer.
- `server/modules/operations/routes.test.ts` covers the admin gate, success path, and blocked dependency path.
- `server/modules/contracts/openapi.test.ts` covers the pilot readiness route in the generated contract.
- The acceptance gate should remain blocked until staging evidence is recorded alongside this file.
