# Observability Operations Runbook

This runbook covers the M6.5 self-hosted observability slice: Prometheus scrape configuration, alert rules, Grafana dashboards, and first-response procedures for WiseEff operations signals.

## Scope

- Config lives under `ops/self-hosted/observability/`.
- Prometheus scrapes the WiseEff API metrics endpoint at `api:8787/metrics` from the private compose network.
- Optional PostgreSQL, Caddy, and host metrics require exporter services on the same private network.
- Grafana dashboards are versioned JSON files under `ops/self-hosted/observability/grafana/dashboards/`.
- The WiseEff API exposes `/metrics` as Prometheus text and refreshes dependency, readiness, and worker queue gauges before rendering the scrape response.
- Log-analysis worker terminal metrics include duration samples by stage/status and failure counters by low-cardinality reason/stage. They intentionally omit job IDs, run IDs, raw uploaded content, and raw error messages.
- Business-path counters currently include Agent provider calls, Agent approval decisions, Agent tool terminal results, Agent audit write failures, and device gateway operations for detect, read, write, and rollback actions.
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
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json` | Service health, traffic, latency, and dependency readiness. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json` | Log-analysis queue, worker, retry, and duration views. |
| `ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json` | Audit, Agent, and device-gateway operations views. |

## Install

1. Put Prometheus on the same private network as the WiseEff API service.
2. Mount `ops/self-hosted/observability/prometheus.yml` as the Prometheus config file.
3. Mount `ops/self-hosted/observability/alerts.yml` next to it as `alerts.yml`.
4. Import the three Grafana dashboards and bind their datasource variable to the Prometheus datasource.
5. Confirm `/metrics` is not reachable from the public internet.

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
5. Use `wiseeff_agent_provider_calls_total`, `wiseeff_agent_approvals_total`, `wiseeff_agent_tool_results_total`, `wiseeff_audit_write_failures_total`, and `wiseeff_device_gateway_operations_total` as supporting signals; they do not replace audit records, approval records, or device-lab evidence.

## Alert Response

### WiseEffApiDown

1. Check Prometheus target details for `wiseeff-api`.
2. From the Prometheus network, run `wget -qO- http://api:8787/health/live`.
3. If health is down, check the API container/process logs and restart the API only after preserving the failure output.
4. If health is up but scrape is down, verify `/metrics` routing and private-network DNS.

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

### WiseEffAgentProviderFailure

1. Check provider health and `AGENT_API_BASE_URL`.
2. Capture provider mode, model, timeout, readiness message, and request ID.
3. If the provider is unavailable during high-risk operations, pause Agent-assisted writes.

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
