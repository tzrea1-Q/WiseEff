# Reliability

> Chinese: [Chinese](zh-CN/RELIABILITY.md)

WiseEff reliability work should protect user trust in parameter changes, log analysis, device debugging, and Agent-assisted actions.

## Current Baseline

- Frontend build and tests are available through npm scripts.
- Backend exposes `/health/live`, `/health/ready`, and compatibility `/api/v1/health`.
- SQL migrations live in `server/migrations/`.
- Deployment and operations design lives in `design-docs/deployment-operations.md`.
- Testing strategy lives in `design-docs/testing-strategy.md`.

The pre-existing `0117_user_account_deletion.sql` migration remains in place unchanged. Effective
driver-parameter catalog rollout then uses migrations `0118_effective_driver_parameter_catalog.sql` to expand
subject/placement and reconciliation evidence, `0119_effective_driver_parameter_catalog_contract.sql` to guard
new DTS identity writes, and `0120_effective_driver_parameter_catalog_finalize.sql` to complete safe graph
backfill and reject future duplicate active versions. `0121_effective_driver_parameter_catalog_legacy_write_compat.sql`
keeps legacy unlinked staging writes compatible without making them effective, while
`0122_classify_nodename_driver_subjects.sql` corrects nodename-only subjects/modules into the node-type taxonomy,
`0123_harden_node_type_identity.sql` repairs trusted blank taxonomy names or fails closed before enforcing the
non-empty node-type name constraint, and `0124_harden_driver_identity_owner.sql` rejects cross-tenant subject/schema
or property-key identity writes, and `0125_harden_driver_schema_owner_scope.sql` closes the symmetric
DriverSchema-root owner boundary. `0126_guard_binding_spec_version_owner.sql` prevents a binding revision
from pointing at a version owned by another spec. The verification gate also blocks historical owner/version
disagreements and duplicate active node-type source/property identities, so an effective query that returns no
row cannot be mistaken for a ready release.
Operators must snapshot PostgreSQL
and object storage, run the reconciliation dry-run, apply one organization per transaction,
and finish with `npm run parameter-definitions:check`; any blocker keeps release fail-closed.
The recovery procedure and evidence fields are defined in the [effective catalog runbook](runbooks/effective-driver-parameter-catalog-reconciliation.md).

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
- Device gateway: clear write-command and readback outcomes, including timeout, stderr, offline, unsupported readback, and unknown legacy Bridge results.
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

The supported stock topology has exactly one API replica because local-device-bridge WebSockets are held in API-process memory. For `up --scale api=...`, `up --scale=api=...`, and standalone `scale api=...`, `ops/self-hosted/scripts/compose` accepts only exact `api=1` and rejects every other `api=*` value before Docker runs; scaling other services passes through. Direct Compose bypasses that guard but remains unsupported with multiple API replicas. Orchestrator or external multi-replica deployments are likewise unsupported for bridge workflows unless they provide bridge-aware routing for both the socket and all subsequent bridge-backed requests. That custom topology is outside the stock contract and needs separate target evidence; this baseline makes no HA or multi-replica readiness claim.

Hosts that have an IP and no DNS name should use the [setup wizard](../ops/self-hosted/setup.md) (`./scripts/setup.sh`). The IP lab path generates secrets, serves HTTP or Caddy internal TLS, seeds ChargeLab demo data, and attaches the lab admin to `org-chargelab`. It is a lab/demo profile, not commercial-pilot evidence.

An already running checkout uses the dedicated [self-hosted upgrade entry](../ops/self-hosted/upgrade.md). It resolves one commit, builds before downtime, verifies a PostgreSQL/object-store/Redis recovery point, recreates services without deleting volumes, and leaves traffic stopped with `recovery-required` after post-migration failure. Run the one-time root-only `prepare-host` action to grant the deployment user Docker access and secure journal/backup ownership; normal actions then reject any root effective user so the deployment user's Git/proxy context and file ownership are preserved. Restricted-network hosts use one mode-`0600`, allowlist-parsed build contract for proxy, npm registry, approved CA, and build TLS policy; setup and upgrade pass it into BuildKit without persisting credentials in journals or image layers, while Docker daemon pulls remain a separate operator boundary. `verify` is the default. A host unable to install the CA can select build-only `insecure`, but every actual build also requires `--allow-insecure-build`; the journal records this provenance while host/runtime TLS and package integrity/signature gates remain enforced. The pinned base-image contract carries both OCI manifest and Docker config digests so containerd-backed and classic `overlay2` stores verify the same archive without weakening the platform gate. Same-SHA no-op additionally requires the exact target application image on API/worker/web and a passing public probe. Legacy mixed API/worker/web images are captured per service. Persistent lock files are inspected and safely recovered through `lock-status`/`unlock`, not manual deletion. `setup.sh --force` remains a configuration operation, not an upgrade shortcut.

Self-hosted operators should run:

```bash
npm run selfhost:check
npm run queue:check -- --base-url https://<host>
npm run selfhost:smoke -- --base-url https://<host>
```

The smoke writes `docs/generated/m6-self-hosted-runtime-evidence.md` by default and probes `/health/live`, `/health/ready`, `/api/v1/me`, and `/api/v1/operations/pilot-readiness`. M6.4 requires `/health/ready` to include `dependencies.durableQueue.transport` and `dependencies.durableQueue.database`. Allowing `deviceGateway` as the only blocked gate is valid only for non-HDC staging.

### Self-hosted upgrade readiness and recovery truth

The upgrade controller keeps data-plane readiness service-specific: PostgreSQL and Redis require Docker `healthy`, MinIO `running` means process liveness only, and `minio-init` must exit `0` after its endpoint/credential/bucket initialization. A MinIO healthcheck is intentionally not inferred from `running`; the successful initializer is the object-store readiness proof, with MinIO rechecked throughout initializer polling and after exit `0`. Candidate `apply` and `resume` paths require API readiness, worker liveness plus Docker health on `8788`, and web access before queue resume. For advanced resume phases `queue-resumed`, `starting-proxy`, and `validating-public`, the candidate proxy is isolated before those readiness checks and remains down until API, worker, and web all pass; an unhealthy worker blocks both proxy-up and public probing. Final verification uses supported formatted Docker image inspection, treats named-volume mappings as unordered identity sets, and records a stable code for every failed identity invariant. Before `old-stack-restored` is persisted, a separate restore verification helper checks the data plane, API live/ready, worker health, web direct access, and previous app image identity; only then does it resume the queue, recreate proxy, and run public health last. Any failure remains `recovery-required`, persists whether proxy or queue/worker isolation actually succeeded, and records bounded/redacted `failed_phase`, `failure_service`, `failure_code`, `failure_summary`, `recovery_started`, `recovery_verified`, `recovery_failure_summary` when a recovery action emits diagnostics, and one executable `next_action`: pre-migration old-stack `resume`; token-gated, data-preserving `recover-candidate` for eligible post-migration completion failures; or token-gated whole-state rollback for earlier/unsupported post-migration failures. Candidate recovery re-isolates traffic, verifies the recovery-point manifest and local candidate image, and restores worker, queue, proxy, and public validation in order; it never restores data. Local mock tests do not establish target-environment readiness.

## M6.5 Observability Baseline

M6.5 adds self-hosted observability configuration under `ops/self-hosted/observability/`: Prometheus scrape config, alert rules, and four Grafana dashboards for services, overview, jobs, and security operations. The baseline scrape path is `api:8787/metrics` from a private compose or operations network.

The self-hosted `observability` Compose profile is operated through `ops/self-hosted/scripts/observability`. It adds Prometheus, Grafana, Alertmanager, HTTP/TCP service probes, host metrics, PostgreSQL metrics, Redis metrics, automatic datasource/dashboard provisioning, and a fourth `WiseEff Services` dashboard. Monitoring UIs bind to loopback by default and are intended for SSH-tunnel, VPN, or an equivalently controlled operations path. The dedicated worker exposes private liveness and Prometheus endpoints on compose port `8788`.

`GET /metrics` exposes build info, HTTP request counters/duration buckets, readiness/dependency gauges, worker queue gauges, log-analysis terminal job duration/failure-reason counters, Xiaoze LLM readiness gauges, Agent approval/tool metrics, device gateway operation counters, DTS parse/schema/compile latency and failures, DTS toolchain readiness/version info, open identity-mapping and spec-review backlogs, config publish results (including bypass), and parameter-identity migration/cutover status. These metrics support operational triage, but audit records, device snapshots, and target evidence remain the authoritative proof for high-risk writes.

Baseline tracing is available through the injectable tracing boundary. The current runtime exports HTTP `api.request` spans with route templates, Agent provider health/planning spans, and debugging gateway detect/read/write/rollback spans when tracing is enabled. Trace attributes must stay low-cardinality and non-sensitive; target Prometheus/Grafana/trace-collector evidence is still required before a deployed environment is called observability-ready.

Parameter semantic identity cutover is an irreversible-looking maintenance operation with **whole-snapshot restore** as the only rollback. Operators must follow [docs/runbooks/parameter-identity-cutover.md](runbooks/parameter-identity-cutover.md): write freeze → snapshot IDs → toolchain health → dry-run → backlog clear → compile-all → `--apply` → cutover SQL → postflight → app switch → observation. Partial continuation after a failed apply is forbidden.

Metrics are internal operations data. Production and pilot deployments must keep `/metrics` private through direct private-network scraping, a reverse-proxy allowlist, VPN, mTLS, or stronger equivalent control. Public `/metrics` exposure is not acceptable for readiness.

Every production alert rule must include a `runbook_url` annotation. Use [runbooks/observability-operations.md](runbooks/observability-operations.md) for alert response and [runbooks/incidents.md](runbooks/incidents.md) for incident severity, handoff, evidence, and closure.

## Production Configuration Gate

- `NODE_ENV=production` requires `DATABASE_URL`.
- `NODE_ENV=production` requires `OBJECT_STORE_MODE=s3`.
- `OBJECT_STORE_MODE=s3` requires `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- M6.3 self-hosted targets should also set `OBJECT_STORAGE_TLS_POLICY=required`, `OBJECT_STORAGE_PATH_STYLE`, `OBJECT_STORAGE_HEALTH_PREFIX`, and isolated backup/restore targets before backup drills.
- `NODE_ENV=production` requires live Xiaoze LLM configuration unless `XIAOZE_DETERMINISTIC=true`: `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`.
- `AGENT_API_TIMEOUT_MS` is not part of the canonical Xiaoze group and currently has no Xiaoze runtime consumer; wiring or renaming it is separate debt.
- Production and self-hosted deployments require `XIAOZE_CHECKPOINTER=postgres` unless `XIAOZE_DETERMINISTIC=true`.
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
- Webhook delivery-attempt rows are bounded by one maintenance loop owned by the active log worker in both polling and durable modes. It starts an asynchronous cycle immediately, then every 60 seconds deletes at most 10 batches of 1,000 rows while retaining the latest configured N per organization-scoped domain (`10000` by default, stable `created_at DESC, id DESC`). Cleanup failures are redacted and retried next cycle without interrupting analysis or delivery. Disabling retention stops future deletion only; database backup/restore is the recovery path for already-pruned rows.

## M6.3 Backup And Restore

- Self-hosted backup/restore evidence is generated with `npm run backup:drill` and checked with `npm run backup:check`.
- Restore target safety is checked with `npm run restore:drill`; it refuses live database URLs, live buckets, and empty/non-isolated restore prefixes.
- Evidence must name the selected S3-compatible provider, environment label, branch, commit, backup targets, isolated restore targets, command exit statuses, object checksum validation, table-count validation, sampled log reference validation, and redaction status.
- Redis queue backup remains conditional until M6.4 adds the durable queue service.
- Local generated evidence proves evidence shape, redaction, failed-command handling, and restore-target safety. Target readiness still requires a real restore drill in an isolated non-customer or pilot environment.

## M3 Debugging Operations

- Local debugging acceptance is simulator-first. `DEBUG_DEVICE_GATEWAY_MODE=simulator` uses the seeded Aurora target and deterministic node values, so read/write/readback/rollback can be verified without a physical device.
- Write-command failures surface as operation failures with readable timeout, offline, or stderr text. A command that executed followed by a technical readback failure remains an executed write with a warning; the last known current value stays stale until a linked read retry succeeds. An alternate observed representation remains `executed + observed`, not a mismatch. The simulator and HDC/ADB fake-runner suites cover representation differences and technical failures. Legacy Bridge payloads with only a top-level result remain `unknown` and instruct the operator to upgrade; capability version 2 reports both outcomes explicitly.
- A successful write creates a pre-write snapshot. Rollback is expected to write each snapshot entry back with readback, mark the snapshot consumed only if all writes succeed, and leave failed snapshots valid for retry.
- **DTS reload deploy is in-request** (ADR-0020): mount, push, trigger, kernel-log capture, and behavioural verification run on the API process that holds the bridge WebSocket. There is no BullMQ / durable-queue path for reload. The stock supported topology therefore uses one API replica; non-bridge-aware multi-replica deployment is unsupported.
- Current residual UI gap: API write snapshots created on `/node-debugging` are not yet automatically surfaced in the `/debugging` rollback card. The backend rollback API and audit path are verified by M3 E2E; UI state promotion remains tracked as technical debt. `/debugging` itself is product-offline; DTS reload evidence lives on `/dts-reload`.
- Production HDC mode is selected with `DEBUG_DEVICE_GATEWAY_MODE=hdc` and `HDC_TIMEOUT_MS`; production rejects simulator mode unless `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true` is explicitly set for non-customer staging. HDC and live Agent provider seams are implemented, but real pilot readiness depends on target-environment evidence. Real target discovery/write/readback/snapshot-rollback evidence is covered by the HDC device-lab smoke only when `HDC_DEVICE_LAB_AVAILABLE=true` and explicit write/rollback confirmation tokens are set. The local lab auto-prepares a lab-only temporary file node by default; customer or production node paths still require separate approval.

## M4 Agent Operations

- PostgreSQL is the source of truth for Agent sessions, messages, tool calls, approvals, and run traces.
- Tool failures must preserve conversation state, append readable failure context where possible, and keep audit records correlated by request id.
- Approval execution is idempotent by approval state: only `pending` approvals can transition to `approved` or `rejected`; repeated approval attempts return `INVALID_APPROVAL_STATE`.
- Approval-time execution must re-check authz and current business state before running the tool. If that check fails, the pending approval and tool call remain retryable.
- `parameter.submitChangeDraft` creates human-review drafts only; it does not merge or apply production parameter values.
- Live Xiaoze LLM startup uses LangChain `ChatOpenAI` against the atomic `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` group. The model defaults to `gpt-4o-mini`; canonical blanks never fall back to legacy aliases.
- Xiaoze LLM readiness is checked through the same health seam used by `/health/ready`; dependency details include safe evidence such as `baseUrlConfigured` and model id when available. If the LLM is unavailable, the orchestrator emits a degraded assistant message, records a fallback reason, and skips tool execution.
- Xiaoze multi-step planning checkpoints are durable when `XIAOZE_CHECKPOINTER=postgres` (required in production unless `XIAOZE_DETERMINISTIC=true`). LangGraph checkpoint tables are created idempotently during `npm run db:migrate`, so HITL resume survives API restarts and multi-replica routing bound to the same PostgreSQL. Local dev/tests default to in-memory checkpointing.
- `/metrics` exports `wiseeff_xiaoze_llm_ready` for Xiaoze LLM readiness. Model ids stay in readiness JSON and traces rather than Prometheus labels.
- For offline acceptance without a live model, set `XIAOZE_DETERMINISTIC=true` and run `npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts`.
- Trace metadata now includes latency, token usage, estimated cost, safety status, safety reasons, and fallback reason so pilot operators can distinguish normal planning from provider outages.
- Production auth now requires OIDC/JWKS in `NODE_ENV=production`; the pilot HMAC verifier is retained only for local smoke/test profiles. Target reliability evidence still has to prove the real self-hosted issuer, token refresh/logout behavior, and `/api/v1/me` with target OIDC access tokens.

## Rollback Expectations

- Frontend static assets should be quickly reversible.
- Database migrations should be forward-compatible or include a recovery note.
- Worker releases should avoid interrupting high-risk tasks.
- Device gateway changes should be verified against the simulator and HDC/ADB fake-runner tests before real devices. Real-device rollout must then record target detection, read, write-command failure, readback failure, alternate readback representation, linked read retry, timeout/offline, stderr, and strict rollback evidence from the device lab.

## References

- `design-docs/deployment-operations.md`
- `design-docs/testing-strategy.md`
- `runbooks/README.md`
- `exec-plans/active/development-roadmap.md`
