# Rollback Runbook

Rollback protects pilot users when a deployment or migration behaves unsafely.

For M6.6 self-hosted release candidates, use [Self-Hosted Release And Rollback](release-rollback.md) as the release-window procedure. This page remains the generic rollback checklist.

## Rollback Triggers

- `/health/ready` returns repeated `503`.
- `pilot-readiness` changes from `pilot_ready` to `blocked` unexpectedly.
- Parameter writes fail or miss audit evidence.
- Log worker dead letters grow without recovery.
- Object-store readiness fails.
- Device gateway reports repeated timeout, stderr, offline, or readback mismatch failures.
- Agent provider health becomes unsafe or unavailable without expected fallback behavior.
- Capacity thresholds breach during a release window.
- Target synthetic acceptance fails after deployment.

## Rehearsal Procedure

1. Choose a controlled staging window.
2. Record the starting commit and environment.
3. Deploy the candidate build.
4. Run the normal smoke.
5. Simulate the rollback trigger if safe.
6. Stop new writes.
7. Drain or stop the worker.
8. Remove traffic from the candidate API/frontend.
9. Restore database and object storage if data changed.
10. Redeploy the last known good build.
11. Re-run smoke checks.
12. Record evidence and update the pilot acceptance artifact.
13. For M6.6 releases, also update [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or the approved external release evidence record.

## Emergency Sequence

1. Stop new writes.
2. Disable worker consumption.
3. Remove traffic from the bad deployment.
4. Restore the last known good database/object-store state if needed.
5. Redeploy the last known good API and frontend.
6. Run:

```bash
npm run smoke:m5
```

7. Confirm audit continuity and readiness status.

## Notes

Database migrations should be forward-compatible where possible. If a migration needs a special recovery path, document it in the migration plan or the deployment evidence before rollout.
Irreversible migrations require a forward-fix plan before release; do not call them rollback-safe unless a restore rehearsal proves the path.
