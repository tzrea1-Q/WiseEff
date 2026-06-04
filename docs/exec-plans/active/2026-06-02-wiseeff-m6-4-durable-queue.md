# WiseEff M6.4 Durable Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Replace or augment the database-polling worker seam with a self-hosted durable queue for log-analysis work.

**Architecture:** PostgreSQL remains the source of truth for business records, job state, audit, and evidence. Redis plus BullMQ, or a deliberately chosen equivalent, becomes the durable dispatch and retry layer so API and worker processes can scale independently while job completion remains transactionally reflected in PostgreSQL.

**Tech Stack:** Redis, BullMQ, TypeScript worker adapters, PostgreSQL job records, Vitest, Playwright acceptance for log workflows, self-hosted Docker Compose, WiseEff readiness and smoke gates.

---

## Reference Basis

- BullMQ overview: https://docs.bullmq.io/what-is-bullmq
- BullMQ API docs: https://api.docs.bullmq.io/
- Redis persistence docs: https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/

## Scope Boundary

M6.4 includes:

- Queue adapter interface for enqueue, process, retry, dead-letter, pause, resume, and health.
- Redis/BullMQ self-hosted service wiring.
- Log-analysis job dispatch through the durable queue.
- Idempotent PostgreSQL job transitions so duplicate queue delivery cannot corrupt state.
- Retry/backoff/dead-letter behavior with explicit failure reasons.
- Worker graceful shutdown and stuck-job recovery.
- Readiness endpoint updates for Redis and queue health.
- Backup/restore coordination with M6.3 Redis persistence procedures.

M6.4 excludes:

- Moving all future async tasks to Redis in one sweep.
- Replacing PostgreSQL as the source of truth for job history.
- Multi-region queue topology.
- Full observability dashboards. Metrics hooks may be added, but dashboards are M6.5.

## Dependencies And Ordering

- M6.1 should provide the self-hosted runtime baseline.
- M6.3 should define backup/restore scripts; M6.4 closes Redis-specific backup validation.
- M6.5 will consume queue metrics and logs.
- M6.6 will use queue drain/pause/resume during release and rollback.

## Success Criteria

- [x] Log uploads enqueue work into the durable queue in durable mode.
- [x] A separate worker process consumes queue jobs in durable mode.
- [x] PostgreSQL job state remains coherent after retry scheduling, retry exhaustion, and duplicate delivery in local tests.
- [x] Dead-letter records remain visible through PostgreSQL job state and existing log/job APIs.
- [x] `/health/ready` reports Redis/BullMQ transport and PostgreSQL job-state readiness when durable queue health is configured.
- [ ] `npm run test:m2`, `npm run acceptance:browser`, and log-analysis acceptance pass with queue mode enabled against a target environment.
- [x] TD-007 is narrowed with local implementation evidence; target Redis evidence, queue metrics, and capacity tuning remain open.

## Expected File Structure

Create:

- `server/modules/jobs/queuePort.ts`: queue adapter interface and shared types.
- `server/modules/jobs/bullmqQueue.ts`: Redis/BullMQ implementation.
- `server/modules/jobs/bullmqQueue.test.ts`: adapter unit tests with fake Redis/BullMQ boundaries.
- `server/modules/jobs/queueHealth.ts`: queue readiness model.
- `server/modules/jobs/queueHealth.test.ts`: readiness tests.
- `server/modules/logs/logAnalysisQueue.ts`: log-analysis enqueue/process binding.
- `server/modules/logs/logAnalysisQueueRuntime.test.ts`: durable runtime creation, malformed payload, retry throw, and transport tests.
- `docs/runbooks/durable-queue.md`: Redis/BullMQ operator runbook.

Modify:

- `server/modules/logs/service.ts`
- `server/modules/logs/worker.ts`
- `server/modules/logs/workerRunner.ts`
- `server/modules/jobs/repository.ts`
- `server/modules/jobs/workerHealth.ts`
- `server/modules/operations/health.ts`
- `server/contextFactory.ts`
- `server/index.ts`
- `package.json`
- `ops/self-hosted/compose.yaml`
- `ops/self-hosted/.env.example`
- `docs/RELIABILITY.md`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/monitoring-alerting.md`
- `docs/developer/environment-variables.md`
- `docs/developer/verification-matrix.md`
- `docs/exec-plans/tech-debt-tracker.md`

## Implementation Tasks

### Task 1: Queue Port And Contract Tests

- [x] Write failing tests for queue semantics: enqueue once, retry/backoff, dead-letter after max attempts, pause/resume, and health failure.
- [x] Add queue types without coupling service code directly to BullMQ.
- [x] Run focused queue tests and confirm the red/green path before implementation.

### Task 2: Redis/BullMQ Adapter

- [x] Add BullMQ and Redis client dependencies after reviewing package impact.
- [x] Implement the BullMQ adapter behind `queuePort`.
- [x] Add env variables for Redis URL, queue prefix, retry attempts, backoff, and worker concurrency.
- [x] Ensure Redis connection errors surface as actionable readiness failures instead of silent success.
- [x] Run focused queue adapter tests.

### Task 3: Log Analysis Dispatch

- [x] Write failing tests for log upload enqueue, worker consume by `jobId`, duplicate delivery, retry scheduling, and dead-letter status.
- [x] Update log creation to write PostgreSQL job state and enqueue the durable queue message after job creation.
- [x] Update worker runner to consume from the queue and use existing log-analysis processing functions.
- [x] Preserve existing local database-polling mode through `LOG_ANALYSIS_QUEUE_MODE=polling`.
- [x] Run focused log-analysis queue, service, route, worker, and worker-runner tests.

### Task 4: Health, Smoke, And Operations

- [x] Add queue health to `/health/ready` and pilot-readiness details.
- [x] Update smoke scripts to report Redis/queue status separately from worker status.
- [x] Add tests for queue-ready, queue-degraded, and queue-missing modes.
- [x] Update runbooks for pause, resume, drain, dead-letter review, and recovery.

### Task 5: Acceptance And Backup Integration

- [ ] Run log-analysis acceptance with queue mode enabled against a target durable queue environment.
- [x] Update backup/restore procedures to require Redis persistence validation when durable queue mode is enabled.
- [x] Add queue evidence expectations to self-hosted smoke and `queue:check`.
- [x] Update TD-007 in `docs/exec-plans/tech-debt-tracker.md`.

### Task 6: Verification And Completion

- [x] Run focused queue/log tests.
- [x] Run `npm run test:m2`.
- [ ] Run `npm run acceptance:browser` or focused log acceptance if full browser runtime is too expensive during development.
- [x] Run `npm run docs:check`.
- [x] Run `npm run contract:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.

## Current Completion Status

As of 2026-06-02, the repository implementation is locally complete for queue dispatch, worker consumption, retry/dead-letter behavior, readiness, self-hosted Redis wiring, docs, and focused tests. This plan remains active because target-environment Redis/BullMQ evidence, queue-mode acceptance, Redis persistence drill evidence, queue metrics, and capacity tuning have not yet been recorded.

`npm run test:m2` was attempted on 2026-06-02. Its unit/build stages passed, but the Playwright E2E stage was blocked by local runtime setup: the current worktree has no `.env`, several E2E helpers received no `DATABASE_URL`, and port `8787` was already occupied by an existing WiseEff API that Playwright could reuse. Treat this as an environment/target evidence gap, not as completed queue-mode acceptance.

On 2026-06-03, a local target-like durable queue readiness check passed with a temporary Redis container and an isolated API process configured with `LOG_ANALYSIS_QUEUE_MODE=durable`, `LOG_WORKER_ENABLED=false`, and `REDIS_URL=redis://127.0.0.1:6381`. The command `npm run queue:check -- --base-url=http://127.0.0.1:8788` returned `Durable queue transport and PostgreSQL job state are ready.` This proves the local readiness gate can detect Redis/BullMQ and PostgreSQL job-state health, but it is not target-environment evidence and does not satisfy the open target queue-mode acceptance, Redis persistence drill, queue metrics, or capacity tuning requirements.

On 2026-06-04, the same local target-like durable queue readiness gate was rerun after the integrated M6 evidence sweep. The temporary Redis/API setup again produced a `passed` result and regenerated `docs/generated/m6-queue-readiness-evidence.md` with `dependencies.durableQueue.status=ready`, `transport.status=ready`, and `database.status=ready`. This keeps the local M6.4 evidence current for M6.6 release-readiness evaluation, but it still does not replace a real self-hosted target queue-mode acceptance run, Redis persistence drill, queue drain/pause/resume release rehearsal, queue metrics evidence, or capacity tuning evidence.

Later on 2026-06-04, `npm run test:m2` passed locally after the default Playwright E2E configuration was hardened to keep M5.11 quality specs behind `playwright.quality.config.ts` and force the deterministic Agent provider for default E2E runs. The command completed with 218 Vitest files passed, 72 server Vitest files passed, production build passed with the existing chunk-size warning, and Playwright reported 39 passed / 2 HDC skipped. This restores the local M2/M5 browser regression gate, but it still does not satisfy the open target durable queue-mode acceptance, Redis persistence drill, queue metrics evidence, or capacity tuning requirements.

## External Inputs Needed

- Redis deployment location and persistence policy for the first self-hosted target.
- Queue concurrency target for first pilot beyond the local default of `1`.
- Retry and dead-letter retention policy beyond the local default attempts/backoff.
- Whether Redis is allowed on the same Linux host as PostgreSQL for the first self-hosted deployment.
- Backup directory or snapshot command for Redis persistence.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Updated | `README.md`, `docs/README.md`, `docs/developer/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Durable queue runbook and `queue:check` are linked. |
| Planning docs | Updated | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | TD-007 is narrowed; target queue evidence remains open. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Update only if visible log-analysis states change. |
| Architecture docs | Updated | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | Documents Redis/BullMQ dispatch and PostgreSQL source-of-truth boundary. |
| Quality/testing docs | Updated | `docs/developer/verification-matrix.md`, `docs/QUALITY_SCORE.md` | Adds queue-mode readiness gate and local implementation status. `docs/design-docs/testing-strategy.md` was not edited because no browser-state acceptance contract changed. |
| Reliability/runbooks | Updated | `docs/RELIABILITY.md`, `docs/runbooks/durable-queue.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/monitoring-alerting.md`, `docs/runbooks/self-hosted-runtime.md` | Queue recovery, readiness, and Redis persistence are documented. |
| Security/governance docs | Reviewed/Updated | `docs/security/secrets-management.md` | Redis credentials are covered as secrets. Queue payloads carry `jobId`, not full log contents. |
| Frontend/design docs | Reviewed | `docs/FRONTEND.md` | No visible job-state or polling behavior changed. |
| Generated artifacts | Review | `docs/generated/acceptance-operation-evidence.md`, `docs/generated/m5-pilot-acceptance.md` | Regenerate only after acceptance/smoke changes. |
| References | Review | `docs/references/` | Add compact queue reference if repeated agent work needs it. |
| Chinese developer docs | Updated | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/security-reliability.md` | Queue runtime and recovery are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- TD-007 cannot be closed unless queue-mode runtime and failure-mode tests pass.
- Redis backup/restore evidence must be either completed through M6.3 scripts or explicitly recorded as the only remaining storage gap.

## UI Interaction Automation Review

M6.4 may change visible log-analysis progress and failure states.

- Affected acceptance specs: `e2e/acceptance/log-analysis.acceptance.spec.ts`.
- Acceptance requirement IDs: `LOG-HAPPY-001`, `LOG-REANALYZE-001`, `SHELL-DIAG-001`.
- Operation IDs: `LOG-HAPPY-001`, `LOG-REANALYZE-001`.
- Required action: If queue mode changes progress timing, retry messages, failed-job text, or reanalysis behavior, update browser acceptance and operation evidence.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, and `npm run acceptance:evidence`.
