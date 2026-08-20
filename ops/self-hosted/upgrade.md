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

Before migration starts, a quiescence or backup failure brings the previous stack back and records `old-stack-restored` or `failed-safe`. A failure after candidate API startup records `recovery-required`, leaves the proxy stopped, and keeps queues paused. Do not edit the journal or manually resume traffic.

For an idempotent post-migration health/finalization phase, use the journal's printed action:

```bash
./scripts/upgrade.sh resume --run-id <run-id>
```

`resume` never resets `migration_started` and never silently restores data. If the run is `recovery-required`, follow the explicit rollback path.

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
- Preserve the same Compose project and named volume identities. Do not add a new project name during an upgrade.
- Treat `recovery-required` as a maintenance incident. Keep the proxy stopped until `resume` or the approved whole-state restore completes.
- Local tests and `selfhost:check` validate the entry and templates; they do not constitute target-environment, pilot, or production-readiness evidence.
