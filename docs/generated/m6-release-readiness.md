## M6.6 Self-Hosted Release Gate Evidence

- Date: 2026-06-02T17:53:06.321Z
- Status: `failed`
- Branch: `codex/m6-6-release-rollback-capacity-gate`
- Commit: `54925ef0238b373035d79387a2ec475524a34635`
- Version: `v0.1.0`
- Dirty worktree: `true`
- Target environment: `local-self-hosted`
- Artifact: `local-build`
- Environment fingerprint: `sha256:local-env-not-committed`
- Synthetic acceptance mode: `target-non-hdc`
- HDC status: `skipped_by_scope`
- HDC evidence: `n/a`

### Migration Set

- `0001_m0_foundation.sql`
- `0002_m1_parameters.sql`
- `0003_parameter_workflow_assignees.sql`
- `0004_m2_logs.sql`
- `0005_m3_debugging.sql`
- `0006_m3_5_job_leases.sql`
- `0007_m3_5_device_leases.sql`
- `0008_m4_agent.sql`
- `0009_m5_job_dead_letters.sql`
- `0010_m5_agent_provider_traces.sql`

### Evidence Paths

- Backup evidence: `docs/generated/backup-restore-drill.md`
- Rollback plan: `docs/runbooks/release-rollback.md`
- Rollback rehearsal: `pending`
- Target synthetic acceptance: `pending`
- Capacity gate: `docs/generated/capacity-gate.md`

### Command Gates

| Command | Status | Detail |
| --- | --- | --- |
| docs:check | pending | configured_not_run |
| contract:check | pending | configured_not_run |
| test:all | pending | configured_not_run |
| build | pending | configured_not_run |
| acceptance:coverage | pending | configured_not_run |
| acceptance:operations | pending | configured_not_run |
| acceptance:evidence | pending | configured_not_run |
| selfhost:check | pending | configured_not_run |
| git diff --check | pending | configured_not_run |

### Dependency Gates

| Dependency | Status |
| --- | --- |
| self-hosted config | pending |
| backup/restore | pending |
| queue readiness | pending |
| observability | pending |

### Blockers

- Release worktree must be clean before producing final evidence.

### Pending Evidence

- Rollback rehearsal evidence is pending.
- Target synthetic acceptance evidence is pending.
- Command gate not run: docs:check.
- Command gate not run: contract:check.
- Command gate not run: test:all.
- Command gate not run: build.
- Command gate not run: acceptance:coverage.
- Command gate not run: acceptance:operations.
- Command gate not run: acceptance:evidence.
- Command gate not run: selfhost:check.
- Command gate not run: git diff --check.
- Self-hosted config evidence is pending.
- Backup/restore evidence is pending.
- Queue readiness evidence is pending.
- Observability evidence is pending.
