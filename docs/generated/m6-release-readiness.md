## M6.6 Self-Hosted Release Gate Evidence

- Date: 2026-06-04T02:58:08.249Z
- Status: `failed`
- Branch: `codex/m6-target-evidence-closure`
- Commit: `a82b50bf5b03ee8231e284c131d3d30ab2b95e7f`
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
- `0011_m6_user_governance.sql`

### Evidence Paths

- Backup evidence: `docs/generated/m6-backup-restore-evidence.md`
- Identity evidence: `docs/generated/m6-identity-evidence.md`
- Rollback plan: `docs/runbooks/release-rollback.md`
- Rollback rehearsal: `docs/generated/m6-rollback-rehearsal-evidence.md`
- Target synthetic acceptance: `pending`
- Capacity gate: `docs/generated/capacity-gate.md`
- Queue evidence: `docs/generated/m6-queue-readiness-evidence.md`
- Observability evidence: `docs/generated/m6-observability-evidence.md`

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
| identity:check | pending | configured_not_run |
| git diff --check | pending | configured_not_run |

### Dependency Gates

| Dependency | Status |
| --- | --- |
| self-hosted config | pending |
| backup/restore | passed |
| identity readiness | pending |
| rollback readiness | pending |
| capacity readiness | pending |
| target synthetic readiness | pending |
| queue readiness | passed |
| observability | passed |

### Blockers

- Release worktree must be clean before producing final evidence.

### Pending Evidence

- Target synthetic acceptance evidence is pending.
- Command gate not run: docs:check.
- Command gate not run: contract:check.
- Command gate not run: test:all.
- Command gate not run: build.
- Command gate not run: acceptance:coverage.
- Command gate not run: acceptance:operations.
- Command gate not run: acceptance:evidence.
- Command gate not run: selfhost:check.
- Command gate not run: identity:check.
- Command gate not run: git diff --check.
- Self-hosted config evidence is pending.
- Identity readiness evidence is pending.
- Rollback readiness evidence is pending.
- Capacity readiness evidence is pending.
- Target synthetic readiness evidence is pending.
