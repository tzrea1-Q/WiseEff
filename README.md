# WiseEff

> Chinese: [Chinese](docs/zh-CN/root/README.md)

WiseEff is an AI-assisted enterprise efficiency platform prototype. It has moved from a frontend-only demo toward an M0-M6 productization baseline with a Vite/React/TypeScript frontend, mock and API runtimes, a TypeScript modular backend, PostgreSQL migrations, OpenAPI contract checks, production auth boundaries, worker/object-store seams, Redis/BullMQ durable queue support, HDC gateway seams, live Agent provider seams, and admin-gated pilot/readiness endpoints.

The repository is suitable for controlled staging and pilot evidence collection. It must not be described as broadly production-ready until real target-environment evidence exists for live API, PostgreSQL-backed E2E, HDC device lab, backup/restore, rollback, identity, queue, observability, capacity, and live Agent provider checks.

## Requirements

### Development machines

Use a development machine or CI runner with:

- Node.js 22 LTS, or another Node.js version satisfying Vite 7 requirements.
- npm 11, or a compatible npm version.
- Docker Engine for the one-command local PostgreSQL path.

Vite 7 requires Node.js `^20.19.0 || >=22.12.0`. The repository includes `.nvmrc`; new development machines should use Node 22.

Node.js 22 official Linux binaries require glibc 2.28 or newer. Ubuntu 18.04 and other older hosts cannot run the repository npm scripts natively on the host OS.

### Linux runtime servers

A Linux server can run the self-hosted stack without installing Node.js on the host. The application runs inside Docker containers built from `node:22-alpine`.

Server prerequisites:

- Docker Engine 20.10 or newer.
- Docker Compose v2 plugin, or standalone `docker-compose` 1.28 or newer.
- Ports `80` and `443` open for the reverse proxy.
- DNS for `WISEEFF_SITE_HOST`.

Use `./scripts/compose` in `ops/self-hosted/` on the server. It accepts either `docker compose` or `docker-compose`, passes `-f compose.yaml` automatically for standalone Compose, and rejects versions that are too old for the self-hosted compose file.

Detailed runbook: [docs/runbooks/self-hosted-runtime.md](docs/runbooks/self-hosted-runtime.md).

## Development On Your Machine

Install dependencies, prepare local env, and start the full local stack:

```bash
npm ci
copy .env.example .env
npm run dev:all
```

`npm run dev:all` auto-detects `docker compose` or `docker-compose`, starts PostgreSQL from `compose.yaml`, waits for readiness, runs migrations and seeds, then starts the WiseEff API and API-mode Vite frontend. Start from `.env.example`; it prepares local PostgreSQL, local object storage, simulator device gateway, production-mode local account auth defaults, optional HMAC smoke inputs, and the Pi-backed live Agent provider format. If live Agent model/key values are blank, local startup falls back to the deterministic Agent provider.

Development services bind to `127.0.0.1`. Vite usually prints this URL after startup:

```text
http://127.0.0.1:5173/
```

Common development and verification commands:

```bash
npm run dev:all
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
npm run docs:check
npm run selfhost:check
npm run observability:check
npm run queue:check -- --base-url http://127.0.0.1:8787
```

Use `npm run docs:check` for documentation governance, local Markdown links, bilingual developer-doc pairs, and required `.env.example` coverage.

## Deploy On A Linux Server

Run the service stack on the server. Keep development, unit tests, E2E, and smoke checks on another machine with Node.js 22.

On the server:

```bash
cd ops/self-hosted
cp .env.example .env
chmod 600 .env
# Fill every blank secret, OIDC value, object-store endpoint, and public URL in .env.
./scripts/compose --env-file .env up -d --build
./scripts/compose --env-file .env ps
./scripts/compose --env-file .env logs --tail=100 api worker proxy
```

Important deployment notes:

- Set `VITE_WISEEFF_API_BASE_URL` to the final public WiseEff URL before `./scripts/compose ... up -d --build`. Rebuild when that URL changes.
- Do not run `db:seed:*` scripts against customer or production data.
- Do not commit `ops/self-hosted/.env`.

For controlled self-managed deployments with local accounts (`AUTH_PROVIDER=local` in `ops/self-hosted/.env`), bootstrap the first admin after the stack is up:

```bash
./scripts/compose --env-file .env exec api npm run admin:bootstrap -- \
  --username admin.ops \
  --password 'ReplaceWithAStrongPassword'
```

For internal staging or demo hosts only, import bundled M0–M3 seed data:

```bash
./scripts/seed-demo-data.sh
```

Migration `0021_baseline_platform_roles.sql` seeds platform roles and local-registration organizations automatically on API startup.

Upgrade an existing server deployment:

```bash
git fetch origin
git checkout <release-commit>
cd ops/self-hosted
./scripts/compose --env-file .env up -d --build
```

Graceful stop:

```bash
cd ops/self-hosted
./scripts/compose --env-file .env stop api worker web proxy
```

More operations: [docs/runbooks/self-hosted-runtime.md](docs/runbooks/self-hosted-runtime.md) and [ops/self-hosted/README.md](ops/self-hosted/README.md).

## Verify A Deployed Server From Another Machine

Run these from a development machine or CI checkout that has Node.js 22. Point them at the deployed server URL:

```bash
npm ci
npm run selfhost:check

npm run selfhost:smoke \
  -- --env-file ops/self-hosted/.env \
  --base-url https://wiseeff.example.com \
  --allow-only-blocked=deviceGateway

npm run queue:check \
  -- --env-file ops/self-hosted/.env \
  --base-url https://wiseeff.example.com
```

`--allow-only-blocked=deviceGateway` is acceptable only for a non-HDC self-hosted staging target after the other readiness gates are real. Full pilot readiness still requires HDC evidence.

Optional release and capacity gates:

```bash
npm run capacity:gate -- --target-url https://wiseeff.example.com
npm run selfhost:release-gate -- --target-environment staging-a --artifact-ref <artifact> --env-fingerprint <sha256>
```

## Runtime Modes

The frontend defaults to **API mode** for local development and production-oriented work. `npm run dev` and `npm run dev:all` start the Vite app with API runtime unless you override the environment.

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

Use mock mode only for frontend-only demos or when you explicitly want in-memory prototype data without a running API:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

Production builds must not use mock data as a business data source. Backend writes must enforce authz, validation, transactions, and audit on the server side.

## Repository Map

- `AGENTS.md`: agent guide and repository routing.
- `CONTRIBUTING.md`: contributor setup, planning, docs, and verification workflow.
- `ARCHITECTURE.md`: high-level runtime and module map.
- `docs/`: product, architecture, developer, API, security, reliability, runbook, and plan knowledge base.
- `src/`: Vite React frontend, domain types, ports, mock runtime, HTTP client, components, pages, and tests.
- `server/`: modular backend API, auth, audit, domain modules, operations, observability, and database foundations.
- `ops/self-hosted/`: self-hosted Linux runtime templates, checks, storage, release, and smoke guidance.

Developers should start with `CONTRIBUTING.md` and `docs/developer/README.md`. API usage starts at `docs/api/README.md`; security review starts at `docs/security/README.md`; runbooks start at `docs/runbooks/README.md`.
