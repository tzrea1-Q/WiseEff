# Completed Execution Plans

Completed plans are historical implementation evidence. They can explain why a system exists, but they should not override current source code, generated artifacts, current design docs, runbooks, or quality docs.

## Current Milestone History

| Milestone | Plan |
| --- | --- |
| M0 foundation | `2026-05-25-wiseeff-m0-productization-foundation.md` |
| M1 parameter management | `2026-05-25-wiseeff-m1-parameter-management-mvp.md` |
| M2 log analysis | `2026-05-26-wiseeff-m2-log-analysis-mvp.md` |
| M3 debugging | `2026-05-27-wiseeff-m3-debugging-mvp.md` |
| M3.5 commercial readiness | `2026-05-27-wiseeff-m3-5-commercial-readiness.md` |
| M4 Agent collaboration | `2026-05-27-wiseeff-m4-agent-collaboration-mvp.md` |
| M5 commercial pilot readiness | `2026-05-28-wiseeff-m5-commercial-pilot-readiness.md` |
| M5.1 documentation governance | `2026-05-29-wiseeff-m5-1-documentation-governance.md` |
| M5.5 browser acceptance coverage hardening | `2026-06-01-wiseeff-m5-5-browser-acceptance-coverage-hardening.md` |
| M5.6 user operation coverage matrix | `2026-06-01-wiseeff-m5-6-user-operation-coverage-matrix.md` |
| M5.7 evidence-grade browser acceptance | `2026-06-01-wiseeff-m5-7-evidence-grade-browser-acceptance.md` |
| M5.8 deterministic acceptance coverage closure | `2026-06-01-wiseeff-m5-8-deterministic-acceptance-coverage-closure.md` |
| M5.9 state model and contract-driven testing | `2026-06-01-wiseeff-m5-9-state-model-contract-testing.md` |
| M5.10 evidence-grade upgrade | `2026-06-01-wiseeff-m5-10-evidence-grade-upgrade.md` |
| M5.11 accessibility / visual / responsive gates | `2026-06-01-wiseeff-m5-11-accessibility-visual-responsive-gates.md` |
| M5.12 staging synthetic CI evidence archiving | `2026-06-02-wiseeff-m5-12-staging-synthetic-ci-evidence-archiving.md` |
| M6.1 self-hosted runtime baseline | `2026-06-02-wiseeff-m6-1-self-hosted-runtime-baseline.md` |
| Chinese developer docs | `2026-05-29-wiseeff-developer-docs-zh-cn.md` |
| Bilingual developer docs | `2026-06-10-wiseeff-bilingual-developer-docs.md` |
| Audit center M1/M2 | `2026-06-17-wiseeff-audit-center-m1.md`, `2026-06-17-wiseeff-audit-center-m2.md` |
| Local account lifecycle | `2026-06-12-wiseeff-local-account-lifecycle.md` |
| Pi Agent provider adapter | `2026-06-09-wiseeff-pi-agent-provider-adapter.md`, `2026-06-09-wiseeff-pi-agent-evidence-evaluation.md` |
| Complex debugging-node values | `2026-06-23-wiseeff-complex-debug-node-values.md` |
| Xiaoze thread persistence | `2026-06-24-wiseeff-xiaoze-thread-persistence.md` |
| Dead code / legacy cleanup | `2026-06-30-wiseeff-dead-code-cleanup.md` |
| Parameter debugging interim hide | `2026-07-01-wiseeff-parameter-debugging-platform-redesign.md` |
| Retire Superpowers; adopt Matt skills | `2026-07-25-retire-superpowers-adopt-matt-skills.md` |

## Historical Feature Plans

On 2026-08-19, the property-key source cutover and remainder (`2026-08-18-property-key-source-cutover.md`, `2026-08-19-property-key-cutover-remainder.md`, #544/#549/#553/#555/#558) moved here. TD-117 is closed as accepted residual: the cutover machine is complete; leftover is cross-page navigation. Do not reopen ADR-0017 or enable inline rename while referenced.

On 2026-08-18, the CI feedback-loop plan (`2026-08-18-ci-feedback-loop-optimization.md`, #523–#525) moved here: PR merge bar is L1 + `@ci-smoke`; L2 is post-merge / nightly / label. Wave 2 `main` L2 wall clock was 31m12s ([`32109015523`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32109015523)). TD-118 remains for the shared-DB browser suite.

On 2026-08-17, landed path-reachable C1–C4 (`2026-08-05-path-reachable-mock-gap-program.md` and children), Internal Beta product feedback (`2026-07-08-product-feedback.md`), topology review rounds 3–6, and Xiaoze approval-failure recovery (`2026-08-17-xiaoze-approval-failure-recovery.md`, TD-102 / TD-094) were moved here from `active/`. A second 2026-08-17 archive pass moved landed DTS workbench/seed, attribution/driver-registry/overlay, parameter-admin UX/IA, batch import/excel, logs org-scope, personal overview, ADB/HDC, debug-admin, Device Bridge phase 1/2, Xiaoze turn-state UX, and CORS bootstrap plans. The same day’s launch closeout archived attribution deferred D-AG-01–04 evidence (`2026-08-01-attribution-deferred-implementation.md`).

The dated feature plans from 2026-05-07 through 2026-05-24 record prototype and UI evolution. Treat them as history unless a current product, design, frontend, or architecture document explicitly points to them as still-current behavior.

## Reading Rule

If a completed plan conflicts with current docs, prefer this order:

1. Source code and tests.
2. Generated artifacts such as OpenAPI and database schema summaries.
3. Current runbooks, security, reliability, API, and architecture docs.
4. Product specs.
5. Completed execution plans.

**Historical agent banners:** Many completed plans include obsolete `REQUIRED SUB-SKILL: Use superpowers:…` lines from the former Superpowers harness. Ignore them when executing or reviewing history. Current agent orchestration uses Matt Pocock skills + `docs/agents/*` and `docs/PLANS.md` Plan Rules.
