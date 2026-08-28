# Audit Retention

> Chinese: [Chinese](../zh-CN/security/audit-retention.md)

Audit records are product evidence. Missing audit is a product failure for production writes.

## Current Audit Coverage

- Parameter submits, review advance/reject, merge, and import.
- Log upload, upload failed, rerun, archive, unarchive, and feedback.
- Debugging target detection, session creation, node read/write, and snapshot rollback.
- Agent session, tool requested, approval requested, approval executed/rejected, and tool failure.
- User governance create, permanent delete, profile update, activation/deactivation, and role replacement. Delete audit retains the opaque target id and non-secret lifecycle facts, not deleted-user PII or credential material.

## Retention Guidance

`log_webhook_deliveries` is audit-adjacent operational history, not the immutable `audit_events` product-evidence log. It is intentionally bounded per organization-scoped log domain: the active log worker keeps the latest 10,000 attempts by stable `created_at DESC, id DESC` order, in batches of 1,000 (at most 10 batches every 60 seconds). Cleanup is fail-open for webhook delivery and logs only deleted count/duration or a redacted failure code. `LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED=false` stops future deletion; already-pruned rows are recoverable only through the normal database backup/restore path.

For controlled pilot:

- keep audit events for the full pilot period plus the agreed review window,
- keep request ids and trace ids with each event,
- keep high-risk write audit evidence with enough metadata to reconstruct action, actor, scope, and result,
- keep backup/restore drill summaries with enough metadata to reconstruct provider, target environment, isolated restore targets, validation commands, and outcome,
- avoid storing raw secrets or unnecessary customer payloads in audit metadata.

## Query Expectations

Operators should be able to investigate by:

- actor,
- project or organization,
- request id,
- business target id,
- tool call id,
- session id,
- snapshot id,
- time range.

## Gaps Before Broad Production

- formal retention period and legal hold policy,
- immutable audit store or append-only export,
- scheduled audit export,
- admin-facing audit review workflow,
- target-environment audit write failure evidence. M6.5 now emits Agent audit write failure counters and includes a dashboard/alert rule, but target Prometheus scrape and Alertmanager routing proof are still required before treating the signal as production-verified.
