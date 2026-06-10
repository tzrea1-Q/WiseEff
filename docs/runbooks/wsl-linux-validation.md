# WSL Linux Validation

> Chinese: [Chinese](../zh-CN/wsl-linux-validation.md)

This runbook records what can be validated from a local WSL Linux lab and what still requires a real self-hosted target server.

## Scope

WSL validation is useful for proving Linux runtime compatibility before spending time on a remote server. It can exercise Docker Compose services, the API, PostgreSQL, Redis/BullMQ, S3-compatible object storage, worker startup, health checks, queue readiness, metrics exposure, and local OIDC mechanics.

WSL validation is not target-environment evidence. Do not move M6.2-M6.6 plans to `docs/exec-plans/completed/` or mark a commercial self-hosted target ready from WSL-only results.

## Verified In Local WSL Lab

The local lab used Ubuntu 24.04 on WSL 2, Docker Desktop backend, Node 22, and the self-hosted Compose profile with local port overrides.

Verified checks:

- `npm run selfhost:check` passed in WSL.
- `npm run observability:check` passed in WSL.
- `npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url http://127.0.0.1:8789 --allow-only-blocked=deviceGateway,agentProvider,backups` passed against the WSL lab API.
- `npm run queue:check -- --env-file ops/self-hosted/.env --base-url http://127.0.0.1:8789 --output docs/generated/m6-queue-readiness-evidence.wsl-lab.md` passed.
- `npm run identity:local-oidc-drill -- --output docs/generated/m6-local-oidc-identity-evidence.wsl-lab.md` passed.
- `/health/ready` returned database, object-store, worker queue, and durable queue readiness.
- `/metrics` returned Prometheus metrics.
- Docker Compose services for API, web, worker, PostgreSQL, Redis, and MinIO were healthy or running. Caddy was not started for this localhost lab because real DNS/TLS was out of scope.

## WSL Findings

S3-compatible object storage exposed a real compatibility issue in the HTTP transport: PUT requests must sign content-type and metadata headers with standard AWS SigV4 canonical signing. This is covered by `server/modules/logs/s3ObjectStore.test.ts`.

Do not run TypeScript tests directly from the Windows worktree inside WSL when `node_modules` was installed on Windows. Native packages such as esbuild are platform-specific. Use a WSL-native worktree with WSL-installed dependencies, or run Windows checks from PowerShell.

Do not `source ops/self-hosted/.env` in Bash. The `.env` file is meant for dotenv and Docker Compose, and authorization values can contain spaces such as `Bearer <token>`. Prefer scripts that load the env file directly.

For backup and restore drills, use one of these forms:

```bash
npm run restore:drill --target-env-file=ops/self-hosted/.env
npm run backup:drill --target-env-file=ops/self-hosted/.env
```

The scripts also accept a direct positional path when invoking `tsx`:

```bash
npx tsx scripts/run-restore-drill.ts ops/self-hosted/.env
npx tsx scripts/run-backup-drill.ts ops/self-hosted/.env
```

Avoid `npm run <script> -- --env-file ops/self-hosted/.env` on Node 22 based Windows shells because Node has a native `--env-file` flag that can intercept the argument before the WiseEff script receives it.

## Not Verifiable From WSL Alone

The following remain target-server tasks:

- Real DNS and TLS termination through Caddy or the chosen reverse proxy.
- Keycloak or equivalent OIDC target integration, including discovery/JWKS, token refresh/logout, and negative issuer/audience/expiry tokens against the deployed API.
- Backend user and role governance evidence from the target environment, including UI, API, DB, and audit proof for `PERM-USER-MGMT-001`.
- Backup and restore using isolated restore database and isolated object-store bucket or prefix on the target server.
- Redis persistence snapshot and checkpoint evidence from the target server.
- Prometheus target scrape, Alertmanager routing, and Grafana dashboard import proof using non-local URLs or approved external records.
- Rollback rehearsal on a non-customer target environment, including stop-writes, queue drain, artifact rollback, optional database/object-store restore, and post-rollback smoke.
- Capacity gate evidence with observed target metrics for p95 latency, error rate, RPS, CPU, memory, database connections, queue backlog, and object-store probe.
- Target synthetic browser acceptance and CI artifact archival against a deployed target.
- HDC device-lab evidence.
- Live Agent provider evidence if the production provider and API key are not available in the WSL lab.

## Evidence Boundary

Use WSL results as development confidence and preflight evidence. Final M6.2-M6.6 closure still requires `npm run m6:target-plan`, the target-specific evidence commands listed in `docs/developer/verification-matrix.md`, and a passing `npm run m6:target-evidence`.
