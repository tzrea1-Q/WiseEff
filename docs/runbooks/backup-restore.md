# Backup And Restore Runbook

> Chinese: [Chinese](../zh-CN/runbooks/backup-restore.md)

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

9. With proxy traffic, API, workers and publication writers stopped, capture the latest applicable organization deletion state from the current database into a protected file outside the database/object snapshots being restored. See [Organization deletion replay](#organization-deletion-replay). If the latest database cannot be read, stop the restore.
10. Restore PostgreSQL into `RESTORE_DATABASE_URL`.
11. Restore object storage into `RESTORE_OBJECT_STORAGE_BUCKET` and `RESTORE_OBJECT_STORAGE_PREFIX`.
12. Restore Redis persistence when durable queue mode is enabled, then pause the restored queues again. Restored Redis may contain an unpaused queue.
13. Replay the preserved deletion state against the restored database and actual configured object/checkpoint stores using a real surviving platform user. Keep all application producers and public traffic stopped until replay succeeds.
14. Start API and worker against the restored state.
15. Validate table counts and sampled log object references.
16. Run smoke against the restored environment:

```bash
npm run smoke:m5
```

17. When durable queue mode is enabled, also run:

```bash
npm run queue:check -- --base-url https://<host>
```

18. Confirm `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness` behave as expected.
19. Generate and check redacted M6 backup/restore evidence:

```bash
npm run backup:drill
npm run backup:check
```

The backup drill accepts the same env-file alias:

```bash
npm run backup:drill --target-env-file=ops/self-hosted/.env
```

20. Record `M5_BACKUP_RESTORE_DRILL_AT` only after the real target restore drill passes.
21. Update [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md) or the external release evidence record.

## Organization Deletion Replay

An older backup can contain organizations and files deleted after that backup. Retain the latest minimal deletion state outside the older recovery point, then apply it to restored content before reopening access. Copying a completed receipt alone does not erase restored business data. This procedure does not claim immediate erasure of backup media.

The maintenance process uses the configured database and actual stores, without starting an API or worker daemon:

```bash
node --import tsx scripts/organization-erasure-recovery.ts capture --file /protected/recovery/organization-erasures.json
# After restoring all stores, while traffic and producers remain stopped:
node --import tsx scripts/organization-erasure-recovery.ts replay --file /protected/recovery/organization-erasures.json --actor actual-surviving-platform-user-id
```

For an isolated drill, capture from the latest source before replacement and configure replay for the isolated restore targets. Keep the file private, retain it through retries, and never regenerate it from an already restored older database. Capture exclusively creates the file; an existing or incomplete unverified file is not permission to overwrite deletion history. A valid empty deletion list is distinct from a missing, empty or malformed file.

The self-hosted `upgrade.sh rollback --restore-data` owner performs these gates automatically. Set `WISEEFF_ORGANIZATION_ERASURE_REPLAY_ACTOR_ID` explicitly to an actual surviving platform user. The owner stores `organization-erasures.json` in its protected upgrade run directory, captures before replacing PostgreSQL, and reuses the verified capture after interruption. After restoring PostgreSQL, objects and Redis, it pauses queues again and replays before recreating application services, resuming queues or starting the proxy. Restart-only rollback, resume and candidate recovery cannot bypass an incomplete replay.

The recorded candidate image must contain the recovery CLI and support the restored schema and configured stores. A missing CLI, unavailable latest database, incompatible schema, missing platform actor, failed deletion, or absent/changed native Agent checkpoint store blocks reopening. The owner does not silently migrate the restored database or fall back to an older image without the gate. Keep services isolated and use the existing recovery procedure to resolve compatibility before retrying. A separate checkpoint database must be restored and ownership-verified as well; changing a physical store identity is not proof of erasure.

Acceptance needs a real old-backup restore: later deletion state must remove restored target data and block target credentials, new operations, queue claims and callback replay while retaining other organizations and shared objects. Include interrupted/failed intents and a completed receipt whose old business rows return with the backup. Shell wrapper tests prove ordering and refusal behavior only; they do not prove Docker, target-host, PostgreSQL, object-store or checkpoint recovery.

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

## Overlay Artifact Retention And GC

Compiled DTS reload overlay blobs (source + `dtbo`) stay downloadable for `RELOAD_ARTIFACT_RETENTION_DAYS` (90) from run `completed_at` (else `created_at`). After that window, download and deploy return `410` with `details.code: "reload-artifact-expired"`. Run metadata, SHA-256 digests, byte sizes, the reload snapshot, and existing audit rows stay on the run.

Physical blob deletion is a PostgreSQL jobs-table task, kind `overlay-artifact-gc`:

- Enqueue is idempotent while a queued or processing job already exists for that organization.
- The worker claims the job, deletes expired object-store keys, nulls storage keys, writes a system audit (`app: dts-reload`, `kind: overlay-artifact-gc`, `action: sweep`) with the run digest (`scannedRuns`, `reclaimedRuns`, `deletedBlobs`), then completes.
- Failures use the jobs retry/backoff lease. Exhausted attempts dead-letter the job and leave remaining keys in place for the next sweep.
- This path does not use Redis/BullMQ. Do not treat a real S3/MinIO drill as the completion gate.

Operators still schedule the kick with cron (or an equivalent timer):

```bash
npm run reload:sweep-artifacts
```

The script reclaims stale `deploying` runs, enqueues `overlay-artifact-gc` jobs for organizations that still hold expired blobs, and drains those jobs through the same worker entry. A store without `delete` is a no-op. Repeating the command is safe.

## Failure Handling

If backup or restore fails:

- Do not set `M5_BACKUP_RESTORE_DRILL_AT`.
- Record the failed command, exit code, and redacted error summary.
- Keep generated evidence honest; do not edit failed evidence into a pass.
- Add or update a technical debt item if the fix is not immediate.
- Do not mark the M6.6 release gate complete; rollback and capacity gates cannot compensate for missing restore evidence.
