# Reliability

> Chinese: [Chinese](zh-CN/RELIABILITY.md)

WiseEff reliability work should protect user trust in parameter changes, log analysis, device debugging, and Agent-assisted actions.

## Current Baseline

- Frontend build and tests are available through npm scripts.
- Backend exposes `/health/live`, `/health/ready`, and compatibility `/api/v1/health`.
- SQL migrations live in `server/migrations/`.
- Deployment and operations design lives in `design-docs/deployment-operations.md`.
- Testing strategy lives in `design-docs/testing-strategy.md`.

## Reliability Principles

- Long-running work should report progress and failure reasons.
- Writes should be idempotent where retries are possible.
- State transitions should be validated against the current version.
- Audit failures are product failures, not background noise.
- Device write failures must be visible and traceable.
- Provider outages and device failures must leave audit/readiness evidence rather than silently passing.
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

Current endpoints:

- `/health/live`: process is alive and can serve HTTP without checking dependencies.
- `/health/ready`: commercial readiness check for configured dependencies. It checks database connectivity, object-store readiness, worker job-state health, optional Redis/BullMQ durable queue health, and live Agent provider readiness, returning 503 with per-dependency reasons when a dependency is missing or failed.
- `/api/v1/health`: compatibility smoke endpoint for existing clients.

## Self-Hosted Runtime Baseline

M6.1 adds a self-hosted Linux runtime under `ops/self-hosted/`. It separates PostgreSQL, API, web, worker, Redis, and reverse proxy services. Local API startup still binds to `HOST=127.0.0.1` by default. Self-hosted API containers set `HOST=0.0.0.0` and `LOG_WORKER_ENABLED=false`; the dedicated worker container runs `npm run worker:logs`.

M6.4 adds Redis/BullMQ durable dispatch for log analysis. PostgreSQL remains the source of truth for job state, leases, retries, dead-letter metadata, audit, and evidence. Queue payloads carry the PostgreSQL `jobId`; the worker claims that job before processing. When PostgreSQL schedules a retry, the BullMQ handler throws so Redis redelivers the message according to the configured attempts/backoff. Database polling mode remains available with `LOG_ANALYSIS_QUEUE_MODE=polling`.

Self-hosted operators should run:

```bash
npm run selfhost:check
npm run queue:check -- --base-url https://<host>
npm run selfhost:smoke -- --base-url https://<host>
```

The smoke writes `docs/generated/m6-self-hosted-runtime-evidence.md` by default and probes `/health/live`, `/health/ready`, `/api/v1/me`, and `/api/v1/operations/pilot-readiness`. M6.4 requires `/health/ready` to include `dependencies.durableQueue.transport` and `dependencies.durableQueue.database`. Allowing `deviceGateway` as the only blocked gate is valid only for non-HDC staging.

## M6.5 Observability Baseline

M6.5 adds self-hosted observability configuration under `ops/self-hosted/observability/`: Prometheus scrape config, alert rules, and three Grafana dashboards for overview, jobs, and security operations. The baseline scrape path is `api:8787/metrics` from a private compose or operations network.

`GET /metrics` exposes build info, HTTP request counters/duration buckets, readiness/dependency gauges, worker queue gauges, log-analysis terminal job duration/failure-reason counters, Agent provider call counters, and device gateway operation counters for detect, read, write, and rollback paths. These metrics support operational triage, but audit records, device snapshots, and target evidence remain the authoritative proof for high-risk writes.

Baseline tracing is available through the injectable tracing boundary. The current runtime exports HTTP `api.request` spans with route templates, Agent provider health/planning spans, and debugging gateway detect/read/write/rollback spans when tracing is enabled. Trace attributes must stay low-cardinality and non-sensitive; target Prometheus/Grafana/trace-collector evidence is still required before a deployed environment is called observability-ready.

Metrics are internal operations data. Production and pilot deployments must keep `/metrics` private through direct private-network scraping, a reverse-proxy allowlist, VPN, mTLS, or stronger equivalent control. Public `/metrics` exposure is not acceptable for readiness.

Every production alert rule must include a `runbook_url` annotation. Use [runbooks/observability-operations.md](runbooks/observability-operations.md) for alert response and [runbooks/incidents.md](runbooks/incidents.md) for incident severity, handoff, evidence, and closure.

## Production Configuration Gate

- `NODE_ENV=production` requires `DATABASE_URL`.
- `NODE_ENV=production` requires `OBJECT_STORE_MODE=s3`.
- `OBJECT_STORE_MODE=s3` requires `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- M6.3 self-hosted targets should also set `OBJECT_STORAGE_TLS_POLICY=required`, `OBJECT_STORAGE_PATH_STYLE`, `OBJECT_STORAGE_HEALTH_PREFIX`, and isolated backup/restore targets before backup drills.
- `NODE_ENV=production` requires `AGENT_PROVIDER=live`.
- `AGENT_PROVIDER=live` requires `AGENT_MODEL` and `AGENT_API_KEY`.
- `AGENT_API_FORMAT` defaults to `wiseeff`; set `AGENT_API_FORMAT=pi` for the `@earendil-works/pi-ai` adapter or `AGENT_API_FORMAT=openai` for OpenAI-compatible `/chat/completions` and `/models` providers.
- `AGENT_API_FORMAT=pi` requires `AGENT_PI_PROVIDER` and does not require `AGENT_API_BASE_URL`.
- `AGENT_API_FORMAT=wiseeff` and `AGENT_API_FORMAT=openai` require `AGENT_API_BASE_URL`.
- `AGENT_API_TIMEOUT_MS` controls the live provider HTTP request timeout and defaults to 5000ms.
- `NODE_ENV=production` rejects `MOCK_RUNTIME_ENABLED=true`.
- `LOG_ANALYSIS_QUEUE_MODE=durable` requires `REDIS_URL`.
- Missing or unsafe production settings should stop the API process before it accepts traffic.

## M2 Log Analysis Operations

- Local object storage is configured with `OBJECT_STORE_ROOT` and defaults to `.wiseeff-object-store`. Uploaded log bytes are stored under an organization-scoped key derived from the checksum and sanitized file name. Readiness uses a small write/read/delete probe under the configured root.
- Production-like object storage uses `OBJECT_STORE_MODE=s3` with an S3/OSS-compatible endpoint and bucket. The adapter keeps the same organization-scoped key shape and records checksum, file size, content type, retention class, and encryption-mode metadata on writes.
- `/health/ready` routes S3-compatible readiness through the object-store health seam. M6.3 checks bucket `HEAD`, probe object `PUT`, object `HEAD`, object `GET` checksum, and object `DELETE`, then returns safe failure categories and remediation hints.
- The built-in HTTP transport signs S3-compatible requests with AWS4-HMAC-SHA256-style headers and path-style URLs for self-hosted providers. It remains provider-neutral; lifecycle rules, replication, KMS or at-rest encryption policy, and credential provisioning are operator responsibilities.
- Retention and encryption are represented as object metadata in the app seam. Provider lifecycle, credential rotation, and backup/export procedures must be documented in target evidence.
- The M2 worker can run in local database-polling mode or M6.4 durable queue mode. Durable mode uses Redis/BullMQ for dispatch, while PostgreSQL leases still protect writes and final state. The in-process worker started by `npm run dev:api` remains sufficient for local smoke tests, but target self-hosted environments should run the dedicated worker service.
- Jobs move through queued/running/complete/failed states with parse, pattern, rootcause, and report stages. The frontend currently uses job polling through `LogAnalysisRepository`; SSE endpoints exist in the API shape but polling remains the reliable local path.
- Unsupported file formats do not enter the worker. They create a terminal failed log record immediately with an unsupported-format reason.
- Rerun creates a new run/job for the same log record. Duplicate queue delivery is idempotent because a completed PostgreSQL job cannot be claimed again. Dead-letter and retry evidence remains visible in PostgreSQL job state.

## M6.3 Backup And Restore

- Self-hosted backup/restore evidence is generated with `npm run backup:drill` and checked with `npm run backup:check`.
- Restore target safety is checked with `npm run restore:drill`; it refuses live database URLs, live buckets, and empty/non-isolated restore prefixes.
- Evidence must name the selected S3-compatible provider, environment label, branch, commit, backup targets, isolated restore targets, command exit statuses, object checksum validation, table-count validation, sampled log reference validation, and redaction status.
- Redis queue backup remains conditional until M6.4 adds the durable queue service.
- Local generated evidence proves evidence shape, redaction, failed-command handling, and restore-target safety. Target readiness still requires a real restore drill in an isolated non-customer or pilot environment.

## M3 Debugging Operations

- Local debugging acceptance is simulator-first. `DEBUG_DEVICE_GATEWAY_MODE=simulator` uses the seeded Aurora target and deterministic node values, so read/write/readback/rollback can be verified without a physical device.
- Gateway failures must surface as operation failures with readable timeout, offline, stderr, or readback mismatch text. The simulator covers read-only rejection and readback mismatch. The M5 HDC adapter adds fake-runner tests for target detection, nonzero/stderr failures, argv construction, command timeout text, and read-back mismatch.
- A successful write creates a pre-write snapshot. Rollback is expected to write each snapshot entry back with readback, mark the snapshot consumed only if all writes succeed, and leave failed snapshots valid for retry.
- Current residual UI gap: API write snapshots created on `/node-debugging` are not yet automatically surfaced in the `/debugging` rollback card. The backend rollback API and audit path are verified by M3 E2E; UI state promotion remains tracked as technical debt.
- Production HDC mode is selected with `DEBUG_DEVICE_GATEWAY_MODE=hdc` and `HDC_TIMEOUT_MS`; production rejects simulator mode unless `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true` is explicitly set for non-customer staging. HDC and live Agent provider seams are implemented, but real pilot readiness depends on target-environment evidence. Real target discovery/write/readback/snapshot-rollback evidence is covered by the HDC device-lab smoke only when `HDC_DEVICE_LAB_AVAILABLE=true` and the `HDC_SMOKE_*` target/session/parameter/node/value env vars are set; otherwise it remains an external pilot acceptance item, not proven by the local simulator or fake-runner tests.

## M4 Agent Operations

- PostgreSQL is the source of truth for Agent sessions, messages, tool calls, approvals, and run traces.
- Tool failures must preserve conversation state, append readable failure context where possible, and keep audit records correlated by request id.
- Approval execution is idempotent by approval state: only `pending` approvals can transition to `approved` or `rejected`; repeated approval attempts return `INVALID_APPROVAL_STATE`.
- Approval-time execution must re-check authz and current business state before running the tool. If that check fails, the pending approval and tool call remain retryable.
- `parameter.submitChangeDraft` creates human-review drafts only; it does not merge or apply production parameter values.
- Live provider startup uses the selected provider format. The default `wiseeff` format is HTTP-backed through `AGENT_API_BASE_URL` and expects `/agent/health` and `/agent/plan-turn`; `AGENT_API_FORMAT=openai` expects OpenAI-compatible `/models` and `/chat/completions`; `AGENT_API_FORMAT=pi` resolves `AGENT_PI_PROVIDER` and `AGENT_MODEL` through `@earendil-works/pi-ai`.
- Live Agent provider readiness is checked through the same health seam used by `/health/ready`; Agent provider dependency details include safe provider evidence (`provider`, `format`, `piProvider`, `model`, and `promptVersion`) when available. If the provider is unavailable, the orchestrator emits a degraded assistant message, records a fallback reason, and skips tool execution.
- `/metrics` keeps the compatibility `wiseeff_agent_provider_ready` gauge and may add low-cardinality provider labels such as `provider`, `format`, and `piProvider`. Model ids and prompt versions stay in readiness JSON and traces rather than Prometheus labels.
- `npm run agent:pi-eval` is the offline Pi adapter gate. `npm run agent:pi-smoke` is optional live evidence and uses a synthetic no-tool prompt; it must return `toolRequests: 0`.
- Trace metadata now includes latency, token usage, estimated cost, safety status, safety reasons, and fallback reason so pilot operators can distinguish normal planning from provider outages.
- Production auth now requires OIDC/JWKS in `NODE_ENV=production`; the pilot HMAC verifier is retained only for local smoke/test profiles. Target reliability evidence still has to prove the real self-hosted issuer, token refresh/logout behavior, and `/api/v1/me` with target OIDC access tokens.

## Rollback Expectations

- Frontend static assets should be quickly reversible.
- Database migrations should be forward-compatible or include a recovery note.
- Worker releases should avoid interrupting high-risk tasks.
- Device gateway changes should be verified against the simulator and HDC fake-runner tests before real devices. Real-device rollout must then record target detection, read, write, timeout/offline, stderr, readback mismatch, and rollback evidence from the device lab.

## References

- `design-docs/deployment-operations.md`
- `design-docs/testing-strategy.md`
- `runbooks/README.md`
- `exec-plans/active/development-roadmap.md`
