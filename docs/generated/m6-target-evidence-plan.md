## M6 Target Evidence Execution Plan

- Date: 2026-06-05T01:26:32.803Z
- Status: `blocked`
- Target base URL: `not-configured`

### Configured Target Inputs

| Key | Value |
| --- | --- |
| WISEEFF_API_BASE_URL | `not-configured` |
| VITE_WISEEFF_API_BASE_URL | `not-configured` |
| AUTH_OIDC_ISSUER | `not-configured` |
| AUTH_OIDC_AUDIENCE | `not-configured` |
| M6_IDENTITY_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_EXPIRED_AUTHORIZATION | `not-configured` |
| M6_IDENTITY_BROWSER_RUNTIME | `not-configured` |
| RESTORE_DATABASE_URL | `not-configured` |
| RESTORE_OBJECT_STORAGE_BUCKET | `not-configured` |
| RESTORE_OBJECT_STORAGE_PREFIX | `not-configured` |
| BACKUP_DATABASE_TARGET | `not-configured` |
| BACKUP_OBJECT_STORAGE_TARGET | `not-configured` |
| REDIS_URL | `not-configured` |
| BACKUP_REDIS_SNAPSHOT_TARGET | `not-configured` |
| BACKUP_REDIS_CHECKPOINT_VALIDATED | `not-configured` |
| M6_SELFHOSTED_SMOKE_AUTHORIZATION | `not-configured` |
| WISEEFF_SMOKE_AUTHORIZATION | `not-configured` |
| M6_OBSERVABILITY_TARGET_ENVIRONMENT | `not-configured` |
| M6_OBSERVABILITY_CONFIG_STATUS | `not-configured` |
| M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE | `not-configured` |
| M6_OBSERVABILITY_ALERTMANAGER_ROUTING | `not-configured` |
| M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT | `not-configured` |
| M6_OBSERVABILITY_PROMETHEUS_QUERY | `not-configured` |
| M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE | `not-configured` |
| M6_OBSERVABILITY_GRAFANA_EVIDENCE | `not-configured` |
| WISEEFF_CAPACITY_TARGET_URL | `not-configured` |
| WISEEFF_CAPACITY_AUTHORIZATION | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_P95_MS | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_ERROR_RATE | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_RPS | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_CPU | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_MEMORY | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_DB_CONNECTIONS | `not-configured` |
| M6_TARGET_CAPACITY_OBSERVED_QUEUE_BACKLOG | `not-configured` |
| M6_TARGET_CAPACITY_OBJECT_STORE_PROBE | `not-configured` |
| M6_TARGET_ROLLBACK_ENVIRONMENT | `not-configured` |
| M6_TARGET_ROLLBACK_RELEASE_VERSION | `not-configured` |
| M6_TARGET_ROLLBACK_CANDIDATE_ARTIFACT | `not-configured` |
| M6_TARGET_ROLLBACK_PREVIOUS_ARTIFACT | `not-configured` |
| M6_TARGET_ROLLBACK_APPROVAL_OWNER | `not-configured` |
| M6_TARGET_ROLLBACK_MAINTENANCE_WINDOW | `not-configured` |
| M6_TARGET_ROLLBACK_STOP_WRITES | `not-configured` |
| M6_TARGET_ROLLBACK_QUEUE_DRAIN | `not-configured` |
| M6_TARGET_ROLLBACK_ARTIFACT_ROLLBACK | `not-configured` |
| M6_TARGET_ROLLBACK_DATABASE_RESTORE | `not-configured` |
| M6_TARGET_ROLLBACK_OBJECT_STORE_RESTORE | `not-configured` |
| M6_TARGET_ROLLBACK_POST_ROLLBACK_SMOKE | `not-configured` |
| M6_TARGET_ROLLBACK_BACKUP_EVIDENCE | `not-configured` |
| M6_TARGET_ROLLBACK_SMOKE_EVIDENCE | `not-configured` |
| M6_TARGET_ROLLBACK_NOTES | `not-configured` |
| M6_TARGET_SYNTHETIC_EVIDENCE_PATH | `not-configured` |
| M6_TARGET_RELEASE_ENVIRONMENT | `not-configured` |
| M6_TARGET_RELEASE_ARTIFACT_REF | `not-configured` |
| M6_TARGET_RELEASE_ENV_FINGERPRINT | `not-configured` |
| M6_TARGET_RELEASE_IDENTITY_READINESS | `not-configured` |
| M6_TARGET_RELEASE_BACKUP_RESTORE_READINESS | `not-configured` |
| M6_TARGET_RELEASE_ROLLBACK_READINESS | `not-configured` |
| M6_TARGET_RELEASE_CAPACITY_READINESS | `not-configured` |
| M6_TARGET_RELEASE_SYNTHETIC_READINESS | `not-configured` |
| M6_TARGET_RELEASE_QUEUE_READINESS | `not-configured` |
| M6_TARGET_RELEASE_OBSERVABILITY_READINESS | `not-configured` |
| M6_TARGET_RELEASE_CAPACITY_EVIDENCE_PATH | `not-configured` |
| M6_TARGET_RELEASE_QUEUE_EVIDENCE_PATH | `not-configured` |
| M6_TARGET_RELEASE_OBSERVABILITY_EVIDENCE_PATH | `not-configured` |

### Blockers

- M6.2 missing AUTH_OIDC_ISSUER.
- M6.2 missing AUTH_OIDC_AUDIENCE.
- M6.2 missing M6_IDENTITY_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION.
- M6.2 missing M6_IDENTITY_EXPIRED_AUTHORIZATION.
- M6.2 requires M6_IDENTITY_BROWSER_RUNTIME=passed.
- M6.3 missing RESTORE_DATABASE_URL.
- M6.3 missing RESTORE_OBJECT_STORAGE_BUCKET.
- M6.3 missing RESTORE_OBJECT_STORAGE_PREFIX.
- M6.3 missing BACKUP_DATABASE_TARGET.
- M6.3 missing BACKUP_OBJECT_STORAGE_TARGET.
- M6.3 missing REDIS_URL.
- M6.3 missing BACKUP_REDIS_SNAPSHOT_TARGET.
- M6.3 requires BACKUP_REDIS_CHECKPOINT_VALIDATED=true.
- M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.
- M6.4 missing M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION.
- M6.5 requires M6_OBSERVABILITY_TARGET_ENVIRONMENT.
- M6.5 requires M6_OBSERVABILITY_CONFIG_STATUS=passed.
- M6.5 requires M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE=passed.
- M6.5 requires M6_OBSERVABILITY_ALERTMANAGER_ROUTING=passed.
- M6.5 requires M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT=passed.
- M6.5 missing M6_OBSERVABILITY_PROMETHEUS_QUERY.
- M6.5 missing M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE.
- M6.5 missing M6_OBSERVABILITY_GRAFANA_EVIDENCE.
- M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL.
- M6.6 missing WISEEFF_CAPACITY_AUTHORIZATION.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_P95_MS.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_ERROR_RATE.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_RPS.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_CPU.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_MEMORY.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_DB_CONNECTIONS.
- M6.6 missing M6_TARGET_CAPACITY_OBSERVED_QUEUE_BACKLOG.
- M6.6 requires M6_TARGET_CAPACITY_OBJECT_STORE_PROBE=passed.
- M6.6 requires M6_TARGET_ROLLBACK_ENVIRONMENT to identify a target, staging, pilot, or self-hosted environment.
- M6.6 missing M6_TARGET_ROLLBACK_RELEASE_VERSION.
- M6.6 missing M6_TARGET_ROLLBACK_CANDIDATE_ARTIFACT.
- M6.6 missing M6_TARGET_ROLLBACK_PREVIOUS_ARTIFACT.
- M6.6 missing M6_TARGET_ROLLBACK_APPROVAL_OWNER.
- M6.6 missing M6_TARGET_ROLLBACK_MAINTENANCE_WINDOW.
- M6.6 requires M6_TARGET_ROLLBACK_STOP_WRITES=passed.
- M6.6 requires M6_TARGET_ROLLBACK_QUEUE_DRAIN=passed.
- M6.6 requires M6_TARGET_ROLLBACK_ARTIFACT_ROLLBACK=passed.
- M6.6 requires M6_TARGET_ROLLBACK_DATABASE_RESTORE=passed.
- M6.6 requires M6_TARGET_ROLLBACK_OBJECT_STORE_RESTORE=passed.
- M6.6 requires M6_TARGET_ROLLBACK_POST_ROLLBACK_SMOKE=passed.
- M6.6 missing M6_TARGET_ROLLBACK_BACKUP_EVIDENCE.
- M6.6 missing M6_TARGET_ROLLBACK_SMOKE_EVIDENCE.
- M6.6 missing M6_TARGET_ROLLBACK_NOTES.
- M6.6 missing M6_TARGET_SYNTHETIC_EVIDENCE_PATH.
- M6.6 requires M6_TARGET_RELEASE_ENVIRONMENT to identify a target, staging, pilot, or self-hosted environment.
- M6.6 missing M6_TARGET_RELEASE_ARTIFACT_REF.
- M6.6 missing M6_TARGET_RELEASE_ENV_FINGERPRINT.
- M6.6 requires M6_TARGET_RELEASE_IDENTITY_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_BACKUP_RESTORE_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_ROLLBACK_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_CAPACITY_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_SYNTHETIC_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_QUEUE_READINESS=passed.
- M6.6 requires M6_TARGET_RELEASE_OBSERVABILITY_READINESS=passed.
- M6.6 missing M6_TARGET_RELEASE_CAPACITY_EVIDENCE_PATH.
- M6.6 missing M6_TARGET_RELEASE_QUEUE_EVIDENCE_PATH.
- M6.6 missing M6_TARGET_RELEASE_OBSERVABILITY_EVIDENCE_PATH.

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
- REDIS_URL
- BACKUP_REDIS_SNAPSHOT_TARGET
- BACKUP_REDIS_CHECKPOINT_VALIDATED=true

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
- Durable queue Redis persistence snapshot and checkpoint metadata are captured.
- Evidence is redacted and records the target environment label.

Notes:

- Local backup evidence proves shape only unless generated from the real target restore drill.

#### M6.4 Durable Queue Target Evidence

- Objective: Prove the target API is running durable queue mode with Redis/BullMQ transport and PostgreSQL job-state readiness.

Required inputs:

- WISEEFF_API_BASE_URL
- M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION

Commands:

- `npm run queue:check -- --base-url <target-url>`

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
- `npm run observability:target-evidence`

Evidence paths:

- `docs/generated/m6-observability-config-evidence.md`
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

- `npm run capacity:gate -- --target-url "<target-url>" --environment "<target-environment>"`
- `npm run rollback:rehearsal --`
- `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime`
- `npm run selfhost:release-gate --`
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
