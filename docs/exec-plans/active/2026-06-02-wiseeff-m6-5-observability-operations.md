# WiseEff M6.5 Observability And Operations Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) tracking. Prefer Matt skills `implement` and `tdd` — write the failing test first, implement the smallest change, then verify green. Follow `docs/PLANS.md` Git Branch & PR Workflow (implementation commits on the feature branch; parent opens/merges the PR).



**Goal:** Add self-hosted observability, alerting, and operations runbooks for WiseEff API, web, worker, database, object storage, queue, Agent provider, and device gateway seams.

**Architecture:** WiseEff should emit structured logs, metrics, traces, and correlation identifiers without depending on a SaaS observability vendor. OpenTelemetry provides instrumentation boundaries, Prometheus scrapes metrics, Grafana visualizes dashboards, and Alertmanager or equivalent routes actionable alerts.

**Tech Stack:** OpenTelemetry JavaScript, Prometheus, Grafana, optional Loki/Promtail or file log shipping, structured JSON logs, self-hosted Docker Compose, WiseEff health/readiness endpoints.

---

## Reference Basis

- OpenTelemetry JavaScript docs: https://opentelemetry.io/docs/languages/js/
- Prometheus alerting rules docs: https://prometheus.io/docs/prometheus/2.54/configuration/alerting_rules/
- Prometheus alerting practices: https://prometheus.io/docs/practices/alerting/

## Scope Boundary

M6.5 includes:

- Request, job, audit, Agent, and device operation correlation fields.
- Structured server logs suitable for file or container log collection.
- `/metrics` endpoint or equivalent Prometheus scrape target.
- OpenTelemetry traces for API routes, database calls, object-store calls, queue jobs, Agent provider calls, and device gateway calls where practical.
- Self-hosted Prometheus, Grafana, and alerting configuration.
- Dashboards for health, traffic, latency, errors, queue, worker, object storage, database, Agent provider, and acceptance synthetic status.
- Runbooks for alert response and incident handoff.

M6.5 excludes:

- SaaS monitoring vendors.
- Exhaustive business analytics.
- Capacity/load testing execution. M6.5 exposes metrics; M6.6 uses them in capacity gates.
- Rewriting business modules solely for instrumentation aesthetics.

## Dependencies And Ordering

- M6.1 provides runtime topology.
- M6.3 provides object-store and backup signals.
- M6.4 provides queue metrics and Redis signals.
- M6.6 consumes dashboards and alerts during release, rollback, and capacity gates.

## Success Criteria

- Every API request has a request ID and trace ID in logs and responses where appropriate.
- Audit events can be correlated with request ID, user ID, operation ID, and trace ID.
- Log-analysis queue health exposes queued, processing, dead-letter, oldest-queued-age, and local terminal job duration/failure-reason metrics.
- Agent provider readiness, Agent provider calls, Agent approval decisions, Agent tool terminal results, Agent audit write failures, debugging HTTP route outcomes, and device gateway operations are observable through baseline counters.
- Prometheus can scrape WiseEff metrics.
- Grafana dashboards load from versioned local files.
- A self-hosted operator can start, stop, inspect, and tail the complete local observability stack through one repository-owned command without installing Node.js on the server.
- Grafana provisions the Prometheus datasource and all WiseEff dashboards automatically; no manual dashboard import is required.
- The graphical service view covers API, worker, web, proxy, PostgreSQL, Redis, object storage, Prometheus, Grafana, Alertmanager, and the host, while Grafana, Prometheus, and Alertmanager bind to loopback by default.
- Alerts are actionable and tied to runbooks.
- `npm run docs:check`, `npm run test:all`, `npm run build`, and observability metadata gates pass.

## Expected File Structure

Create:

- `server/observability/logger.ts`: structured log helpers.
- `server/observability/metrics.ts`: metrics registry and HTTP exposition.
- `server/observability/tracing.ts`: OpenTelemetry setup boundary.
- `server/observability/correlation.ts`: request/job/audit correlation helpers.
- `server/observability/*.test.ts`: focused tests for logging, metrics, and correlation.
- `ops/self-hosted/observability/prometheus.yml`
- `ops/self-hosted/observability/alerts.yml`
- `ops/self-hosted/observability/alertmanager.yml`
- `ops/self-hosted/observability/blackbox.yml`
- `ops/self-hosted/observability/grafana/provisioning/datasources/prometheus.yml`
- `ops/self-hosted/observability/grafana/provisioning/dashboards/wiseeff.yml`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-services.json`
- `ops/self-hosted/scripts/observability`
- `scripts/check-observability-config.ts`
- `scripts/check-observability-config.test.ts`
- `docs/runbooks/observability-operations.md`
- `docs/runbooks/incidents.md`

Modify:

- `server/index.ts`
- `server/contextFactory.ts`
- `server/modules/audit/*`
- `server/modules/jobs/*`
- `server/modules/logs/*`
- `server/modules/agent/*`
- `server/modules/debugging/*`
- `server/modules/operations/health.ts`
- `package.json`
- `ops/self-hosted/compose.yaml`
- `docs/runbooks/monitoring-alerting.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/developer/environment-variables.md`
- `docs/developer/verification-matrix.md`

## Implementation Tasks

### Task 1: Observability Metadata Gate

- [x] Write failing tests in `scripts/check-observability-config.test.ts`.
- [x] Require Prometheus config, alert rules, at least three Grafana dashboards, and runbook links.
- [x] Require package scripts for observability config validation.
- [x] Require no secrets in dashboard/config files.
- [x] Run `npm test -- scripts/check-observability-config.test.ts` and confirm expected failure.

### Task 2: Structured Logs And Correlation

- [x] Write failing unit tests for request ID, trace ID, audit ID, job ID, and operation ID propagation.
- [x] Implement structured JSON logging helpers.
- [x] Ensure error responses include request IDs without leaking secrets.
- [x] Ensure audit writes can include correlation metadata.
- [x] Run focused server tests for observability and audit modules.

### Task 3: Metrics Endpoint

- [x] Write failing tests for metrics registration and redaction.
- [x] Add process, HTTP, database, object-store, queue, worker, Agent, and device baseline metrics.
  - Current evidence: process/build info, HTTP request counts/duration buckets, database/object-store/Agent provider readiness, readiness status, worker queue gauges, log-analysis terminal job duration/failure-reason counters, Agent provider call counters, Agent approval/tool-result counters, Agent audit write failure counters, and device gateway operation counters are implemented.
  - Pending deep metrics: fine-grained device failure categories and target scrape history for release-blocking thresholds.
- [x] Add `/metrics` with production access guidance, such as private network only or reverse-proxy allowlist.
- [x] Add readiness checks that verify metrics registration does not break health endpoints.
- [x] Run focused metrics tests.

### Task 4: OpenTelemetry Tracing

- [x] Add tracing setup that can be disabled in local tests and enabled in self-hosted runtime.
- [x] Instrument API routes, database calls, queue processing, object-store probes, Agent provider calls, and device gateway calls where the interfaces already provide clean boundaries.
  - Current evidence: the tracing boundary can be enabled or disabled and isolates exporter failures; HTTP `api.request` spans use low-cardinality route templates; Agent provider health/planning spans, Agent tool-execution spans, debugging gateway detect/read/write/rollback spans, shared PostgreSQL `db.query` spans, object-store `put`/`get`/`checkHealth` spans, durable queue processor spans, and log-analysis job-processing spans are wired into runtime entrypoints through injectable boundaries. Database spans record statement type, parameter count, row count when available, status, and error type without exporting SQL text, table names, bound values, or raw error messages. Object-store spans record only operation and storage mode, without exporting bucket names, endpoints, storage keys, file names, credentials, object bytes, or raw failure messages. Queue and job spans record only low-cardinality queue, trigger, status, and error type attributes without exporting Redis URLs, queue prefixes, job IDs, run IDs, organization IDs, project IDs, storage keys, file names, or raw failure messages. Agent tool-execution spans record only bounded tool name, tool kind, approval requirement, status, and error type without exporting session IDs, tool call IDs, approval IDs, user input, payload, project IDs, result summaries, citations, or raw error messages.
  - Pending deep spans: none known at local code-boundary level; target-environment distributed tracing claims still require real target observability evidence.
- [x] Ensure trace export failures do not break business requests.
- [x] Run focused tests for disabled/enabled tracer configuration and error isolation.

### Task 5: Dashboards And Alerts

- [x] Add Prometheus scrape config for API, worker, PostgreSQL exporter if available, reverse proxy, and node exporter if included.
- [x] Add alert rules for API down, readiness not-ready, elevated 5xx, high latency, queue backlog, dead-letter presence, object-store probe failure, database unavailable, Agent provider readiness failure, and disk pressure.
- [x] Add Grafana dashboards as versioned JSON.
- [x] Link every alert to a runbook section.
- [x] Run `npm run observability:check`.

### Task 6: Runbooks And Verification

- [x] Update monitoring and incident runbooks.
- [x] Add a smoke step that verifies Prometheus can scrape WiseEff metrics.
- [x] Run `npm run observability:check`.
- [x] Run `npm run docs:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.

### Task 7: One-Command Self-Hosted Monitoring Stack

- [x] Add red tests for the operator CLI, Compose observability profile, provisioning files, loopback-only ports, and full service-target coverage.
- [x] Add Prometheus, Grafana, Alertmanager, blackbox exporter, Node exporter, PostgreSQL exporter, and Redis exporter to the self-hosted Compose profile.
- [x] Expose a private worker liveness/metrics listener so the dedicated worker is a real Prometheus target rather than a reserved placeholder.
- [x] Provision the Prometheus datasource and all versioned dashboards automatically, including an all-services/host dashboard.
- [x] Add `./scripts/observability up|down|restart|status|logs` with persistent monitoring volumes and no effect on application data volumes.
- [x] Bind Grafana, Prometheus, and Alertmanager to `127.0.0.1` by default and document SSH tunnelling; keep application `/metrics` private.
- [x] Update English and Chinese operator, reliability, environment-variable, and verification documentation.
- [x] Run focused tests, observability/self-hosted/docs checks, Compose rendering, build, `git diff --check`, and real Grafana browser verification when the local container runtime is available.

## Current Evidence Status

- Local code/config evidence exists for the metrics endpoint, structured telemetry helpers, observability config gate, Prometheus config, alert runbook links, dashboard JSON, runbooks, log-analysis terminal job duration/failure-reason counters, Agent provider call counters, device gateway operation counters, HTTP route-template spans, Agent provider spans, and debugging gateway spans.
- Fresh local verification on 2026-06-04 passed with `npm run docs:check`, `npm test -- --run scripts/check-observability-config.test.ts server/observability/logger.test.ts server/observability/metrics.test.ts server/observability/tracing.test.ts server/observability/correlation.test.ts server/shared/http/router.test.ts server/modules/agent/orchestrator.test.ts server/modules/agent/routes.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts server/app.test.ts`, `npm run observability:check`, `npm run test:all`, `npm run build`, and `git diff --check`.
- Later on 2026-06-04, `npm run observability:target-evidence` was added so target Prometheus scrape, Alertmanager routing, and Grafana dashboard import proof can be recorded separately from config-only evidence. `npm run observability:check` now writes `docs/generated/m6-observability-config-evidence.md`; `docs/generated/m6-observability-evidence.md` is reserved for target observability evidence and should remain failed/pending until the real target proofs are attached.
- Later on 2026-06-04, a local TDD slice added log-analysis worker terminal metrics for complete, retry, dead-lettered, and stale-failed paths. The shared registry exposes `wiseeff_log_analysis_job_duration_ms_sum/count` by stage/status and `wiseeff_log_analysis_job_failures_total` by reason/stage, with tests proving raw job IDs, run IDs, and error messages are not used as labels. Fresh verification passed with `npm test -- --run server/observability/metrics.test.ts server/modules/logs/worker.test.ts server/app.test.ts server/modules/logs/workerRunner.test.ts server/modules/logs/logAnalysisQueueRuntime.test.ts scripts/check-observability-config.test.ts`, `npm run observability:check`, `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, and `git diff --check`. This is local code/config evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- Later on 2026-06-04, a local TDD slice added Agent approval/tool/audit-failure metrics. The shared registry exposes `wiseeff_agent_approvals_total`, `wiseeff_agent_tool_results_total`, and `wiseeff_audit_write_failures_total` with low-cardinality labels. The Agent orchestrator records approval requested/approved/rejected and tool succeeded/failed/rejected only after terminal audit or transaction success; audit write failure is recorded when an audit write throws and the original error is rethrown. The security operations dashboard, metric allow-list, alert rule, and runbooks now recognize these signals. This is local code/config evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- On 2026-06-05, a local TDD slice added shared database tracing at the PostgreSQL boundary and wired it into the API and log worker entrypoints. Focused tests prove `db.query` spans are emitted for successful queries, failed queries, and transaction control/query calls with low-cardinality attributes only; SQL text, table names, bound values, and raw error messages are not exported as span attributes. This is local code evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- On 2026-06-05, a local TDD slice added object-store tracing at the runtime factory boundary and wired it into the API and log worker entrypoints. Focused tests prove `object_store.operation` spans are emitted for `put`, `get`, and `checkHealth` with low-cardinality operation/mode attributes only; bucket names, endpoints, storage keys, file names, credentials, object bytes, and raw failure messages are not exported as span attributes. This is local code evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- On 2026-06-05, a local TDD slice added durable queue processor spans and log-analysis job-processing spans. Focused tests prove `log_analysis.queue.process` and `log_analysis.job` spans are emitted for durable queue and polling/queue job execution with low-cardinality queue/trigger/status/error-type attributes only; Redis URLs, queue prefixes, job IDs, run IDs, log IDs, organization IDs, project IDs, storage keys, file names, and raw failure messages are not exported as span attributes. This is local code evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- On 2026-06-05, a local TDD slice added Agent per-tool execution spans. Focused tests prove `agent.tool.execute` spans are emitted for direct read tools and approval-time preparation tools with bounded tool/kind/requires-approval/status attributes only; session IDs, tool call IDs, approval IDs, project IDs, request IDs, payload values, result summaries, citations, and raw failure messages are not exported as span attributes. This is local code evidence only; it does not prove target Prometheus scrape, Alertmanager routing, or Grafana import.
- On 2026-06-05, `npm run observability:target-evidence` and the final `npm run m6:target-evidence` summary gate were tightened so target proof URLs for Prometheus, Alertmanager, and Grafana cannot point at `localhost`, `127.*`, `0.0.0.0`, or `::1`. Non-URL proof references such as redacted operator evidence paths or Prometheus query text remain valid. This prevents local dashboard or scrape links from being recorded as target observability proof.
- On 2026-08-21, the one-command self-hosted monitoring profile was verified locally with the repository-owned operator command. Prometheus 2.54.1 and Alertmanager 0.28.0 accepted their mounted configs (`promtool` found 15 valid rules; `amtool` found one local receiver), Grafana 11.3.1 automatically provisioned the Prometheus datasource and four WiseEff dashboards, and the service dashboard returned 12 blackbox probe series. The rendered Compose profile contained all 15 application and monitoring services and bound Grafana, Prometheus, and Alertmanager to loopback. Browser verification of `/d/wiseeff-services/wiseeff-services` passed at `1440x900`, `768x1024`, and `390x844`; refresh worked, no horizontal overflow or browser console errors were found, and screenshots were written under `work/ui-checks/`. Focused tests passed (52 script files / 488 tests with 5 skipped; 17 worker/metrics tests), `npm run test:all` passed (395 frontend files / 2,954 tests; 52 script files / 488 tests with 5 skipped; 21 bridge files / 138 tests; 346 server files passed with 2 skipped / 2,681 tests passed with 8 skipped), and `npm run selfhost:check`, `npm run observability:check`, Compose rendering, `npm run build`, and `git diff --check` passed. This is local implementation evidence, not target-environment evidence.
- Target-environment evidence is still pending: a real Prometheus instance has not scraped the deployed WiseEff API target, Alertmanager routing has not been exercised, and Grafana dashboard import/screenshots have not been captured.
- Because target-environment observability evidence is pending, keep this plan in `docs/exec-plans/active/` until M6.6 or a target self-hosted environment run records that evidence.

## External Inputs Needed

- Metrics exposure policy: private network, VPN, reverse-proxy allowlist, or mTLS.
- Alert destination: email, webhook, chat, or local-only dashboard.
- Log retention target and storage location.
- Whether Grafana/Prometheus run on the WiseEff host or a separate operations host.
- Incident escalation contacts and operating hours.

The one-command local stack does not wait for these inputs: it uses a local-only Alertmanager receiver and loopback-only UIs. External alert delivery and shared-network Grafana access remain explicit target-environment choices.

## Git & PR Workflow

- Feature branch: `feat/self-hosted-observability-stack`, created from local `main` aligned with `origin/main` at implementation start.
- The implementation remains on the feature branch for review. Opening or merging a GitHub PR is outside this user-requested local implementation unless separately requested.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/zh-CN/README.md` | Point operators to the one-command profile. |
| Planning docs | Update | This plan | Track and verify the one-command monitoring slice. |
| Product specs | No change | `docs/product-specs/` | No product workflow change expected. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/deployment-operations.md` | Existing observability topology remains valid; record the deployable profile only where runtime operations are described. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/zh-CN/developer/verification-matrix.md` | Add one-command stack and rendered Compose gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/zh-CN/RELIABILITY.md`, `docs/runbooks/observability-operations.md`, `docs/zh-CN/runbooks/observability-operations.md` | Document the local stack, access boundary, service coverage, and commands. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/data-classification.md`, `docs/security/audit-retention.md`, `docs/security/secrets-management.md` | No classification change; loopback-only UI ports preserve the existing private telemetry boundary. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | Update only if frontend telemetry is added. |
| Generated artifacts | Update | `docs/generated/m6-observability-config-evidence.md` | Refresh config-only evidence; do not treat it as target proof. |
| References | Review | `docs/references/` | Add compact observability reference if useful for agents. |
| Self-hosted operator docs | Update | `ops/self-hosted/README.md`, `ops/self-hosted/README.zh-CN.md` | Add the server-side one-command entry and local UI access. |
| Environment variables | Update | `ops/self-hosted/.env.example`, `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md` | Document local UI ports, retention, and worker metrics listener. |
| Chinese developer docs | Update | `docs/zh-CN/README.md`, `docs/zh-CN/RELIABILITY.md`, `docs/zh-CN/root/ARCHITECTURE.md`, paired developer and runbook files | Keep operator commands, access boundary, environment variables, and verification guidance aligned with English docs. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Every production alert must link to an actionable runbook.
- Telemetry docs must explicitly state what data is safe or unsafe to log.
- If metrics are exposed without access controls, the plan must remain blocked.

## UI Interaction Automation Review

M6.5 should not change product UI interaction behavior.

- Affected acceptance specs: none expected for product UI.
- Acceptance requirement IDs: `SHELL-DIAG-001` may catch new console/API failures if frontend telemetry is added.
- Operation IDs: none expected.
- Required action: If frontend telemetry changes route loading, error handling, or visible banners, update the relevant acceptance coverage and run `npm run acceptance:browser`.
