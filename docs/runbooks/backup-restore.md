# Backup And Restore Runbook

Backup and restore evidence is required before calling a pilot or self-hosted target environment ready.

M6.3 standardizes WiseEff backup evidence around PostgreSQL plus S3-compatible object storage. M6.4 adds Redis/BullMQ queue persistence checks: queue backup is conditional only when durable queue mode is not enabled. When `LOG_ANALYSIS_QUEUE_MODE=durable`, target evidence must capture Redis or BullMQ-equivalent persistence metadata.

M6.6 also requires a pre-release backup before deploying a self-hosted release candidate. Link the backup artifact and restore rehearsal from [release-rollback.md](release-rollback.md) and the release record in `ops/self-hosted/releases/`.

## Backup Scope

- PostgreSQL database.
- S3-compatible object storage objects for uploaded logs and generated artifacts.
- Redis persistence for BullMQ queue metadata when `LOG_ANALYSIS_QUEUE_MODE=durable`.
- Deployment configuration needed to recreate the environment.
- Evidence artifacts such as smoke output, readiness JSON, and generated drill reports.

## Required Targets

Use separate live, backup, and restore targets.

| Target | Rule |
| --- | --- |
| Live database | The normal `DATABASE_URL` used by API and worker. |
| Backup database target | `BACKUP_DATABASE_TARGET`, usually a mounted file path such as `file:///var/backups/wiseeff/postgres/wiseeff.dump`. |
| Restore database | `RESTORE_DATABASE_URL`, an isolated database that is never equal to `DATABASE_URL`. |
| Live object store | `OBJECT_STORAGE_BUCKET` plus the live prefix used by WiseEff. |
| Backup object target | `BACKUP_OBJECT_STORAGE_TARGET`, usually a filesystem export or isolated backup bucket/prefix. |
| Restore object target | `RESTORE_OBJECT_STORAGE_BUCKET` plus `RESTORE_OBJECT_STORAGE_PREFIX`; both must be isolated from the live bucket/prefix. |

The restore drill must stop before running commands if a restore target points at the live database, live bucket, or an empty/non-isolated object prefix.

## Object Store Compatibility

Before relying on a self-hosted object store, confirm that `/health/ready` can complete the WiseEff compatibility probe:

- Bucket `HEAD`.
- Probe object `PUT` with `x-amz-meta-*` metadata.
- Probe object `HEAD`.
- Probe object `GET` with checksum validation.
- Probe object `DELETE`.

Readiness failures should expose safe categories and remediation hints, not credentials, signed URLs, or raw secret-bearing provider payloads.

## Drill Procedure

1. Announce the drill window and environment label.
2. Confirm the provider decision record in `ops/self-hosted/storage/provider-decision.md`.
3. Confirm `.env` or `ops/self-hosted/.env` contains the backup and restore variables.
4. Stop or pause non-essential writes if the environment requires it.
5. Take a database backup with the approved operator command.
6. Capture object-storage state using the provider export, sync, or snapshot procedure.
7. Capture Redis persistence state or snapshot when durable queue mode is enabled.
8. Validate restore targets before executing restore commands:

```bash
npm run restore:drill
```

When explicitly loading an env file in PowerShell, WSL, or Node 22 based shells, prefer the WiseEff-specific alias:

```bash
npm run restore:drill --target-env-file=ops/self-hosted/.env
```

Avoid `source ops/self-hosted/.env` because dotenv values can contain spaces, including `Bearer <token>` authorization values.

9. Restore PostgreSQL into `RESTORE_DATABASE_URL`.
10. Restore object storage into `RESTORE_OBJECT_STORAGE_BUCKET` and `RESTORE_OBJECT_STORAGE_PREFIX`.
11. Restore Redis persistence when durable queue mode is enabled.
12. Start API and worker against the restored state.
13. Validate table counts and sampled log object references.
14. Run smoke against the restored environment:

```bash
npm run smoke:m5
```

15. When durable queue mode is enabled, also run:

```bash
npm run queue:check -- --base-url https://<host>
```

16. Confirm `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness` behave as expected.
17. Generate and check redacted M6 backup/restore evidence:

```bash
npm run backup:drill
npm run backup:check
```

The backup drill accepts the same env-file alias:

```bash
npm run backup:drill --target-env-file=ops/self-hosted/.env
```

18. Record `M5_BACKUP_RESTORE_DRILL_AT` only after the real target restore drill passes.
19. Update [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md) or the external release evidence record.

## Local Evidence

Local non-customer evidence may use placeholder endpoints and isolated local paths to validate evidence shape, redaction, and target-safety checks. This is useful development evidence only.

Local evidence must not be used to claim target restore readiness. Target readiness requires a real non-customer or pilot environment restore into isolated database and object-store targets.

## Evidence Fields

`docs/generated/m6-backup-restore-evidence.json` should contain:

- provider decision path and selected provider,
- branch, commit, and environment label,
- object-store endpoint, bucket, health prefix, backup target, restore target, object count, and checksum status,
- database backup command, backup target, restore target, and table-count validation status,
- queue mode, status, and Redis persistence metadata when durable queue mode is enabled,
- restore start and completion timestamps,
- isolated restore target names,
- sampled log reference count and missing object count,
- command exit statuses,
- redaction status.

`docs/generated/m6-backup-restore-evidence.md` is the human-readable summary generated from the JSON evidence.

For M6.6 releases, link the same backup and restore evidence from [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or the approved external release evidence record.

## Acceptance

- PostgreSQL backup is restored into an isolated database.
- Object storage is restored into an isolated bucket or prefix.
- Restored database records reference existing restored log objects.
- Object checksums are validated where available.
- Restored Redis or queue persistence is either validated through `queue:check` or explicitly recorded as not applicable for polling mode.
- API readiness gives actionable dependency status.
- Smoke checks run against the restored environment.
- Evidence contains no secrets, bearer tokens, signed URLs, raw customer data, database dumps, or object bytes.

## Redis Conditional Status

When polling mode is used, queue evidence should be:

```json
{
  "mode": "polling",
  "status": "conditional",
  "reason": "LOG_ANALYSIS_QUEUE_MODE is not durable for this environment."
}
```

When durable queue mode is enabled, `queue.status` cannot be `conditional`. Target evidence should include Redis persistence or BullMQ-equivalent queue state plus `queue:check` validation before the target drill is accepted:

```json
{
  "mode": "durable",
  "status": "captured",
  "persistence": {
    "snapshotTarget": "file:///backups/wiseeff/redis.rdb",
    "checkpointValidated": true
  }
}
```

If the target intentionally avoids restoring queue persistence, the operator must document the queue-drain procedure and validate the post-restore queue state with `npm run queue:check -- --base-url <target-url>`.

## Failure Handling

If backup or restore fails:

- Do not set `M5_BACKUP_RESTORE_DRILL_AT`.
- Record the failed command, exit code, and redacted error summary.
- Keep generated evidence honest; do not edit failed evidence into a pass.
- Add or update a technical debt item if the fix is not immediate.
- Do not mark the M6.6 release gate complete; rollback and capacity gates cannot compensate for missing restore evidence.
