# Monitoring And Alerting Runbook

This runbook defines the minimum signals needed for controlled staging and pilot operation.

## Required Signals

| Area | Signal |
| --- | --- |
| API | request count, latency, error rate, request id |
| Readiness | `/health/live`, `/health/ready`, pilot-readiness status |
| Database | connection errors, slow queries, migration failures |
| Worker | queued/running/failed/dead-letter counts, lease churn |
| Object storage | readiness probe failures, write/read/delete failures |
| Logs | analysis duration, failed unsupported formats, rerun counts |
| Device gateway | timeout, stderr, offline, readback mismatch, rollback failure |
| Agent provider | health status, fallback reason, latency, token usage, estimated cost, safety status |
| Audit | missing audit event for production writes |
| Release capacity | p95 latency, error rate, throughput, CPU, memory, database connections, queue backlog, object-store probe |

## Alerts

Page or immediately escalate:

- repeated `/health/ready` failures,
- `pilot_readiness.status=blocked` after a previous ready state,
- audit write failure,
- device write failure on high-risk operation,
- rollback failure,
- object-store health failure,
- worker dead-letter growth,
- provider unsafe response or unexpected fallback spike.
- release-window capacity threshold breach,
- target synthetic acceptance failure after deployment.

## First Triage

1. Capture request id, session id, job id, tool call id, snapshot id, or audit id.
2. Check `/health/ready`.
3. Check the module-specific records:
   - parameters: change request and audit event,
   - logs: log record, run, job, object key,
   - debugging: session, node operation, snapshot, audit event,
   - Agent: session, message, tool call, approval, trace.
4. Decide whether to continue, pause writes, or trigger rollback.
5. During M6.6 releases, compare the incident signal with the release record and [release-rollback.md](release-rollback.md) rollback decision points.

## Evidence

Attach alert snapshots, readiness JSON, and command output to the environment acceptance artifact when they affect pilot readiness. For M6.6 release windows, also attach capacity and observability snapshots to [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or the external release evidence record.
