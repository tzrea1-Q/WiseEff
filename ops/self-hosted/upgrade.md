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

Git, Docker Engine, and application build downloads are separate network scopes. The script can preserve or override Git proxy settings, but it deliberately does not rewrite a host's Docker daemon proxy or corporate trust store. If `git fetch` works while an image pull fails, configure the Docker service proxy. If TLS inspection produces an unknown/self-signed-chain error, install the organization-approved CA for Git/curl/Docker instead of globally disabling certificate verification.

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

If the resolved SHA already runs, the command exits successfully as a no-op. Pass `--restart` only when a same-SHA full recreation is intentionally required.

The recovery root defaults to `/var/backups/wiseeff/upgrades/<run-id>` and the ignored journal to `ops/self-hosted/.state/upgrades/<run-id>`. Override them with `--backup-root` and `--state-dir` when the host has a secured dedicated filesystem. The environment file must remain mode `600`.

## Status and interruption

Every mutating phase is written atomically. Keep the printed `run_id` and inspect it after an SSH loss or host restart:

```bash
./scripts/upgrade.sh status --run-id <run-id>
./scripts/upgrade.sh status --run-id <run-id> --json
```

Candidate builds always use plain BuildKit progress and stream a redacted copy to the run journal. If Docker or `npm ci` fails, `apply` exits with code `20` before traffic is stopped, restores the previous checkout, and prints three deployment-user-readable paths:

- `diagnostics_dir`: private mode-`0700` directory under the run journal;
- `build_summary`: mode-`0600` classified cause and next step;
- `build_log`: mode-`0600` complete redacted Compose/BuildKit output.

The image build runs `npm ci` through an internal diagnostic wrapper. On failure, the wrapper copies the otherwise-ephemeral `/root/.npm/_logs/*-debug-*.log` content into the build stream between `WISEEFF_NPM_CI_DIAGNOSTICS_BEGIN/END` markers, while preserving the original npm exit code and redacting URL credentials, registry tokens, passwords, and bearer tokens. No host root access is needed. Inspect the durable evidence with:

```bash
./scripts/upgrade.sh status --run-id <run-id>
cat ops/self-hosted/.state/upgrades/<run-id>/diagnostics/summary.txt
less ops/self-hosted/.state/upgrades/<run-id>/diagnostics/build.log
```

Common failures are classified as dependency-lock mismatch, corporate CA, DNS, network/proxy, registry integrity/package availability, host capacity, or probable OOM. Unknown failures remain `unclassified` with the full log retained. Correct the reported cause and rerun `apply`; no manual copy from `/root/.npm` and no `resume` are needed for a pre-downtime build failure.

Before migration starts, a quiescence or backup failure brings the previous stack back and records `old-stack-restored` or `failed-safe`. A failure after candidate API startup records `recovery-required`, leaves the proxy stopped, and keeps queues paused. Do not edit the journal or manually resume traffic.

For an idempotent post-migration health/finalization phase, use the journal's printed action:

```bash
./scripts/upgrade.sh resume --run-id <run-id>
```

`resume` never resets `migration_started` and never silently restores data. If the run is `recovery-required`, follow the explicit rollback path.

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
- Treat `recovery-required` as a maintenance incident. Keep the proxy stopped until `resume` or the approved whole-state restore completes.
- Local tests and `selfhost:check` validate the entry and templates; they do not constitute target-environment, pilot, or production-readiness evidence.
