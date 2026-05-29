# Quality Score

Date: 2026-05-29

This is a living quality dashboard for WiseEff. Update it when major features land, tests change materially, or a quality gap is closed.

## Current Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0-M5 foundation | 8/10 | Modular TypeScript API, auth/audit, M1 parameter services, M2 log services/worker, M3 simulator/HDC debugging boundary, M4 Agent orchestration/provider boundary, generated OpenAPI artifact, readiness checks, backend tests, API-mode Playwright smokes, and the M5 pilot readiness route plus smoke command. | E2E still requires external PostgreSQL setup, durable queue/cloud provider wiring remains post-M5 work, and staging/pilot evidence is not yet captured in-repo. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs, M3.5 commercial-readiness plan, and M5 release operations docs. | API contract is now generated/checked from route metadata, but staging/pilot evidence still needs to be recorded. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 7/10 | Deployment and reliability docs exist; `/health/live`, `/health/ready`, and the M5 pilot readiness gate cover the release baseline; M2 has local object storage, job polling, leased jobs, failed records, and rerun support. | Distributed workers, durable object storage, retry/backoff policy, SSE hardening, real gateway observability, production monitoring, and external pilot evidence remain future work. |
| Harness knowledge base | 8/10 | Docs are indexed and organized into product, design, execution, generated, and reference sections. | Add mechanical link/schema checks later. |
| Production/pilot evidence | 5/10 | M5 gates exist, PR #39 merged, GitHub CI passed, and `docs:check` now guards active plan documentation metadata. | Staging live API, PostgreSQL-backed E2E, HDC device-lab, backup/restore, rollback, and live provider evidence are not yet recorded. |

## Required Verification Gates

For code changes:

- Run targeted tests for touched modules.
- Run `npm run build` for TypeScript, Vite, routing, shared type, or package changes.
- Run `npm test` for frontend-impacting changes.
- Run `npm run test:server` for backend-impacting changes.
- Run `npm run test:e2e` for M1/M2 acceptance when `DATABASE_URL` and seed data are available.
- Run `npm run test:m2` before landing M2 log-analysis MVP changes in a local or staging environment with PostgreSQL.
- Run `npm run test:m3` before landing M3 debugging MVP changes in a local or staging environment with PostgreSQL.
- Run `npm run test:m3-5` before treating the M1-M3 API-mode baseline as commercial-readiness complete in a local or staging environment with PostgreSQL.
- Run `npm run test:m4` before landing M4 Agent changes in a local or staging environment with PostgreSQL.
- Run `npm run smoke:m5` and `npm run test:m5` before treating the M5 pilot baseline as complete.
- Run `npm run docs:check` before completing non-trivial active plans.

## M2 Coverage

M2 is covered by backend parser/analyzer/repository/service/route/worker tests, frontend DTO/runtime/log-admin tests, and `e2e/log-analysis.api.spec.ts`. The E2E smoke uploads `charging-foldback.log`, waits for completion, verifies thermal/foldback evidence, submits helpful feedback, archives through admin, verifies default log lists hide archived records, then uploads `unsupported.bin` and verifies a failed record with a readable unsupported-format reason.

Remaining M2 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; object storage is filesystem-backed; worker concurrency is single-process; OpenAPI/client generation and real AI adapter integration are not done.

## M3 Coverage

M3 is covered by backend debugging policy/schema/repository/service/route/simulator tests, frontend debugging DTO/runtime/page tests, and `e2e/debugging.api.spec.ts`. The E2E smoke detects `Aurora Simulator 1`, reads fast charge current as `3000`, writes `3100` with readback, verifies `Cycle count` cannot be written through the UI, writes the readback mismatch probe and expects mismatch text, rolls back the fast charge snapshot, verifies the value returns to `3000`, and checks debugging write/rollback audit events.

Remaining M3 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; the gateway is simulator-backed rather than real HDC; `/node-debugging` write snapshots are not yet promoted into `/debugging` rollback UI state; OpenAPI/client generation and catalog CRUD remain deferred. Device leases are service-backed in M3.5, Agent approval records are covered by M4, and real-device lab validation is still needed.

## M3.5 Coverage

M3.5 is covered by operations health/readiness tests, production environment contract tests, route manifest tests, leased log-analysis job tests, local object-store readiness tests, debugging device lease tests, request/audit correlation tests, `npm run test:all`, `npm run build`, and `npm run test:m3-5` when `DATABASE_URL` is available.

Remaining M3.5 risks: readiness checks still use local object storage rather than S3/OSS, the job worker is leased but still in-process, gateway readiness is simulator-first, and OpenAPI/client generation remains deferred.

## M4 Coverage

M4 is covered by Agent route, schema, orchestrator, tool registry, parameter/log/debugging/audit tool tests, frontend `AgentGateway` DTO/runtime tests, UnifiedAgent API-mode tests, and `e2e/agent.api.spec.ts`. Negative tests cover approval-required tool runs, stale approval state, inactive users, missing permissions, wrong-session approvals, validation failures, and approval execution failure audit correlation.

Remaining M4 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; provider logic is deterministic rather than a real LLM; generated OpenAPI clients, prompt safety evaluation, model latency/cost handling, and provider outage behavior remain deferred.

## M5 Coverage

M5 is covered by the generated OpenAPI contract artifact, the route manifest/schema registry tests, the admin-gated pilot readiness route, the `npm run smoke:m5` script with explicit local skip control, the M5 acceptance docs, and the full `npm run test:m5` gate when PostgreSQL and the other external dependencies are available.

Remaining M5 risks: local smoke can prove the release gate structure, but real staging backup/restore, device-lab, and pilot signoff evidence still has to be captured before the environment is called pilot-ready.

For documentation-only changes:

- Verify file paths and cross-links.
- Run `npm run docs:check` and `git diff --check`.

## Quality Rules

- Every production write path needs authz, validation, audit, and tests.
- Every new state machine needs positive and negative tests.
- Every API contract change needs frontend DTO review.
- Every Agent tool that changes state needs approval and audit coverage.
- Every device write needs permission, range, state, snapshot, and audit coverage.
