# Self-Hosted Operations Handbook

> Chinese: [Chinese](operations.zh-CN.md)

This is the command handbook for an operator maintaining one WiseEff Linux self-hosted checkout. Start here for routine work. Follow the linked specialist runbook when an operation needs a recovery drill, target-environment evidence, or incident approval.

Unless a section says otherwise, run commands as the dedicated deployment user from:

```bash
cd /srv/wiseeff/ops/self-hosted
```

Use the repository's `./scripts/compose` wrapper rather than calling `docker compose` or `docker-compose` directly. The wrapper selects a supported Compose implementation and preserves this checkout's Compose file and project identity.

## Choose The Correct Entry

| Situation | Command or entry | Result |
| --- | --- | --- |
| First installation or intentional reconfiguration | `./scripts/setup.sh` | Creates or updates `.env`, builds, starts, and optionally provisions. |
| Existing containers were intentionally stopped | `./scripts/compose --env-file .env start` | Starts the exact existing containers and images; no build or Git change. |
| One existing service needs a process restart | `./scripts/compose --env-file .env restart <service>` | Restarts the existing container; does not rebuild or apply Compose changes. |
| A stopped or missing service must be reconciled without building | `./scripts/compose --env-file .env up -d --no-build` | Starts or creates from the image reference currently resolved by Compose. Check image identity first after an immutable-SHA upgrade. |
| Deploy the latest code while preserving complete data | `./scripts/upgrade.sh plan`, then `./scripts/upgrade.sh apply` | Resolves one commit, takes a verified recovery point, migrates, recreates, and validates. |
| Recreate the same deployed commit | `./scripts/upgrade.sh apply --restart --ref <sha>` | Runs the full protected upgrade workflow even when the SHA is unchanged. |
| Enterprise proxy/npm mirror/CA setup | `./scripts/build-network.sh init`, edit, then `status` | Creates and validates the private build transport contract consumed by setup/upgrade. |
| Monitoring lifecycle | `./scripts/observability <up|status|logs|restart|down>` | Operates only the private monitoring profile. |
| Upgrade/setup lock conflict | `./scripts/upgrade.sh lock-status`, then `unlock` only if stale | Inspects or safely clears stale lock metadata without killing a live operation. |

Do not use `setup.sh --force` as an upgrade or restart command. It intentionally replaces `.env` and rotates database/object-store credentials. Do not use `compose down -v`, `docker volume rm`, or `docker system prune` in a data-preserving workflow.

## Public Operator Entry Points

| Entry | Intended use |
| --- | --- |
| `./scripts/compose` | Supported Compose compatibility boundary for service lifecycle, status, logs, config, and exec. |
| `./scripts/setup.sh` | First setup and section-scoped access/admin/seed/LLM reconfiguration. |
| `./scripts/doctor.sh` | Static configuration diagnosis, with optional live probes. |
| `./scripts/upgrade.sh` | Data-preserving upgrade, same-SHA recreation, host preparation, journal status, resume, rollback, and lock recovery. |
| `./scripts/build-network.sh` | Initializes and safely reports the restricted-network proxy/npm-registry/approved-CA contract. |
| `./scripts/observability` | Built-in Prometheus/Grafana/Alertmanager lifecycle. |
| `./scripts/seed-demo-data.sh` | Demo/staging-only ChargeLab seed; never customer or production data. |
| `./scripts/memory-mode.sh` | Compatibility switch for a memory-constrained host shared with local development; not the normal production lifecycle entry. |
| `./scripts/deploy-ip-lab.sh` | Legacy IP-lab compatibility wrapper; new installs should use `setup.sh`. |

Show the authoritative interface implemented by each entry:

```bash
./scripts/setup.sh --help
./scripts/doctor.sh --help
./scripts/upgrade.sh --help
./scripts/build-network.sh --help
./scripts/observability --help
```

## Daily Quick Reference

```bash
# All application/data container states, including stopped containers
./scripts/compose --env-file .env ps -a

# Public liveness and dependency readiness
curl -fsS https://<host>/health/live
curl -fsS https://<host>/health/ready

# Recent logs
./scripts/compose --env-file .env logs --tail=200 api worker proxy

# Follow one service
./scripts/compose --env-file .env logs -f worker

# Start existing containers after an intentional stop
./scripts/compose --env-file .env start

# Restart one existing service without rebuilding
./scripts/compose --env-file .env restart worker
```

`/health/live` proves the API process is alive. `/health/ready` may return `503` while the API is alive when PostgreSQL, object storage, Redis/durable queue, an Agent provider, or another required dependency is blocked. Preserve its dependency detail when escalating.

## One-Time Host Preparation And Permissions

Before the first upgrade, normalize Docker and protected backup/journal permissions:

```bash
sudo ./scripts/upgrade.sh prepare-host --yes
```

The command uses `SUDO_USER` as the deployment operator. A direct root session must identify it explicitly:

```bash
sudo ./scripts/upgrade.sh prepare-host --yes --operator <deployment-user>
```

Log out and reconnect if group membership changed. Membership in the Docker socket group is effectively root-equivalent; grant it only to a dedicated trusted deployment account.

Run `plan`, `apply`, `status`, `resume`, `rollback`, ordinary Compose commands, and monitoring commands as the deployment user without `sudo`. Root does not normally inherit that user's Git proxy configuration and can create root-owned state that later blocks normal operations.

Verify access:

```bash
id
docker info
./scripts/compose version
stat -c '%A %U %G %n' .env /var/backups/wiseeff/upgrades
```

Keep `.env` at mode `600`; keep backup directories at `700` and backup files at `600`.

## Restricted Enterprise Network

Configure build transport as the deployment user, not through `sudo`:

```bash
./scripts/build-network.sh init
chmod 600 .build-network.env
# Edit only documented values in .build-network.env.
./scripts/build-network.sh status
./scripts/upgrade.sh plan
```

The `status` output is safe for routine tickets: it shows configured/not-configured state and the npm registry hostname, never proxy URLs or credentials. Setup and upgrade load the contract automatically; `--build-network-file <path>` is available for a secured alternative location. Existing exported shell proxy variables work when the file is absent.

Use these boundaries when diagnosing a failure:

| Failing operation | Network owner | Corrective entry |
| --- | --- | --- |
| `git fetch` / target resolution | deployment user's Git/libcurl | shell/Git proxy or upgrade `--git-proxy` |
| `RUN apk`, `git clone`, `pip`, or `npm ci` inside the app build | managed BuildKit args, internal registry, approved CA | `.build-network.env`, then `build-network.sh status` |
| `FROM` metadata or pull for an image not covered by the bundled base image | Docker daemon / BuildKit service | configure and restart the Docker daemon proxy/DNS outside WiseEff |
| API/worker outbound calls after startup | runtime container environment | opt in with `WISEEFF_RUNTIME_PROXY=true`; keep internal service names in `NO_PROXY` |

Never solve enterprise TLS interception with `strict-ssl=false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or global certificate-verification disablement. Point `WISEEFF_BUILD_CA_CERT_FILE` at the organization-approved PEM instead. The file parser rejects unsafe permissions, symlinks, unknown/duplicate keys, conflicting proxy pairs, credential-bearing registry URLs, and invalid CA inputs before a build starts.

## First Installation And Reconfiguration

Interactive first installation:

```bash
./scripts/setup.sh
```

No-DNS IP lab example:

```bash
./scripts/setup.sh --non-interactive --ip <server-ip>
```

Reconfigure only the public access or LLM section without replacing all secrets:

```bash
./scripts/setup.sh access
./scripts/setup.sh llm
./scripts/doctor.sh --probe-live
```

When `AUTH_PROVIDER=local` and setup did not already provision the first administrator, use the one-shot bootstrap only while no admin role binding exists:

```bash
./scripts/compose --env-file .env exec api npm run admin:bootstrap -- \
  --username admin.ops \
  --password 'ReplaceWithAStrongPassword' \
  --name 'Platform Admin' \
  --organization WiseEff
```

Only an internal demo/staging host may import bundled demonstration data:

```bash
./scripts/seed-demo-data.sh
```

Read [Setup](setup.md) and [IP Lab](ip-lab.md) before using non-default flags. `setup.sh --force` is destructive to credential continuity and is not an update path.

On a memory-constrained development host that intentionally alternates between a local npm runtime and the self-hosted Compose runtime, inspect and switch with:

```bash
./scripts/memory-mode.sh status
./scripts/memory-mode.sh dev
./scripts/memory-mode.sh selfhost
```

This compatibility helper runs Compose `down` in `dev` mode and a generic Compose `up` in `selfhost` mode. Do not use it on a commit-SHA production deployment: it removes the existing containers and can lose their immutable image identity. Use `compose stop`/`start` there.

## Start, Stop, And Restart

### Start an already-created deployment

Use this after an intentional `compose stop` or host maintenance:

```bash
./scripts/compose --env-file .env start
./scripts/compose --env-file .env ps
```

This preserves the exact existing application image, including an immutable commit tag created by `upgrade.sh`.

### Reconcile missing containers without a build

Use only when a container was removed and the Compose-resolved application image is known to be the intended deployed image:

```bash
./scripts/compose --env-file .env config --images
./scripts/compose --env-file .env up -d --no-build
./scripts/compose --env-file .env ps
```

After an immutable-SHA upgrade, prefer `start`. A generic `up` can resolve the default `wiseeff-app:local` tag instead of the commit-addressed image if `WISEEFF_APP_TAG` is not pinned. If an upgraded container is missing, preserve the remaining container/image evidence and follow [Self-Hosted Upgrade](upgrade.md) rather than guessing a tag.

### Restart one or more existing services

```bash
./scripts/compose --env-file .env restart worker
./scripts/compose --env-file .env restart api worker web proxy
```

`restart` does not rebuild an image and does not apply changed Compose environment/configuration. Use the protected upgrade path for a code, image, migration, or Compose change.

### Graceful application stop

Stop public/application traffic while leaving PostgreSQL, Redis, and MinIO running:

```bash
./scripts/compose --env-file .env stop proxy api worker web
```

Stop every current base service while preserving containers and volumes:

```bash
./scripts/compose --env-file .env stop
```

Bring the same containers back with `start`. Prefer `stop`/`start` over `down`/`up` for routine maintenance because it preserves container and image identity.

## Services And Logs

| Service | Role | First checks |
| --- | --- | --- |
| `postgres` | System of record | container health, disk space, connection/migration errors |
| `redis` | Durable queue transport/persistence | health, AOF state, queue readiness |
| `minio` | Local S3-compatible object storage | endpoint, credentials, bucket permissions, disk space |
| `minio-init` | Idempotent bucket initializer | an exited code `0` is normal after completion |
| `api` | API, migrations, readiness, metrics | `/health/live`, `/health/ready`, migration/startup logs |
| `worker` | Log-analysis jobs and worker metrics | process health, queue claims, retries/dead letters |
| `web` | Built frontend preview | container health and page response |
| `proxy` | Caddy public HTTP/TLS edge | ports, certificate/routing logs, upstream reachability |

Useful commands:

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 <service>
./scripts/compose --env-file .env logs --since=30m <service>
./scripts/compose --env-file .env exec <service> <command>
./scripts/compose --env-file .env config --quiet
./scripts/compose --env-file .env config --images
```

Redact passwords, bearer tokens, signed URLs, uploaded log contents, raw parameter values, and device payloads before sharing output.

## Upgrade And Data-Preserving Full Recreation

Run once per host/operator:

```bash
sudo ./scripts/upgrade.sh prepare-host --yes
```

Normal interactive upgrade; no `--ref` means the freshly fetched `origin/main`:

```bash
./scripts/upgrade.sh plan
./scripts/upgrade.sh apply
```

`plan` also verifies the target commit's checksum-pinned `linux/amd64` Dockerfile base-image bundle without changing Docker. Its `base image` line tells whether the exact image is already local or `apply` will load and tag the verified repository tar. `apply` performs that preparation before Compose build and before downtime; no manual `docker load` is needed after this controller release is installed. The run's text/JSON status records the exact image identity and whether it came from `local` or `bundled-archive`.

Pin a controlled release or commit:

```bash
./scripts/upgrade.sh plan --ref refs/tags/<release>
./scripts/upgrade.sh apply --ref refs/tags/<release>
# or: --ref <commit-sha>
```

Use a Git-only proxy override when necessary:

```bash
./scripts/upgrade.sh plan --git-proxy http://127.0.0.1:7890
```

The upgrade entry requires the existing `postgres redis minio api worker web proxy` services to be running so it can record runtime, image, network, and volume identities. If preflight says a service is not running, inspect it before retrying:

```bash
./scripts/compose --env-file .env ps -a
./scripts/compose --env-file .env logs --tail=200 <service>
./scripts/compose --env-file .env start <service>
```

Read [Self-Hosted Upgrade](upgrade.md) before the first target-environment run. It defines the recovery point, stable exit codes, maintenance boundary, and rollback approvals.

## Interrupted Upgrade, Lock, And Rollback

Keep the printed `run_id` from every applied upgrade.

```bash
./scripts/upgrade.sh status --run-id <run-id>
./scripts/upgrade.sh status --run-id <run-id> --json
./scripts/upgrade.sh resume --run-id <run-id>
```

When `apply` exits `20` during a Docker or `npm ci` build, the old services are still online. The command automatically retains redacted, deployment-user-readable evidence inside the run journal. Use the `build_summary` and `build_log` paths printed by `status`; do not inspect the host's `/root/.npm`, because npm ran as root only inside an ephemeral BuildKit stage.

```bash
./scripts/upgrade.sh status --run-id <run-id>
cat ops/self-hosted/.state/upgrades/<run-id>/diagnostics/summary.txt
less ops/self-hosted/.state/upgrades/<run-id>/diagnostics/build.log
```

Inspect a setup/upgrade lock:

```bash
./scripts/upgrade.sh lock-status
./scripts/upgrade.sh unlock
```

`unlock` is safe and repeatable: it refuses with exit `75` when a live operation owns the lock and never kills that process. Do not delete `.operation.lock`, its owner metadata, or fallback lock directories manually.

A post-migration `recovery-required` state is an incident. Keep the proxy stopped and follow the journal. Whole-state restore requires the exact confirmation token:

```bash
./scripts/upgrade.sh rollback --run-id <run-id> \
  --restore-data --confirm restore-<run-id>
```

This can discard PostgreSQL, object-store, and durable Redis writes after the recovery point. Only the incident owner should approve it.

## Backup And Restore Evidence

Every upgrade creates and verifies its own pre-migration recovery point. Pilot/release readiness additionally requires an isolated restore drill. Run evidence tooling from a Node.js 22 development or CI runner at the repository root, not by sourcing the production `.env` in a shell:

```bash
npm run backup:drill --target-env-file=ops/self-hosted/.env
npm run backup:check
npm run restore:drill --target-env-file=ops/self-hosted/.env
```

Restore targets must be isolated from the live PostgreSQL database and live object-store bucket/prefix. Follow [Backup And Restore](../../docs/runbooks/backup-restore.md); never turn a local placeholder drill into target-readiness evidence.

## Graphical Monitoring

Start the loopback-only monitoring profile after the application stack is healthy:

```bash
./scripts/observability up
./scripts/observability status
./scripts/observability logs -f
```

Lifecycle commands:

```bash
./scripts/observability restart
./scripts/observability down
```

`down` here removes only monitoring containers and preserves both application services and named volumes. From the operator workstation, reach Grafana through SSH instead of exposing it publicly:

```bash
ssh -L 3000:127.0.0.1:3000 <user>@<server>
```

Then open `http://127.0.0.1:3000`. Follow [Observability Operations](../../docs/runbooks/observability-operations.md) for dashboards, alert routing, and target evidence.

## Validation And Release Evidence

These commands need Node.js 22 and normally run from a development/CI checkout, not the minimal deployment host:

```bash
npm run selfhost:check
npm run selfhost:smoke -- --env-file ops/self-hosted/.env \
  --base-url https://<host> --allow-only-blocked=deviceGateway
npm run queue:check -- --env-file ops/self-hosted/.env --base-url https://<host>
npm run observability:check
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- \
  --target-environment <label> \
  --artifact-ref <artifact> \
  --env-fingerprint <sha256>
```

`--allow-only-blocked=deviceGateway` is only for an approved non-HDC staging target. It is not full pilot readiness. Repository-local checks and config evidence never replace real target, backup/restore, alert-routing, capacity, rollback, or device-lab evidence.

## Common Failures

| Message or symptom | Meaning | Safe next action |
| --- | --- | --- |
| `Self-hosted service is not running: worker` | `worker` is stopped, exited, or absent; the rest of the stack may still be running | `ps -a`, preserve `worker` logs, then `start worker` only if the failure is understood |
| `Docker daemon is unavailable to the deployment user` | Docker group/socket access is missing or the login session is stale | run `sudo ./scripts/upgrade.sh prepare-host --yes`, reconnect, retry without `sudo` |
| Backup root is not writable | host preparation/ownership is incomplete | run `prepare-host`; do not run normal upgrade actions as root |
| `Another WiseEff setup or upgrade operation holds the host lock` | a live or stale shared operation lock exists | run `lock-status`; wait if held, use `unlock` only when reported stale |
| `category=base-image` or a bundle checksum/platform error | target contract, tar, Dockerfile tag, or host architecture do not agree | do not pull or retag an arbitrary image; restore the tracked bundle/contract or use a matching supported host, then rerun `plan` |
| Docker tries to fetch `node:22.21.1-alpine` metadata | the installed controller predates automatic bundle preparation, or the exact pinned tag was not prepared | install this controller once using the documented base-image manual fallback; subsequent `apply` runs prepare it automatically |
| Dirty checkout refusal | tracked or unignored files differ from the deployed commit | inspect `git status --short`; preserve operator files and intentionally resolve the drift |
| Git fetch timeout while direct user Git works | the command may be running through `sudo`, missing proxy environment, or using a different Git config | run as deployment user; inspect proxy config; use `--git-proxy` for a Git-only override |
| Git succeeds but image pull/build fails | Docker daemon/build network is a separate proxy or CA boundary | configure the Docker service proxy and organization-approved CA; do not disable TLS globally |
| `npm ci` fails and references `/root/.npm/_logs` | the path belongs to the ephemeral image-build stage, not the host | read the run's `build_summary` and redacted `build_log`; fix the classified cause, then rerun `apply` |
| `/health/live` passes but `/health/ready` fails | API is alive but a required dependency is blocked | preserve readiness JSON and route to the named dependency |
| `worker` repeatedly exits despite `restart: unless-stopped` | startup/config/dependency failure, not a simple stopped service | preserve logs and dependency readiness before any restart loop |
| `recovery-required` | candidate migration started and automatic safe completion failed | keep proxy stopped; use recorded `resume` or approved whole-state rollback |

## Incident First Response

```bash
date -Is
./scripts/compose --env-file .env ps -a
curl -fsS https://<host>/health/live
curl -fsS https://<host>/health/ready
./scripts/compose --env-file .env logs --since=30m api worker proxy
```

Preserve timestamps, request/job/run IDs, affected workflow, last known good commit, and redacted logs before restarting anything. If writes, audit, database, rollback, or high-risk device operations are affected, follow [Incident Response](../../docs/runbooks/incidents.md) and pause the relevant writes before attempting recovery.

## Data And Credential Safety

- Persistent state lives in named PostgreSQL, Redis, MinIO, and Caddy volumes plus configured external object storage. Ordinary `stop`, `start`, and `restart` do not delete it.
- `.env` contains production secrets. Keep mode `600`, do not commit it, do not paste it into tickets, and do not `source` it merely to run an operational command.
- Do not change the Compose project name during restart or upgrade; that would select a different set of named volumes.
- Do not manually edit upgrade journals or backup manifests.
- Do not globally disable Git/curl/Docker TLS verification to work around enterprise certificate inspection; install the approved CA.
- Do not run `setup.sh --force`, `compose down -v`, `docker volume rm`, or `docker system prune` unless an explicitly approved destructive procedure intends the corresponding data/credential loss.

## Specialist Runbooks

- [Setup](setup.md)
- [IP Lab](ip-lab.md)
- [Self-Hosted Upgrade](upgrade.md)
- [Self-Hosted Runtime](../../docs/runbooks/self-hosted-runtime.md)
- [Backup And Restore](../../docs/runbooks/backup-restore.md)
- [Durable Queue](../../docs/runbooks/durable-queue.md)
- [Observability Operations](../../docs/runbooks/observability-operations.md)
- [Release And Rollback](../../docs/runbooks/release-rollback.md)
- [Incident Response](../../docs/runbooks/incidents.md)
- [Runbook Index](../../docs/runbooks/README.md)
