# Environment Variables

Use `.env.example` as the local non-HDC staging profile. Copy it to `.env`, then fill only the live Agent provider URL, model, and API key if you are testing live provider behavior.

## Core Runtime

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | API startup | Production enables stricter config gates. |
| `HOST` | `127.0.0.1` | API startup | Self-hosted containers set `0.0.0.0` so the reverse proxy can reach the API. |
| `PORT` | `8787` | API startup | The frontend assumes `127.0.0.1:8787` in API mode by default. |
| `DATABASE_URL` | local PostgreSQL URL | Migrations, seeds, API mode, E2E | PostgreSQL is the source of truth. |
| `WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | smoke clients | Used by M5 smoke scripts. |
| `VITE_WISEEFF_RUNTIME_MODE` | `api` in `.env.example` | frontend runtime | Use `mock` for frontend-only tests or demos. |
| `VITE_WISEEFF_API_BASE_URL` | `http://127.0.0.1:8787` | frontend API runtime | Must point at the API process. |

## Auth

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `AUTH_MODE` | `production` in `.env.example` | production-mode smoke | Use `development` only for local development-user flows. |
| `AUTH_TOKEN_ISSUER` | `wiseeff-local` | production auth | Must match signed token issuer. |
| `AUTH_TOKEN_HMAC_SECRET` | local sample secret | production auth | Use real secrets outside local work. |
| `M5_SMOKE_AUTHORIZATION` | local admin bearer token | M5 smoke | Grants `admin:access` to pilot-readiness smoke. |
| `WISEEFF_SMOKE_AUTHORIZATION` | local admin bearer token | M5 smoke | Alternate name accepted by smoke scripts. |

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

## Device Gateway

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `DEBUG_DEVICE_GATEWAY_MODE` | `simulator` | debugging runtime | Use `hdc` for real device-lab evidence. |
| `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION` | `true` | non-customer staging simulator mode | Never use for customer production signoff. |
| `HDC_TIMEOUT_MS` | `5000` | HDC adapter | Command timeout budget. |
| `HDC_DEVICE_LAB_AVAILABLE` | unset | HDC smoke | Set only when real target values are available. |
| `HDC_SMOKE_*` | unset | HDC smoke | Project, device, target, parameter, node, and write value inputs. |

## Agent Provider

| Variable | Local default | Required for | Notes |
| --- | --- | --- | --- |
| `AGENT_PROVIDER` | `live` in `.env.example` | live provider path | Set `deterministic` for stable local tests without an API key. |
| `AGENT_API_FORMAT` | `openai` | live provider path | OpenAI-compatible chat completion format. |
| `AGENT_API_BASE_URL` | blank | live provider path | Fill locally; never commit secrets. |
| `AGENT_MODEL` | blank | live provider path | Fill locally. |
| `AGENT_API_KEY` | blank | live provider path | Secret. |
| `AGENT_API_TIMEOUT_MS` | `30000` | live provider path | Request timeout. |
| `AGENT_PROMPT_VERSION` | `m5-agent-v1` | traces | Include in provider trace metadata. |

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

M6.1 adds `ops/self-hosted/.env.example` for Linux deployments. It keeps secrets blank and expects the operator to fill DNS/TLS, PostgreSQL password, auth, S3-compatible object storage, Agent provider, and smoke authorization values.

| Variable | Self-hosted value | Notes |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Required inside the API container so Caddy can proxy to it. |
| `LOG_WORKER_ENABLED` | `false` in API, `true` in worker | Prevents the API container from running a duplicate in-process worker. |
| `WISEEFF_SITE_HOST` | operator-provided DNS | Used by Caddy and frontend API base URL. |
| `WISEEFF_TLS_EMAIL` | operator-provided email | Used by Caddy ACME/TLS. |
| `M6_SELFHOSTED_SMOKE_AUTHORIZATION` | admin bearer token | Preferred self-hosted smoke token; M5 smoke token names are also accepted. |

M6.3 adds `ops/self-hosted/storage/object-store.env.example` for the S3-compatible storage profile. Run `npm run restore:drill`, `npm run backup:drill`, and `npm run backup:check` after filling isolated backup and restore targets.
