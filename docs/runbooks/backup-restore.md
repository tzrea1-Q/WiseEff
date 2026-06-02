# Backup And Restore Runbook

Backup and restore evidence is required before calling a pilot environment ready.

M6.6 also requires a pre-release backup before deploying a self-hosted release candidate. Link the backup artifact and restore rehearsal from [release-rollback.md](release-rollback.md) and the release record in `ops/self-hosted/releases/`.

## Backup Scope

- PostgreSQL database.
- Object storage objects for uploaded logs and exported artifacts.
- Deployment configuration needed to recreate the environment.
- Evidence artifacts such as smoke output and readiness JSON.

## Drill Procedure

1. Announce the drill window.
2. Stop or pause non-essential writes if the environment requires it.
3. Take a database backup.
4. Capture object-storage state or snapshot according to the provider.
5. Restore into a clean target environment.
6. Start API and worker against the restored state.
7. Run:

```bash
npm run smoke:m5
```

8. Confirm `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness` behave as expected.
9. Record the drill timestamp in `M5_BACKUP_RESTORE_DRILL_AT` only after the drill passes.
10. Update [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md).
11. For M6.6 releases, link the same backup and restore evidence from [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or the approved external release evidence record.

## Acceptance

- Restored database contains expected organizations, projects, audit events, parameters, logs, debugging records, and Agent records.
- Restored object storage contains log files needed by existing log records.
- API readiness gives actionable dependency status.
- Smoke checks run against the restored environment.

## Failure Handling

If restore fails, keep the evidence honest:

- Do not set `M5_BACKUP_RESTORE_DRILL_AT`.
- Record the failed step and error.
- Add or update a technical debt item if the fix is not immediate.
- Do not mark the M6.6 release gate complete; rollback and capacity gates cannot compensate for missing restore evidence.
