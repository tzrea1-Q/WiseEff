# Backup And Restore Runbook

Backup and restore evidence is required before calling a pilot or self-hosted target environment ready.

M6.3 standardizes WiseEff backup evidence around PostgreSQL plus S3-compatible object storage. Redis queue backup remains conditional until M6.4 introduces the durable queue service.

## Backup Scope

- PostgreSQL database.
- S3-compatible object storage objects for uploaded logs and generated artifacts.
- Deployment configuration needed to recreate the environment.
- Redis persistence after M6.4.
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
7. Validate restore targets before executing restore commands:

```bash
npm run restore:drill
```

8. Restore PostgreSQL into `RESTORE_DATABASE_URL`.
9. Restore object storage into `RESTORE_OBJECT_STORAGE_BUCKET` and `RESTORE_OBJECT_STORAGE_PREFIX`.
10. Start API and worker against the restored state.
11. Validate table counts and sampled log object references.
12. Run smoke against the restored environment:

```bash
npm run smoke:m5
```

13. Generate and check redacted M6 backup/restore evidence:

```bash
npm run backup:drill
npm run backup:check
```

14. Record `M5_BACKUP_RESTORE_DRILL_AT` only after the real target restore drill passes.
15. Update [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md) or the external release evidence record.

## Local Evidence

Local non-customer evidence may use placeholder endpoints and isolated local paths to validate evidence shape, redaction, and target-safety checks. This is useful development evidence only.

Local evidence must not be used to claim target restore readiness. Target readiness requires a real non-customer or pilot environment restore into isolated database and object-store targets.

## Evidence Fields

`docs/generated/m6-backup-restore-evidence.json` should contain:

- provider decision path and selected provider,
- branch, commit, and environment label,
- object-store endpoint, bucket, health prefix, backup target, restore target, object count, and checksum status,
- database backup command, backup target, restore target, and table-count validation status,
- queue status, which may be `conditional` until M6.4,
- restore start and completion timestamps,
- isolated restore target names,
- sampled log reference count and missing object count,
- command exit statuses,
- redaction status.

`docs/generated/m6-backup-restore-evidence.md` is the human-readable summary generated from the JSON evidence.

## Acceptance

- PostgreSQL backup is restored into an isolated database.
- Object storage is restored into an isolated bucket or prefix.
- Restored database records reference existing restored log objects.
- Object checksums are validated where available.
- API readiness gives actionable dependency status.
- Smoke checks run against the restored environment.
- Evidence contains no secrets, bearer tokens, signed URLs, raw customer data, database dumps, or object bytes.

## Redis Conditional Status

Until M6.4 lands, queue evidence should be:

```json
{
  "status": "conditional",
  "reason": "Redis durable queue is introduced in M6.4."
}
```

After M6.4, update this runbook and the evidence checker to validate Redis persistence or BullMQ-equivalent durable queue state.

## Failure Handling

If backup or restore fails:

- Do not set `M5_BACKUP_RESTORE_DRILL_AT`.
- Record the failed command, exit code, and redacted error summary.
- Keep generated evidence honest; do not edit failed evidence into a pass.
- Add or update a technical debt item if the fix is not immediate.
