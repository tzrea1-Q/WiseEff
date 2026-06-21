# WiseEff

> Chinese: [Chinese](docs/zh-CN/root/README.md)

WiseEff is an AI-assisted enterprise efficiency platform prototype. It has moved from a frontend-only demo toward an M0-M6 productization baseline with a Vite/React/TypeScript frontend, mock and API runtimes, a TypeScript modular backend, PostgreSQL migrations, OpenAPI contract checks, production auth boundaries, worker/object-store seams, Redis/BullMQ durable queue support, HDC gateway seams, live Agent provider seams, and admin-gated pilot/readiness endpoints.

The repository is suitable for controlled staging and pilot evidence collection. It must not be described as broadly production-ready until real target-environment evidence exists for live API, PostgreSQL-backed E2E, HDC device lab, backup/restore, rollback, identity, queue, observability, capacity, and live Agent provider checks.

## Requirements

- Node.js 22 LTS, or another Node.js version satisfying Vite 7 requirements.
- npm 11, or a compatible npm version.

Vite 7 requires Node.js `^20.19.0 || >=22.12.0`. The repository includes `.nvmrc`; new development machines should use Node 22.

## Quick Start

```bash
npm ci
copy .env.example .env
npm run dev:all
```

`npm run dev:all` starts Docker PostgreSQL from `compose.yaml`, waits for readiness, runs migrations and seeds, then starts the WiseEff API and API-mode Vite frontend. Start from `.env.example`; it prepares local PostgreSQL, local object storage, simulator device gateway, production-mode local account auth defaults, optional HMAC smoke inputs, and the Pi-backed live Agent provider format. If live Agent model/key values are blank, local startup falls back to the deterministic Agent provider.

Development services bind to `127.0.0.1`. Vite usually prints this URL after startup:

```text
http://127.0.0.1:5173/
```

## Common Commands

```bash
npm run dev:all
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
npm run docs:check
npm run queue:check -- --base-url http://127.0.0.1:8787
npm run selfhost:check
npm run observability:check
```

Use `npm run docs:check` for documentation governance, local Markdown links, bilingual developer-doc pairs, and required `.env.example` coverage.

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
