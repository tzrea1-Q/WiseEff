## M6.6 Rollback Rehearsal Evidence

- Date: 2026-06-04T11:08:23.524Z
- Status: `failed`
- Environment: `local-self-hosted`
- Release version: `v0.1.0`
- Candidate artifact: `local-build`
- Previous artifact: `not-run`
- Approval owner: `not-assigned`
- Maintenance window: `not-scheduled`

### Rollback Steps

| Step | Status |
| --- | --- |
| stop writes | pending |
| queue drain | pending |
| artifact rollback | pending |
| database restore | skipped_by_scope |
| object-store restore | skipped_by_scope |
| post-rollback smoke | pending |

### Artifacts

- Backup/restore evidence: `docs/generated/m6-backup-restore-evidence.md`
- Post-rollback smoke evidence: `pending`
- Queue evidence: `docs/generated/m6-queue-readiness-evidence.md`
- Notes: `pending`

### Blockers

- Rollback environment must identify a configured target, staging, pilot, or self-hosted environment.

### Pending Evidence

- Rollback step pending: stop writes.
- Rollback step pending: queue drain.
- Rollback step pending: artifact rollback.
- Rollback step pending: post-rollback smoke.
