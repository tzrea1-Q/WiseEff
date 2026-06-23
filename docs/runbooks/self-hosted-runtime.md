# Self-Hosted Runtime Runbook

> Chinese: [Chinese](../zh-CN/runbooks/self-hosted-runtime.md)

This runbook covers the M6.1 self-hosted Linux baseline plus the M6.4 durable queue runtime shape. It proves WiseEff can run as separate API, web, worker, PostgreSQL, Redis, and reverse-proxy services on a controlled Linux host. It does not replace the remaining M6 hardening for OIDC, self-hosted object storage evidence, observability, rollback, and capacity.

## Preconditions

- A Linux server or VM. The baseline expectation is Ubuntu 22.04/24.04 LTS, Debian 12, Rocky Linux 9, or another distribution that can run a supported Docker Engine release. Older hosts such as Ubuntu 18.04 may still work with the standalone `docker-compose` binary through `./scripts/compose`.
- Docker Engine **20.10+** and a Compose CLI usable by the operator account. Use `./scripts/compose` in this directory; it accepts `docker compose` or standalone `docker-compose` **1.28+** and rejects older versions.

```bash
docker version
./scripts/compose version || docker compose version || docker-compose --version
```

Node.js is **not** required on the runtime server. Run `npm run selfhost:check`, `npm run selfhost:smoke`, and other repository verification commands from a development machine or CI runner with Node.js 22.

- DNS for `WISEEFF_SITE_HOST`.
- Ports `80` and `443` open to the intended network.
- At least 20 GB free disk for a pilot baseline, with PostgreSQL growth monitored separately:

```bash
df -h
docker system df
```

- A backup target outside the Docker data root, for example `/var/backups/wiseeff` or a mounted NAS path. M6.3 turns this into a restore-drilled procedure.
- A non-customer staging decision if `DEBUG_DEVICE_GATEWAY_MODE=simulator` is used.
- S3-compatible object-store endpoint credentials. M6.1 consumes the endpoint; M6.3 chooses and hardens the self-hosted provider.
- Live Agent provider URL, model, and API key if `/health/ready` should report Agent readiness.

## Prepare Environment

```bash
cd ops/self-hosted
cp .env.example .env
chmod 600 .env
```

Fill every blank value in `.env`. The self-hosted API container uses:

- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `LOG_WORKER_ENABLED=false`

The separate worker service runs `npm run worker:logs`. In M6.4 durable mode, API and worker both use Redis/BullMQ through `REDIS_URL`, while PostgreSQL remains the source of truth for job state.

Do not commit `ops/self-hosted/.env`. The repository `.dockerignore` also excludes `.env` files from image build contexts so operator secrets do not get baked into container layers.

`VITE_WISEEFF_API_BASE_URL` is a build-time frontend value. Set it to the final public WiseEff URL before running `./scripts/compose --env-file .env up -d --build`; rebuilding is required when that URL changes.

## Start

```bash
./scripts/compose --env-file .env up -d --build
./scripts/compose --env-file .env ps
./scripts/compose --env-file .env logs --tail=100 api worker proxy
```

The API service runs migrations before starting. Migration `0021_baseline_platform_roles.sql` seeds the platform roles and local-registration organizations required for local account signup. Do not run demo seed scripts against customer data.

## Bootstrap The First Local Admin

Use this only for controlled self-managed deployments with `AUTH_PROVIDER=local`. It creates the first and only bootstrap admin when no admin role binding exists yet.

```bash
./scripts/compose --env-file .env exec api npm run admin:bootstrap -- \
  --username admin.ops \
  --password 'ReplaceWithAStrongPassword' \
  --name 'Platform Admin' \
  --organization 硬件部
```

Then log in through the UI with that username and password. Additional admins should be created from **User Permissions** after login.

If bootstrap reports that an admin already exists, use the governance UI or reset the deployment database; the command is intentionally one-shot for safety.

## Import Demo Seed Data

For internal staging or demo hosts only:

```bash
./scripts/compose --env-file .env exec api npm run db:seed:all
```

Or from `ops/self-hosted/`:

```bash
./scripts/seed-demo-data.sh
```

This runs `db:seed:m0` through `db:seed:m3` in order. Demo data is stored under the `org-chargelab` organization. Move a local account into that organization or create users there if you need to browse the seeded Aurora project data.

## Verify Configuration

From the repository root:

```bash
npm run selfhost:check
npm run queue:check -- --env-file ops/self-hosted/.env --base-url https://wiseeff.example.com
```

This validates package scripts, compose services, persistent PostgreSQL and Redis storage, env keys, Caddy routing, and target durable queue readiness.

## Smoke

Before expecting the non-HDC smoke to be blocked only by `deviceGateway`, run the backup/restore drill and set `M5_BACKUP_RESTORE_DRILL_AT` to the real restore-validation timestamp. M6.3 will harden this procedure, but the existing pilot-readiness route already treats backup evidence as a readiness gate.

For non-HDC staging:

```bash
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://wiseeff.example.com --allow-only-blocked=deviceGateway
```

For full pilot readiness, omit `--allow-only-blocked=deviceGateway` and provide real HDC evidence through the HDC runbook.

The smoke probes:

- `/health/live`
- `/health/ready`
- `/api/v1/me`
- `/api/v1/operations/pilot-readiness`

M6.4 requires `/health/ready` to include `dependencies.durableQueue.transport` and `dependencies.durableQueue.database`.

Evidence is written to `docs/generated/m6-self-hosted-runtime-evidence.md` by default. Do not commit evidence that exposes internal hostnames, customer identifiers, or secrets.

## Stop And Emergency Stop

Graceful stop:

```bash
cd ops/self-hosted
./scripts/compose --env-file .env stop api worker web proxy
```

Emergency stop while preserving PostgreSQL data:

```bash
cd ops/self-hosted
./scripts/compose --env-file .env stop api worker web proxy
./scripts/compose --env-file .env logs --tail=200 api worker > ../../test-results/self-hosted-emergency.log
```

Avoid `./scripts/compose down -v` unless the operator explicitly intends to delete persistent PostgreSQL and Caddy volumes.

## Upgrade

```bash
git fetch origin
git checkout <release-commit>
npm ci
npm run selfhost:check
cd ops/self-hosted
./scripts/compose --env-file .env up -d --build
```

After upgrade, run self-hosted smoke and review proxy/API/worker logs.

## Known M6.1 Boundaries

- Production identity is still the M5 HMAC boundary until M6.2.
- Object storage must be S3-compatible, but provider deployment and backup are M6.3.
- Queueing uses the M6.4 Redis/BullMQ durable transport in self-hosted durable mode. Target evidence still requires `queue:check` and `selfhost:smoke` against the deployed host.
- Metrics, dashboards, and alerts are M6.5.
- Release rollback and capacity gates are M6.6.
