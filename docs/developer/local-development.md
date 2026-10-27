# Local Development

> Chinese: [Chinese](../zh-CN/developer/local-development.md)

This guide gets WiseEff running locally for API-mode development and acceptance checks.

## Requirements

- Node.js 22 LTS or a Vite 7-compatible Node version.
- npm 11 or a compatible npm version.
- Docker Desktop or Docker Engine for the one-command local PostgreSQL path.
- PostgreSQL reachable from `DATABASE_URL` if you run the services manually.
- Device Tree Compiler (`dtc`) for compiler checks and DTS publish validation. M1 seeding parses the committed project-primary boards without requiring a compiler run.
- Optional: live Xiaoze LLM values (`XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY`) if you are testing non-deterministic Agent behavior.

## CI-parity browser database and tool caches

The opt-in Compose `ci` profile uses `pgvector/pgvector:pg16`, the same image as CI, without replacing the default development database or its volume:

```bash
docker compose --profile ci up -d --wait postgres-ci
export DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55436/wiseeff_ci
npm run seed:browser
```

Prepare `.env` and the pinned DTS toolchain as described below before seeding. `WISEEFF_CI_POSTGRES_PORT` overrides the profile's loopback port (default `55436`); update `DATABASE_URL` to match. The profile owns the separate `wiseeff-postgres-ci-data` volume. Stop only this service with `docker compose --profile ci stop postgres-ci`; do not remove unrelated databases or volumes. This persistent local fixture is not the disposable database required by managed-instance server tests.

`seed:browser` is the shared local quality and CI quality/acceptance-smoke contract: `db:migrate` → `reset:quality-runtime` → `db:seed:all` → `seed:quality:admin-lists`. The all-seed command installs the published Catalog between M0 and M1. Any failure stops the sequence. Local quality setup invokes this command automatically; CI sets `WISEEFF_QUALITY_SKIP_SEED=true` only after it succeeds. Run it only against a dedicated local/test fixture: reset removes transient users, credentials, sessions and probe data. Never point it at production. Isolated visual-review fixtures remain separately authorized and seeded.

For sandboxed checkouts whose `node_modules` is not writable, set a writable, checkout-specific cache directory:

```bash
export WISEEFF_TOOL_CACHE_DIR=/tmp/wiseeff-ui-t-1166-cache
npm run typecheck
npm run lint
```

This redirects both TypeScript build-info files for `npm run typecheck` and the TypeScript phase of `npm run build`, plus the ESLint cache for `npm run lint`. Generated TypeScript configs extend the checked-in configs with unchanged inputs/options except for build-info paths. Use a separate directory per checkout and do not share it between concurrent runs. Unset the variable to retain the existing `node_modules/.tmp` and `node_modules/.cache/eslint/` defaults. Direct `npx tsc`/`npx eslint` commands do not read this variable; use their native flags when bypassing the npm wrappers.

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

The overlays may report `reg_format` / `ranges_format` warnings when compiled without their external base DTS. Compiler errors or an unavailable compiler fail this optional compiler check. M1 seeding separately rejects committed boards that fail its parse-only integrity check.

For fail-closed production publish validation (dtc + fdtoverlay + dt-validate at pinned versions from `tools/dts-toolchain/versions.json`):

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check -- --required
npm run dts:config:validate
```

`dts:toolchain:check --required` compares resolved versions to the pin file and fails on missing tools, unparseable version output, or mismatch. Controlled deployments may provide `WISEEFF_DTC_PATH`, `WISEEFF_FDTOVERLAY_PATH`, or `WISEEFF_DT_VALIDATE_PATH`; an invalid explicit override fails closed instead of falling back.

Legacy-cohort operator semantic identity migration rehearsal only (dry-run by default; apply only in a maintenance window). This is not part of fresh canonical seeding or startup:

```bash
npm run parameter-identities:migrate
npm run parameter-identities:check
```

Operator procedure: [../runbooks/parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md).

On PowerShell, edit `.env` and fill only these blank values when testing live Xiaoze LLM behavior:

```text
XIAOZE_LLM_API_BASE_URL=
XIAOZE_LLM_MODEL=
XIAOZE_LLM_API_KEY=
```

Fill `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` in `.env` / `.env.local` when testing live Xiaoze LLM behavior.

To keep live LLM secrets out of `.env`, copy `.env.local.example` to `.env.local`. That file is gitignored and overrides `.env` at runtime.

## One-Command Local Stack

Start the full local stack:

```bash
npm run dev:all
```

This command starts Docker PostgreSQL through `compose.yaml`, waits for it to accept connections, runs `dev:setup`, then starts the API, an API-mode Vite frontend and an independent publication manager. For a database already running on the configured local port, use `npm run dev:all -- --no-postgres`; it leaves that PostgreSQL service untouched. The API process starts the log-analysis worker when `DATABASE_URL` and local object storage are configured.

`npm run dev:setup` is the shared interactive-development preparation contract. It requires explicit `NODE_ENV=development` and a loopback PostgreSQL URL, runs migrations and M0-M3 seeds, adopts the exact committed demo Catalog through the synchronizer with `synthetic-fixture` evidence, enables only the initial publication policy, and verifies the seeded Org Admin's real authoring/publication surface. It provisions separate non-superuser API/worker/manager LOGINs using the existing provisioner. Private DSNs live under `.wiseeff-tools/local-development/` in 0700 directories and 0600 files; repeat setup reuses them without password rotation. The ordinary API never receives the manager DSN.

Setup fails if publication was deliberately disabled, frozen, or the pre-adoption Catalog differs from the exact committed seed. It does not clear those states. After adoption, seeds retain the database's current Catalog, including online successors. API startup remains verify-only; raw `db:seed:all` is a data-fixture contract and does not establish an interactive authoring environment. A successful seed or `/health/live` alone is insufficient: setup must pass the real publication-surface and manager-identity checks, and the manager process must run for publication jobs to activate. These local checks do not establish target-host or production readiness.

`db:seed:all` and `db:seed:m1` initialize parameter data **only through canonical owners**. M1 installs the pinned constrained vendor Catalog through `seedPublishedCatalog` (the existing Catalog installer), creates taxonomy/modules and canonical-only source structural revisions, then registers canonical Subjects and materializes canonical Bindings and Project values. It does not initialize legacy Spec, Binding, flat Definition, or PPV rows. The Aurora `watchdog_time` demo history comes from a real canonical draft → submit → review → source commit, not direct history inserts. Seeding is idempotent; reruns should not duplicate canonical Catalog, Binding, value, or history rows.

**Fresh canonical seeding requires no semantic identity cutover.** M1 does not run the old semantic identity migration or `ensureLocalPostCutoverIdentity`. At API startup, a clean, fully source-pinned canonical installation skips legacy finalize: startup does not invoke the legacy migration for that state.

In development and tests, the startup identity resolver also recognizes that canonical state without a legacy cutover marker: legacy Specs and Bindings must be empty, canonical Bindings must exist, and every current value must have a source pin to its file's active version. This read-only fallback tolerates absent canonical tables or rows and reuses the existing clean-database guard, refusing retained flat Definition/PPV rows, history without a Binding or logical-node identity, and unbound binding-subject drafts/change requests. In production, both API and log-worker startup use only the existing cutover marker or retired flat-table probe; fresh canonical and mixed databases do not switch modes through this local fallback. It does not replace an operator cutover. Node-enablement rows retain their separate logical-node identity and do not require a Binding. Canonical single and batch source commits index their new DTS versions in the same transaction, so structure navigation and Binding source locations remain available after the demo history write.

`npm run dev:api` (and the API process started by `dev:all`) retains the **idempotent local post-cutover boot guard for legacy cohorts** before listen in development; legacy operator helpers remain available. The local finalize hook never runs in production and runs in tests only with explicit opt-in; the read-only clean-database check also protects canonical-seed identity resolution. `WISEEFF_LOCAL_POST_CUTOVER=0` disables this boot hook. The deprecated `WISEEFF_SEED_LEGACY_FLAT_IDENTITY=1` is retained only as an API-boot compatibility opt-out for existing legacy operator workflows. **M1 ignores it**: there is no legacy flat seed option. Skipping the boot hook does not perform a legacy cutover or make blocked typed submissions valid.

An existing dual-track database can fail the local cutover/boot guard. Do not use seeding to upgrade populated pre-canonical data or wipe a database/volume as a default remedy. First inventory the database, Docker volumes, object storage, and other checkouts using them; any destructive reset requires explicit authorization. Prefer a separate empty local database for demo seeding. Populated-upgrade operator workflows (#824) are unchanged; follow [parameter-identity-cutover.md](../runbooks/parameter-identity-cutover.md) for the fail-closed maintenance path.

Before starting, the launcher checks the configured database, API and frontend ports (defaults `5432`, `8787`, `5173`). Without `--no-postgres`, an existing WiseEff PostgreSQL container on the database port is restarted and awaited. Existing WiseEff API/web processes on the configured ports are stopped so the current checkout can restart them. Unknown services remain untouched and are reported as blockers. Use distinct ports and a separate database/object-store for independent worktrees; `WISEEFF_PUBLICATION_MANAGER_HEALTH_PORT` also needs a free port (default `8791`).

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

That compose URL is the API-mode application database. It is **not** catalog-launch evidence: the image is `postgres:16-alpine`, the database is shared across checkouts, and it often lacks pgvector.

For isolated server tests, set `DATABASE_URL`, `TEST_DATABASE_URL`, and `WISEEFF_TEST_DATABASE_PREFIX` to the dedicated lane. Templates use `<lane>_test_tpl_*`; disposable workers use `wiseeff_test_wk_<base36-lane-length>_<lane>_*`, preserving literal lane isolation while satisfying the unchanged ephemeral-publication policy. Disposable names retain their complete run identity and unique suffix within PostgreSQL's 63-byte identifier limit; cleanup matches the run field, not substrings in the lane or fingerprint. Managed-instance fixtures remain non-ephemeral and require the existing adoption proof.

### Catalog launch lanes (Wayfinder #668)

Remaining catalog launch Issues provision an isolated pgvector database per Issue and must pass a local gate before Hosted:

```bash
npm run catalog:lane:env -- provision --issue 687
npm run catalog:lane:env -- doctor --issue 687
npm run catalog:lane:accept -- --issue 687 -- npm run test:server -- server/modules/catalog-kernel/compiler
npm run catalog:lane:env -- cleanup --abandoned
```

The helper uses `pgvector/pgvector:pg16` on `127.0.0.1:55438` and database `wiseeff_lane_<issue>`. It rejects `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff`. After Catalog role migrations exist, `doctor` / `accept` run a `catalog_migration_owner` SELECT canary against `public.parameter_specs` so Hosted is confirmation, not discovery. Full rules: [Catalog Launch Operating Rules](../agents/catalog-launch-operating-rules.md).

For an empty local development database, run migrations and the ordered seeds:

```bash
npm run db:migrate
npm run db:seed:all
```

When authoring migrations from 0185 onward, each new public table must include a subsequent runtime DML grant DO block using `has_table_privilege(oid, 'public.log_domains', 'INSERT')`, or an explicit `-- runtime-acl: owner-only <table> <reason>` opt-out.

The individual commands remain available:

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

Seeds are ordered by milestone:

- `db:seed:m0`: organization, users, roles, and project foundation.
- `db:seed:m1`: pinned canonical vendor Catalog, taxonomy/modules, project-primary DTS baselines and structural revisions without legacy projection, canonical Subject registrations/Bindings/Project values, and reviewed source-commit demo history. It requires the M0 foundation and installs the Catalog itself, including when run standalone; it does not depend on a prior `db:seed:all` invocation.
- `db:seed:m2`: log-analysis sample data.
- `db:seed:m3`: simulator debugging device and catalog.

Fresh databases seeded from the same commit have identical canonical module counts, Subject registrations/placements, Binding-to-module assignments and current values, including after quality visual seeding. Seed placement keeps curated-module priority and orders available modules by their stable source key (or name), not generated UUIDs; existing registrations are never moved. The real-PostgreSQL regression is `npm run test:server -- server/scripts/seed-all.determinism.integration.test.ts` with `DATABASE_URL` and `TEST_DATABASE_URL` set. It compares natural-key outputs, not generated row IDs or audit timestamps.

### Pinned vendor documentation

M1 invokes vendor documentation sync. To rerun it independently against the local demo database:

```bash
npx tsx scripts/sync-vendor-property-docs.ts
```

The sync uses `seedPublishedCatalog` to materialize the pinned canonical Definition revisions through the Catalog installer; it does not directly upsert legacy documentation/Definitions or rewrite installed revisions. Mutable documentation edits or new Catalog documentation require governed Catalog publication, not a seed/sync rewrite. Do not use the pinned demo installer to overwrite a newer or independently governed Catalog.

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

For an interactive environment with an existing local PostgreSQL service, use `npm run dev:all -- --no-postgres`. This runs the shared setup and passes the private API LOGIN to the API child and the manager LOGIN only to the separate manager child. `npm run dev:setup` can also prepare and verify the environment without starting services. The individual commands below are low-level diagnostics; `dev:api` does not perform Catalog adoption or start its manager. `npm run dev:publication` starts only the manager using the prepared private credentials.

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
