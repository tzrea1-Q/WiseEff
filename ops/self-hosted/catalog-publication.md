# Catalog publication operator handbook

> Chinese: [Chinese](catalog-publication.zh-CN.md)

Work directory for every command unless noted:

```bash
cd /srv/wiseeff/ops/self-hosted
```

Use `./scripts/compose` rather than raw `docker compose`. Configuration sources:

| File | Used by | Contents |
| --- | --- | --- |
| `.env` | postgres, redis, minio, api, worker, web, proxy | Public runtime. Must **not** contain `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL`. |
| `.env.publication-manager` | `publication-manager` only | Manager DSN and lease knobs. Copy from `.env.publication-manager.example`. |
| `CATALOG_BASELINE_READONLY_DATABASE_URL` | inspect only | Read-only LOGIN. Collector refuses `DATABASE_URL`. |

`publication_enabled` defaults to `false`. Isolated enablement is not production authorization.

Setup and upgrade write `.env.publication-manager` as an **unconfigured stub** when the private file is missing. They never copy `DATABASE_URL`. The stub is written before any Compose parse so a first-intro target that adds `publication-manager` can still `stop proxy`. Missing `WISEEFF_PUBLICATION_MANAGER_DATABASE_URL` keeps the manager health endpoint at `503 { configured: false }`. On a stack that already ran `publication-manager`, upgrade freeze fail-closes without a dedicated LOGIN. On first intro (no previous manager container and no manager DSN) apply skips freeze, does not start `publication-manager`, and does not require `configured: true`; provision LOGINs after the migrations that create `catalog_publication`. Provision dedicated LOGINs with `npx tsx scripts/catalog-publication-ops.ts provision-logins --credential-dir <0700-dir>`. Stdout is roles and file paths only; DSNs are written as `0600` files (`api.dsn`, `worker.dsn`, `manager.dsn`). Copy the manager DSN into `.env.publication-manager`. Put the API DSN in public `.env` `DATABASE_URL` and the worker DSN in `WISEEFF_WORKER_DATABASE_URL`. Do not treat “replace the account before production” as delivery. Default re-runs verify owned LOGINs and do not rotate passwords; pass `--rotate-passwords` for an auditable rotation.

## 1. Deploy the manager

Same application image as api/worker/web. Command inside the image: `npm run publication:manager`.

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 publication-manager
curl -fsS http://127.0.0.1:8791/health/live   # from inside the manager container
```

API and log worker set `WISEEFF_API_PROCESS=1` / `LOG_WORKER_ENABLED=true` and never load `.env.publication-manager`. The manager entry requires `WISEEFF_PUBLICATION_MANAGER=1`.

## 2. Inspect a preexisting Catalog

```bash
cd /srv/wiseeff
CATALOG_BASELINE_READONLY_DATABASE_URL='postgres://readonly@postgres:5432/wiseeff' \
  npx tsx scripts/catalog-publication-ops.ts inspect
```

Exit `0` prints JSON+sha256. Exit `2` usage. Exit `1` read/privilege failure. Does not insert an Artifact.

## 3. Adopt (check then execute)

Does not advance `catalog_state.current`. Wrong bundle, missing history, drift, or unknown data mode is refused.

```bash
WISEEFF_PUBLICATION_MANAGER_DATABASE_URL='postgres://wiseeff_publication_manager:...@postgres:5432/wiseeff' \
  npx tsx scripts/catalog-publication-ops.ts adopt --check \
    --expected-id crel_... \
    --expected-digest sha256:... \
    --bundle /path/to/current-bundle.json \
    --actor <user-id> \
    --verification-digest sha256:... \
    --data-mode fresh

WISEEFF_PUBLICATION_MANAGER_DATABASE_URL='...' \
  npx tsx scripts/catalog-publication-ops.ts adopt --execute \
    --expected-id crel_... \
    --expected-digest sha256:... \
    --bundle /path/to/current-bundle.json \
    --actor <user-id> \
    --verification-digest sha256:... \
    --data-mode fresh \
    --evidence-kind synthetic-fixture
```

`--evidence-kind target-host` is reserved for an authorized target collection. Isolated labs use `synthetic-fixture`.

## 4. Grant and revoke real publisher capabilities

Do not use `WISEEFF_CATALOG_TEST_CAPABILITIES` (empty when `AUTH_MODE=production` or `NODE_ENV=production`).

```bash
npx tsx scripts/catalog-publication-ops.ts capabilities grant \
  --user-id <user-id> --organization-id <org-id> --capability catalog:author
npx tsx scripts/catalog-publication-ops.ts capabilities grant \
  --user-id <user-id> --organization-id <org-id> --capability catalog:publish
npx tsx scripts/catalog-publication-ops.ts capabilities status \
  --user-id <user-id> --organization-id <org-id> --capability catalog:publish
npx tsx scripts/catalog-publication-ops.ts capabilities revoke \
  --user-id <user-id> --organization-id <org-id> --capability catalog:publish
```

This binds a dedicated `catalog-capability-*` role. It does not add `catalog:publish` to the default `admin` role.

## 5. Policy status / isolated enable / disable

```bash
npx tsx scripts/catalog-publication-ops.ts policy status
npx tsx scripts/catalog-publication-ops.ts policy enable --actor <user-id> \
  --confirmation ephemeral-test-only
npx tsx scripts/catalog-publication-ops.ts policy disable --actor <user-id> \
  --confirmation ephemeral-test-only
```

Enable is refused unless `current_database()` matches the ephemeral test name pattern and the confirmation token matches. Closing publication does not delete Catalog rows and does not restore legacy `advance` after a Receipt exists.

## 6. Freeze for upgrade / restore

`./scripts/upgrade.sh apply` sets publication freeze using the private manager DSN through `compose run --no-deps api` on the candidate image (`npx tsx scripts/catalog-publication-ops.ts freeze`). That uses image `node_modules` and Compose DNS for `postgres`. It does not `compose exec` into a manager container, and it does not require host `npx`/`pg`. A PR #827 stack with no manager, or a stopped/crashed manager, can still freeze when a dedicated LOGIN exists. Missing dedicated LOGIN fail-closes when the previous stack already ran `publication-manager`. First intro without that LOGIN skips freeze instead of aborting the upgrade that creates `catalog_publication`. After freeze, upgrade stops `publication-manager` only when a container exists. Rollback must not `up publication-manager` when the restored Compose file has no such service, and must not reuse the API previous image tag as a stand-in. Failure or timeout leaves freeze set and isolates `publication-manager`. Unfreeze is the upgrade **success commit**: it runs only after public probe and final verification, and only when this upgrade owns the freeze (an operator-owned freeze is not cleared).

Manual:

```bash
npx tsx scripts/catalog-publication-ops.ts freeze set --actor deployment-upgrade
npx tsx scripts/catalog-publication-ops.ts freeze status
npx tsx scripts/catalog-publication-ops.ts freeze clear --actor deployment-upgrade
```

Ordinary restart must not install a vendor bundle over database current. Restore uses `./scripts/upgrade.sh` recovery, not adopt, and not pointer-only rollback.

## 7. Isolated delivery acceptance

```bash
cd /srv/wiseeff
WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 \
  WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL='postgres://wiseeff:...@127.0.0.1:55438/postgres' \
  npm run catalog:publication:delivery-accept
```

The runner builds the formal `ops/self-hosted/Dockerfile` image, provisions distinct **lab run-scoped** API/worker/manager LOGINs on an ephemeral pgvector database (it does not ALTER the cluster-global `wiseeff_api` / `wiseeff_worker` / `wiseeff_publication_manager` names), starts the stock Compose services plus the isolated overlay (`e2e/acceptance/helpers/compose.catalog-delivery.yaml`), then executes adopt → real local login → in-product publish → Receipt/current → DTS ingest → workbench save → second publish → service restart → history reread. Assertions bind this run's Candidate/Job/Receipt/Release/Definition/Binding/ProjectValue IDs. Queued/running after the wait is failure. Missing prerequisites exit non-zero. This runner is not production enablement and is not a silent skip on GitHub L1. It refuses `127.0.0.1:5432/wiseeff` and the shared g668 database name `wiseeff`.

The overlay is **network/port/topology only** (loopback ports, `host.docker.internal`, postgres profile off). Stock `api` command is `npx tsx server/index.ts`; official migrate is a setup/upgrade one-shot with `WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL`. Stock `worker` `DATABASE_URL` comes from `WISEEFF_WORKER_DATABASE_URL`. The overlay must not replace those process or privilege seams.
