# Self-Hosted One-Command Upgrade

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md)

**Goal:** Deliver a production-minded single-host upgrade entry that resolves one immutable Git commit, prebuilds it, quiesces writes, verifies a complete recovery point, recreates every Compose service without deleting volumes, runs migrations in the existing API startup path, validates the result, and supports durable resume/recovery.

**Status:** The core implementation and host-compatibility hardening are on `main`. The current follow-up integrates durable, redacted candidate-build diagnostics into `apply` and `status`. A clean forward upgrade and recovery rehearsal remain required target evidence before claiming release readiness.

**Design:** [Self-Hosted One-Command Upgrade Design](../../design-docs/2026-08-20-self-hosted-one-command-upgrade-design.md)

**Architecture:** Add one deep upgrade module behind `ops/self-hosted/scripts/upgrade.sh`. Keep setup/configuration/provisioning in `setup.sh`. The host implementation stays bash so Node.js is not required. Vitest exercises the shell interface with fake commands and temporary Git repositories; in-container TypeScript owns queue maintenance where application dependencies are required.

## Success Criteria

- `cd ops/self-hosted && ./scripts/upgrade.sh` upgrades the configured tracking ref through one confirmation flow.
- the target ref is resolved once and the run records an immutable SHA.
- target checkout validation and application image build complete before any service is stopped.
- a failed candidate build retains deployment-user-readable, redacted BuildKit/npm diagnostics and an actionable summary without requiring host root access.
- the normal path never changes `.env`, runs provision/seed, rotates credentials, or deletes volumes.
- PostgreSQL, object storage, and durable Redis state form one verified pre-migration recovery point.
- every long-running Compose service is recreated while all persistent volume identities stay unchanged.
- API migrations complete before public traffic resumes.
- an interrupted run has exactly one valid next action: safe exit, `resume`, or explicit `rollback`.
- post-migration failures keep the proxy stopped and surface `recovery-required`; they never claim automatic rollback.
- a non-customer Ubuntu rehearsal proves a forward upgrade and an injected post-migration recovery path with redacted evidence.

## Git & PR Workflow

- Create `feat/self-hosted-one-command-upgrade` from the latest `main`.
- Implementation agents commit only on that feature branch. They do not push to `main`, open/merge a PR, or fast-forward local `main`.
- The parent/session owner reviews the branch, runs or spot-checks the required gates, opens the PR, merges after approval, and then runs `git pull origin main`.
- Keep this as one implementation branch unless the target-environment rehearsal needs a follow-up evidence-only branch.
- Target-rehearsal compatibility hardening uses `fix/self-hosted-upgrade-host-compat` from current `main`; the parent/session owner opens and merges its PR after the local gates and CI merge bar pass.

## Preconditions

- The current setup wizard, doctor, Compose wrapper, self-hosted smoke, durable queue, backup/restore runbook, and release/rollback runbook remain available.
- The first target host adopts the release containing `upgrade.sh` using the existing manual upgrade command. Subsequent upgrades use the new entry.
- Implementation must preserve the current Compose project identity; adding a new global `-p` project name is out of scope because it could detach existing named volumes.
- Real target evidence must use a non-customer host and a backup root outside the repository and Docker data root.

## Phase 0 — Freeze The Interface With Failing Tests

**Files:**

- Create `ops/self-hosted/scripts/upgrade.sh.test.ts`
- Create `ops/self-hosted/scripts/fixtures/upgrade/` only for small non-secret fixture manifests if needed
- Update `vitest.scripts.config.ts` only if the current include rules do not discover the test

**Tasks:**

- [ ] Add black-box tests for `apply`, `plan`, `status`, `resume`, and `rollback` parsing.
- [ ] Lock stable exit classes `0`, `2`, `10`, `20`, `30`, `40`, `50`, `60`, `70`, and `75`.
- [ ] Test same-SHA no-op and `--restart` behavior.
- [ ] Test non-interactive confirmation requirements and run-specific restore confirmation.
- [ ] Test console/journal redaction with database, object-store, API-key, and bearer-token canaries.
- [ ] Test forbidden command canaries: `down -v`, `volume rm`, `system prune`, Git reset/clean, seed/provision, and `setup.sh --force`.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
```

Expected before implementation: failures because the public entry does not exist. Expected after each slice: only the next unimplemented behavior remains red.

## Phase 1 — Protocol, Lock, Journal, Plan, And Status

**Files:**

- Create `ops/self-hosted/scripts/upgrade.sh`
- Create `ops/self-hosted/scripts/upgrade-lib.sh`
- Create `ops/self-hosted/upgrade-protocol.env`
- Update `ops/self-hosted/.gitignore` or root `.gitignore` for `.state/`
- Update `ops/self-hosted/scripts/setup.sh` to share the mutating-operation lock
- Update `ops/self-hosted/scripts/setup.sh.test.ts`

**Tasks:**

- [ ] Implement the stable launcher and strict command parser without `eval` or sourcing run-state data.
- [ ] Add one shared host lock for upgrade, mutating setup actions, and future restore operations.
- [ ] Persist a mode-`0700` run directory with atomic phase/field writes and a redacted append-only event log.
- [ ] Define protocol version compatibility and target-checkout re-exec behavior.
- [ ] Implement `plan` to validate checkout shape, `.env` mode/keys, current containers, Compose project/volume identities, Docker/Compose versions, disk/inode headroom, backup-root safety, target ref resolution, and changed migration files.
- [ ] Implement `status` as a read-only journal renderer with text and JSON output.
- [ ] Reject dirty tracked/unignored files, symlink escapes, unknown data size, project identity drift, and insufficient backup/image headroom before downtime.
- [ ] Record `.env` fingerprint only; never print resolved `compose config` containing secrets.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/setup.sh.test.ts
```

Expected: plan/status, protocol, lock contention, dirty tree, path safety, disk, and redaction tests pass with no Docker daemon required.

## Phase 2 — Immutable Target And Commit-Addressed Image Build

**Files:**

- Update `ops/self-hosted/scripts/upgrade.sh`
- Update `ops/self-hosted/scripts/upgrade-lib.sh`
- Update `ops/self-hosted/compose.yaml`
- Update `ops/self-hosted/scripts/check-self-hosted-config.ts`
- Update `ops/self-hosted/scripts/check-self-hosted-config.test.ts`
- Update `ops/self-hosted/.env.example`
- Update profile/env renderers and their tests only if a new optional upgrade-ref key is persisted

**Tasks:**

- [ ] Fetch the requested ref and resolve it once to `<sha>^{commit}`.
- [ ] Record current running application image IDs and tag them with a run-specific previous tag.
- [ ] Check out the target SHA in detached deployment mode without touching ignored `.env`/state paths.
- [ ] Re-exec the target implementation after verifying protocol compatibility.
- [ ] Give API, worker, and web one explicit commit-addressed application image contract; avoid rebuilding the same source three times where Compose permits reuse.
- [ ] Build and run image/config validation while old containers continue serving.
- [ ] On protocol, checkout, or build failure, restore the previous checkout pointer and exit without stopping a container.
- [ ] Preserve ordinary `setup.sh up` behavior when no upgrade tag override is supplied.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
```

Expected: a moving ref cannot change the recorded target mid-run; a build failure leaves old container/image identities running.

## Phase 3 — Queue Quiescence And Verified Recovery Point

**Files:**

- Create `ops/self-hosted/scripts/queue-maintenance.ts`
- Create `ops/self-hosted/scripts/queue-maintenance.test.ts`
- Add an in-container package script in `package.json`
- Update `ops/self-hosted/compose.yaml` with a pinned operations/backup-tool profile if required
- Update `ops/self-hosted/scripts/upgrade.sh`
- Update `ops/self-hosted/scripts/upgrade-lib.sh`
- Update `ops/self-hosted/.env.example` only for truly operator-controlled timeout/root settings

**Tasks:**

- [ ] Add `pause`, `drain-status`, and `resume` queue maintenance behavior for durable BullMQ mode; polling mode reports an explicit no-op.
- [ ] Pause queue intake, stop public proxy, wait for active work, and gracefully stop API/worker/web.
- [ ] Prove no app writer remains before snapshot begins.
- [ ] Stream a custom-format PostgreSQL dump to a partial path and validate it with `pg_restore --list` before atomic completion.
- [ ] Mirror the configured S3-compatible bucket with a pinned `minio/mc` image and verify a key/size/checksum manifest.
- [ ] Force/copy/verify a Redis RDB checkpoint when durable queue mode is enabled.
- [ ] Write a complete SHA-256 artifact manifest and mark the recovery point verified only when all required stores pass.
- [ ] On quiescence or backup failure, restart the stopped old containers, resume queue/proxy, and record `failed-safe` or `old-stack-restored`.
- [ ] Keep partial backup directories for diagnosis; never present them as restorable.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/queue-maintenance.test.ts
```

Expected: every backup failure injection restores the old online stack without migration; the journal contains no secrets and no partial recovery point is accepted.

## Phase 4 — Ordered Full Recreation, Migration, And Health Gates

**Files:**

- Update `ops/self-hosted/scripts/upgrade.sh`
- Update `ops/self-hosted/scripts/upgrade-lib.sh`
- Update `ops/self-hosted/compose.yaml`
- Update `ops/self-hosted/scripts/doctor-selfhost.ts` only if reusable structured health output is needed
- Update `ops/self-hosted/scripts/run-self-hosted-smoke.ts` only if a bounded local/internal mode is needed
- Add focused tests beside each changed script

**Tasks:**

- [ ] Recreate PostgreSQL, Redis, MinIO, and `minio-init` against the recorded existing volumes; wait for health and re-check mounts.
- [ ] Mark `migration-started` immediately before candidate API startup.
- [ ] Start API alone and observe the existing migrate-before-serve command.
- [ ] Prove migration completion and API liveness before starting web/worker.
- [ ] Start web and worker from the candidate image, validate full internal readiness and health, then resume the queue.
- [ ] Start/recreate Caddy last and run public liveness/readiness plus bounded self-hosted smoke.
- [ ] Verify every expected long-running container id changed, expected images run, volume identities match, `.env` fingerprint is unchanged, and no seed/provision command ran.
- [ ] Record downtime, migrations, health/smoke result, and backup manifest before `completed`.
- [ ] If failure occurs after migration startup, stop proxy, pause queue, mark `recovery-required`, and return exit `70` without destructive restore.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
npm run selfhost:check
```

Expected: state-machine fault injection proves the correct safe/recovery behavior at every phase and validates the full-restart invariants.

## Phase 5 — Resume, Rollback, And Whole-State Restore

**Files:**

- Update `ops/self-hosted/scripts/upgrade.sh`
- Update `ops/self-hosted/scripts/upgrade-lib.sh`
- Extend `ops/self-hosted/scripts/upgrade.sh.test.ts`
- Create a real-Docker integration test/harness under `ops/self-hosted/scripts/` or `scripts/` according to existing test routing

**Tasks:**

- [ ] Implement monotonic `resume`: re-check observable state, reuse only checksum-valid backups, and never reset `migration-started`.
- [ ] Implement application-image rollback without data restore only for proven pre-migration or explicitly backward-compatible cases.
- [ ] Implement confirmation-gated whole-state restore of PostgreSQL, object storage, and Redis as one recovery point.
- [ ] Refuse partial cross-store restore through the normal interface.
- [ ] Warn and require a run-specific token if a completed/traffic-served run would discard later writes.
- [ ] Test SIGTERM/SIGHUP/host-reboot-style interruption at every state transition.
- [ ] Ensure interrupted and `recovery-required` backups are never auto-pruned.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
```

Expected: each interrupted phase has one valid next action; explicit restore returns all sentinel stores to the same recovery point.

## Phase 6 — Real Ubuntu Rehearsal And Operator Documentation

**Files:**

- Update `README.md`
- Update `ops/self-hosted/README.md` and `README.zh-CN.md`
- Create `ops/self-hosted/upgrade.md` and `upgrade.zh-CN.md`
- Update `ops/self-hosted/setup.md` and `setup.zh-CN.md` to separate setup from upgrade
- Update `docs/runbooks/self-hosted-runtime.md` and Chinese companion
- Update `docs/runbooks/release-rollback.md` and Chinese companion
- Update `docs/runbooks/backup-restore.md` and Chinese companion
- Update `docs/developer/verification-matrix.md` and Chinese companion if a new target test command is added
- Update `scripts/bilingual-docs.ts`
- Update the design and this plan with final deviations/evidence

**Tasks:**

- [ ] Provision a non-customer Ubuntu host with an existing self-hosted dataset and secured backup root.
- [ ] Record sentinel PostgreSQL row, MinIO object checksum, durable Redis queue state, Caddy volume identity, `.env` fingerprint, running images, and current commit.
- [ ] Run one successful forward upgrade and prove every success criterion.
- [ ] Inject one post-migration readiness failure; prove proxy remains stopped and whole-state recovery follows the documented confirmation flow.
- [ ] Store only redacted run manifest, command status, hashes, and target evidence references; do not commit dumps, object bytes, `.env`, or internal credentials.
- [ ] Update all operator docs with exact first-adoption, normal upgrade, status/resume, and recovery commands.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/queue-maintenance.test.ts
npm run selfhost:check
npm run docs:check
git diff --check
```

Expected: local gates pass and the release record links one successful target upgrade plus one recovery rehearsal.

## Phase 7 — Target-Rehearsal Host Compatibility Hardening

The first Ubuntu rehearsal established the upgrade state-machine shape but exposed several operator-host compatibility gaps. These are implementation findings, not steps that should remain as chat-only manual recovery:

| Finding | Root cause | Required automation |
| --- | --- | --- |
| Git works for the deployment user but times out under `sudo` | `sudo` resets proxy environment variables and reads root's Git config | Keep proxy normalization/`--git-proxy`, reject `plan`/`apply`/recovery actions for any root effective user, and provide a root-only host-preparation action that does not access Git |
| Docker works only through `sudo` | deployment user is absent from the Docker socket group | `prepare-host` detects and adds the invoking `SUDO_USER` to the Docker group, then reports that a new login is required |
| `/var/backups/wiseeff/upgrades` exists but is root-owned | directory creation did not transfer ownership to the deployment operator | `prepare-host` creates/owns/modes the dedicated backup root and upgrade state root without changing application data |
| local diagnostics or corporate build edits make the checkout dirty | untracked/tracked files can change the Docker context or make the deployed source ambiguous | fail immediately with `git status --short` guidance; never auto-delete operator changes |
| a root-created `.state/upgrades/<run-id>` breaks Docker build context transfer | local upgrade journals are ignored by Git but not by Docker | exclude `ops/self-hosted/.state/` from `.dockerignore` and guard it in `selfhost:check` |
| legacy API, worker, and web containers have different image IDs | the earlier Compose shape built per-service images | preserve and tag the previous image per service, accept mixed legacy identities during preflight, and restore each service from its recorded image |
| failed preflight/fetch/build steps can continue and print stale target data | Bash `errexit` is suppressed for functions invoked from `if ! ...` | explicitly propagate every preflight, target-resolution, build, quiescence, snapshot, and recovery error |
| the lock file exists after exit or a fallback lock directory survives a crash | `flock` files are persistent by design; mkdir fallback can be stale | record lock-owner metadata, expose `lock-status`, and make `unlock` clear only proven-stale metadata/fallback locks while refusing a live kernel lock |
| Compose prints the obsolete top-level `version` warning | Compose v2 ignores the legacy key | remove the key and update configuration-token checks |
| Git works but Docker pulls or curl TLS verification still fail | Git, the Docker daemon, and corporate CA trust are separate network scopes | preserve Git proxy settings in the script, document Docker-service proxy and approved-CA setup, and never disable TLS verification automatically |

**Tasks:**

- [x] Add regression tests for fail-fast preflight/fetch/build behavior and mixed legacy application images.
- [x] Add `prepare-host`, `lock-status`, and safe `unlock` actions without widening `apply` authority.
- [x] Add lock-owner metadata and stale-lock recovery tests for `flock` and mkdir fallback modes.
- [x] Exclude upgrade state from Docker build context and remove the obsolete Compose version field.
- [x] Update the operator guide/design pair with the one-time preparation flow, automatic compatibility behavior, lock decision table, and exact success evidence.
- [x] Run script tests, `selfhost:check`, `docs:check`, TypeScript build, and `git diff --check` locally.
- [ ] Merge only after the CI merge bar passes.

**Expected outcome:** a fresh or previously root-operated Ubuntu checkout can be normalized with one explicit host-preparation command, normal upgrade commands run as the deployment user, legacy application images require no manual convergence, failed gates stop immediately, and operators never manually delete a lock file or directory.

## Phase 8 — Integrated Candidate-Build Diagnostics

Docker BuildKit runs `npm ci` as root inside an ephemeral stage. A failure may therefore advertise `/root/.npm/_logs` even though that path is neither the deployment user's host directory nor recoverable after the failed stage exits. Diagnosis must be a default responsibility of the upgrade module, not an emergency command sequence.

**Files:**

- Create `ops/self-hosted/scripts/npm-ci-with-diagnostics.sh` and focused tests.
- Update `ops/self-hosted/Dockerfile` and self-hosted configuration checks.
- Update `ops/self-hosted/scripts/upgrade-lib.sh` and its public-interface tests.
- Update the upgrade design, operator guide, and operations-handbook bilingual pairs.

**Tasks:**

- [x] Run `npm ci` through a portable wrapper that emits sanitized in-stage npm debug logs on failure and preserves the original exit code.
- [x] Force plain BuildKit progress for candidate builds while streaming redacted output to the private run journal.
- [x] Classify common lockfile, CA, DNS, proxy/network, registry, capacity, and OOM failures into a concise summary.
- [x] Expose build status, diagnostics directory, build log, summary, and next action through existing text/JSON `status` output.
- [x] Keep the failure before downtime, restore the previous checkout, retain stable exit `20`, and leave the old stack online.
- [x] Enforce `0700`/`0600` permissions and regression-test credential redaction, log retention, status rendering, and Dockerfile wiring.
- [ ] Rehearse one injected npm build failure on the target Ubuntu host and retain only redacted path/status evidence.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/npm-ci-with-diagnostics.test.ts ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
git diff --check
```

**Expected outcome:** `upgrade.sh apply` automatically turns an otherwise inaccessible BuildKit npm failure into a durable, private, deployment-user-readable diagnostic bundle, while preserving the no-downtime-on-build-failure invariant and the existing operator interface.

## Rollout And Compatibility

1. Land the implementation without changing existing setup/start defaults.
2. Install that release once through the current manual `git fetch` / checkout / Compose path.
3. Run `upgrade.sh plan` on the target and compare detected project/volume identities with the live stack.
4. Rehearse a same-SHA `--restart` on a non-customer host.
5. Rehearse a forward upgrade and failure recovery.
6. Promote `upgrade.sh` to the documented default upgrade entry only after the target evidence is reviewed.

If standalone Compose behavior cannot satisfy a required invariant, fail preflight with an actionable version message; do not silently take a weaker path.

## Documentation Impact Matrix

| Area | Status | Files | Requirement |
| --- | --- | --- | --- |
| Repository maps | Update | `README.md`, `docs/README.md` if needed | Point upgrade operators to the new entry; keep setup separate. |
| Planning docs | Update | this plan, Chinese companion, `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Track implementation and completion evidence. |
| Product specs | No change | `docs/product-specs/` | Operator workflow, not end-user product behavior. |
| Architecture docs | Update | design doc pair; review `ARCHITECTURE.md`; `docs/design-docs/deployment-operations.md` pair | Record the upgrade module and source-checkout deployment seam. |
| Quality/testing docs | Review | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` and companions | Add target integration gate if it becomes a recurring command. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md` and companion; self-hosted, release/rollback, backup/restore runbook pairs | Exact ordering, failure classes, restore authority, evidence. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/secrets-management.md`, `docs/security/data-classification.md` and companions | Backup sensitivity, log redaction, restore confirmation. |
| Frontend/design docs | No change | `docs/FRONTEND.md`, UI design docs | No product UI or browser interaction change. |
| Generated artifacts | Review | target run manifest/evidence path only | Never commit customer data, dumps, `.env`, or secrets. |
| References | Review | `docs/references/` | Add no reference unless a concise upgrade protocol reference proves useful. |
| Self-hosted ops | Update | `ops/self-hosted/**`, `compose.yaml`, examples, scripts | Implementation surface. |
| Chinese developer docs | Update | every companion named above | Separate, linked English and Chinese pages. |

## Documentation Update Gate

- Before moving this plan to `completed/`, every `Update` and `Review` row must be updated or explicitly recorded unchanged with evidence.
- `scripts/bilingual-docs.ts` must include every new required operator/design pair.
- `npm run docs:check` is blocking.
- Deferred provider adapters, zero-downtime deployment, prebuilt registry releases, or automatic retention must be added to `docs/exec-plans/tech-debt-tracker.md` if they remain desired after implementation.

## UI Interaction Automation Review

No frontend-visible interaction, route, form, API response consumed by the UI, or user operation changes. No browser acceptance requirement or operation ID is added. The target self-hosted smoke remains an operations validation, not a UI product change.
