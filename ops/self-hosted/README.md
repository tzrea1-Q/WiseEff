# WiseEff Self-Hosted Runtime

> Chinese: [Chinese](README.zh-CN.md)

This directory contains the M6.1 single-Linux-server baseline. It is meant for a controlled self-hosted staging or pilot host, not broad production hardening by itself.

M6.6 release-candidate procedures live in [releases/](releases/). Use them after the runtime is deployed and before claiming a self-hosted target is ready for a controlled commercial pilot.

## Services

- `postgres`: PostgreSQL source of truth.
- `api`: WiseEff API, bound to `0.0.0.0:8787` inside the compose network.
- `worker`: dedicated log-analysis worker through `npm run worker:logs`.
- `web`: Vite preview serving the built frontend.
- `proxy`: Caddy reverse proxy and TLS termination.

## Start

Server prerequisites: Docker Engine 20.10+, and Docker Compose v2 or standalone `docker-compose` 1.28+. Node.js is not required on the server; the stack runs inside containers.

The runtime image installs Alpine's `dtc` package and runs `dtc --version` during image build. This makes DTS validation and `db:seed:m1` independent of host packages. `npm run selfhost:check` verifies both the image dependency and the repository dtc commands.

```bash
cp .env.example .env
chmod 600 .env
# Fill every blank secret and target endpoint in .env.
./scripts/compose --env-file .env up -d --build
```

The `./scripts/compose` wrapper accepts either `docker compose` (Compose v2) or `docker-compose` (standalone v1). It passes `-f compose.yaml` automatically when the standalone binary is used and rejects Compose versions that are too old for this stack.

After the stack is up with `AUTH_PROVIDER=local`, bootstrap the first admin once:

```bash
./scripts/compose --env-file .env exec api npm run admin:bootstrap -- \
  --username admin.ops \
  --password 'ReplaceWithAStrongPassword'
```

For internal demo/staging hosts, import bundled seed data with:

```bash
./scripts/seed-demo-data.sh
```

The M1 step compiles the three project overlays inside the API container before persisting the full source-bound parameter catalog and baselines.

See [docs/runbooks/self-hosted-runtime.md](../../docs/runbooks/self-hosted-runtime.md) for full bootstrap and seed guidance.

Run metadata and smoke checks from a development machine or CI runner with Node.js 22:

```bash
npm run selfhost:check
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://wiseeff.example.com
```

Then run the metadata gate from the repository root:

```bash
npm run selfhost:check
```

Run smoke against the target URL:

```bash
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://wiseeff.example.com --allow-only-blocked=deviceGateway
```

`--allow-only-blocked=deviceGateway` is acceptable only for a non-HDC self-hosted staging target after the other readiness gates are real, including `M5_BACKUP_RESTORE_DRILL_AT` from a completed backup/restore drill. Full pilot readiness still requires HDC evidence.

## Release And Capacity Gates

From the repository root:

```bash
npm run capacity:gate -- --target-url https://wiseeff.example.com
npm run selfhost:release-gate -- --target-environment staging-a --artifact-ref <artifact> --env-fingerprint <sha256>
```

`capacity:gate` writes `docs/generated/capacity-gate.md`. `selfhost:release-gate` writes `docs/generated/m6-release-readiness.md`. Both scripts are evidence writers as well as gates: without real target capacity, rollback, queue, observability, and synthetic acceptance evidence they must remain failed or pending.

## Device Bridge (macOS portable)

The portable `wiseeff-bridge` bundle (`.tar.gz`) does not register the `wiseeff-bridge://` URL scheme automatically. Browser pairing from the web UI requires a URL handler.

After extracting the portable bundle and starting the bridge in standby mode:

```bash
./wiseeff-bridge start
./wiseeff-bridge register
```

`register` creates `~/.wiseeff/WiseEffBridgeLauncher.app`, registers `wiseeff-bridge://` with Launch Services, and points the handler at your portable `cli.js`. Run `wiseeff-bridge unregister` to remove it.

The macOS `.pkg` installer registers the URL scheme through `/Applications/WiseEff Bridge.app` and does not need `register`. See [bridge-installer/README.md](./bridge-installer/README.md) for installer build notes.
