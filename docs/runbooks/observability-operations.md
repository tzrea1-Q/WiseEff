# Observability Operations Runbook

> Chinese: [Chinese](../zh-CN/runbooks/observability-operations.md)

This runbook covers the M6.5 self-hosted observability slice: Prometheus scrape configuration, alert rules, Grafana dashboards, and first-response procedures for WiseEff operations signals.

## Scope

- Config lives under `ops/self-hosted/observability/`.
- Prometheus scrapes the WiseEff API metrics endpoint at `api:8787/metrics` from the private compose network.
- The self-hosted Compose `observability` profile runs Prometheus, Grafana, Alertmanager, blackbox exporter, Node exporter, PostgreSQL exporter, and Redis exporter without exposing them through Caddy.
- The built-in profile provides PostgreSQL, Redis, and host exporters; Caddy/proxy availability is checked through a private blackbox probe.
- Grafana dashboards are versioned JSON files under `ops/self-hosted/observability/grafana/dashboards/`.
- The WiseEff API exposes `/metrics` as Prometheus text and refreshes dependency, readiness, and worker queue gauges before rendering the scrape response.
- Log-analysis worker terminal metrics include duration samples by stage/status and failure counters by low-cardinality reason/stage. They intentionally omit job IDs, run IDs, raw uploaded content, and raw error messages.
- Business-path counters currently include Agent provider calls, Agent approval decisions, Agent tool terminal results, Agent audit write failures, device gateway operations, DTS parse/schema/compile results, config publish outcomes (including bypass), and parameter-identity migration/cutover gauges refreshed on each `/metrics` scrape.
- Alerts also cover DTS toolchain unavailability, persistent identity mapping backlog, and production publish validation bypass; first response for those alerts is [parameter-identity-cutover.md](parameter-identity-cutover.md).
- Baseline trace spans currently include HTTP `api.request` spans with route templates, Agent provider health/planning spans, and debugging gateway detect/read/write/rollback spans. They intentionally avoid raw prompts, uploaded content, device values, target refs, and concrete entity IDs.
- `npm run observability:check` validates required scrape config, alert runbook links, dashboard JSON, package scripts, and obvious secret leakage in observability files. It writes config-only evidence to `docs/generated/m6-observability-config-evidence.md`.
- `npm run observability:target-evidence` writes target-environment evidence to `docs/generated/m6-observability-evidence.md`.

## Metrics Exposure Policy

`/metrics` must be treated as internal operations data. It can reveal route names, dependency status, job counts, failure reasons, provider state, and high-risk operation metadata.

Production and pilot deployments must use one of these patterns:

- Private-network scrape only: Prometheus runs in the same private compose or operations network and scrapes `api:8787/metrics` directly.
- Reverse-proxy allowlist: if `/metrics` is exposed through Caddy or another proxy, restrict it to fixed operations IP ranges or VPN CIDRs.
- Equivalent stronger control: mTLS or a private service mesh is acceptable when documented in the target deployment record.

Do not expose `/metrics` to the public internet. Do not include authorization headers, bearer tokens, API keys, raw uploaded log content, raw parameter values, or raw device write payloads in metric labels.

Trace exporters must follow the same rule. Route templates, provider/model identifiers, gateway action, mode, and status are acceptable. Raw prompts, assistant drafts, tool payloads, node paths, target refs, requested/previous/readback values, stdout/stderr, bearer tokens, and concrete user/session/device/snapshot IDs are not acceptable trace attributes.

## Files

| File | Purpose |
| --- | --- |
| `ops/self-hosted/observability/prometheus.yml` | Prometheus scrape and rule-file configuration. |
| `ops/self-hosted/observability/alerts.yml` | WiseEff alert rules with `runbook_url` annotations. |
| `ops/self-hosted/observability/alertmanager.yml` | Local dashboard receiver and alert grouping defaults. |
| `ops/self-hosted/observability/blackbox.yml` | HTTP and TCP service probes. |
| `ops/self-hosted/observability/grafana/provisioning/` | Automatic Prometheus datasource and dashboard provisioning. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json` | Service health, traffic, latency, and dependency readiness. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json` | Log-analysis queue, worker, retry, and duration views. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json` | Audit, Agent, and device-gateway operations views. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-services.json` | API, worker, web, proxy, data services, monitoring targets, and host resources. |

## One-Command Self-Hosted Start

Start the application stack first. Then, from `ops/self-hosted/` on the server:

```bash
./scripts/observability up
./scripts/observability status
```

The command provisions the Prometheus datasource and all four WiseEff dashboards automatically. It preserves Prometheus, Grafana, and Alertmanager state in named volumes. The other lifecycle commands affect only monitoring services:

```bash
./scripts/observability logs -f
./scripts/observability restart
./scripts/observability down
```

`down` stops the monitoring services without stopping WiseEff or deleting monitoring/application volumes.

Grafana, Prometheus, and Alertmanager bind to the server loopback interface. From an operator workstation, open an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

Then open `http://127.0.0.1:3000` locally. Grafana runs as an anonymous read-only viewer because the listener is loopback-only; it does not create a default administrator account. Prometheus is available on loopback port `9090` and Alertmanager on `9093` for diagnosis. Override local ports with `WISEEFF_GRAFANA_PORT`, `WISEEFF_PROMETHEUS_PORT`, or `WISEEFF_ALERTMANAGER_PORT`. `WISEEFF_PROMETHEUS_RETENTION` defaults to `15d`.

The built-in Alertmanager receiver keeps alerts visible in the local Alertmanager UI but deliberately sends no email, webhook, or chat notification. A target deployment must configure and exercise an approved receiver before marking Alertmanager routing evidence passed.

The service dashboard combines blackbox probes for API, worker, web, proxy, MinIO, PostgreSQL, Redis, and the monitoring components with scrape-target state and host CPU, memory, and filesystem metrics. The dedicated worker exposes `/health/live` and `/metrics` on private compose port `8788`.

## Separate Operations Host

When Prometheus and Grafana run on a separate operations host instead of the built-in profile:

1. Put Prometheus on an approved private network that can reach the WiseEff API service.
2. Mount `ops/self-hosted/observability/prometheus.yml` and `alerts.yml` into Prometheus.
3. Provision or import the datasource and dashboards from `ops/self-hosted/observability/grafana/`.
4. Replace compose-only target names with approved private addresses where required.
5. Confirm `/metrics` and monitoring UIs are not reachable from the public internet.

## Smoke Check

From the Prometheus host or container:

```bash
wget -qO- http://api:8787/metrics | head
```

From Prometheus:

```promql
up{job="wiseeff-api"}
```

Expected result: the query returns `1` for the WiseEff API target. If it returns `0`, follow [WiseEffApiDown](#wiseeffapidown).

For the built-in stack, also verify that service probes are present:

```promql
max by (service) (probe_success{job=~"wiseeff-service-(http|tcp)"})
```

Every expected service should return `1`. A missing series is a configuration defect; a `0` is a live probe failure.

## Dashboard Review

During staging or pilot readiness, capture screenshots or exports for:

- WiseEff Overview: API scrape status, readiness, request rate, latency, dependency readiness.
- WiseEff Jobs: queued jobs, processing jobs, dead-letter count, backlog by queue, and oldest queued age.
- WiseEff Security Operations: readiness not-ready, Agent provider readiness, Agent approval decisions, Agent tool terminal results, Agent audit write failures, Agent/debugging route request rates, and high-risk route error rates.

Attach relevant screenshots to the target-environment evidence record when they affect readiness.

## Target Evidence Recording

`npm run observability:check` validates local configuration, dashboard JSON, alert links, and secret hygiene. It writes config-only evidence to `docs/generated/m6-observability-config-evidence.md` and must not be treated as target readiness. Target readiness additionally requires a target-environment evidence record at `docs/generated/m6-observability-evidence.md` or an approved external record referenced by the release evidence.

For `npm run m6:target-evidence` to accept M6.5, the target record must include these redacted result lines after the target has been exercised:

```markdown
- Status: `passed`
- Prometheus target scrape: `passed`
- Alertmanager routing: `passed`
- Grafana dashboard import: `passed`
```

Do not write those lines as `passed` from static config review alone. They require:

- Prometheus `up{job="wiseeff-api"}` equals `1` for the deployed target.
- An Alertmanager route exercise or approved alert-routing proof reaches the configured receiver.
- The Grafana dashboard import is visible in the target Grafana instance, with dashboard export or screenshot evidence attached to the release record.

Use the target evidence writer after collecting those proofs:

```bash
npm run observability:check
npm run observability:target-evidence -- --target-environment <label> --config-status passed --prometheus-target-scrape passed --alertmanager-routing passed --grafana-dashboard-import passed --prometheus-query 'up{job="wiseeff-api"} == 1' --alert-route-evidence <path-or-record> --grafana-evidence <path-or-record>
```

If any target proof is not available, keep the matching status as `pending` or `failed`. The generated `docs/generated/m6-observability-evidence.md` should then remain failed and `npm run m6:target-evidence` must continue to block M6.5 completion.

## Job And Worker Triage

1. Check `WiseEff Jobs` for queued, running, failed, retrying, and dead-letter signals.
2. Capture job ID, run ID, log record ID, lease owner, retry count, and failure reason from logs or database records.
3. If backlog is growing but no worker is active, restart only the worker service after preserving logs.
4. If dead-letter count increases, pause new log-analysis intake until the failure reason is understood.
5. Record whether the failure is parser, object-store, database, worker lease, or unsupported-format related.

## Security And High-Risk Operations

1. Treat audit write failures, high-risk device failures, rollback failures, unsafe Agent responses, and unexpected provider fallback as pilot-impacting.
2. Capture request ID, audit ID, Agent session ID, tool call ID, approval ID, debugging session ID, device ID, and target ID when present.
3. Redact user tokens, provider keys, raw log contents, raw parameter values, and raw device payloads from shared evidence.
4. Pause high-risk writes if audit or rollback evidence is missing.
5. Use `wiseeff_xiaoze_llm_ready`, `wiseeff_agent_approvals_total`, `wiseeff_agent_tool_results_total`, `wiseeff_audit_write_failures_total`, and `wiseeff_device_gateway_operations_total` as supporting signals; they do not replace audit records, approval records, or device-lab evidence.

## Alert Response

### WiseEffApiDown

1. Check Prometheus target details for `wiseeff-api`.
2. From the Prometheus network, run `wget -qO- http://api:8787/health/live`.
3. If health is down, check the API container/process logs and restart the API only after preserving the failure output.
4. If health is up but scrape is down, verify `/metrics` routing and private-network DNS.

### WiseEffServiceProbeDown

1. Open the `WiseEff Services` dashboard and identify the `service` label reporting `DOWN`.
2. Compare its blackbox `probe_success` result with the matching Compose service state from `./scripts/compose --env-file .env ps -a`.
3. Probe the target from the Prometheus or blackbox container network; distinguish DNS/network failure from an application health failure.
4. Preserve the matching service logs before restarting only the affected service.

### WiseEffReadinessBlocked

1. Run `curl -fsS https://<host>/health/ready`.
2. Record the dependency reason from the readiness JSON.
3. Route to database, object store, Agent provider, worker, or device gateway triage based on the blocked dependency.
4. Do not mark pilot readiness green until the readiness endpoint and dashboard agree.

### WiseEffElevatedHttp5xx

1. Check request logs for top failing routes and request IDs.
2. Compare 5xx spikes with deploys, migrations, provider outages, object-store failures, and database failures.
3. If writes are failing, decide whether to pause writes or start rollback according to the rollback runbook.

### WiseEffHighApiLatency

1. Identify the slow route from the dashboard legend.
2. Check database, object-store, provider, and device-gateway latency around the same time window.
3. If latency affects parameter review, log analysis, debugging, or Agent actions, record the affected workflow and user-visible symptom.

### WiseEffQueueBacklogHigh

1. Check whether the worker service is running and claiming jobs.
2. Compare queued jobs with completion rate and job duration P95.
3. If object-store or database readiness is degraded, fix that dependency before adding worker capacity.
4. Pause bulk uploads if backlog continues to grow.

### WiseEffDeadLetterGrowth

1. Capture job ID, run ID, retry count, stage, and failure reason.
2. Confirm whether the failure is deterministic by rerun only after preserving the first failure evidence.
3. If multiple jobs dead-letter for the same reason, pause log-analysis intake and open an incident.

### WiseEffObjectStoreProbeFailure

1. Check `/health/ready` object-store detail.
2. Verify bucket, endpoint, credentials, network path, and write/read/delete permissions.
3. Pause log uploads until readiness is restored.

### WiseEffDatabaseUnavailable

1. Check PostgreSQL health, connection count, disk space, and recent migrations.
2. Verify `DATABASE_URL` and network routing from the API service.
3. If migrations just ran, preserve migration output and follow rollback or restore guidance as needed.

### WiseEffXiaozeLlmFailure

1. Check Xiaoze LLM health through `/health/ready` and confirm `AGENT_API_BASE_URL`, `AGENT_MODEL`, and `AGENT_API_KEY` when not running with `XIAOZE_DETERMINISTIC=true`.
2. Capture model id, timeout, readiness message, and request ID from `/health/ready` or pilot-readiness details.
3. For offline acceptance, set `XIAOZE_DETERMINISTIC=true` and rerun `npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts`.
4. Compare `/metrics` with readiness JSON. `wiseeff_xiaoze_llm_ready` should reflect Xiaoze LLM readiness.
5. If the LLM is unavailable during high-risk operations, pause Agent-assisted writes.

### WiseEffAuditWriteFailure

1. Treat the affected write as not fully trustworthy until the missing audit evidence is explained.
2. Capture the request ID, event kind, action, target type, affected Agent session, tool call, approval, and user.
3. Check database connectivity, audit table writes, transaction rollback behavior, and recent deployments.
4. Pause high-risk Agent or device writes if audit writes continue to fail.
5. Do not reconstruct audit rows manually without preserving the original failure evidence and operator decision record.

## Pending Deep Instrumentation

The M6.5 baseline intentionally avoids pretending that every high-risk business operation already emits a dedicated counter. These signals require follow-up service instrumentation before they become hard alerts:

- Per-tool execution spans.
- Database, object-store, queue-processing, and per-job spans.
- Fine-grained device gateway failure categories beyond operation/action/status labels, such as timeout, offline, stderr category, and target identity.
- Target Prometheus scrape and Grafana proof for per-job terminal duration, failure-reason, Agent approval/tool-result, and audit write failure metrics.

### WiseEffHostDiskPressure

1. Identify the mount with low free space.
2. Check PostgreSQL, object-store, Caddy, Prometheus, Grafana, and log directories.
3. Preserve incident evidence before deleting or rotating files.
4. If database or object-store disk is affected, prepare backup/restore or rollback procedures.
