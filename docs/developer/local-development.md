# Local Development

> Chinese: [Chinese](../zh-CN/developer/local-development.md)

This guide gets WiseEff running locally for API-mode development and acceptance checks.

## Requirements

- Node.js 22 LTS or a Vite 7-compatible Node version.
- npm 11 or a compatible npm version.
- Docker Desktop or Docker Engine for the one-command local PostgreSQL path.
- PostgreSQL reachable from `DATABASE_URL` if you run the services manually.
- Device Tree Compiler (`dtc`). Install it through the repository bootstrap below; M1 seed treats it as required.
- Optional: live Xiaoze LLM credentials (`AGENT_API_*`) if you are testing non-deterministic Agent behavior.

## First Setup

```bash
npm ci
copy .env.example .env
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
```

`dts:toolchain:bootstrap` creates the ignored project venv at `.wiseeff-tools/dts-toolchain`, installs the pinned dtschema requirement, and ensures dtc/fdtoverlay match `tools/dts-toolchain/versions.json` (reusing a matching host install when present, otherwise building the pinned commit into the project toolchain bin). API runtime, seed scripts, and the check command share that resolver; a personal Python bin directory is not required on `PATH`. To verify the checked-in Aurora/Nebula/Atlas seed overlays independently, run:

```bash
npm run dtc:seed:compile
```

The overlays may report `reg_format` / `ranges_format` warnings when compiled without their external base DTS. Compiler errors or an unavailable compiler fail the command and block M1 seeding.

For fail-closed production publish validation (dtc + fdtoverlay + dt-validate at pinned versions from `tools/dts-toolchain/versions.json`):

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dts:config:validate
```

`dts:toolchain:check --required` compares resolved versions to the pin file and fails on missing tools, unparseable version output, or mismatch. Controlled deployments may provide `WISEEFF_DTC_PATH`, `WISEEFF_FDTOVERLAY_PATH`, or `WISEEFF_DT_VALIDATE_PATH`; an invalid explicit override fails closed instead of falling back.

Semantic identity migration rehearsal (dry-run by default; apply only in a maintenance window):

```bash
npm run parameter-identities:migrate
npm run parameter-identities:check
```

Operator procedure: [../runbooks/parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md).

On PowerShell, edit `.env` and fill only these blank values when testing live Xiaoze LLM behavior:

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

Fill `AGENT_API_*` in `.env` / `.env.local` when testing live Xiaoze LLM behavior.

To keep live LLM secrets out of `.env`, copy `.env.local.example` to `.env.local`. That file is gitignored and overrides `.env` at runtime.

## One-Command Local Stack

Start the full local stack:

```bash
npm run dev:all
```

This command starts Docker PostgreSQL through `compose.yaml`, waits for it to accept connections, runs migrations and M0-M3 seeds, then starts the API and an API-mode Vite frontend. The API process starts the log-analysis worker when `DATABASE_URL` and local object storage are configured.

`db:seed:m1` defaults to **semantic-only** demo data plus an idempotent **local post-cutover finalize** so typed binding drafts can be submitted for review. It does **not** seed flat `parameter_definitions` / `project_parameter_values`, and it will **refuse** to cut over a dirty dual-track developer database in place — wipe the Docker volume (`docker compose down -v`) and re-run `npm run dev:all`. Production identity cutover remains the fail-closed maintenance path in [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md).

`npm run dev:api` (and the API process started by `dev:all`) also runs the same **idempotent local post-cutover** before listen when `NODE_ENV=development` (default). That closes the gap where code was updated but an old Docker volume still had `cutovers=0`. Dirty dual-track DBs **fail API startup** with the wipe guidance instead of serving a stack that 409s on submit. Opt out with `WISEEFF_LOCAL_POST_CUTOVER=0`, or use `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` for dual-track rehearsal (startup finalize stays off; typed submit remains blocked). Never enabled when `NODE_ENV=production`.

To seed the old dual-track flat identity without local cutover (typed submit stays blocked until a real cutover):

```bash
WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1 npm run db:seed:m1
```

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
- `db:seed:m1`: semantic project-primary DTS baselines, topology bindings/specs, vendor property docs, a demo binding-revision history, and local post-cutover finalize (so typed binding submit works). Flat `parameter_definitions` / PPV are not seeded by default. It runs the required dtc gate first.
- `db:seed:m2`: log-analysis sample data.
- `db:seed:m3`: simulator debugging device and catalog.

### Development demo logins (API mode)

When `NODE_ENV=development`, `db:seed:m0` upserts local usernames and a shared demo password for ChargeLab personas. Use these only on local developer databases.

| Username | Persona |
| --- | --- |
| `xu.yun` | Admin (Xu Yun) |
| `zhao.heng` | Hardware User |
| `liu.min` | Software User |
| `wang.jie` | Hardware Committer |
| `chen.na` | Software User |
| `li.peng` | Hardware Committer |
| `sun.mei` | Software Committer |

Shared password: `WiseEff-Dev!`

Non-development seeds skip these credentials. Empty non-demo installs still use `npm run admin:bootstrap`.

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

Local development defaults to multi-protocol mode (`hdc` + `adb` gateways registered; simulator remains available as a fallback target when no real device is detected). Only override `DEBUG_DEVICE_GATEWAY_MODE` for targeted device-lab evidence runs.

```text
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
```

Real HDC/ADB evidence belongs to the device-lab runbook and must not be replaced by simulator-only proof.

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
