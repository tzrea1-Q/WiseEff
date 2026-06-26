# Local Development

> Chinese: [Chinese](../zh-CN/developer/local-development.md)

This guide gets WiseEff running locally for API-mode development and acceptance checks.

## Requirements

- Node.js 22 LTS or a Vite 7-compatible Node version.
- npm 11 or a compatible npm version.
- Docker Desktop or Docker Engine for the one-command local PostgreSQL path.
- PostgreSQL reachable from `DATABASE_URL` if you run the services manually.
- Optional: live Xiaoze LLM credentials (`AGENT_API_*`) if you are testing non-deterministic Agent behavior.

## First Setup

```bash
npm ci
copy .env.example .env
```

On PowerShell, edit `.env` and fill only these blank values when testing live Xiaoze LLM behavior:

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

For acceptance runs without a live model, set `XIAOZE_DETERMINISTIC=true` instead of filling `AGENT_API_*`.

## One-Command Local Stack

Start the full local stack:

```bash
npm run dev:all
```

This command starts Docker PostgreSQL through `compose.yaml`, waits for it to accept connections, runs migrations and M0-M3 seeds, then starts the API and an API-mode Vite frontend. The API process starts the log-analysis worker when `DATABASE_URL` and local object storage are configured.

Before starting, the launcher checks the required local ports. If port `5432` is already used by a WiseEff PostgreSQL Docker container, it restarts that container and waits for readiness. If ports `8787` or `5173` are already used by WiseEff API/web services, it stops those existing processes so the current checkout can restart them. Unknown services on those ports are left untouched and reported as blockers.

The default local URLs are:

```text
API: http://127.0.0.1:8787
Web: http://127.0.0.1:5173
```

If Vite chooses another port, use the terminal output.

## Database

Create a local PostgreSQL database/user matching `.env.example`:

```text
postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff
```

Then run migrations and seed data:

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

Seeds are ordered by milestone:

- `db:seed:m0`: organization, users, roles, and project foundation.
- `db:seed:m1`: parameter-management data.
- `db:seed:m2`: log-analysis sample data.
- `db:seed:m3`: simulator debugging device and catalog.

## Manual Service Startup

Use the manual commands when you want separate terminals or an existing PostgreSQL instance instead of Docker Compose.

Start the API:

```bash
npm run dev:api
```

Start the log worker in another terminal when exercising log analysis:

```bash
npm run worker:logs
```

Start the frontend:

```bash
npm run dev
```

## Runtime Modes

Mock mode is for frontend-only demos and component tests:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

API mode is the default local development path. `npm run dev` and `npm run dev:all` set it explicitly; `.env.example` matches the same contract:

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

Production behavior must not depend on mock runtime data.

## Local Object Storage

The local profile uses file-backed storage:

```text
OBJECT_STORE_MODE=local
OBJECT_STORE_ROOT=.wiseeff-object-store
```

The directory is ignored by Git. Do not commit uploaded logs or backup/restore scratch directories.

## Device Gateway

Local development uses the simulator:

```text
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
```

Real HDC evidence belongs to the device-lab runbook and must not be replaced by simulator-only proof.

## Common Workflows

Parameter workflow:

```bash
npm run test:e2e -- e2e/parameter-management.api.spec.ts
```

Log workflow:

```bash
npm run test:e2e -- e2e/log-analysis.api.spec.ts
```

Debugging workflow:

```bash
npm run test:e2e -- e2e/debugging.api.spec.ts
```

Xiaoze workflow:

```bash
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Use [verification-matrix.md](verification-matrix.md) before finishing work.
