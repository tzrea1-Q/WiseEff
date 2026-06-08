# Quality Score

Date: 2026-05-29

This is a living quality dashboard for WiseEff. Update it when major features land, tests change materially, or a quality gap is closed.

## Current Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0-M5 foundation | 8/10 | Modular TypeScript API, auth/audit, M1 parameter services, M2 log services/worker, M3 simulator/HDC debugging boundary, M4 Agent orchestration/provider boundary, generated OpenAPI artifact, readiness checks, backend tests, local PostgreSQL-backed API-mode Playwright smokes, the M5 pilot readiness route plus smoke command, and M6.4 Redis/BullMQ queue dispatch for log-analysis jobs. | Target queue evidence, cloud-provider wiring, and external staging/pilot evidence are not yet captured in-repo. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs, M3.5 commercial-readiness plan, and M5 release operations docs. | API contract is now generated/checked from route metadata, but staging/pilot evidence still needs to be recorded. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 7.5/10 | Deployment and reliability docs exist; `/health/live`, `/health/ready`, and the M5 pilot readiness gate cover the release baseline; M2 has local object storage, job polling, leased jobs, failed records, and rerun support; M6.4 adds Redis/BullMQ durable dispatch while PostgreSQL remains the source of truth for job state, retries, dead-letter metadata, audit, and evidence; M6.5 adds `/metrics`, log-analysis terminal job duration/failure-reason counters, Agent provider call counters, device gateway operation counters, baseline HTTP/Agent/debugging spans, Prometheus config, alert rules, Grafana dashboards, and local observability checks. | Target Redis evidence, durable object storage target evidence, target Prometheus/Grafana/Alertmanager/trace-collector evidence, SSE hardening, fine-grained device failure categories, queue metrics/capacity tuning, release rollback, capacity, and external pilot evidence remain future work. |
| Harness knowledge base | 8.5/10 | Docs are indexed and organized into product, design, execution, developer, API, security, runbook, generated, reference, and Chinese developer sections. `docs:check` now guards active plan governance, key docs, local markdown links, and `.env.example` coverage. | Generated schema freshness and deeper doc freshness checks remain future improvements. |
| Production/pilot evidence | 7.8/10 | M5 gates exist, PR #39 merged, GitHub CI passed, `docs:check` guards active plan metadata, M5.2 local PostgreSQL-backed API-mode E2E passed, local `/health/ready` is green for database/object store/worker/live Agent health, local non-HDC smoke passed with only `deviceGateway` blocked, browser acceptance passed in local non-HDC mode, M5.9 adds deterministic state-model checks, M5.10 evidence-grade operation records, M5.11 accessibility/visual/responsive gates, M5.12 CI local non-HDC acceptance, M6.1 self-hosted runtime config/smoke gates, M6.3 self-hosted storage/backup checks, M6.4 local durable Redis/BullMQ queue checks, M6.5 local observability config/runtime gates, and M6.6 release-gate/capacity-gate evidence writers. | Full target-environment staging evidence still has to be run and reviewed, and HDC device-lab, real self-hosted target restore evidence, dynamic production identity/OIDC target evidence, target Redis/BullMQ queue evidence, target observability scrape/alert/dashboard evidence, deployment rollback rehearsal, target capacity metrics, live-provider tool-flow evaluation, and strict full-pilot `npm run smoke:m5` remain open. |

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
- Run `npm run acceptance:models` when workflow state transitions, permission contracts, or seeded API/domain fixtures change behind automated browser flows.
- Run `npm run acceptance:ci` when GitHub Actions acceptance jobs, synthetic modes, or artifact archive paths change.
- Run `npm run acceptance:quality` when accessibility, visual, or responsive quality-gate wiring changes.
- Run `npm run selfhost:check` when self-hosted runtime templates or docs change.
- Run `npm run selfhost:smoke` against a live self-hosted target before claiming the M6.1 runtime is deployed.
- Run `npm run capacity:gate` and `npm run selfhost:release-gate` when release, rollback, capacity, or self-hosted release evidence changes.
- Run `npm run observability:check` when Prometheus, alert, dashboard, telemetry docs, or observability package scripts change.
- Run `npm run restore:drill`, the real restore commands, `npm run backup:drill`, and `npm run backup:check` against isolated target restore infrastructure before claiming M6.3 target backup/restore readiness.
- Run `npm run queue:check -- --base-url <target-url>` before claiming a self-hosted Redis/BullMQ queue target is ready.
- Run `npm run acceptance:a11y`, `npm run acceptance:visual`, or `npm run acceptance:responsive` for UI-facing changes that affect semantics, layout, screenshots, or viewport usability.
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

M5 is covered by the generated OpenAPI contract artifact, the route manifest/schema registry tests, the admin-gated pilot readiness route, the `npm run smoke:m5` script with explicit local skip control, the M5 acceptance docs, local PostgreSQL-backed API-mode Playwright evidence, M5.9 `npm run acceptance:models` state-model invariants, M5.10 evidence-grade operation records with API/DB/audit summaries for declared assertions, M5.11 accessibility/visual/responsive quality gates, M5.12 CI local non-HDC acceptance and target synthetic artifact archiving, and the full `npm run test:m5` gate when the remaining external dependencies are available.

Remaining M5 risks: local smoke can prove the release gate structure, but full target-environment staging, HDC device-lab, cloud object-store evidence, deployment rollback, and pilot signoff evidence still has to be captured before the environment is called pilot-ready. The 2026-05-30 local production-auth E2E run passed with `VITE_WISEEFF_API_AUTHORIZATION`, but dynamic identity/OIDC, token refresh, and target-environment user provisioning remain production-hardening work.

## M6 Coverage

M6.1 is covered by self-hosted compose/env/proxy metadata checks and a smoke runner for deployed Linux targets. M6.6 adds `npm run capacity:gate`, `npm run selfhost:release-gate`, `ops/self-hosted/releases/`, and the release/rollback runbook so a release candidate has version, artifact, migration, identity, backup, rollback, capacity, synthetic acceptance, and HDC-scope evidence slots.

Remaining M6 risks: the M6.2-M6.5 implementation PRs and target evidence are still separate workstreams. M6.6 consumes M6.2 identity readiness as an explicit release dependency, but local script output is not an identity, capacity, or rollback pass unless backed by target OIDC evidence, target metrics, rollback rehearsal, queue drain/pause/resume, observability snapshots, and target synthetic artifacts.

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
