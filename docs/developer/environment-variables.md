# Environment Variables

> Chinese: [Chinese](../zh-CN/developer/environment-variables.md)

Use `.env.example` as the local non-HDC staging profile. Copy it to `.env`, then fill the blank `AGENT_API_*` values when testing live Xiaoze LLM behavior.

## Core Runtime

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | API startup | Production enables stricter config gates. |
| `HOST` | `127.0.0.1` | API startup | Self-hosted containers set `0.0.0.0` so the reverse proxy can reach the API. |
| `PORT` | `8787` | API startup | The frontend assumes `127.0.0.1:8787` in API mode by default. |
| `DATABASE_URL` | local PostgreSQL URL | Migrations, seeds, API mode, E2E | PostgreSQL is the source of truth. |
| `WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | smoke clients | Used by M5 smoke scripts. |
| `VITE_WISEEFF_RUNTIME_MODE` | `api` (code default and `.env.example`) | frontend runtime | `npm run dev` / `npm run dev:all` also inject `api`. Use `mock` for frontend-only tests or demos. |
| `VITE_WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | frontend API runtime | Must point at the API process. |

## Auth

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `AUTH_MODE` | `production` in `.env.example` | production-mode smoke | Use `development` only for local development-user flows. |
| `AUTH_PROVIDER` | `local` in local `.env.example`; `oidc` in self-hosted example | production auth | `local` is the default local account/session provider, `oidc` is for target self-hosted SSO, and `hmac` is for explicit local smoke/test only. |
| `AUTH_TOKEN_ISSUER` | `wiseeff-local` | optional local HMAC smoke | Must match signed local smoke token issuer when `AUTH_PROVIDER=hmac`. |
| `AUTH_TOKEN_HMAC_SECRET` | local sample secret | optional local HMAC smoke | Use only for local smoke/test profiles. |
| `AUTH_OIDC_ISSUER` | unset locally | self-hosted OIDC | OIDC issuer URL, for example `https://id.example.com/realms/wiseeff`. |
| `AUTH_OIDC_AUDIENCE` | unset locally | self-hosted OIDC | Expected access-token audience, for example `wiseeff-api`. |
| `AUTH_OIDC_JWKS_URI` | unset locally | self-hosted OIDC override | Optional JWKS endpoint when discovery should not be used. |
| `M5_SMOKE_AUTHORIZATION` | local admin bearer token | M5 smoke | Grants `admin:access` to pilot-readiness smoke. |
| `WISEEFF_SMOKE_AUTHORIZATION` | local admin bearer token | M5 smoke | Alternate name accepted by smoke scripts. |
| `M6_SELFHOSTED_SMOKE_AUTHORIZATION` | unset locally | self-hosted smoke | Preferred self-hosted Admin bearer token; use an OIDC access token in target environments. |
| `M6_IDENTITY_AUTHORIZATION` | unset locally | M6.2 identity evidence | Admin OIDC bearer token used by `npm run identity:check` for `/api/v1/me`. |
| `M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION` | unset locally | M6.2 identity evidence | Token expected to be rejected for issuer mismatch. |
| `M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION` | unset locally | M6.2 identity evidence | Token expected to be rejected for audience mismatch. |
| `M6_IDENTITY_EXPIRED_AUTHORIZATION` | unset locally | M6.2 identity evidence | Expired token expected to be rejected. |

To exercise the productized local login/register UI, keep the default `AUTH_MODE=production` and `AUTH_PROVIDER=local`, run database migrations so `user_password_credentials` and `auth_sessions` exist, then start the API and API-mode frontend. Local accounts do not require `AUTH_TOKEN_*` or `AUTH_OIDC_*` values. Registration uses username, a fixed organization choice, and the selected platform role; email verification is intentionally not available yet. With the local development default `NODE_ENV=development`, self-registered accounts join the seeded `org-chargelab` / `ChargeLab` demo organization so seeded data is visible after login. Set `NODE_ENV` to a non-development value only when you want local accounts to remain isolated in their selected department organizations.

## Object Store

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `OBJECT_STORE_MODE` | `local` | log uploads, readiness | Production requires `s3`. |
| `OBJECT_STORE_ROOT` | `.wiseeff-object-store` | local object store | Ignored by Git. |
| `OBJECT_STORAGE_ENDPOINT` | blank/commented | S3/OSS mode | Target-environment value. |
| `OBJECT_STORAGE_BUCKET` | blank/commented | S3/OSS mode | Target-environment value. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | blank/commented | S3/OSS mode | Secret. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | blank/commented | S3/OSS mode | Secret. |
| `OBJECT_STORAGE_REGION` | blank/commented | S3/OSS mode | Optional provider region. |
| `OBJECT_STORAGE_TLS_POLICY` | `required` in self-hosted profile | M6.3 target evidence | Target evidence must use TLS unless an explicitly local lab exception is recorded. |
| `OBJECT_STORAGE_PATH_STYLE` | `true` in self-hosted profile | S3-compatible self-hosting | Use path-style addressing for self-hosted providers that do not support virtual-host buckets. |
| `OBJECT_STORAGE_HEALTH_PREFIX` | `.health/` | readiness probe | Prefix for write/read/head/delete health probe objects. |
| `OBJECT_STORAGE_RETENTION_CLASS` | `pilot-default` | log metadata | Stored as object metadata for retention evidence. |

## DTS Config Set Validation Gate

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `DTS_VALIDATION_MODE` | `block` (code default; unset in `.env.example`) | P2 config-set baseline release gate | `block` fails `releaseBaseline` with `409` when `dtc` reports an error or the `dtc` binary is unavailable. `warn` always passes but marks the result `requiresConfirmation: true`. `off` skips validation entirely (never spawns `dtc`). Set `warn` on self-hosted targets that do not ship a `dtc` binary. |
| `DTS_IDENTITY_FALLBACK_MODE` | `allow` (code default) | DTS file sync / structured-edit identity resolve | When `source_file_name`/`source_node_path` is unbound, matching may fall back to `(name, module)`. `allow` keeps that path and counts `identityFallbackUses`. `warn` allows fallback and writes a `parameter-file-identity-fallback` audit event. `deny` refuses fallback on sync with `409 VALIDATION_FAILED`; structured-edit still may insert a new PPV+source bind (new bind ≠ fallback). |
| `DTS_ENABLE_DT_SCHEMA` | off (`0` / unset) | Optional dt-schema binding checks after `dtc` | Set `1`/`true`/`on` to run the optional schema hook (`enableDtSchema` / injectable `schemaRunner`). |
| `DTS_DT_SCHEMA_MODE` | `warn` | Schema-tool missing / schema error policy | `warn` records a warning and does not hard-fail when the schema tool is unavailable. `block` elevates unavailability (and schema errors) to hard failures when the outer validation mode is not `warn`. |
| `PARAMETER_IDENTITY_MAINTENANCE_TOKEN` | unset | `parameter-identities:migrate --apply` | Shared secret required with `--maintenance-token` during the semantic identity maintenance window. Dry-run does not require it. Never commit the real token. |

`DtcValidator` (`server/modules/parameter-files/dtcValidator.ts`) runs the system `dtc` compiler in a restricted subprocess: an isolated temp directory, a minimal `PATH`-only environment, and a hard timeout that kills the child on expiry. When `dtc` is not on `PATH`, the validator degrades instead of hanging: `block` reports `ok:false` (release stays blocked pending a human decision to switch to `warn`), `warn` reports `ok:true` with a diagnostic noting validation was skipped, and `off` never calls `dtc` at all. Every gate run — pass, fail, or degraded — writes a `validation.gate` audit event. Containerized/`gVisor` sandboxing for `dtc` is intentionally **not** implemented; see `docs/SECURITY.md`.

## Durable Queue

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `LOG_WORKER_ENABLED` | `true` | log worker startup | Self-hosted API containers set `false`; the worker container runs `npm run worker:logs`. |
| `LOG_ANALYSIS_QUEUE_MODE` | `polling` | log worker dispatch | Use `durable` for self-hosted Redis/BullMQ dispatch. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | durable queue mode | Required when `LOG_ANALYSIS_QUEUE_MODE=durable`. |
| `LOG_ANALYSIS_QUEUE_PREFIX` | `wiseeff` | BullMQ key namespace | Use a unique prefix per environment if Redis is shared. |
| `LOG_ANALYSIS_QUEUE_ATTEMPTS` | `4` | retry/dead-letter policy | Aligns BullMQ attempts with PostgreSQL job retry state. |
| `LOG_ANALYSIS_QUEUE_BACKOFF_MS` | `1000` | retry/dead-letter policy | Base exponential backoff in milliseconds. |
| `LOG_ANALYSIS_QUEUE_CONCURRENCY` | `1` | worker throughput | Increase only after capacity testing. |

## Device Gateway

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `DEBUG_DEVICE_GATEWAY_MODE` | `multi` (code default) | debugging runtime | Override only for targeted device-lab evidence (`hdc`, `adb`, or `simulator`). |
| `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION` | `true` | non-customer staging simulator mode | Never use for customer production signoff. |
| `HDC_TIMEOUT_MS` | `5000` | HDC adapter | Command timeout budget. |
| `ADB_TIMEOUT_MS` | `5000` | ADB adapter | Command timeout budget. |
| `HDC_DEVICE_LAB_AVAILABLE` | unset | HDC smoke | Set only when real target values are available. |
| `HDC_SMOKE_PROJECT_ID` | `aurora` | HDC device-lab | Operation context for permissions, session records, node operations, audit, and evidence. |
| `HDC_SMOKE_DEVICE_ID` | auto lab row | HDC device-lab | Optional validation override for the lab-only WiseEff HDC device inventory id. |
| `HDC_SMOKE_TARGET_REF` | auto | HDC device-lab | Optional validation override for the single `hdc list targets` target. |
| `HDC_SMOKE_PARAMETER_ID` | auto lab parameter | HDC device-lab | Optional validation override for the lab-only temporary-node parameter id. |
| `HDC_SMOKE_NODE_PATH` | `/data/local/tmp/wiseeff_hdc_smoke_node` | HDC device-lab | Optional validation override for the lab-only temporary file node. |
| `HDC_SMOKE_ORIGINAL_VALUE` | `wiseeff-hdc-original` | HDC device-lab | Optional lab temporary-node setup value. |
| `HDC_SMOKE_WRITE_VALUE` | `wiseeff-hdc-updated` | HDC device-lab | Optional lab write value used after explicit confirmation. |
| `HDC_SMOKE_CONFIRM_WRITE` | none | HDC device-lab | Required for HDC write/readback evidence; must equal `confirm-high-risk-write`. |
| `HDC_SMOKE_CONFIRM_ROLLBACK` | none | HDC device-lab | Required for HDC snapshot restoration; must equal `confirm-rollback`. |
| `HDC_SMOKE_EXPECT_READ_PATTERN` | unset | HDC device-lab | Optional regex validation for read evidence. |
| `HDC_SMOKE_USER_ID` | `u-xu-yun` | HDC device-lab | Optional smoke actor override. |
| `ADB_DEVICE_LAB_AVAILABLE` | unset | ADB smoke | Set only when a local ADB device and approved read/write targets are available. |
| `ADB_SMOKE_PROJECT_ID` | none | ADB device-lab | Required when `DEBUG_DEVICE_GATEWAY_MODE=adb` and `ADB_DEVICE_LAB_AVAILABLE=true`; operation context only. |
| `ADB_SMOKE_DEVICE_ID` | auto | ADB device-lab | Optional validation override for the discovered WiseEff ADB device inventory id. |
| `ADB_SMOKE_TARGET_REF` | auto | ADB device-lab | Optional validation override for the single ready `adb devices` serial. |
| `ADB_SMOKE_PARAMETER_ID` | auto | ADB device-lab | Optional validation override for the shared default ADB smoke parameter id. |
| `ADB_SMOKE_NODE_PATH` | auto | ADB device-lab | Optional validation override for the server-side binding node path. |
| `ADB_SMOKE_ENABLE_WRITE` | `false` | ADB device-lab | Enables optional write/readback/rollback; never inferred from auto-configuration. |
| `ADB_SMOKE_WRITE_VALUE` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |
| `ADB_SMOKE_CONFIRM_WRITE` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |
| `ADB_SMOKE_CONFIRM_ROLLBACK` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |

## Xiaoze LLM And Agent Flags

API mode always includes Xiaoze; mock mode has no Agent UI. The backend always registers the AG-UI SSE endpoint when the database is available.

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `AGENT_API_BASE_URL` | blank | live Xiaoze LLM | OpenAI-compatible endpoint. Never commit secrets or private endpoints. |
| `AGENT_MODEL` | blank | live Xiaoze LLM | Fill locally for live model runs. |
| `AGENT_API_KEY` | blank | live Xiaoze LLM | Secret. |
| `AGENT_API_TIMEOUT_MS` | `30000` | live Xiaoze LLM | Request timeout for LangChain `ChatOpenAI`. |
| `XIAOZE_MODEL` | blank (falls back to `AGENT_MODEL`) | live Xiaoze runs | Optional override for the Xiaoze LangGraph agent model id. |
| `XIAOZE_CHECKPOINTER` | `memory` | production Xiaoze planning resume | Use `postgres` in production/self-hosted so LangGraph checkpoints survive restarts and multi-replica routing; tables are ensured by `npm run db:migrate`. `memory` remains valid for local dev and tests. |
| `XIAOZE_REASONING_FALLBACK_HEURISTIC` | `false` | live Xiaoze LLM | Opt-in legacy language heuristic for splitting untagged model content into reasoning vs answer. Keep `false` in production; structured `reasoning_content` / `<think>` tags are the primary path. |
| `XIAOZE_PROACTIVE_ENABLED` | `false` | proactive suggest API | Set `true` to register read-only `POST /api/v1/agent/xiaoze/suggest`. Default off; opt-in only. |
| `VITE_XIAOZE_PROACTIVE_ENABLED` | `false` | proactive suggestions UI | Mounts `useXiaozeSuggestions` in `AgentInsightBar`. Requires API `XIAOZE_PROACTIVE_ENABLED=true`. Default off. |
| `VITE_XIAOZE_PROMPT_DEBUG` | `false` | frontend dev tooling | Opt-in prompt/debug surfacing for Xiaoze development. |

## M5 Evidence

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `M5_CONTRACT_CHECK_PASSED` | `true` | local smoke profile | Represents fresh contract check evidence only after running it. |
| `M5_CONTRACT_ARTIFACT_CHECKED_AT` | unset | pilot gate | Timestamp alternative for contract evidence. |
| `M5_BACKUP_RESTORE_DRILL_AT` | unset | pilot-ready backup gate | Set only after a real drill passes. |
| `M5_SMOKE_ALLOW_NO_API` | `false` | smoke skip control | Use `true` only for local documentation runs that intentionally skip API probing. |

## M6 Backup And Restore

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `OBJECT_STORAGE_PROVIDER` | `s3-compatible` | M6.3 evidence | Name the selected self-hosted provider, such as `rustfs`, `minio-compatible`, or `ceph-rgw`. |
| `BACKUP_DRILL_ENVIRONMENT` | `local` | M6.3 evidence | Human-readable environment label. |
| `BACKUP_DATABASE_COMMAND` | `pg_dump --format=custom` | M6.3 evidence | Operator-approved database backup command summary. |
| `BACKUP_DATABASE_TARGET` | self-hosted example path | M6.3 evidence | Backup destination for PostgreSQL dump evidence. |
| `BACKUP_OBJECT_STORAGE_TARGET` | self-hosted example path | M6.3 evidence | Backup/export destination for object storage. |
| `RESTORE_DATABASE_URL` | isolated restore example | M6.3 restore drill | Must not equal `DATABASE_URL`. |
| `RESTORE_OBJECT_STORAGE_BUCKET` | `wiseeff-restore` in examples | M6.3 restore drill | Must not equal the live `OBJECT_STORAGE_BUCKET`. |
| `RESTORE_OBJECT_STORAGE_PREFIX` | `m6-drill/` in examples | M6.3 restore drill | Must be non-empty, end with `/`, and remain isolated from live data. |
| `REDIS_URL` | unset | M6.4+ queue backup | Until M6.4, queue evidence remains conditional. |

## Self-Hosted Runtime

M6.1 adds `ops/self-hosted/.env.example` for Linux deployments. M6.2 switches the target identity profile to OIDC. It keeps secrets blank and expects the operator to fill DNS/TLS, PostgreSQL password, OIDC issuer/audience, S3-compatible object storage, Xiaoze LLM settings, and smoke authorization values.

| Variable | Self-hosted value | Notes |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Required inside the API container so Caddy can proxy to it. |
| `LOG_WORKER_ENABLED` | `false` in API, `true` in worker | Prevents the API container from running a duplicate in-process worker. |
| `LOG_ANALYSIS_QUEUE_MODE` | `durable` | Uses Redis/BullMQ transport while PostgreSQL remains the source of truth. |
| `REDIS_URL` | `redis://redis:6379` | Compose Redis service used by API and worker containers. |
| `BACKUP_REDIS_SNAPSHOT_TARGET` | restore-drill snapshot path | Required by `npm run m6:target-plan` for final M6.3 target evidence when durable queue mode is in scope. |
| `BACKUP_REDIS_CHECKPOINT_VALIDATED` | `true` after Redis checkpoint validation | Required by `npm run m6:target-plan`; target M6.3 evidence must prove durable queue persistence was captured. |
| `WISEEFF_SITE_HOST` | operator-provided DNS | Used by Caddy and frontend API base URL. |
| `WISEEFF_TLS_EMAIL` | operator-provided email | Used by Caddy ACME/TLS. |
| `AUTH_PROVIDER` | `oidc` | Target self-hosted production identity provider. Use `local` only for a self-managed deployment that intentionally uses WiseEff local accounts instead of external SSO. |
| `AUTH_OIDC_ISSUER` | operator-provided issuer | Must match the access-token `iss` claim. |
| `AUTH_OIDC_AUDIENCE` | `wiseeff-api` or operator value | Must match the access-token `aud` claim. |
| `M6_SELFHOSTED_SMOKE_AUTHORIZATION` | Admin OIDC bearer token | Preferred self-hosted smoke token; M5 smoke token names are accepted only for compatibility. |
| `M6_IDENTITY_*` token variables | target OIDC test tokens | Used by `npm run identity:check`; keep unset locally unless a real self-hosted IdP/API target is available. |
| `M6_IDENTITY_BROWSER_RUNTIME` | `passed` only after target browser proof | Required by `npm run m6:target-plan`; records target browser token acquisition, refresh, and logout proof. |
| `M6_IDENTITY_USER_GOVERNANCE_EVIDENCE` | `passed` only after target operation evidence | Required by `npm run m6:target-plan`; records that target `PERM-USER-MGMT-001` operation evidence includes UI, API, DB, and audit proof. |
| `M6_OBSERVABILITY_TARGET_ENVIRONMENT` | target/staging/pilot/self-hosted label | Required by `npm run observability:target-evidence` and `npm run m6:target-plan`. Must not be `local-*`. |
| `M6_OBSERVABILITY_CONFIG_STATUS` | `passed` after `npm run observability:check` | Required before target observability evidence can be treated as executable. |
| `M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE` | `passed` after target scrape proof | Required by `npm run observability:target-evidence`; keep pending until Prometheus has scraped the deployed target. |
| `M6_OBSERVABILITY_ALERTMANAGER_ROUTING` | `passed` after alert route proof | Required by `npm run observability:target-evidence`; keep pending until alert routing has been exercised. |
| `M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT` | `passed` after dashboard proof | Required by `npm run observability:target-evidence`; keep pending until dashboards are imported or screenshotted. |
| `M6_OBSERVABILITY_PROMETHEUS_QUERY` | evidence reference or query URL | Redacted proof reference for Prometheus target scrape. |
| `M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE` | evidence reference | Redacted proof reference for Alertmanager routing. |
| `M6_OBSERVABILITY_GRAFANA_EVIDENCE` | evidence reference | Redacted proof reference for Grafana dashboard import. |
| `WISEEFF_CAPACITY_TARGET_URL` | target API URL | Required by `npm run m6:target-plan` and `npm run capacity:gate`; must be non-local. |
| `WISEEFF_CAPACITY_AUTHORIZATION` | target Admin bearer token | Required for target capacity smoke requests; redacted in generated evidence. |
| `M6_TARGET_CAPACITY_OBSERVED_*` | observed target metrics | Plan-only inputs for p95 latency, error rate, throughput, CPU, memory, DB connections, and queue backlog collected from the target. |
| `M6_TARGET_CAPACITY_OBJECT_STORE_PROBE` | `passed` after target probe | Required before the M6.6 target execution plan is ready. |
| `M6_TARGET_ROLLBACK_*` | target rollback rehearsal inputs | Plan-only inputs that map to `npm run rollback:rehearsal -- ...`; include target environment, artifact refs, approval/window, passed step statuses, database/object-store restore statuses, backup evidence, smoke evidence, and notes. |
| `M6_TARGET_SYNTHETIC_EVIDENCE_PATH` | target browser evidence path | Required evidence path after `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime`. |
| `M6_TARGET_RELEASE_*` | target release gate inputs | Plan-only inputs that map to `npm run selfhost:release-gate -- ...`; include target environment, artifact, env fingerprint, passed readiness statuses, and capacity/queue/observability evidence paths. |

M6.3 adds `ops/self-hosted/storage/object-store.env.example` for the S3-compatible storage profile. Run `npm run restore:drill`, `npm run backup:drill`, and `npm run backup:check` after filling isolated backup and restore targets.

## Observability

M6.5 observability config lives in `ops/self-hosted/observability/`. It does not require application secrets by itself, but the target deployment must choose a private metrics access pattern before pilot use.

| Setting | Expected value | Notes |
| --- | --- | --- |
| Metrics endpoint | `http://api:8787/metrics` from private network | Prometheus should scrape the API container over the compose or operations network. |
| Public `/metrics` exposure | disabled | If reverse-proxied, restrict by VPN, fixed IP allowlist, mTLS, or stronger equivalent control. |
| Grafana datasource | Prometheus datasource selected during import | Dashboard JSON uses a `DS_PROMETHEUS` datasource variable. |
| Alert runbook links | `docs/runbooks/observability-operations.md#...` | Every alert rule must keep a `runbook_url` annotation. |
