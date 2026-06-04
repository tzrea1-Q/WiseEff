## M6 Target Evidence Execution Plan

- Date: 2026-06-04T07:35:33.651Z
- Status: `blocked`
- Target base URL: `http://127.0.0.1:8787`

### Configured Target Inputs

| Key | Value |
| --- | --- |
| WISEEFF_API_BASE_URL | `http://127.0.0.1:8787` |
| VITE_WISEEFF_API_BASE_URL | `http://127.0.0.1:8787` |
| AUTH_OIDC_ISSUER | `not-configured` |
| AUTH_OIDC_AUDIENCE | `not-configured` |
| M6_IDENTITY_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_EXPIRED_AUTHORIZATION | `not-configured` |
| RESTORE_DATABASE_URL | `not-configured` |
| RESTORE_OBJECT_STORAGE_BUCKET | `not-configured` |
| RESTORE_OBJECT_STORAGE_PREFIX | `not-configured` |
| BACKUP_DATABASE_TARGET | `not-configured` |
| BACKUP_OBJECT_STORAGE_TARGET | `not-configured` |
| M6_SELFHOSTED_SMOKE_AUTHORIZATION | `not-configured` |
| WISEEFF_SMOKE_AUTHORIZATION | `Bearer <redacted>` |
| WISEEFF_CAPACITY_TARGET_URL | `not-configured` |

### Blockers

- M6.2 missing AUTH_OIDC_ISSUER.
- M6.2 missing AUTH_OIDC_AUDIENCE.
- M6.2 missing M6_IDENTITY_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_EXPIRED_AUTHORIZATION.
- M6.3 missing RESTORE_DATABASE_URL.
- M6.3 missing RESTORE_OBJECT_STORAGE_BUCKET.
- M6.3 missing RESTORE_OBJECT_STORAGE_PREFIX.
- M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.
- M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL.

### Ordered Execution

#### M6.2 Identity And User Governance Target Evidence

- Objective: Prove the deployed WiseEff API trusts the target OIDC issuer and enforces DB-backed user governance.

Required inputs:

- AUTH_OIDC_ISSUER
- AUTH_OIDC_AUDIENCE
- M6_IDENTITY_AUTHORIZATION
- M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION
- M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION
- M6_IDENTITY_EXPIRED_AUTHORIZATION
- M6_IDENTITY_BROWSER_RUNTIME=passed after browser refresh/logout proof

Commands:

- `npm run identity:check`

Evidence paths:

- `docs/generated/m6-identity-evidence.md`

Success criteria:

- OIDC discovery/JWKS passes against the target issuer.
- /api/v1/me resolves the target Admin user through production OIDC.
- Wrong issuer, wrong audience, and expired token checks return 401.
- Browser token acquisition, refresh, and logout are recorded as passed.

Notes:

- docs/generated/m6-local-oidc-identity-evidence.md is local implementation proof only and is not accepted as target evidence.

#### M6.3 Self-Hosted Storage And Backup Target Evidence

- Objective: Prove restore safety and cross-store recovery on isolated non-customer PostgreSQL/object-store targets.

Required inputs:

- RESTORE_DATABASE_URL
- RESTORE_OBJECT_STORAGE_BUCKET
- RESTORE_OBJECT_STORAGE_PREFIX
- BACKUP_DATABASE_TARGET
- BACKUP_OBJECT_STORAGE_TARGET

Commands:

- `npm run restore:drill`
- `npm run backup:drill`
- `npm run backup:check`

Evidence paths:

- `docs/generated/m6-backup-restore-evidence.md`
- `docs/generated/m6-backup-restore-evidence.json`

Success criteria:

- Restore targets are isolated from live database and object-store locations.
- PostgreSQL restore validation and object-store checksum validation pass.
- Evidence is redacted and records the target environment label.

Notes:

- Local backup evidence proves shape only unless generated from the real target restore drill.

#### M6.4 Durable Queue Target Evidence

- Objective: Prove the target API is running durable queue mode with Redis/BullMQ transport and PostgreSQL job-state readiness.

Required inputs:

- WISEEFF_API_BASE_URL
- M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION

Commands:

- `npm run queue:check -- --base-url http://127.0.0.1:8787`

Evidence paths:

- `docs/generated/m6-queue-readiness-evidence.md`

Success criteria:

- /health/ready exposes dependencies.durableQueue.
- Durable queue transport is ready.
- PostgreSQL job-state health is ready.
- The evidence base URL is a non-local target URL.

Notes:

- Queue pause/drain/resume release rehearsal should be attached to M6.6 rollback/release evidence.

#### M6.5 Observability And Operations Target Evidence

- Objective: Prove Prometheus scrape, Alertmanager routing, and Grafana dashboard import for the target runtime.

Required inputs:

- Prometheus target scrape result
- Alertmanager routing exercise result
- Grafana dashboard import or screenshot evidence

Commands:

- `npm run observability:check`

Evidence paths:

- `docs/generated/m6-observability-evidence.md`

Success criteria:

- Prometheus target scrape is recorded as passed.
- Alertmanager routing is recorded as passed.
- Grafana dashboard import is recorded as passed.
- Runbook links and alert metadata remain valid.

Notes:

- Config validation alone is not target observability evidence; attach the scrape/routing/dashboard proof.

#### M6.6 Release, Rollback And Capacity Target Evidence

- Objective: Prove the self-hosted release candidate can be accepted, capacity-tested, synthetically checked, and rolled back.

Required inputs:

- WISEEFF_CAPACITY_TARGET_URL
- Rollback candidate/previous artifact references
- Target synthetic acceptance artifact
- Queue evidence path
- Observability evidence path
- Environment fingerprint

Commands:

- `npm run capacity:gate -- --target-url http://127.0.0.1:8787`
- `npm run rollback:rehearsal`
- `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime`
- `npm run selfhost:release-gate`
- `npm run m6:target-evidence`

Evidence paths:

- `docs/generated/capacity-gate.md`
- `docs/generated/m6-rollback-rehearsal-evidence.md`
- `docs/generated/acceptance-browser-evidence.md`
- `docs/generated/m6-release-readiness.md`
- `docs/generated/m6-target-evidence-summary.md`

Success criteria:

- Capacity evidence contains observed target metrics and no pending threshold rows.
- Rollback rehearsal records stop-writes, queue drain, artifact rollback, and post-rollback smoke.
- Target synthetic browser acceptance passes with --no-start-runtime.
- Release gate marks identity, backup/restore, rollback, capacity, queue, observability, and target synthetic readiness as passed.
- m6:target-evidence passes before M6.2-M6.6 plans move to completed.

Notes:

- Do not mark release readiness passed while any dependency evidence is pending or local-only.
