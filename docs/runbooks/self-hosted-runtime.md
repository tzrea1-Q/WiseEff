# Self-Hosted Runtime Runbook

This runbook covers the M6.1 self-hosted Linux baseline. It proves WiseEff can run as separate API, web, worker, PostgreSQL, and reverse-proxy services on a controlled Linux host. It does not replace M6.2-M6.6 hardening for OIDC, self-hosted object storage, durable queues, observability, rollback, and capacity.

## Preconditions

- A Linux server or VM. The baseline expectation is Ubuntu 22.04/24.04 LTS, Debian 12, Rocky Linux 9, or another distribution that can run a supported Docker Engine release.
- Docker Engine and Docker Compose v2 are installed and usable by the operator account:

```bash
docker version
docker compose version
```

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

The separate worker service runs `npm run worker:logs`.

Do not commit `ops/self-hosted/.env`. The repository `.dockerignore` also excludes `.env` files from image build contexts so operator secrets do not get baked into container layers.

`VITE_WISEEFF_API_BASE_URL` is a build-time frontend value. Set it to the final public WiseEff URL before running `docker compose up -d --build`; rebuilding is required when that URL changes.

## Start

```bash
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 api worker proxy
```

The API service runs migrations before starting. Do not run seed scripts against customer data.

## Verify Configuration

From the repository root:

```bash
npm run selfhost:check
```

This validates package scripts, compose services, persistent PostgreSQL storage, env keys, and Caddy routing.

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

Evidence is written to `docs/generated/m6-self-hosted-runtime-evidence.md` by default. Do not commit evidence that exposes internal hostnames, customer identifiers, or secrets.

## Stop And Emergency Stop

Graceful stop:

```bash
cd ops/self-hosted
docker compose --env-file .env stop api worker web proxy
```

Emergency stop while preserving PostgreSQL data:

```bash
cd ops/self-hosted
docker compose --env-file .env stop api worker web proxy
docker compose --env-file .env logs --tail=200 api worker > ../../test-results/self-hosted-emergency.log
```

Avoid `docker compose down -v` unless the operator explicitly intends to delete persistent PostgreSQL and Caddy volumes.

## Upgrade

```bash
git fetch origin
git checkout <release-commit>
npm ci
npm run selfhost:check
cd ops/self-hosted
docker compose --env-file .env up -d --build
```

After upgrade, run self-hosted smoke and review proxy/API/worker logs.

## Known M6.1 Boundaries

- Production identity is still the M5 HMAC boundary until M6.2.
- Object storage must be S3-compatible, but provider deployment and backup are M6.3.
- Queueing still uses the M5 worker seam until M6.4.
- Metrics, dashboards, and alerts are M6.5.
- Release rollback and capacity gates are M6.6.
