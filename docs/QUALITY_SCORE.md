# Quality Score

> Chinese: [Chinese](zh-CN/QUALITY_SCORE.md)

Date: 2026-05-29

This dashboard retains historical assessments and coverage notes. The scores and old milestone run claims below were not recalculated or rerun in the 2026-09-06 documentation consolidation. Use [test design](design-docs/testing-strategy.md) for current scenario planning and the [verification matrix](developer/verification-matrix.md) for executable gates.

## Source-Verified Corrections (2026-09-06)

Source baseline: `67d4a77325b6009b77c2373bd788298a6d022bcf`; no new product test results.

- [Catalog production composition](../server/modules/parameter-catalog-api/productionWire.ts) and its integration tests exist, including release pins, governance, project scope and batch-query budgets. Installation and target cutover remain separate evidence.
- [Log kernel selection](../server/modules/logs/analyzer/analyzerFromEnv.ts) defaults to the bounded loop, with explicit single-shot configuration and marked rules fallback; real-log quality is a separate evaluation.
- [PostgreSQL checkpointing](../server/modules/agent/xiaoze/durableCheckpointer.ts) and [cross-instance integration coverage](../server/modules/agent/xiaoze/durableCheckpointer.integration.test.ts) exist. The integration case uses a fake approval resolver; pair it with approval-chain coverage rather than treating it as end-to-end security proof.
- The [node-debugging browser contract](../e2e/acceptance/debugging-simulator.acceptance.spec.ts) separates command execution from an alternate observed value. A different observation is not automatically a failed write.
- Historical deferred OIDC, queue, object-store and OpenAPI statements below describe earlier milestones. Current implemented seams are mapped in the [technical document](design-docs/full-stack-architecture.md); their target validation is not established by this source review.

## Historical Scores

| Area | Score | Evidence | Main Gap |
| --- | ---: | --- | --- |
| Frontend prototype | 8/10 | Broad Vitest and Testing Library coverage across pages, components, permissions, admin flows, logs, debugging, and Agent UI. | Some workflows remain mock-backed. |
| Backend M0-M5 foundation | 8/10 | Modular TypeScript API, auth/audit, M1 parameter services, M2 log services/worker, M3 simulator/HDC debugging boundary, Xiaoze Agent orchestration/tool-registry boundary, generated OpenAPI artifact, readiness checks, backend tests, local PostgreSQL-backed API-mode Playwright smokes, the M5 pilot readiness route plus smoke command, and M6.4 Redis/BullMQ queue dispatch for log-analysis jobs. | Target queue evidence, cloud-provider wiring, and external staging/pilot evidence are not yet captured in-repo. |
| Product specs | 8/10 | Product spec, prototype spec, MVP scope, onboarding spec. | Future user research and acceptance examples should be added as productization continues. |
| Architecture docs | 8/10 | Full-stack architecture, domain model, API contract, deployment, security, testing docs, M3.5 commercial-readiness plan, and M5 release operations docs. | API contract is now generated/checked from route metadata, but staging/pilot evidence still needs to be recorded. |
| Security model | 7/10 | RBAC, audit, Agent approval, and device safety are documented and partly represented in code. | Production auth, server-side business permissions, and negative tests need expansion. |
| Reliability | 7.5/10 | Deployment and reliability docs exist; `/health/live`, `/health/ready`, and the M5 pilot readiness gate cover the release baseline; M2 has local object storage, job polling, leased jobs, failed records, and rerun support; M6.4 adds Redis/BullMQ durable dispatch while PostgreSQL remains the source of truth for job state, retries, dead-letter metadata, audit, and evidence; M6.5 adds `/metrics`, log-analysis terminal job duration/failure-reason counters, Xiaoze LLM readiness gauges, Agent approval/tool metrics, device gateway operation counters, baseline HTTP/Agent/debugging spans, Prometheus config, alert rules, Grafana dashboards, and local observability checks. | Target Redis evidence, durable object storage target evidence, target Prometheus/Grafana/Alertmanager/trace-collector evidence, SSE hardening, fine-grained device failure categories, queue metrics/capacity tuning, release rollback, capacity, and external pilot evidence remain future work. |
| Harness knowledge base | 8.5/10 | Docs are indexed and organized into product, design, execution, developer, API, security, runbook, generated, reference, and Chinese developer sections. `docs:check` now guards active plan governance, key docs, local markdown links, and `.env.example` coverage. | Generated schema freshness and deeper doc freshness checks remain future improvements. |
| Production/pilot evidence | 7.8/10 | M5 gates exist, PR #39 merged, GitHub CI passed, `docs:check` guards active plan metadata, M5.2 local PostgreSQL-backed API-mode E2E passed, local `/health/ready` is green for database/object store/worker/Xiaoze LLM health, local non-HDC smoke passed with only `deviceGateway` blocked, browser acceptance passed in local non-HDC mode, M5.9 adds deterministic state-model checks, M5.10 evidence-grade operation records, M5.11 accessibility/visual/responsive gates, M5.12 CI local non-HDC acceptance, M6.1 self-hosted runtime config/smoke gates, M6.3 self-hosted storage/backup checks, M6.4 local durable Redis/BullMQ queue checks, M6.5 local observability config/runtime gates, and M6.6 release-gate/capacity-gate evidence writers. | Full target-environment staging evidence still has to be run and reviewed, and HDC device-lab, real self-hosted target restore evidence, dynamic production identity/OIDC target evidence, target Redis/BullMQ queue evidence, target observability scrape/alert/dashboard evidence, deployment rollback rehearsal, target capacity metrics, live Xiaoze LLM evaluation, and strict full-pilot `npm run smoke:m5` remain open. |

## Required Verification Gates

The [verification matrix](developer/verification-matrix.md) owns commands, prerequisites, path-sensitive CI, Gate0, target evidence and documentation-only gates. The [test design](design-docs/testing-strategy.md) maps risks to existing suites and states what each result can prove. Follow those owners rather than maintaining another command inventory here.

## Historical Milestone Coverage

The following milestone notes preserve earlier scope and residuals; they are not a fresh status inventory. Apply the source-verified corrections above before reusing them.

## M2 Coverage

M2 is covered by backend parser/analyzer/repository/service/route/worker tests, frontend DTO/runtime/log-admin tests, and `e2e/log-analysis.api.spec.ts`. The E2E smoke uploads `charging-foldback.log`, waits for completion, verifies thermal/foldback evidence, submits helpful feedback, archives through admin, verifies default log lists hide archived records, then uploads `unsupported.bin` and verifies a failed record with a readable unsupported-format reason.

Remaining M2 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; object storage is filesystem-backed; worker concurrency is single-process; OpenAPI/client generation and real AI adapter integration are not done.

## M3 Coverage

M3 is covered by backend debugging policy/schema/repository/service/route/simulator tests, frontend debugging DTO/runtime/page tests, and `e2e/debugging.api.spec.ts`. The E2E smoke detects `Aurora Simulator 1`, reads fast charge current as `3000`, writes `3100` with readback, verifies `Cycle count` cannot be written through the UI, writes the alternate-readback probe and expects successful command execution with the observed value shown separately, rolls back the fast charge snapshot, verifies the value returns to `3000`, and checks debugging write/rollback audit events.

Remaining M3 risks: local E2E depends on an external PostgreSQL `DATABASE_URL`; the gateway is simulator-backed rather than real HDC; `/node-debugging` write snapshots are not yet promoted into `/debugging` rollback UI state; OpenAPI/client generation and catalog CRUD remain deferred. Device leases are service-backed in M3.5, Agent approval records are covered by Xiaoze acceptance specs, and real-device lab validation is still needed.

## M3.5 Coverage

M3.5 is covered by operations health/readiness tests, production environment contract tests, route manifest tests, leased log-analysis job tests, local object-store readiness tests, debugging device lease tests, request/audit correlation tests, `npm run test:all`, `npm run build`, and `npm run test:m3-5` when `DATABASE_URL` is available.

Remaining M3.5 risks: readiness checks still use local object storage rather than S3/OSS, the job worker is leased but still in-process, gateway readiness is simulator-first, and OpenAPI/client generation remains deferred.

## Xiaoze Coverage

Xiaoze is covered by AG-UI endpoint, LangGraph planning, tool registry, orchestrator approval-bridge, perception/action tool tests, frontend `XiaozeProvider`/`XiaozeApprovalCard` tests, and `e2e/acceptance/xiaoze-*.acceptance.spec.ts`. Negative tests cover approval-required mutating tools, stale approval state, inactive users, missing permissions, validation failures, and approval execution failure audit correlation.

Remaining Xiaoze risks: local acceptance depends on an external PostgreSQL `DATABASE_URL`; deterministic mode covers the standard UI acceptance path; live LLM quality still needs target-environment evaluation with real `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` configuration; generated OpenAPI clients, prompt safety evaluation, and target LLM outage drills require their separate evidence. Durable PostgreSQL checkpointing is implemented; see the source-verified correction above.

## M5 Coverage

M5 is covered by the generated OpenAPI contract artifact, the route manifest/schema registry tests, the admin-gated pilot readiness route, the `npm run smoke:m5` script with explicit local skip control, the M5 acceptance docs, local PostgreSQL-backed API-mode Playwright evidence, M5.9 `npm run acceptance:models` state-model invariants, M5.10 evidence-grade operation records with API/DB/audit summaries for declared assertions, M5.11 accessibility/visual/responsive quality gates, M5.12 layered CI (PR merge bar is L1 + `@ci-smoke`; L2 quality is a sibling job and local visual/full-browser evidence runs through the fresh, exact-owned `acceptance:gate0` runtime on `main` / nightly / label / dispatch), fail-closed credential scanning before Gate0 artifact upload, target synthetic artifact archiving, and the full `npm run test:m5` gate when the remaining external dependencies are available.

Remaining M5 risks: local smoke can prove the release gate structure, but full target-environment staging, HDC device-lab, cloud object-store evidence, deployment rollback, and pilot signoff evidence still has to be captured before the environment is called pilot-ready. The 2026-05-30 local production-auth E2E run passed with `VITE_WISEEFF_API_AUTHORIZATION`, but dynamic identity/OIDC, token refresh, and target-environment user provisioning remain production-hardening work.

## M6 Coverage

M6.1 is covered by self-hosted compose/env/proxy metadata checks and a smoke runner for deployed Linux targets. The upgrade controller regression gate is `npm run test:scripts -- ops/self-hosted/scripts/upgrade.sh.test.ts`: mock Docker/Compose states cover service-specific PostgreSQL/Redis/MinIO readiness, repeated MinIO checks around `minio-init`, candidate worker liveness/Docker-health gates before queue resume, proxy isolation and readiness ordering across `queue-resumed`, `starting-proxy`, and `validating-public`, truthful previous-stack recovery, executable phase-specific recovery actions, stable failure diagnostics, the bounded credential-redaction corpus, and public-probe proxy bypass. This local gate and CI do not establish target-host acceptance. M6.6 adds `npm run capacity:gate`, `npm run selfhost:release-gate`, `ops/self-hosted/releases/`, and the release/rollback runbook so a release candidate has version, artifact, migration, identity, backup, rollback, capacity, synthetic acceptance, and HDC-scope evidence slots.

The same gate executes final-state verification without mocking it: candidate image lookup must use the supported formatted Docker interface, named-volume identity is order-independent but value-exact, and every failed invariant writes its stable service/code. Protected `recover-candidate` tests cover the run-bound token, phase/recovery-point eligibility, isolation-before-verification order, backup-manifest and candidate-image gates, worker-before-queue-before-proxy sequencing, failure re-isolation, and the prohibition on data restore.

Remaining M6 risks: the M6.2-M6.5 implementation PRs and target evidence are still separate workstreams. M6.6 consumes M6.2 identity readiness as an explicit release dependency, but local script output is not an identity, capacity, or rollback pass unless backed by target OIDC evidence, target metrics, rollback rehearsal, queue drain/pause/resume, observability snapshots, and target synthetic artifacts.

## DTS Reload Coverage

DTS reload debugging (`/dts-reload`, `server/modules/dts-reload`) landed through series #281–#290. Coverage includes candidate listing, sensitive-node start gates, overlay compile/preflight, fake-bridge deploy (mount / pushFile / trigger), kernel-log evidence, behavioural verify, residue bookkeeping, restore-baseline, and configuration admin. Acceptance IDs:

| ID | Coverage | Notes |
| --- | --- | --- |
| `DTS-RELOAD-DEPLOY-001` | automated | Fake local device bridge deploy to `unverifiable` |
| `DTS-RELOAD-KERNEL-001` | automated | Kernel log capture stays unjudged evidence |
| `DTS-RELOAD-VERIFY-001` | automated | `debug.readNode` behavioural verify |
| `DTS-RELOAD-RESIDUE-001` | automated | Residue + restore-baseline |
| `DTS-RELOAD-DEPLOY-HW-001` | conditional | Real HDC lab; requires `DEVICE_BRIDGE_HDC_AVAILABLE=true` |

Agent mutating calls (start / deploy / restore) are refused server-side with audited `dts-reload-agent-refused` (#301); sensitive-node Agent refusal remains defence in depth. Human-operator sensitive behaviour from #284 is unchanged.

Remaining gaps: HW-conditional lab evidence (`DTS-RELOAD-DEPLOY-HW-001`); multi-replica bridge routing (TD-067); deferred product debt TD-063–066 (promote-to-library, workbench hand-off, value shapes, artifact GC).

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
