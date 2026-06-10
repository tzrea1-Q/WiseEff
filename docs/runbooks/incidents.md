# Incident Runbook

> Chinese: [Chinese](../zh-CN/runbooks/incidents.md)

Use this runbook when an alert or operator observation indicates degraded WiseEff pilot or staging operation.

## Severity

| Severity | Examples | Response |
| --- | --- | --- |
| Critical | API down, readiness blocked, audit write failure, database unavailable, rollback failure, high-risk device write failure | Page the operator, pause risky writes, preserve evidence, and decide rollback or restore. |
| Warning | Elevated 5xx, high latency, queue backlog, Agent fallback spike, disk pressure | Triage within the operating window and escalate if the condition persists or affects pilot workflows. |
| Informational | Single transient scrape miss, brief provider latency, non-HDC device gateway blocked in staging | Record if it affects readiness evidence; no page unless repeated. |

## First Ten Minutes

1. Name the incident with date, environment, and primary symptom.
2. Capture the alert, dashboard time range, and Prometheus query result.
3. Capture request ID, job ID, audit ID, Agent session ID, approval ID, debugging session ID, device ID, or target ID when present.
4. Check `https://<host>/health/live` and `https://<host>/health/ready`.
5. Decide whether to pause writes, pause uploads, pause Agent-assisted actions, or pause device writes.

## Evidence

Collect only the minimum evidence needed for diagnosis and audit:

- Alert name, severity, start time, end time, and runbook URL.
- Readiness JSON and dependency detail.
- Relevant logs with secrets and payloads redacted.
- Dashboard screenshot or exported panel data.
- Operator actions, timestamps, and results.

Never paste bearer tokens, provider keys, raw uploaded logs, raw parameter values, or raw device payloads into incident notes.

## Handoff

When escalating, include:

- Current customer or pilot impact.
- Whether writes are paused.
- Last known good deploy or config change.
- Failed dependency and exact error text.
- Links to dashboard snapshots and runbook sections.
- Proposed next action: continue triage, rollback, restore, or wait for external provider recovery.

## Closure

An incident can close only after:

- The alert has resolved or is explicitly accepted as a known degraded state.
- `/health/ready` matches the intended environment state.
- Any paused writes/uploads/actions are either resumed or tracked as blocked.
- Evidence is attached to the target-environment record when readiness or pilot status was affected.
- Follow-up work is filed for missing metrics, noisy alerts, unclear docs, or manual-only recovery steps.
