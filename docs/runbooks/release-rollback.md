# Self-Hosted Release And Rollback Runbook

This runbook is the M6.6 procedure for releasing WiseEff to a controlled self-hosted Linux target and rehearsing rollback before a customer pilot.

## Preconditions

- A release candidate has a version label, commit SHA, artifact reference, target environment label, and environment-file fingerprint.
- `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:evidence`, `npm run selfhost:check`, `npm run identity:check`, and `git diff --check` pass.
- Production targets use `AUTH_PROVIDER=oidc`; local HMAC smoke tokens are not acceptable identity readiness evidence.
- Target OIDC evidence is archived at `docs/generated/m6-identity-evidence.md` or an approved external record and proves discovery/JWKS, Admin `/api/v1/me`, wrong issuer, wrong audience, expired token, and browser token acquisition/refresh/logout checks.
- A backup is taken before deployment and can be restored into a clean target.
- Queue pause/drain/resume behavior is documented for the target queue mode.
- Monitoring is available during the release window.
- HDC is explicitly marked unavailable, skipped by scope, or enabled with evidence.

## Pre-Deploy Sequence

1. Announce the maintenance window and approval owner.
2. Record the starting artifact, commit SHA, environment label, and config fingerprint.
3. Pause non-essential writes if the release affects migrations, queues, object storage, or worker behavior.
4. Take PostgreSQL and object-store backups.
5. Record backup evidence in the release record.
6. Drain or pause workers according to the queue runbook.
7. Run migrations only after the backup is complete.
8. Deploy API, web, and worker artifacts.
9. Resume workers after smoke checks confirm the API is ready.

## Post-Deploy Validation

Run:

```bash
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://<host>
npm run identity:check
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256> --identity-readiness passed --queue-readiness passed --queue-evidence <path-or-record> --observability passed --observability-evidence <path-or-record>
```

Attach Playwright reports, operation evidence, capacity evidence, smoke output, metrics snapshots, and release readiness output to the release record.

## Rollback Decision Points

Trigger rollback when any of these occur during the release window:

- repeated `/health/ready` failures,
- target synthetic acceptance fails on a P0/P1 workflow,
- p95 latency, error rate, queue backlog, database connections, or object-store probe breaches the capacity threshold,
- migration fails or leaves the application unable to boot,
- worker dead letters grow without recovery,
- production writes lose audit evidence,
- device or Agent write safety becomes uncertain.

## Rollback Sequence

1. Stop new writes or put the product into the approved maintenance state.
2. Pause or drain the worker/queue.
3. Remove traffic from the candidate API/web artifact.
4. Redeploy the last known good API, web, and worker artifacts.
5. If the candidate changed data, restore PostgreSQL and object-store state from the pre-release backup.
6. Re-run `npm run selfhost:smoke` against the target.
7. Confirm `/health/live`, `/health/ready`, `/api/v1/me` with a target OIDC token, and `/api/v1/operations/pilot-readiness`.
8. Resume workers only after queue and readiness checks are safe.
9. Record rollback rehearsal evidence and update `docs/generated/m6-release-readiness.md` or the external release evidence store.

## Failure Classes

| Failure | Primary rollback path | Notes |
| --- | --- | --- |
| API/web artifact failure | Restore last known good artifact and rerun smoke. | Database restore may be unnecessary if no writes occurred. |
| Worker failure | Pause queue, deploy last known good worker, then resume. | Record queue backlog and dead-letter counts. |
| Migration failure | Restore backup or forward-fix according to the migration plan. | Irreversible migrations must be treated as forward-fix unless a tested restore path exists. |
| Object-store inconsistency | Stop writes, restore object-store snapshot, verify log/object references. | Do not mark release-ready until object references and log reads are coherent. |
| Capacity breach | Roll back or scale according to approved target capacity plan. | Capacity results must include metrics snapshots, not only k6 output. |

## Forward-Fix Policy

Irreversible migrations or data transformations cannot be described as rollback-safe without rehearsal evidence. If rollback is not possible, the release record must name the forward-fix owner, repair command, validation command, and maximum acceptable recovery window before deployment.

## Evidence Rule

This runbook can be rehearsed only in a non-customer target environment. Local command output proves scripts and templates; it does not complete target OIDC identity readiness, rollback rehearsal, target synthetic acceptance, capacity, HDC, or full-pilot readiness.
