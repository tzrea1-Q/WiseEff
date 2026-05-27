# Quality Score

Date: 2026-05-26

This is a living quality dashboard for WiseEff. Update it when major features land, tests change materially, or a quality gap is closed.

## Current Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0/M1/M2/M3 foundation | 7/10 | TypeScript server skeleton, auth context, audit routes, M1 parameter services, M2 log services/worker, M3 simulator debugging services, CORS preflight support, backend tests, and API-mode Playwright smokes. | E2E currently requires external PostgreSQL setup, the worker is in-process, debugging still uses a simulator gateway, and API contracts are still handwritten. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs. | API contract is not yet mechanically enforced. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 6/10 | Deployment and reliability docs exist; M0 health endpoint exists; M2 has local object storage, job polling, failed records, and rerun support. | Distributed workers, durable object storage, lock/retry policy, SSE hardening, and production observability are future work. |
| Harness knowledge base | 8/10 | Docs are indexed and organized into product, design, execution, generated, and reference sections. | Add mechanical link/schema checks later. |

## Required Verification Gates

For code changes:

- Run targeted tests for touched modules.
- Run `npm run build` for TypeScript, Vite, routing, shared type, or package changes.
- Run `npm test` for frontend-impacting changes.
- Run `npm run test:server` for backend-impacting changes.
- Run `npm run test:e2e` for M1/M2 acceptance when `DATABASE_URL` and seed data are available.
- Run `npm run test:m2` before landing M2 log-analysis MVP changes in a local or staging environment with PostgreSQL.
- Run `npm run test:m3` before landing M3 debugging MVP changes in a local or staging environment with PostgreSQL.

## M2 Coverage

M2 is covered by backend parser/analyzer/repository/service/route/worker tests, frontend DTO/runtime/log-admin tests, and `e2e/log-analysis.api.spec.ts`. The E2E smoke uploads `charging-foldback.log`, waits for completion, verifies thermal/foldback evidence, submits helpful feedback, archives through admin, verifies default log lists hide archived records, then uploads `unsupported.bin` and verifies a failed record with a readable unsupported-format reason.

Remaining M2 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; object storage is filesystem-backed; worker concurrency is single-process; OpenAPI/client generation and real AI adapter integration are not done.

## M3 Coverage

M3 is covered by backend debugging policy/schema/repository/service/route/simulator tests, frontend debugging DTO/runtime/page tests, and `e2e/debugging.api.spec.ts`. The E2E smoke detects `Aurora Simulator 1`, reads fast charge current as `3000`, writes `3100` with readback, verifies `Cycle count` cannot be written through the UI, writes the readback mismatch probe and expects mismatch text, rolls back the fast charge snapshot, verifies the value returns to `3000`, and checks debugging write/rollback audit events.

Remaining M3 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; the gateway is simulator-backed rather than real HDC; `/node-debugging` write snapshots are not yet promoted into `/debugging` rollback UI state; OpenAPI/client generation, Agent approval records, device leases, and catalog CRUD remain deferred.

For documentation-only changes:

- Verify file paths and cross-links.
- Run `git diff --check`.

## Quality Rules

- Every production write path needs authz, validation, audit, and tests.
- Every new state machine needs positive and negative tests.
- Every API contract change needs frontend DTO review.
- Every Agent tool that changes state needs approval and audit coverage.
- Every device write needs permission, range, state, snapshot, and audit coverage.
