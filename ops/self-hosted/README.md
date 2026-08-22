# WiseEff Self-Hosted Runtime

> Chinese: [Chinese](README.zh-CN.md)

This directory contains the M6.1 single-Linux-server baseline. It is meant for a controlled self-hosted staging or pilot host, not broad production hardening by itself.

For one operator-facing index of setup, routine start/stop/restart, status, logs, upgrade/recovery, backup, monitoring, and common failures, use the [Self-Hosted Operations Handbook](operations.md).

Use the [setup wizard](setup.md) instead of copying `.env.example` by hand. It covers the [IP lab profile](ip-lab.md) and the DNS + Let's Encrypt profile:

```bash
cd ops/self-hosted
./scripts/setup.sh
```

For an already running checkout, use the dedicated [upgrade entry](upgrade.md). `setup.sh` remains the first-install/configuration/provisioning path; it is not an upgrade command:

```bash
sudo ./scripts/upgrade.sh prepare-host --yes # once per host/operator
./scripts/upgrade.sh plan                     # defaults to origin/main
./scripts/upgrade.sh apply
```

Use `--ref refs/tags/<release>`, `--ref <sha>`, or `WISEEFF_UPGRADE_REF` when the target must be pinned. Run normal upgrade actions without `sudo`. Use `lock-status` and the idempotent `unlock` action instead of deleting operation-lock files by hand.

On restricted enterprise networks, create `.build-network.env` once with `./scripts/build-network.sh init`, edit it as the deployment user, and verify the credential-free summary with `./scripts/build-network.sh status`. Setup and upgrade both consume this proxy/npm-registry/approved-CA/build-TLS contract. Hosts that cannot install a CA may use the documented build-only `insecure` policy with per-command authorization; runtime TLS and package integrity/signatures remain enforced. See [Restricted-network build configuration](upgrade.md#restricted-network-build-configuration).

The DNS + Let's Encrypt path below remains the M6 staging/pilot profile.

M6.6 release-candidate procedures live in [releases/](releases/). Use them after the runtime is deployed and before claiming a self-hosted target is ready for a controlled commercial pilot.

## Services

- `postgres`: PostgreSQL source of truth.
- `api`: WiseEff API, bound to `0.0.0.0:8787` inside the compose network.
- `worker`: dedicated log-analysis worker through `npm run worker:logs`.
- `web`: Vite preview serving the built frontend.
- `proxy`: Caddy reverse proxy and TLS termination.

The upgrade entry recreates all of these services while preserving the existing Compose project and named volumes. It records a PostgreSQL/object-store/Redis recovery point before migration and keeps the proxy stopped if post-migration recovery is required.

## Start

Server prerequisites: Docker Engine 20.10+ and Docker Compose v2. Build-secret support makes standalone Compose v1 unsupported. Node.js is not required on the server; the stack runs inside containers.

The runtime image installs Alpine's `dtc` package and runs `dtc --version` during image build. This makes DTS validation and `db:seed:m1` independent of host packages. `npm run selfhost:check` verifies both the image dependency and the repository dtc commands.

```bash
cp .env.example .env
chmod 600 .env
# Fill every blank secret and target endpoint in .env.
./scripts/compose --env-file .env up -d --build
```

The `./scripts/compose` wrapper requires Docker Compose v2 for this self-hosted stack and rejects standalone Compose v1 before mutation. The stock topology has exactly one API replica: for either `--scale api=...` or `--scale=api=...`, only exact `api=1` is accepted; every other `api=*` value is rejected before Docker runs. Other services' scale values pass through unchanged. A literal `--` ends wrapper-option inspection so container command arguments are not mistaken for Compose scale options. Calling Compose directly bypasses the guard but does not create a supported multi-API topology.

## Graphical Monitoring

After the application stack is running, start the loopback-only monitoring profile:

```bash
./scripts/observability up
./scripts/observability status
```

This starts Prometheus, Grafana, Alertmanager, blackbox exporter, Node exporter, PostgreSQL exporter, and Redis exporter. Grafana automatically provisions the Prometheus datasource and four WiseEff dashboards, including an all-services/host view. No manual import is required.

From an operator workstation, tunnel the loopback-only Grafana port and open `http://127.0.0.1:3000` locally:

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

Use `./scripts/observability logs -f`, `restart`, or `down` for the monitoring lifecycle. `down` leaves the application services and all named volumes intact. See the [observability operations runbook](../../docs/runbooks/observability-operations.md) for security boundaries, port overrides, alert routing, and target evidence.

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
