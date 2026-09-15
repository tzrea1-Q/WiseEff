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

## Missing DTS writeback node index

`parameter-sensitive-node-identity-mismatch` during a typed edit can indicate a historical writeback version with no `dts_nodes`, even though its config revision has semantic node occurrences. New binding/enablement drafts and merge writebacks now index each generated version in the same transaction. Existing versions require an explicit repair; deployment alone does not backfill them.

Use [repair-dts-structural-index.ts](../../scripts/repair-dts-structural-index.ts) inside the updated API container, whose environment already supplies `DATABASE_URL`. Supply the project, file, exact failing version, recorded SHA-256, and complete node locator from the incident evidence:

```bash
node --import tsx scripts/repair-dts-structural-index.ts \
  PROJECT FILE VERSION SHA256 '/complete/node/path'
# After inspecting ready-dry-run, repeat the same command with --apply.
```

The default is a read-only dry run. Apply locks the exact version, verifies embedded source bytes against the recorded checksum and size, and reconstructs only an entirely absent structural index. It leaves source bytes, versions, current pointers, semantic revisions, values, and drafts unchanged. A transactional System-job audit (`dts-structural-index-repaired`) records the checksum and counts; audit failure rolls back the index. Keep the returned trace ID with the operator's incident record.

`skipped-existing-index` means no rows were changed; it does **not** prove an existing partial or ambiguous index is healthy. Unsupported include/delete semantics, missing source, checksum mismatch, or an absent/ambiguous requested node stop recovery. Do not fall back to a newer version or disable the identity guard. After `repaired`, rerun the exact-version diagnostic and retry the original edit. Only target-server evidence closes the incident.

## Typed edits blocked by unchanged unmatched properties

`CONFLICT` with reason `unmatched-occurrence` can occur when the locked baseline already contains unrelated unmatched properties. Typed binding/enablement drafts and merge writebacks retain these only when both revisions have unique open unmatched review evidence and the complete ordered property source chain is unchanged, including file ownership, member precedence, node identity, compatible, and raw property text. Reviews remain open; general baseline validation still counts them. Newly unmatched or changed properties, ambiguous matches, incomplete evidence, and project/platform blockers still block the candidate.

Deploy the updated API and retry the original edit. This change needs no data migration or review-task cleanup. If it still fails, capture the exact reason and compare review evidence against the locked baseline; do not dismiss reviews or disable gates to force the edit through. Local fixture tests do not establish target-server recovery.

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
