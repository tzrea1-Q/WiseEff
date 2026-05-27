# Reliability

WiseEff reliability work should protect user trust in parameter changes, log analysis, device debugging, and Agent-assisted actions.

## Current Baseline

- Frontend build and tests are available through npm scripts.
- Backend M0 exposes `/api/v1/health`.
- SQL migrations live in `server/migrations/`.
- Deployment and operations design lives in `design-docs/deployment-operations.md`.
- Testing strategy lives in `design-docs/testing-strategy.md`.

## Reliability Principles

- Long-running work should report progress and failure reasons.
- Writes should be idempotent where retries are possible.
- State transitions should be validated against the current version.
- Audit failures are product failures, not background noise.
- Device write failures must be visible and traceable.
- Production mock runtime must alert or fail fast.

## Operational Targets

- Normal API pages: P95 response below 800ms in MVP design.
- Log upload: progress feedback for large files.
- Worker tasks: explicit failed, retrying, complete, and canceled states.
- Device gateway: clear timeout, stderr, offline, and readback mismatch reporting.
- Agent tools: failure should not corrupt the conversation or business object.

## Health Checks

Planned endpoints:

- `/health/live`: process is alive.
- `/health/ready`: database, Redis, object storage, and required dependencies are ready.

Current endpoint:

- `/api/v1/health`: M0 API smoke endpoint.

## M2 Log Analysis Operations

- Local object storage is configured with `OBJECT_STORE_ROOT` and defaults to `.wiseeff-object-store`. Uploaded log bytes are stored under an organization-scoped key derived from the checksum and sanitized file name.
- The M2 worker is an in-process loop started by `npm run dev:api` when both `DATABASE_URL` and the local object store are configured. This is sufficient for local/staging smoke tests but is not a distributed worker model.
- Jobs move through queued/running/complete/failed states with parse, pattern, rootcause, and report stages. The frontend currently uses job polling through `LogAnalysisRepository`; SSE endpoints exist in the API shape but polling remains the reliable local path.
- Unsupported file formats do not enter the worker. They create a terminal failed log record immediately with an unsupported-format reason.
- Rerun creates a new run/job for the same log record. Production retry policy, distributed locks, and duplicate-worker protection remain deferred work.

## M3 Debugging Operations

- Local debugging acceptance is simulator-first. `DEBUG_DEVICE_GATEWAY_MODE=simulator` uses the seeded Aurora target and deterministic node values, so read/write/readback/rollback can be verified without a physical device.
- Gateway failures must surface as operation failures with readable timeout, offline, stderr, or readback mismatch text. The simulator currently covers read-only rejection and readback mismatch; production HDC must add timeout/offline fixtures before device rollout.
- A successful write creates a pre-write snapshot. Rollback is expected to write each snapshot entry back with readback, mark the snapshot consumed only if all writes succeed, and leave failed snapshots valid for retry.
- Current residual UI gap: API write snapshots created on `/node-debugging` are not yet automatically surfaced in the `/debugging` rollback card. The backend rollback API and audit path are verified by M3 E2E; UI state promotion remains tracked as technical debt.
- Production HDC gateway work remains open: real target discovery, connection leasing, command timeout policy, stderr normalization, and safe device-lab rollout.

## Rollback Expectations

- Frontend static assets should be quickly reversible.
- Database migrations should be forward-compatible or include a recovery note.
- Worker releases should avoid interrupting high-risk tasks.
- Device gateway changes should be verified against a simulator before real devices.

## References

- `design-docs/deployment-operations.md`
- `design-docs/testing-strategy.md`
- `exec-plans/active/development-roadmap.md`
