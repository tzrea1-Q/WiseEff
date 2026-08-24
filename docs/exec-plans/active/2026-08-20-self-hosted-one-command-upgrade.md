# Self-Hosted One-Command Upgrade

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md)

**Goal:** Deliver a production-minded single-host upgrade entry that resolves one immutable Git commit, prebuilds it, quiesces writes, verifies a complete recovery point, recreates every Compose service without deleting volumes, runs migrations in the existing API startup path, validates the result, and supports durable resume/recovery.

**Status:** The core implementation, host-compatibility hardening, durable build diagnostics, bundled Node base-image preparation, and the MinIO/readiness/recovery hotfixes through PR #621 (`59930c963e172d843ef8f6cb17a33247467a9ab5`) are maintained on `main`. PR #624 (`7749429778cf27bd40aab57fdc775b8084a7a7a5`) is also merged into `main` and provides the advanced-resume worker/proxy gate; the main-line repository implementation additionally includes scheme-agnostic diagnostic credential redaction, covered by mock tests and applicable CI. A clean forward upgrade and recovery rehearsal on a non-customer target host remain the only unfinished environment evidence before claiming release readiness; conditional target-synthetic and local-non-HDC jobs are skipped when prerequisites are absent, not passed.

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
- an interrupted run has exactly one valid next action: safe exit, pre-migration `resume`, or post-migration token-gated `rollback`; failed proxy/queue isolation puts the required manual isolation step first.
- post-migration failures attempt to stop the proxy and surface `recovery-required`; failed isolation is recorded as a manual first step, and the controller never claims automatic rollback.
- the data-plane gate requires PostgreSQL/Redis Docker `healthy`, MinIO process `running`, and successful `minio-init` exit `0`; MinIO is never considered ready from `running` alone.
- `old-stack-restored` is written only after data plane, API, worker, web, previous-image, queue resume, and last-stage proxy/public recovery gates pass; otherwise the journal records `recovery-required` with a non-`none` next action.
- a non-customer Ubuntu rehearsal proves a forward upgrade and an injected post-migration recovery path with redacted evidence.

## Git & PR Workflow

- Create `codex/selfhost-upgrade-recovery-hotfix` from the latest `main`.
- Implementation agents commit only on that feature branch. They do not push to `main`, open/merge a PR, or fast-forward local `main`.
- The parent/session owner reviews the branch, runs or spot-checks the required gates, opens the PR, merges after approval, and then runs `git pull origin main`.
- Keep this as one implementation branch (`codex/selfhost-upgrade-recovery-hotfix`) unless the target-environment rehearsal needs a follow-up evidence-only branch.
- Target-rehearsal compatibility hardening uses `fix/self-hosted-upgrade-host-compat` from current `main`; the parent/session owner opens and merges its PR after the local gates and CI merge bar pass.
- Restricted-network hardening uses `codex/selfhost-restricted-network-build`; the session owner opens its PR after local gates pass and merges only after every required CI check passes.
- Build-only insecure TLS compatibility uses `fix/selfhost-insecure-build-tls-policy`; the session owner opens its PR after local gates pass and merges only after every required CI check passes.
- PR #624 maintains the advanced-resume worker/proxy gate on `main`; diagnostic redaction is a subsequent main-line maintenance change. The session owner merges only after every applicable required CI check passes. Do not switch or rewrite a dirty shared `main` worktree to synchronize it after merge.

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
- [ ] On quiescence or backup failure, pass the data-plane gate before recreating old app containers, verify internal health and image identity, resume the queue, recreate proxy, and probe public health last; if isolation failed, require manual isolation and keep `recovery-required` until all gates pass.
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
- [ ] If failure occurs after migration startup, attempt proxy and queue/worker isolation, mark `recovery-required`, require manual isolation first when either attempt fails, and return exit `70` without destructive restore.

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

## Phase 9 — Pinned Bundled Dockerfile Base Image

The target Ubuntu rehearsal showed BuildKit trying to resolve `node:22.21.1-alpine` from Docker Hub even though the repository contains an amd64 tar. A file in the checkout is not part of Docker's image store, the tar carries a different archive tag, and `.dockerignore` intentionally keeps the 54 MB artifact out of the application build context. Base-image readiness must therefore be a controller responsibility before candidate build.

**Files:**

- Add a machine-readable contract beside the existing base-image tar.
- Update `upgrade-lib.sh`, its public-interface tests, and the self-hosted config checker.
- Update the base-image, upgrade, operations, design, and execution-plan bilingual pairs.

**Tasks:**

- [x] Make `plan` read the target commit's contract without sourcing it and verify Dockerfile ref, tar blob SHA-256, expected image ID/platform, and Docker server platform without loading/tagging.
- [x] Make `apply` revalidate the checked-out tar before build, skip work when the exact image is local, otherwise load the verified archive and create the exact Dockerfile tag.
- [x] Fail closed on missing/tampered archives, unknown/duplicate contract fields, unexpected image identity, or platform mismatch before Compose build and before downtime.
- [x] Record base-image ref, ID, platform, source, and status in text/JSON run status; classify preparation failure as `base-image` under stable build exit `20`.
- [x] Keep the tar outside Docker build context and prohibit automatic pull substitution, default/global TLS disabling, image deletion, and prune behavior.
- [x] Regression-test plan read-only behavior, load/tag ordering, exact-local skip, checksum rejection, platform mismatch, build fail-fast behavior, status rendering, and repository contract drift.
- [ ] Rehearse one target-host `plan` showing `ready-bundled`, then `apply` showing `base_image_source=bundled-archive` and a candidate build that passes the base metadata stage without Docker Hub.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
git diff --check
```

**Expected outcome:** after this controller release is installed, the standard `plan`/`apply` interface deterministically prepares the pinned Node base image from the repository bundle before candidate build, while preserving the old online stack on any preparation failure. The one release that installs this newer controller may still require the documented manual load/tag first-adoption fallback because an older running controller cannot execute target-only behavior.

## Phase 10 — Restricted Enterprise Build Network

The bundled Node image removes one Docker Hub dependency, but the Dockerfile still resolves Alpine packages, the pinned DTC Git source, Python packages, and npm packages. Host Git proxy success is not evidence that BuildKit `RUN` instructions received a proxy, and a TLS-inspecting enterprise proxy also requires the organization-approved CA inside every networked build stage.

**Files:**

- Add a small build-network module and operator entry under `ops/self-hosted/scripts/`.
- Add a mode-`0600` build-network example/config contract outside the runtime `.env`.
- Update `compose.yaml`, `Dockerfile`, npm diagnostics, setup/upgrade entries, and focused script/config tests.
- Update the upgrade, setup, operations, design, reliability, and environment-variable bilingual documentation where the new operator contract applies.

**Tasks:**

- [x] Load only an allowlisted data format; never source the build-network file or print proxy credentials.
- [x] Preserve standard upper/lower-case proxy variables, reject conflicting values, and pass them as Docker predefined proxy build arguments to setup and upgrade builds.
- [x] Support an optional internal npm registry with `replace-registry-host=always`, so the committed non-default absolute tarball hosts do not bypass the configured registry.
- [x] Disable deployment-only npm audit, fund, and update-notifier requests while leaving CI security gates unchanged.
- [x] Mount an optional organization-approved CA through a BuildKit secret and install it into every networked build stage without disabling TLS verification in the default `verify` policy.
- [x] Make `upgrade.sh plan`, setup preflight, and a dedicated read-only status entry report proxy/registry/CA/runtime-proxy state without revealing values.
- [x] Optionally propagate the approved proxy and baked CA to API/worker runtime containers only when the operator explicitly enables runtime proxying.
- [x] Keep candidate build failure before downtime, preserve the current redacted diagnostic journal, and point network/CA summaries to the persistent build-network contract.
- [x] Cover shell-only proxy settings, config-file settings, conflicting variables, unsafe permissions, CA validation, npm registry replacement, setup/upgrade wiring, and credential redaction through public seams.
- [x] Make the pinned Alpine DTC build self-contained (`yaml-dev`, runtime `yaml`, library path) and build the Python `libfdt` binding from the same pinned DTC commit instead of resolving the incompatible legacy PyPI source package.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/build-network.sh.test.ts ops/self-hosted/scripts/npm-ci-with-diagnostics.test.ts ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/setup.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
docker buildx build --platform linux/amd64 --load --tag wiseeff-build-network-verify:amd64 --secret id=wiseeff-corporate-ca,src=ops/self-hosted/build-network/empty-ca.pem -f ops/self-hosted/Dockerfile .
git diff --check
```

**Expected outcome:** a deployment user can persist one private build-network file or use the current shell proxy, then run the unchanged one-command setup/upgrade interfaces. Git, BuildKit package downloads, optional internal npm registry replacement, and approved CA trust are deterministic and diagnosable without leaking credentials or editing Docker daemon state.

## Phase 11 — Docker Image-Store Identity Compatibility And Verified No-Op

A target Docker Engine 28.1.1 host using classic `overlay2` reports the saved image's config digest from `.Id`, while a containerd-backed development host reports its OCI manifest digest. The same target also showed that Git HEAD alone cannot prove a successful apply: an earlier build failure may leave the checkout at the target while API/worker/web still run an older image.

**Tasks:**

- [x] Extend the base-image contract with the pinned Docker config digest while retaining the OCI manifest digest and exact platform.
- [x] Accept either contracted digest only on the contracted platform; include both expected identities and the Docker-reported actual identity in mismatch diagnostics.
- [x] Extract manifest and config identities from the repository tar in `selfhost:check` so contract/archive drift fails CI.
- [x] Persist both identities in plan output and text/JSON run status.
- [x] Require exact commit-addressed image refs on API/worker/web plus a passing public probe before a same-SHA apply returns no-op.
- [x] Add black-box regressions for classic Docker identity, unexpected identity diagnostics, stale runtime images, public health probing, and status evidence.
- [x] Update the upgrade, operations, base-image, design, reliability, and plan bilingual documentation pairs.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
git diff --check
```

**Target evidence still required:** rerun `apply` on the reported Docker 28.1.1 `overlay2` host. It must accept config digest `sha256:c91ce80d48fb1a545181cbad2e7e4329bf5aa581c9a87db465e31fa21f92add7`, complete the candidate build, recreate API/worker/web with the target commit tag, and pass public health. Local and CI gates validate the controller behavior but do not substitute for this deployment-host proof.

## Phase 12 — Build-Only TLS Break-Glass Compatibility

Some enterprise deployment hosts can use an authenticated proxy but cannot install the interception CA. A blanket host/runtime TLS disablement would be unsafe, while an npm-only workaround would leave Alpine, Git, or Python downloads inconsistent. The build-network module therefore owns one explicit policy and translates it to each downloader behind the existing seam.

**Tasks:**

- [x] Add `WISEEFF_BUILD_TLS_POLICY=verify|insecure` to the private allowlisted contract; keep `verify` as the default.
- [x] Require `--allow-insecure-build` on every setup/upgrade command that can build, reject either key in isolation, and clear inherited acknowledgements.
- [x] Scope insecure behavior to npm endpoint validation, the pinned DTC Git clone, named pip hosts, and apk HTTPS certificate checking; retain npm integrity, Alpine package signatures, base-image identity, host Git, Docker daemon, and runtime TLS gates.
- [x] Add a non-secret policy/CA/package-host fingerprint that invalidates trust-install cache when inputs change.
- [x] Persist redacted policy, fingerprint, and `completed_with_insecure_build_transport` evidence in plan/status/build summaries; label the candidate image without persisting a TLS-disable environment variable.
- [x] Add black-box tests for policy parsing, two-key authorization, npm adapter behavior, Compose/Dockerfile wiring, forbidden global disablement, cache fingerprint changes, and status provenance.
- [x] Update setup, upgrade, operations, environment-variable, design, reliability, README, and plan documentation in both languages.
- [ ] Rehearse `plan` plus `apply --allow-insecure-build` on the reported CA-less target host and confirm runtime image environment contains no TLS-disable variable.
- [ ] Merge only after every required PR check passes.

**Verification:**

```bash
npm run test:scripts -- ops/self-hosted/scripts/build-network.sh.test.ts ops/self-hosted/scripts/npm-ci-with-diagnostics.test.ts ops/self-hosted/scripts/setup.sh.test.ts ops/self-hosted/scripts/upgrade.sh.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts
npm run selfhost:check
npm run docs:check
npm run build
git diff --check
```

**Expected outcome:** CA-less enterprise hosts have an explicit, auditable one-build compatibility path without making insecure transport the default, leaking credentials, weakening package identity/integrity, or changing runtime TLS.

## Phase 13 — MinIO Readiness, Candidate Worker Gates, And Truthful Recovery

The incident run `20260824T021935Z-2079618` showed two controller-truth defects: MinIO has no Docker healthcheck and was held to a generic `healthy` wait, while previous-stack recovery could write `old-stack-restored` without verifying worker, web, proxy/public access, queue resume, or previous image identity. Follow-up acceptance found four additional state-machine gaps: MinIO could exit while `minio-init` was still being polled, an unhealthy candidate worker could precede queue/proxy recovery, `recovery-required` could recommend an unusable action, and restore readiness failures retained the candidate phase. This phase keeps service-specific readiness, candidate app readiness, and recovery verification behind `upgrade-lib.sh` so callers express only data-plane readiness and the restore operation.

**Tasks:**

- [x] Add mock Docker/Compose RED tests for MinIO running vs `minio-init` exit `0`, MinIO exit, initializer failure/timeout, PostgreSQL/Redis health, restore gates, stable failure fields, redaction, and proxy bypass.
- [x] Implement `wiseeff_upgrade_wait_data_plane_ready` with service-specific semantics and bounded diagnostics (`failed_phase`, `failure_service`, `failure_code`, `failure_summary`).
- [x] Implement a restore-only verification helper covering data plane, queue resume, API live/ready, worker live/healthy, web direct, previous app image identity, and proxy/public health.
- [x] Keep `old-stack-restored` and `next_action=none` behind `recovery_verified=true`; otherwise persist `recovery-required`, attempt queue/worker and proxy isolation, and record any failed isolation as a manual first step.
- [x] Use `curl --noproxy '*'` for public probes and preserve the build-only `WISEEFF_BUILD_TLS_POLICY` security boundary without introducing a global TLS bypass.
- [x] Recheck MinIO on every `minio-init` poll and once after exit `0`; classify exit, inspect, initializer failure, and timeout paths separately.
- [x] Require candidate worker liveness plus Docker health before queue resume in both `apply` and `resume`, and retain the same gate during final verification.
- [x] Make `recovery-required` next actions executable: pre-migration runs may retry old-stack restore, post-migration runs require token-gated whole-state rollback, and failed isolation requires manual traffic/queue isolation first.
- [x] Enter `old-stack-restore` before any restore operation so recovery data-plane failures cannot retain a candidate phase while preserving earlier candidate failure evidence on successful recovery.
- [x] Update the bilingual operator docs, reliability/runbook references, design notes, and this plan; keep the deployment-host acceptance boundary explicit.
- [x] Implement the advanced-resume proxy isolation/readiness gate for `queue-resumed`, `starting-proxy`, and `validating-public`; keep proxy/public blocked until API/worker/web rechecks pass, and retain final worker drift verification.
- [x] Extend the diagnostic credential corpus and persistence tests for HTTP(S), SOCKS variants, valid extension schemes, mixed-case authorization headers, non-secret context preservation, and all existing secret categories; keep failure service/code and next-action evidence intact.
- [x] Merge the MinIO/readiness/recovery hotfix into `main` through PR #621 and merge commit `59930c963e172d843ef8f6cb17a33247467a9ab5`; merge the advanced-resume implementation through PR #624 and merge commit `7749429778cf27bd40aab57fdc775b8084a7a7a5`, with the diagnostic-redaction regression coverage recorded in this plan.
- [ ] Deploy the merged controller on a non-customer target host and rehearse one clean forward upgrade plus one recovery path; local mock tests and CI do not close this target evidence.

**Verification:**

```bash
bash -n ops/self-hosted/scripts/upgrade.sh
bash -n ops/self-hosted/scripts/upgrade-lib.sh
npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts
npm run test:scripts
npm run selfhost:check
npm run docs:check
npm run build
git diff --check
```

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
| Repository maps | Review | `README.md`, `docs/README.md` if needed | Existing self-hosted links already route to `ops/self-hosted/upgrade.md`; no map change is needed for this defect fix. |
| Planning docs | Update | this plan and Chinese companion; review `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Track implementation and completion evidence. |
| Product specs | No change | `docs/product-specs/` | Operator workflow, not end-user product behavior. |
| Architecture docs | Update | design doc pair; review `ARCHITECTURE.md`; `docs/design-docs/deployment-operations.md` pair | Record the upgrade module and source-checkout deployment seam. |
| Quality/testing docs | Update | `docs/QUALITY_SCORE.md` and companion; review `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` and companions | Record the mock controller regression gate; the existing generic script-suite entries already cover this command, and target integration remains deployment evidence. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md` and companion; `docs/runbooks/self-hosted-runtime.md` and companion; review release/rollback and backup/restore runbook pairs | Exact ordering, failure classes, restore authority, evidence. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/secrets-management.md`, `docs/security/data-classification.md` and companions | Backup sensitivity, log redaction, restore confirmation. |
| Frontend/design docs | No change | `docs/FRONTEND.md`, UI design docs | No product UI or browser interaction change. |
| Generated artifacts | Review | target run manifest/evidence path only | Never commit customer data, dumps, `.env`, or secrets. |
| References | Review | `docs/references/` | Add no reference unless a concise upgrade protocol reference proves useful. |
| Self-hosted ops | Update | `ops/self-hosted/**`, `compose.yaml`, examples, scripts | Implementation surface. |
| Environment variables | Review | `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md` | No new variable is introduced; existing build-only TLS and runtime-proxy semantics remain unchanged. |
| Chinese developer docs | Update | every companion named above | Separate, linked English and Chinese pages. |

## Documentation Update Gate

- Before moving this plan to `completed/`, every `Update` and `Review` row must be updated or explicitly recorded unchanged with evidence.
- `scripts/bilingual-docs.ts` must include every new required operator/design pair.
- `npm run docs:check` is blocking.
- Deferred provider adapters, zero-downtime deployment, prebuilt registry releases, or automatic retention must be added to `docs/exec-plans/tech-debt-tracker.md` if they remain desired after implementation.

## UI Interaction Automation Review

No frontend-visible interaction, route, form, API response consumed by the UI, or user operation changes. No browser acceptance requirement or operation ID is added. The target self-hosted smoke remains an operations validation, not a UI product change.
