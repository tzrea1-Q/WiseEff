# Self-Hosted Upgrade

> Chinese: [Chinese](upgrade.zh-CN.md)

`scripts/upgrade.sh` is the normal upgrade entry for an already running self-hosted checkout. It upgrades to one immutable Git commit, builds the candidate before downtime, pauses and drains application work, creates a verified recovery point, recreates every service against the existing volumes, waits for migrations and health gates, and records a durable journal.

The host needs Docker Engine and Compose; Node.js is not required. The command reads `ops/self-hosted/.env` but never rewrites it, rotates credentials, seeds data, provisions an admin, or removes a volume. It never runs `compose down -v`, `volume rm`, or `system prune`.

Git target resolution inherits the proxy environment of the invoking command and normalizes upper-case `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` to the lower-case variables expected by Git/libcurl. Existing Git `http.proxy`, URL-specific proxy, `GIT_SSH_COMMAND`, and `core.sshCommand` settings remain effective. When needed, provide a Git-only override:

```bash
./scripts/upgrade.sh plan --git-proxy http://127.0.0.1:7890
```

Automation may set `WISEEFF_UPGRADE_GIT_PROXY` instead; the command-line option takes precedence.

Do not source `.env` or a user shell profile to pass proxy settings; the entry point deliberately does not execute arbitrary shell configuration. `--git-proxy` is for HTTP(S)/SOCKS Git remotes; configure `GIT_SSH_COMMAND` or `core.sshCommand` for SSH remotes.

Git, Docker Engine, and application build downloads are separate network scopes. The script can preserve or override Git proxy settings. It also passes the managed build proxy, internal npm registry, and organization-approved CA into BuildKit, but it deliberately does not rewrite the host's Docker daemon proxy or trust store. If `git fetch` works while image metadata or an image pull fails, configure the Docker service proxy separately.

## Restricted-network build configuration

For a host that reaches external package and source endpoints only through an enterprise proxy, create the private build-network file once:

```bash
cd /srv/wiseeff/ops/self-hosted
./scripts/build-network.sh init
# Edit .build-network.env as the deployment user.
./scripts/build-network.sh status
./scripts/upgrade.sh plan
./scripts/upgrade.sh apply
```

The file accepts only the documented proxy pairs, `WISEEFF_NPM_REGISTRY`, `WISEEFF_BUILD_CA_CERT_FILE`, `WISEEFF_BUILD_TLS_POLICY`, and `WISEEFF_RUNTIME_PROXY`; it is parsed as data and is never sourced. It must be a non-symlink regular file readable only by its owner (mode `0600`). Existing shell proxy variables remain valid when no file is created. Non-empty shell values take precedence for the same key, and conflicting upper/lower-case proxy values fail before Docker or Git is changed.

`WISEEFF_NPM_REGISTRY` replaces registry hosts from the committed npm lockfile during `npm ci`. The current entry supports a credential-free URL reachable through the configured proxy; it intentionally rejects inline credentials and does not expose npm token configuration. `WISEEFF_BUILD_CA_CERT_FILE` may be an absolute path or a path relative to `.build-network.env`; it must point to an approved readable PEM file. BuildKit mounts the PEM as a secret and installs it in each build stage without copying the private config or proxy credentials into an image layer. `WISEEFF_BUILD_TLS_POLICY=verify` is the default and recommended policy.

If the deployment host cannot obtain the enterprise CA, a build-only break-glass policy is available. Set the following value in `.build-network.env`:

```dotenv
WISEEFF_BUILD_TLS_POLICY=insecure
```

`plan` remains read-only and displays the insecure policy without requiring authorization. Every command that can actually build must supply the second key explicitly:

```bash
./scripts/upgrade.sh apply --allow-insecure-build
# unattended:
./scripts/upgrade.sh apply --non-interactive --yes --allow-insecure-build
```

The config value alone is refused, and `--allow-insecure-build` is refused when the configured policy is still `verify`. The authorization is valid only for that process. It scopes certificate bypasses to the Docker build adapters for npm, the pinned DTC Git clone, named Python package hosts, and Alpine repository HTTPS. It does not set `NODE_TLS_REJECT_UNAUTHORIZED`, change host Git or Docker-daemon trust, disable npm lockfile integrity, pass Alpine `--allow-untrusted`, or place a TLS-disable variable in the runtime container. Prefer an approved CA, signed internal mirror, or offline dependency bundle whenever one becomes available.

The controller derives a non-secret build-transport fingerprint from the TLS policy, CA contents, and configured package host. Changing the policy or CA therefore invalidates the trust-install layer instead of silently reusing an old BuildKit secret cache. The candidate image records the policy as a non-secret label; the upgrade journal records `build_tls_policy`, the fingerprint, and `completed_with_insecure_build_transport` without recording proxy values.

`WISEEFF_RUNTIME_PROXY=false` is the default. Set it to `true` only when API or worker runtime calls also need the proxy; the controller adds Compose service names to `NO_PROXY`. Docker proxy credentials then become container environment data visible to Docker administrators, so use a dedicated least-privilege deployment credential. Database, Redis, object-storage, web, and proxy containers do not receive the runtime proxy mapping.

`plan`, `status`, and `status --json` expose only whether proxy/CA are configured, the npm registry host, build TLS policy/fingerprint, completion provenance, and the runtime-proxy boolean. They never print or persist proxy URLs or credentials. The file and its example contract are excluded from the Docker build context, and the real file is ignored by Git.

The Dockerfile base image is a special case: the repository carries a checksum-pinned `linux/amd64` bundle under `ops/self-hosted/images/`. `plan` verifies the target commit's bundle contract, archive checksum, Dockerfile reference, and Docker server platform without loading or tagging an image. It reports either `verified local image` or `verified bundle; apply will load and tag it`. During `apply`, after selecting the immutable target and before Compose build, the controller rechecks the checkout archive, loads it when the exact pinned image is absent, verifies its identity/platform, and creates the exact tag used by `FROM`.

The contract pins both the OCI manifest digest (`base_image_id`) and the Docker config digest (`base_image_config_id`). Docker Desktop/containerd-backed stores may expose the former as `.Id`, while a classic Docker Engine `overlay2` store may expose the latter for the same saved image. The controller accepts either pinned digest only on the pinned platform; any third identity fails with the two expected values and the actual value in the error. `npm run selfhost:check` also extracts both identities from the tar so contract/archive drift fails CI. Text and JSON run status record both digests, platform, source, and preparation status.

This removes the Docker Hub dependency for `node:22.21.1-alpine`; it does not make the whole build air-gapped. Alpine packages, the pinned DTC Git source, Python packages, and npm packages still need the managed proxy/mirror path unless separately bundled. Other service image pulls remain a Docker daemon network responsibility. The controller never weakens host/runtime TLS, package integrity/signature checks, deletes images, or prunes Docker state; only the explicitly authorized build-only policy can skip endpoint certificate verification.

## Data-plane readiness and recovery verification

After `apply` recreates `postgres`, `redis`, `minio`, and `minio-init`, the controller applies service-specific readiness semantics:

- PostgreSQL is ready only when Docker reports `healthy`.
- Redis is ready only when Docker reports `healthy`.
- MinIO's `running` state proves only that its process is alive. MinIO is ready only after `minio-init` has exited with code `0`; that initializer's successful `mc alias set` and bucket creation are the authoritative proof that the endpoint, credentials, and `wiseeff`/`wiseeff-restore` buckets are usable.
- An exited MinIO process fails immediately. A `minio-init` non-zero exit or timeout fails the data-plane gate; the controller never treats every `running` container as healthy.
- MinIO is inspected again on every `minio-init` polling attempt and once more after exit `0`; a later MinIO exit cannot be misclassified as `minio-init-timeout`.

Before candidate queue resume, the `apply`/`resume` path checks API readiness, worker `http://127.0.0.1:8788/health/live` plus Docker health, and web direct access. A worker container being present or using the expected image is not sufficient. During previous-stack restoration, the controller verifies the data plane, API live/ready, worker health, web direct access, and previous API/worker/web image identities before resuming the queue; it recreates proxy and checks public health last, before writing `old-stack-restored`. Image identity verification compares both the recorded image reference and the immutable Docker image ID. If any gate fails, the controller writes `recovery-required` and never writes `next_action=none`; it records whether proxy and queue/worker isolation actually succeeded.

Use `status` or `status --json` to inspect `failed_phase`, `failure_service`, `failure_code`, `failure_summary`, `recovery_started`, `recovery_verified`, `recovery_failure_summary`, and `next_action`. Summaries are bounded and redacted; they do not contain proxy passwords, access credentials, or complete sensitive environment values. If any recovery action fails—including stop, pause, or queue resume—`recovery_failure_summary` contains its bounded sanitized action/code/output summary and the same detail is printed and journaled. Public probes use `curl --noproxy '*'`. A Vite `Host: web:5173` 403 inside a container is a Host allowlist result, not proof of a TCP outage; use loopback or the configured allowed hostname for direct probes.

## One-time host preparation

Normalize a host that was initialized or operated through root before running the first upgrade:

```bash
cd /srv/wiseeff/ops/self-hosted
sudo ./scripts/upgrade.sh prepare-host --yes
```

`prepare-host` does not fetch Git, build an image, stop a service, or touch application data. It identifies the invoking `SUDO_USER`, adds that operator to the Docker socket group when needed, creates and secures the upgrade journal and backup roots, and transfers ownership of existing upgrade state/recovery artifacts to that operator. Membership in the Docker group is effectively root-equivalent host access, so use a dedicated trusted deployment account. A direct root session must pass `--operator <deployment-user>`. Log out and reconnect when the command adds Docker group membership.

Run `plan`, `apply`, `resume`, and `rollback` as the deployment user without `sudo`. The upgrade entry rejects those actions whenever the effective user is root—including direct root shells—because root does not normally inherit the deployment user's proxy environment or Git configuration and would recreate root-owned state.

The compatibility path accepts legacy deployments whose API, worker, and web containers have different image IDs. It records and tags each previous service image independently, then uses those exact service-specific images if pre-migration recovery or rollback is required. Operators no longer need to rebuild/recreate the three services merely to satisfy preflight.

## First adoption

Install the release containing this entry through the existing controlled procedure. Before the first real run, check the checkout and live stack:

```bash
cd /srv/wiseeff
git fetch origin --prune
git checkout <release-commit-containing-upgrade.sh>
cd ops/self-hosted
./scripts/upgrade.sh plan --ref <next-release-tag>
```

Review the current and target SHA, changed migrations, Compose project, volume identities, backup root, and free-space gate. The first adoption must be rehearsed on a non-customer host with a disposable recovery point.

An older controller cannot execute behavior that exists only in its target commit. If the currently installed controller predates automatic base-image preparation and is already blocked at Docker metadata resolution, use the manual `docker load`/`docker tag` fallback in [Self-Hosted Base Images](images/README.md) once to install this release. Upgrades started from this release onward use the integrated path.

If a deployment machine is still checked out at an older controller commit, first fetch and check out the release or commit containing this readiness/recovery fix. Only then run `plan` and `apply`; the old controller cannot interpret or execute the new data-plane and recovery gates.

## Normal upgrade

Run interactively from the existing checkout. The default ref is `WISEEFF_UPGRADE_REF` or `origin/main`; release tags or SHAs are preferred for controlled deployment:

```bash
cd /srv/wiseeff/ops/self-hosted
./scripts/upgrade.sh apply --ref refs/tags/<release>
```

The command asks for the literal word `upgrade` immediately before it stops traffic. Automation must opt into both confirmation flags:

```bash
./scripts/upgrade.sh apply --ref <sha> --non-interactive --yes
```

`apply` reports a successful no-op only when the checkout SHA equals the resolved target, API/worker/web all reference the exact commit-addressed target image, and the public health probe passes. A checkout updated after an earlier failed build therefore enters the normal build/recreate flow instead of printing `already running`. Pass `--restart` only when a same-SHA healthy stack still needs intentional full recreation.

The recovery root defaults to `/var/backups/wiseeff/upgrades/<run-id>` and the ignored journal to `ops/self-hosted/.state/upgrades/<run-id>`. Override them with `--backup-root` and `--state-dir` when the host has a secured dedicated filesystem. The environment file must remain mode `600`.

## Status and interruption

Every mutating phase is written atomically. Keep the printed `run_id` and inspect it after an SSH loss or host restart:

```bash
./scripts/upgrade.sh status --run-id <run-id>
./scripts/upgrade.sh status --run-id <run-id> --json
```

Candidate builds always use plain BuildKit progress and stream a redacted copy to the run journal. If bundled base-image preparation, Docker, or `npm ci` fails, `apply` exits with code `20` before traffic is stopped, restores the previous checkout, and prints three deployment-user-readable paths:

- `diagnostics_dir`: private mode-`0700` directory under the run journal;
- `build_summary`: mode-`0600` classified cause and next step;
- `build_log`: mode-`0600` complete redacted Compose/BuildKit output.

The image build runs `npm ci` through an internal diagnostic wrapper. On failure, the wrapper copies the otherwise-ephemeral `/root/.npm/_logs/*-debug-*.log` content into the build stream between `WISEEFF_NPM_CI_DIAGNOSTICS_BEGIN/END` markers, while preserving the original npm exit code and redacting URL credentials, registry tokens, passwords, and bearer tokens. No host root access is needed. Inspect the durable evidence with:

```bash
./scripts/upgrade.sh status --run-id <run-id>
cat ops/self-hosted/.state/upgrades/<run-id>/diagnostics/summary.txt
less ops/self-hosted/.state/upgrades/<run-id>/diagnostics/build.log
```

Base-image contract/archive/platform failures use the `base-image` category. An identity mismatch prints the pinned manifest/config digests, platform, and Docker-reported actual identity; compare the same fields in `status --json` before changing any tag. Other common failures are classified as dependency-lock mismatch, corporate CA, DNS, network/proxy, registry integrity/package availability, host capacity, or probable OOM. Unknown failures remain `unclassified` with the full log retained. Correct the reported cause and rerun `apply`; no manual copy from `/root/.npm` and no `resume` are needed for a pre-downtime build failure.

Before migration starts, a quiescence or backup failure attempts complete previous-stack restoration; only full verification records `old-stack-restored`, otherwise the run remains `recovery-required`. `failed-safe` is reserved for failures that occur before downtime. If old-stack restoration itself fails before migration, `recovery-required` may offer the executable `resume --run-id <run-id>` retry; it does not restore data. A failure after migration starts records `recovery-required` and does not offer ordinary `resume`; the next action is the token-gated whole-state rollback. If proxy or queue isolation failed, the journal puts the required manual isolation step first; rollback rechecks isolation and blocks before data restoration unless it succeeds. Rollback then uses the same old-stack verification gates and writes `rolled-back` only after internal health, queue resume, previous image identity, and proxy/public checks pass. Do not edit the journal or manually resume traffic.

For an idempotent post-migration health/finalization phase, use the journal's printed action:

```bash
./scripts/upgrade.sh resume --run-id <run-id>
```

`resume` never resets `migration_started` and never silently restores data. It retries old-stack restoration only when `migration_started` is false. A post-migration `recovery-required` run returns exit `70` from ordinary `resume`; follow the journal's token-gated rollback action instead.

### Host lock status and recovery

The regular `.operation.lock` file intentionally remains on disk when `flock` is available; file presence does not mean the host is locked. Inspect the kernel/fallback state and recorded owner with:

```bash
./scripts/upgrade.sh lock-status
```

If a crash left stale owner metadata or a stale mkdir fallback lock, clear it safely with:

```bash
./scripts/upgrade.sh unlock
```

`unlock` is idempotent. It never removes the regular `flock` file, never kills a process, and returns exit `75` with the recorded PID/user/operation when a live setup or upgrade still owns the lock. A recent pidless fallback directory is treated as an acquisition in progress and is not cleared until the five-minute stale-lock grace period proves it was abandoned. Proven-stale mkdir fallback locks are moved aside automatically when a later setup/upgrade acquires the lock, so operators must not manually delete lock files or directories.

| `lock_state` | Meaning | Operator action |
| --- | --- | --- |
| `free` | no operation owns the lock; a regular `flock` file may still exist | continue normally; optional `unlock` clears stale owner metadata |
| `held` | a live kernel lock or fallback PID owns it | wait for the recorded operation; `unlock` safely refuses with exit `75` |
| `initializing` | a recent fallback directory has not finished publishing its PID | wait and retry; after five minutes an abandoned directory becomes stale |
| `stale` | the fallback PID is absent or an incomplete lock exceeded the grace period | run `unlock`, or simply retry setup/upgrade and let acquisition move it aside |

## Rollback and whole-state restore

Rollback always requires the run id. A pre-migration application rollback restores the previous commit-addressed image. If migration startup began, the command refuses an application-only rollback and requires the exact token printed in the journal:

```bash
./scripts/upgrade.sh rollback --run-id <run-id> \
  --restore-data --confirm restore-<run-id>
```

This replaces PostgreSQL, the configured S3-compatible bucket, and durable Redis state with the one recovery point captured before migration. It can discard writes made after that point, so it is confirmation-gated and must be approved by the incident owner. Partial cross-store restore is not exposed by this entry.

Stable exit classes are useful for automation: `0` completed/no-op, `2` invalid input or missing confirmation, `10` preflight/target failure, `20` candidate build failure, `30` quiescence failure with old stack restored, `40` recovery-point failure with old stack restored, `50` pre-migration data-service failure, `70` explicit recovery required, and `75` operation-lock contention.

## Operator safety

- Keep backup storage outside the checkout and Docker data root; protect it with mode `0700` directories and `0600` files.
- Keep `ops/self-hosted/.state/` outside the Docker build context; it contains private operation journals, not application source.
- Treat build diagnostics as private operational data. They are redacted automatically, but review them again before sharing outside the operations team.
- Preserve the same Compose project and named volume identities. Do not add a new project name during an upgrade.
- Treat `recovery-required` as a maintenance incident. Follow exactly one journal action: pre-migration old-stack `resume`, or post-migration whole-state rollback with its run-specific token. If `recovery_proxy_stopped=false` or `recovery_queue_paused=false`, manually isolate that traffic first. Keep public traffic stopped until the recorded recovery action completes.
- Local tests and `selfhost:check` validate the entry and templates; they do not constitute target-environment, pilot, or production-readiness evidence.
