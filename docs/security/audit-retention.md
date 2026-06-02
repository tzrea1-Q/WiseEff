# Audit Retention

Audit records are product evidence. Missing audit is a product failure for production writes.

## Current Audit Coverage

- Parameter submits, review advance/reject, merge, and import.
- Log upload, upload failed, rerun, archive, unarchive, and feedback.
- Debugging target detection, session creation, node read/write, and snapshot rollback.
- Agent session, tool requested, approval requested, approval executed/rejected, and tool failure.

## Retention Guidance

For controlled pilot:

- keep audit events for the full pilot period plus the agreed review window,
- keep request ids and trace ids with each event,
- keep high-risk write audit evidence with enough metadata to reconstruct action, actor, scope, and result,
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
- dedicated audit write failure metrics and alerts. M6.5 dashboards currently use readiness and HTTP error signals; audit-specific counters require deeper service instrumentation.
