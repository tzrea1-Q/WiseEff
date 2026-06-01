# Quality Score

Date: 2026-05-29

This is a living quality dashboard for WiseEff. Update it when major features land, tests change materially, or a quality gap is closed.

## Current Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0-M5 foundation | 8/10 | Modular TypeScript API, auth/audit, M1 parameter services, M2 log services/worker, M3 simulator/HDC debugging boundary, M4 Agent orchestration/provider boundary, generated OpenAPI artifact, readiness checks, backend tests, local PostgreSQL-backed API-mode Playwright smokes, and the M5 pilot readiness route plus smoke command. | Durable queue/cloud provider wiring remains post-M5 work, and external staging/pilot evidence is not yet captured in-repo. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs, M3.5 commercial-readiness plan, and M5 release operations docs. | API contract is now generated/checked from route metadata, but staging/pilot evidence still needs to be recorded. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 7/10 | Deployment and reliability docs exist; `/health/live`, `/health/ready`, and the M5 pilot readiness gate cover the release baseline; M2 has local object storage, job polling, leased jobs, failed records, and rerun support. | Distributed workers, durable object storage, retry/backoff policy, SSE hardening, real gateway observability, production monitoring, and external pilot evidence remain future work. |
| Harness knowledge base | 8.5/10 | Docs are indexed and organized into product, design, execution, developer, API, security, runbook, generated, reference, and Chinese developer sections. `docs:check` now guards active plan governance, key docs, local markdown links, and `.env.example` coverage. | Generated schema freshness and deeper doc freshness checks remain future improvements. |
| Production/pilot evidence | 6.8/10 | M5 gates exist, PR #39 merged, GitHub CI passed, `docs:check` guards active plan metadata, M5.2 local PostgreSQL-backed API-mode E2E passed, local `/health/ready` is green for database/object store/worker/live Agent health, local non-HDC smoke passed with only `deviceGateway` blocked, browser acceptance passed in local non-HDC mode, M5.10 operation evidence now includes required API/DB/audit/runtime/trace/reproduction summaries for declared assertions, production-auth API-mode E2E passed with static bearer injection, live Agent chat passed with a longer timeout, and a local PostgreSQL plus local object-store backup/restore drill passed. | Full target-environment staging, HDC device-lab, deployment rollback rehearsal, cloud S3/OSS evidence, dynamic production identity/OIDC, live-provider tool-flow evaluation, and strict full-pilot `npm run smoke:m5` remain open. |

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
- Run `npm run acceptance:browser` and `npm run acceptance:evidence` before accepting UI/API interaction changes that affect automated operation coverage.
- Run `npm run docs:check` before completing non-trivial active plans.
- Run `npm run test:server -- scripts/check-doc-governance.test.ts` when changing documentation governance automation.

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

Remaining M4 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; the standard UI E2E still uses deterministic provider mode; live OpenAI-compatible provider chat was validated locally only after increasing `AGENT_API_TIMEOUT_MS` beyond 5000 ms; generated OpenAPI clients, prompt safety evaluation, model latency/cost handling, and provider outage behavior remain deferred.

## M5 Coverage

M5 is covered by the generated OpenAPI contract artifact, the route manifest/schema registry tests, the admin-gated pilot readiness route, the `npm run smoke:m5` script with explicit local skip control, the M5 acceptance docs, local PostgreSQL-backed API-mode Playwright evidence, M5.10 evidence-grade operation records with API/DB/audit summaries for declared assertions, and the full `npm run test:m5` gate when the remaining external dependencies are available.

Remaining M5 risks: local smoke can prove the release gate structure, but full target-environment staging, HDC device-lab, cloud object-store evidence, deployment rollback, and pilot signoff evidence still has to be captured before the environment is called pilot-ready. The 2026-05-30 local production-auth E2E run passed with `VITE_WISEEFF_API_AUTHORIZATION`, but dynamic identity/OIDC, token refresh, and target-environment user provisioning remain production-hardening work.

For documentation-only changes:

- Verify file paths and cross-links.
- Run `npm run docs:check` and `git diff --check`.
- If the change affects developer setup, verify `.env.example` and `docs/developer/environment-variables.md` stay aligned.

## Quality Rules

- Every production write path needs authz, validation, audit, and tests.
- Every new state machine needs positive and negative tests.
- Every API contract change needs frontend DTO review.
- Every Agent tool that changes state needs approval and audit coverage.
- Every device write needs permission, range, state, snapshot, and audit coverage.
