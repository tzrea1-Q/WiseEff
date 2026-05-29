# Local Development

This guide gets WiseEff running locally for API-mode development and acceptance checks.

## Requirements

- Node.js 22 LTS or a Vite 7-compatible Node version.
- npm 11 or a compatible npm version.
- PostgreSQL reachable from `DATABASE_URL`.
- Optional: a live OpenAI-compatible Agent provider if you are testing `AGENT_PROVIDER=live`.

## First Setup

```bash
npm ci
copy .env.example .env
```

On PowerShell, edit `.env` and fill only these blank values for live Agent provider checks:

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

If you are not testing live Agent provider behavior, set:

```text
AGENT_PROVIDER=deterministic
```

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

## Run The API, Worker, And Frontend

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

The default local URLs are:

```text
API: http://127.0.0.1:8787
Web: http://127.0.0.1:5173
```

If Vite chooses another port, use the terminal output.

## Runtime Modes

Mock mode is for demos and frontend component tests:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

API mode is the production-oriented development path:

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

Agent workflow:

```bash
npm run test:e2e -- e2e/agent.api.spec.ts
```

Use [verification-matrix.md](verification-matrix.md) before finishing work.
