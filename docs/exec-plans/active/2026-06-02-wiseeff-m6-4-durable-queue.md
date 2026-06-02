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

- Log uploads enqueue work into the durable queue.
- A separate worker process consumes queue jobs.
- PostgreSQL job state remains coherent after worker crash, retry exhaustion, and duplicate delivery.
- Dead-letter records are visible through existing job/admin APIs or a minimal backend endpoint.
- `/health/ready` reports Redis and queue readiness.
- `npm run test:m2`, `npm run acceptance:browser`, and log-analysis acceptance pass with queue mode enabled.
- TD-007 is closed or narrowed with evidence.

## Expected File Structure

Create:

- `server/modules/jobs/queuePort.ts`: queue adapter interface and shared types.
- `server/modules/jobs/bullmqQueue.ts`: Redis/BullMQ implementation.
- `server/modules/jobs/bullmqQueue.test.ts`: adapter unit tests with fake Redis/BullMQ boundaries.
- `server/modules/jobs/queueHealth.ts`: queue readiness model.
- `server/modules/jobs/queueHealth.test.ts`: readiness tests.
- `server/modules/logs/logAnalysisQueue.ts`: log-analysis enqueue/process binding.
- `server/modules/logs/logAnalysisQueue.test.ts`: idempotency and retry tests.
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

- [ ] Write failing tests for `queuePort` semantics: enqueue once, process with idempotency key, retry with backoff, dead-letter after max attempts, pause/resume, and health failure.
- [ ] Add queue types without coupling service code directly to BullMQ.
- [ ] Run `npm run test:server -- server/modules/jobs/bullmqQueue.test.ts` and confirm failure before implementation.

### Task 2: Redis/BullMQ Adapter

- [ ] Add BullMQ and Redis client dependencies after reviewing package and license impact.
- [ ] Implement the BullMQ adapter behind `queuePort`.
- [ ] Add env variables for Redis URL, queue prefix, retry attempts, backoff, and worker concurrency.
- [ ] Ensure Redis connection errors do not crash API startup without an actionable production-readiness failure.
- [ ] Run focused queue adapter tests.

### Task 3: Log Analysis Dispatch

- [ ] Write failing tests for log upload enqueue, worker consume, duplicate delivery, worker crash, retry exhaustion, and dead-letter status.
- [ ] Update log creation to write PostgreSQL job state and enqueue the durable queue message.
- [ ] Update worker runner to consume from the queue and use existing log-analysis service functions.
- [ ] Preserve existing local database-polling mode only if explicitly configured for development.
- [ ] Run `npm run test:server -- server/modules/logs/logAnalysisQueue.test.ts server/modules/logs/worker.test.ts`.

### Task 4: Health, Smoke, And Operations

- [ ] Add queue health to `/health/ready` and pilot-readiness details.
- [ ] Update smoke scripts to report Redis/queue status separately from worker status.
- [ ] Add tests for queue-ready, queue-degraded, and queue-missing production modes.
- [ ] Update runbooks for pause, resume, drain, dead-letter review, and recovery.

### Task 5: Acceptance And Backup Integration

- [ ] Run log-analysis acceptance with queue mode enabled.
- [ ] Update M6.3 backup/restore procedures to execute Redis persistence validation.
- [ ] Add queue evidence to generated acceptance or smoke outputs where relevant.
- [ ] Update TD-007 in `docs/exec-plans/tech-debt-tracker.md`.

### Task 6: Verification And Completion

- [ ] Run focused queue/log tests.
- [ ] Run `npm run test:m2`.
- [ ] Run `npm run acceptance:browser` or focused log acceptance if full browser runtime is too expensive during development.
- [ ] Run `npm run docs:check`.
- [ ] Run `npm run contract:check`.
- [ ] Run `npm run test:all`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.

## External Inputs Needed

- Redis deployment location and persistence policy.
- Queue concurrency target for first pilot.
- Retry and dead-letter retention policy.
- Whether Redis is allowed on the same Linux host as PostgreSQL for the first self-hosted deployment.
- Backup directory or snapshot command for Redis persistence.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add durable queue runbook if created. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | Track TD-007 closure or remaining queue debt. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Update only if visible log-analysis states change. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md` | Document Redis/BullMQ dispatch and PostgreSQL source-of-truth boundary. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add queue-mode log-analysis gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/durable-queue.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/monitoring-alerting.md` | Queue recovery and Redis persistence are reliability-critical. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/secrets-management.md` | Redis credentials and queue payload sensitivity must be documented if payloads include sensitive content. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | Update only if visible job states or polling behavior changes. |
| Generated artifacts | Review | `docs/generated/acceptance-operation-evidence.md`, `docs/generated/m5-pilot-acceptance.md` | Regenerate only after acceptance/smoke changes. |
| References | Review | `docs/references/` | Add compact queue reference if repeated agent work needs it. |
| Chinese developer docs | Update | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/security-reliability.md` | Queue runtime and recovery are developer-facing. |

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
