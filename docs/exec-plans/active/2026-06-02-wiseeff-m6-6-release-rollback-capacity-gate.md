# WiseEff M6.6 Release, Rollback And Capacity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Turn WiseEff self-hosted deployments into repeatable release candidates with rollback rehearsal, capacity evidence, and target synthetic acceptance.

**Architecture:** M6.6 consumes M6.1-M6.5 infrastructure and adds release orchestration around it. Releases become versioned, smoke-tested, observable, and reversible; capacity tests run against self-hosted target environments and produce evidence without pretending to cover HDC hardware unless the hardware suite is explicitly enabled.

**Tech Stack:** Self-hosted Linux deployment scripts, Docker Compose or systemd-compatible release commands, WiseEff smoke and acceptance suites, Playwright target synthetic acceptance, k6 or autocannon capacity tests, PostgreSQL migrations, backup/restore scripts, Prometheus/Grafana signals.

---

## Reference Basis

- k6 thresholds docs: https://grafana.com/docs/k6/latest/using-k6/thresholds/
- Playwright docs: https://playwright.dev/
- Docker Compose lifecycle docs: https://docs.docker.com/compose/

## Scope Boundary

M6.6 includes:

- Versioned self-hosted release procedure.
- Pre-release quality and documentation gate.
- Target deployment smoke.
- Database migration safety policy and rollback guidance.
- Queue drain/pause/resume coordination.
- Backup-before-release and restore rehearsal.
- Rollback drill evidence.
- Capacity/load test scripts and thresholds for first commercial pilot scale.
- Target synthetic acceptance job that runs against already deployed self-hosted environments.
- Final M6 commercial-readiness evidence summary.

M6.6 excludes:

- New product functionality.
- Cloud provider deployment pipelines.
- Blue/green or Kubernetes orchestration unless the self-hosted environment already provides it.
- AI exploratory QA.
- Claiming HDC readiness when HDC is not attached and explicitly enabled.

## Dependencies And Ordering

- M6.1 runtime baseline must be usable.
- M6.2 identity path should be complete for production-like target acceptance.
- M6.3 backup/restore scripts must exist.
- M6.4 queue operations must support drain/pause/resume or documented equivalent.
- M6.5 observability must provide release health signals.

## Success Criteria

- Release candidates have a documented version, commit SHA, environment file fingerprint, migration set, and artifact reference.
- Pre-release gates pass: docs, contract, tests, build, browser acceptance, evidence checks, and self-hosted config checks.
- Backup runs before deployment and restore rehearsal is recorded.
- Rollback rehearsal succeeds in a non-customer target environment.
- Capacity test produces latency, error-rate, throughput, CPU/memory, database, queue, and object-store evidence.
- Target synthetic acceptance runs with `--mode target-non-hdc --no-start-runtime`.
- Full-pilot mode remains blocked unless HDC and all external dependencies are present.
- Final M6 evidence clearly states whether WiseEff is ready for a controlled self-hosted commercial pilot.

## Expected File Structure

Create:

- `ops/self-hosted/releases/README.md`: release candidate process.
- `ops/self-hosted/releases/release-template.md`: release evidence template.
- `scripts/run-self-hosted-release-gate.ts`: orchestrates pre-release metadata checks.
- `scripts/run-self-hosted-release-gate.test.ts`: release-gate tests.
- `scripts/run-capacity-gate.ts`: capacity command wrapper and evidence writer.
- `scripts/run-capacity-gate.test.ts`: threshold/evidence validation tests.
- `e2e/capacity/wiseeff-smoke.k6.js` or `scripts/capacity/wiseeff-smoke.ts`: load test script selected during implementation.
- `docs/runbooks/release-rollback.md`: self-hosted release and rollback runbook.
- `docs/generated/m6-release-readiness.md`: final release/capacity/rollback evidence summary.

Modify:

- `package.json`: add release/capacity gate scripts.
- `.github/workflows/ci.yml`: optionally add manual self-hosted target synthetic workflow if not already sufficient from M5.12.
- `ops/self-hosted/README.md`
- `ops/self-hosted/compose.yaml`
- `docs/runbooks/rollback.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/manual-acceptance.md`
- `docs/runbooks/monitoring-alerting.md`
- `docs/developer/verification-matrix.md`
- `docs/design-docs/testing-strategy.md`
- `docs/QUALITY_SCORE.md`
- `docs/exec-plans/tech-debt-tracker.md`

## Implementation Tasks

### Task 1: Release Gate Metadata

- [ ] Write failing tests in `scripts/run-self-hosted-release-gate.test.ts`.
- [ ] Require branch, commit SHA, version label, dirty-worktree status, target environment label, migration list, backup evidence path, rollback plan path, and synthetic acceptance mode.
- [ ] Require explicit HDC status: unavailable, skipped by scope, or enabled with evidence.
- [ ] Implement the release gate metadata checker and evidence writer.
- [ ] Run focused release-gate tests.

### Task 2: Pre-Release Command Orchestration

- [ ] Wire the release gate to run or verify `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:evidence`, and `git diff --check`.
- [ ] Add self-hosted config checks from M6.1.
- [ ] Add backup check from M6.3.
- [ ] Add queue readiness check from M6.4.
- [ ] Add observability config check from M6.5.
- [ ] Ensure failures produce a readable evidence report.

### Task 3: Release And Rollback Runbook

- [ ] Add `docs/runbooks/release-rollback.md`.
- [ ] Define pre-deploy backup, queue drain/pause, migration execution, web/API/worker deployment, smoke, observability watch, and rollback decision points.
- [ ] Define rollback for web/API/worker artifact, database migration failure, object-store inconsistency, and queue backlog.
- [ ] Define forward-fix policy for irreversible migrations.
- [ ] Update `docs/runbooks/rollback.md` to point to the M6.6 release-specific runbook.

### Task 4: Capacity Gate

- [ ] Write failing capacity evidence tests for threshold config, target URL, auth token redaction, and output summary.
- [ ] Add a capacity script covering health, `/api/v1/me`, parameter reads, log list/detail, and selected safe write flow only if a non-customer environment is available.
- [ ] Capture p95 latency, error rate, throughput, CPU/memory, database connections, queue backlog, and object-store probe results.
- [ ] Set first pilot thresholds in docs and make them easy to revise with evidence.
- [ ] Run capacity tests against a non-customer self-hosted target before marking capacity complete.

### Task 5: Target Synthetic Acceptance

- [ ] Confirm M5.12 CI target synthetic mode still works against self-hosted targets.
- [ ] Run `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime` against the target.
- [ ] Run `npm run acceptance:a11y`, `npm run acceptance:responsive`, and visual gate if snapshots are stable for the target build.
- [ ] Archive Playwright report, traces, screenshots, generated browser evidence, operation evidence, and release evidence.

### Task 6: Final M6 Evidence And Completion

- [ ] Generate `docs/generated/m6-release-readiness.md`.
- [ ] Update quality score and technical debt tracker with what is ready, blocked, or explicitly out of scope.
- [ ] Run `npm run docs:check`.
- [ ] Run `npm run contract:check`.
- [ ] Run `npm run test:all`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Move M6.1-M6.6 plans to completed only after each phase has its own verification evidence.

## External Inputs Needed

- Release environment label and host.
- Allowed maintenance window.
- Rollback window and approval owner.
- First-pilot capacity target: concurrent users, requests per minute, log upload volume, maximum accepted p95 latency, and maximum accepted error rate.
- Whether HDC hardware is in scope for the release candidate.
- Where release evidence should be stored if generated artifacts are too sensitive to commit.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add release/rollback runbook and evidence location if durable. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md`, `docs/exec-plans/completed/README.md` | Track final M6 outcome and completed plans. |
| Product specs | Review | `docs/product-specs/` | Update only if release gate changes supported commercial scope. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/deployment-operations.md`, `docs/design-docs/full-stack-architecture.md` | Document release topology and rollback boundaries. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add release, rollback, capacity, and target synthetic gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/release-rollback.md`, `docs/runbooks/rollback.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/monitoring-alerting.md`, `docs/runbooks/manual-acceptance.md` | Core M6.6 scope. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/audit-retention.md`, `docs/security/secrets-management.md` | Release evidence and capacity logs may contain sensitive metadata. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/DESIGN.md` | Update only if target release changes frontend runtime or visual gates. |
| Generated artifacts | Update | `docs/generated/m6-release-readiness.md` | Final evidence summary, redacted before commit. |
| References | Review | `docs/references/` | Add compact release reference if future agents need it. |
| Chinese developer docs | Update | `docs/zh-CN/quality-and-plans.md`, `docs/zh-CN/security-reliability.md`, `docs/zh-CN/backend-runtime.md` | Release and rollback gates are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Release readiness docs must distinguish local gates, target non-HDC gates, and full-pilot HDC gates.
- Capacity thresholds must be documented with actual results or remain explicitly open.
- Rollback cannot be marked complete without rehearsal evidence from a non-customer target environment.

## UI Interaction Automation Review

M6.6 does not intentionally change product UI behavior, but it runs target synthetic browser gates.

- Affected acceptance specs: all `e2e/acceptance/*.acceptance.spec.ts` that run through `npm run acceptance:browser`.
- Acceptance requirement IDs: all IDs in `docs/developer/browser-acceptance-coverage-map.md` remain in scope for release evidence; `HDC-LAB-001` stays conditional unless hardware is enabled.
- Operation IDs: all automated operation IDs in `docs/developer/user-operation-coverage-matrix.md`; `HDC-LAB-001` remains conditional.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime`, and `npm run acceptance:evidence`.
