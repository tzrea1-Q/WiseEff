# Backup And Restore Runbook

Backup and restore evidence is required before calling a pilot environment ready.

## Backup Scope

- PostgreSQL database.
- Object storage objects for uploaded logs and exported artifacts.
- Redis persistence for BullMQ queue metadata when `LOG_ANALYSIS_QUEUE_MODE=durable`.
- Deployment configuration needed to recreate the environment.
- Evidence artifacts such as smoke output and readiness JSON.

## Drill Procedure

1. Announce the drill window.
2. Stop or pause non-essential writes if the environment requires it.
3. Take a database backup.
4. Capture object-storage state or snapshot according to the provider.
5. Capture Redis persistence state or snapshot when durable queue mode is enabled.
6. Restore into a clean target environment.
7. Start API and worker against the restored state.
8. Run:

```bash
npm run smoke:m5
```

9. When durable queue mode is enabled, also run:

```bash
npm run queue:check -- --base-url https://<host>
```

10. Confirm `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness` behave as expected.
11. Record the drill timestamp in `M5_BACKUP_RESTORE_DRILL_AT` only after the drill passes.
12. Update [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md).

## Acceptance

- Restored database contains expected organizations, projects, audit events, parameters, logs, debugging records, and Agent records.
- Restored object storage contains log files needed by existing log records.
- Restored Redis or queue persistence is either validated through `queue:check` or explicitly recorded as not applicable for polling mode.
- API readiness gives actionable dependency status.
- Smoke checks run against the restored environment.

## Failure Handling

If restore fails, keep the evidence honest:

- Do not set `M5_BACKUP_RESTORE_DRILL_AT`.
- Record the failed step and error.
- Add or update a technical debt item if the fix is not immediate.
