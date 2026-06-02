# WiseEff M6.5 Observability And Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

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
- Log-analysis jobs expose job ID, queue ID, run ID, retry count, and failure reason in logs/metrics.
- Agent and device high-risk operations expose approval ID, session ID, target ID, and audit ID.
- Prometheus can scrape WiseEff metrics.
- Grafana dashboards load from versioned local files.
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
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json`
- `ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json`
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

- [ ] Write failing tests in `scripts/check-observability-config.test.ts`.
- [ ] Require Prometheus config, alert rules, at least three Grafana dashboards, and runbook links.
- [ ] Require package scripts for observability config validation.
- [ ] Require no secrets in dashboard/config files.
- [ ] Run `npm test -- scripts/check-observability-config.test.ts` and confirm expected failure.

### Task 2: Structured Logs And Correlation

- [ ] Write failing unit tests for request ID, trace ID, audit ID, job ID, and operation ID propagation.
- [ ] Implement structured JSON logging helpers.
- [ ] Ensure error responses include request IDs without leaking secrets.
- [ ] Ensure audit writes can include correlation metadata.
- [ ] Run focused server tests for observability and audit modules.

### Task 3: Metrics Endpoint

- [ ] Write failing tests for metrics registration and redaction.
- [ ] Add process, HTTP, database, object-store, queue, worker, Agent, and device metrics.
- [ ] Add `/metrics` with production access guidance, such as private network only or reverse-proxy allowlist.
- [ ] Add readiness checks that verify metrics registration does not break health endpoints.
- [ ] Run focused metrics tests.

### Task 4: OpenTelemetry Tracing

- [ ] Add tracing setup that can be disabled in local tests and enabled in self-hosted runtime.
- [ ] Instrument API routes, database calls, queue processing, object-store probes, Agent provider calls, and device gateway calls where the interfaces already provide clean boundaries.
- [ ] Ensure trace export failures do not break business requests.
- [ ] Run focused tests for disabled/enabled tracer configuration and error isolation.

### Task 5: Dashboards And Alerts

- [ ] Add Prometheus scrape config for API, worker, Redis, PostgreSQL exporter if available, reverse proxy, and node exporter if included.
- [ ] Add alert rules for API down, readiness blocked, elevated 5xx, high latency, queue backlog, dead-letter growth, object-store probe failure, database unavailable, Agent provider failure, and disk pressure.
- [ ] Add Grafana dashboards as versioned JSON.
- [ ] Link every alert to a runbook section.
- [ ] Run `npm run observability:check`.

### Task 6: Runbooks And Verification

- [ ] Update monitoring and incident runbooks.
- [ ] Add a smoke step that verifies Prometheus can scrape WiseEff metrics.
- [ ] Run `npm run observability:check`.
- [ ] Run `npm run docs:check`.
- [ ] Run `npm run test:all`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.

## External Inputs Needed

- Metrics exposure policy: private network, VPN, reverse-proxy allowlist, or mTLS.
- Alert destination: email, webhook, chat, or local-only dashboard.
- Log retention target and storage location.
- Whether Grafana/Prometheus run on the WiseEff host or a separate operations host.
- Incident escalation contacts and operating hours.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add observability and incident runbooks. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan | Track M6.5 observability phase. |
| Product specs | No change | `docs/product-specs/` | No product workflow change expected. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/deployment-operations.md` | Document telemetry paths and correlation IDs. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add observability config and smoke gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/monitoring-alerting.md`, `docs/runbooks/observability-operations.md`, `docs/runbooks/incidents.md` | Core M6.5 scope. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/data-classification.md`, `docs/security/audit-retention.md`, `docs/security/secrets-management.md` | Logs/metrics/traces may contain sensitive metadata. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | Update only if frontend telemetry is added. |
| Generated artifacts | Review | `docs/generated/` | Generated evidence only if observability smoke writes a report. |
| References | Review | `docs/references/` | Add compact observability reference if useful for agents. |
| Chinese developer docs | Update | `docs/zh-CN/security-reliability.md`, `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/quality-and-plans.md` | Observability commands and runbooks are developer-facing. |

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
