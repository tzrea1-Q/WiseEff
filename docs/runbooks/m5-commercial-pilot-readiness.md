# M5 Commercial Pilot Readiness Runbook

Date: 2026-05-29

This runbook describes the release gate for a controlled commercial pilot. It assumes the M0-M4 feature work is already merged and that pilot evidence is being collected in a staging or pilot environment.

## Required Environment

- `DATABASE_URL`
- `AUTH_MODE=production`
- `AUTH_TOKEN_ISSUER`
- `AUTH_TOKEN_HMAC_SECRET`
- `OBJECT_STORE_MODE=s3`
- `OBJECT_STORAGE_ENDPOINT`
- `OBJECT_STORAGE_BUCKET`
- `OBJECT_STORAGE_ACCESS_KEY_ID`
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `OBJECT_STORAGE_REGION` (optional)
- `DEBUG_DEVICE_GATEWAY_MODE=hdc`
- `HDC_TIMEOUT_MS`
- `M5_BACKUP_RESTORE_DRILL_AT`
- `WISEEFF_API_BASE_URL` or `VITE_WISEEFF_API_BASE_URL` for the smoke client
- `M5_SMOKE_AUTHORIZATION` or `WISEEFF_SMOKE_AUTHORIZATION` with `admin:access` for staging/prod pilot-readiness smoke
- `M5_SMOKE_ALLOW_NO_API=true` only for local documentation runs that intentionally skip the API probe

## Deploy Order

1. Run the database migration.
2. Deploy the API process.
3. Start the worker process.
4. Deploy the web frontend.
5. Start the device gateway or device-lab process.
6. Run the release smoke.

Recommended commands:

```bash
npm run contract:check
npm run smoke:m5
npm run test:m5
```

`npm run smoke:m5` requires a live API URL by default. For staging/prod pilot checks, set `M5_SMOKE_AUTHORIZATION` or `WISEEFF_SMOKE_AUTHORIZATION` to a bearer token with `admin:access`; otherwise `/api/v1/operations/pilot-readiness` will return 403. Use `M5_SMOKE_ALLOW_NO_API=true` only when documenting the runbook locally without a reachable API.

## Monitoring

- Alert on repeated `/health/ready` failures.
- Alert on `pilot_readiness.status=blocked`.
- Alert on worker dead-letter growth or worker lease churn.
- Alert on object-store health probe failures.
- Alert on device gateway timeout, stderr, or read-back mismatch failures.
- Alert on agent provider fallback or unsafe provider health.
- Alert on audit gaps for high-risk writes.

## Backup And Restore Drill

1. Take a fresh backup before the pilot window.
2. Restore it into a clean environment.
3. Confirm the restored API can answer `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`.
4. Record the drill timestamp in `M5_BACKUP_RESTORE_DRILL_AT`.
5. Keep the pilot evidence and the restore validation together in `docs/generated/m5-pilot-acceptance.md`.

Target guidance:

- RPO: 24 hours
- RTO: 4 hours

## Rollback Triggers

- `pilot-readiness` returns `blocked`.
- `/health/ready` returns `503`.
- Worker dead letters start growing without recovery.
- Object-store health fails.
- Device gateway timeouts, stderr failures, or read-back mismatches appear.
- Agent provider health becomes unsafe or unavailable.
- Audit evidence is missing for a high-risk write.

## Rollback Sequence

1. Stop new writes.
2. Drain or disable the worker.
3. Remove traffic from the pilot deployment.
4. Restore the last known good database and object store state.
5. Re-run `npm run smoke:m5`.
6. Verify the acceptance artifact reflects the rollback and the restored environment.

## Go / No-Go Checklist

- [ ] `npm run contract:check` is current.
- [ ] `/api/v1/operations/pilot-readiness` returns `status: "pilot_ready"`.
- [ ] `/health/ready` is green.
- [ ] Backup/restore drill timestamp is recorded.
- [ ] Device-lab smoke evidence is attached.
- [ ] Agent provider health or safety evidence is attached.
- [ ] Rollback steps were rehearsed in the target environment.
- [ ] `docs/generated/m5-pilot-acceptance.md` lists any skipped external checks explicitly.
