# Plans

> Chinese: [Chinese](zh-CN/PLANS.md)

Execution plans are first-class repository artifacts. Use them for work that has more than a tiny local change or that affects product behavior, architecture, security, reliability, or multiple files.

## Locations

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Technical debt: `exec-plans/tech-debt-tracker.md`

## Current Active Plan

- `exec-plans/active/development-roadmap.md`: M0-M5 productization sequence and post-M5 planning horizon.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`: M5.2 staging pilot evidence execution plan.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`: M5.2 target-environment evidence closure for all non-HDC gates.
- `exec-plans/active/2026-06-02-wiseeff-m6-2-identity-user-governance.md`: self-hosted OIDC identity and durable user-governance APIs.
- `exec-plans/active/2026-06-02-wiseeff-m6-3-self-hosted-storage-backup.md`: self-hosted S3-compatible object storage and backup/restore drills.
- `exec-plans/active/2026-06-02-wiseeff-m6-4-durable-queue.md`: Redis/BullMQ or equivalent durable queue.
- `exec-plans/active/2026-06-02-wiseeff-m6-5-observability-operations.md`: self-hosted observability, alerts, and operations runbooks.
- `exec-plans/active/2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md`: release, rollback, capacity, and target synthetic gates.
- `exec-plans/active/2026-06-27-wiseeff-device-bridge-cors-bootstrap-fix.md`: Device Bridge CORS bootstrap fix — open `/health` CORS, Step 1 pairing entry point, fetch-failed vs process-absent distinction, Bridge CLI proxy support, `webOrigin` defaulting, restart on config change.
- `exec-plans/active/2026-07-06-wiseeff-notification-center.md`: TopBar notification center — replace static bell placeholder with durable inbox APIs, unread badge, workflow producers, and phased queue-backed delivery.
- `exec-plans/active/2026-07-06-parameter-batch-import-wizard.md`: Parameter admin batch import wizard — multi-format parse (xlsx/csv/json/DTS fragment), Step 1 target project selection, per-row review, new-parameter prefill, existing import batch API apply.
- `exec-plans/active/2026-07-07-wiseeff-debug-logs-org-scope-decoupling.md`: Decouple log analysis and debugging from parameter-management projects — organization-scoped M2/M3, migration 0037, API/frontend/Agent/e2e updates.
- `exec-plans/active/2026-07-08-product-feedback.md`: Internal Beta product feedback — persist sidebar feedback with multi-image ObjectStore attachments and admin triage at `/feedback-admin`.
- `exec-plans/active/2026-07-14-dts-management-program.md`: DTS parameter management structural refactor program plan — target architecture, phase boundaries (P0-P3), sequencing, locked positioning decisions, and risk register.
- `exec-plans/active/2026-07-14-dts-p0-parser-safety.md`: DTS parser safety (P0) — strip comments, detect and block unsupported constructs, reject `/include/`, and fail-safe writeback (no schema change).
- `exec-plans/active/2026-07-14-dts-p1-structural-model.md`: DTS structural core (P1) — real DTS parser/CST, node-tree/typed-property/phandle schema, migration `0042`, structural ingest, type-aware sync, and lossless CST writeback.
- `exec-plans/active/2026-07-14-dts-p2-config-set-baseline-gate.md`: DTS config sets, release baselines, and validation gate (P2) — buildable config-set aggregation, baseline snapshot/compare/atomic-rollback, dtc validation gate (with degrade mode), and lossless export, migrations `0043`/`0044`. **Status:** implemented and reviewed on local `main` (API/server delivery; Admin UI deferred to P3).
- `exec-plans/active/2026-07-14-dts-p3-structured-product.md`: DTS structured product closeout (P3) — structured read API + frontend port/mock, value editor by type, config-set/baseline UI, structured diff/change sets, search (path/@address/label/compatible/value), real impact analysis, and node-level/risk-tiered RBAC, migration `0045` (plus project-delete cascade fix `0046`).
- `exec-plans/active/2026-07-14-dts-p31-structured-edit-loop.md`: DTS structured edit loop closeout (P3.1) — wire browser structured edit → change set → change request → P1 CST writeback, map change-set rows to parameter source identity, and carry `rawText` (not normalized) as the writeback payload (closes TD-041). **Status:** implemented on `feat/dts-structured-edit-loop` — awaiting architect review/merge; acceptance `PARAM-DTS-EDIT-002` registered; playwright-cli tri-viewport evidence in `work/ui-checks/p31-*`; full `acceptance:e2e` gate pending parent run.

## Completed Plans

Completed historical plans are preserved under `exec-plans/completed/`, including M0-M5 productization work, M5.1 documentation governance, Chinese developer documentation, M5.3 documentation system completion, M5.4-M5.12 browser acceptance hardening, M6.1 self-hosted runtime baseline, M3.5 commercial readiness hardening, local account lifecycle, Pi Agent provider adapter rounds, the complex debugging-node value model, Device Bridge zero-friction Phase B (`2026-06-25-wiseeff-device-bridge-zero-friction-phase-b.md`), Xiaoze sole Agent cleanup (`2026-06-26-xiaoze-sole-agent-wiseagent-cleanup.md`), Xiaoze thread persistence (`2026-06-24-wiseeff-xiaoze-thread-persistence.md`), dead code cleanup (`2026-06-30-wiseeff-dead-code-cleanup.md`), parameter debugging interim hide (`2026-07-01-wiseeff-parameter-debugging-platform-redesign.md`), the parameter-home production redesign (`2026-07-07-parameter-home-production-redesign.md`), hierarchical module trees (`2026-07-09-wiseeff-hierarchical-modules.md`), project parameter DTS/JSON files with bidirectional sync (`2026-07-11-project-parameter-files.md`), and feature-specific plans from the former Superpowers plan location. Use `exec-plans/completed/README.md` to interpret completed plans as historical evidence rather than current implementation contracts.

## Plan Rules

- Plans should name the goal, architecture, files, tasks, verification commands, and expected outcomes.
- Keep active plans updated as decisions change.
- Move finished plans to `completed/` after implementation and verification.
- If a plan leaves known follow-up work, add it to `tech-debt-tracker.md`.
- Do not rely on chat history for durable execution details.

## Git Branch & PR Workflow

Every active implementation plan must name a **feature branch** checked out from the latest `main`. Future plans must include a `## Git & PR Workflow` section like `2026-06-25-wiseeff-device-bridge-phase-a-fixes.md`.

| Role | Allowed |
| --- | --- |
| **Implementation agent (subagent)** | `git fetch` / checkout branch from `main`, implement, test, **commit on the feature branch** |
| **Implementation agent (subagent)** | **Must not** push to `main`, open GitHub PRs, merge PRs, or fast-forward local `main` |
| **Parent agent (architect / session owner)** | Review subagent output, run or spot-check verification, **create GitHub PR**, merge when approved, then **`git pull origin main`** to sync local `main` |

Branch naming: `fix/<topic>`, `feat/<topic>`, or as specified in the plan. One plan → one branch unless the plan says otherwise.

## Documentation Governance Rule

Every active implementation plan except `development-roadmap.md` must include:

- `## Documentation Impact Matrix`
- `## Documentation Update Gate`

The impact matrix must review repository maps, planning docs, product specs, architecture docs, quality/testing docs, reliability/runbooks, security/governance docs, frontend/design docs, generated artifacts, and references. Each row must be marked `Update`, `Review`, or `No change` with exact file paths.

The update gate is blocking: a plan cannot be moved to `completed/` until every `Update` or `Review` row has either been updated or explicitly recorded as unchanged with evidence. Any deferred work must be added to `exec-plans/tech-debt-tracker.md`.

Future developer-facing changes to architecture, runtime modes, environment variables, API contracts, security, reliability, quality gates, or plan governance must update the relevant Chinese companion page or explicitly record why no Chinese developer-doc update is needed.

Developer-facing docs that humans are expected to read must be bilingual through separate linked files. Keep one language per file: English pages and Chinese pages must link to each other near the top, and maintainers must not mix Chinese and English prose inside a single page as the bilingual strategy. `scripts/bilingual-docs.ts` is the machine-readable inventory for required bilingual pairs.

Run `npm run docs:check` before finishing a non-trivial plan. The check also guards key documentation entry points, local markdown links, and required `.env.example` coverage.

## UI Interaction Automation Rule

After M5.4 lands, any implementation plan that changes user-facing interaction behavior must review browser acceptance coverage. This applies to route changes, forms, tables, filters, uploads, modals, drawers, approvals, navigation, frontend API clients, backend API responses that drive visible UI state, permissions, Agent actions, and device actions initiated from the UI.

The plan must name the affected `e2e/acceptance/` spec, acceptance requirement IDs from `docs/developer/browser-acceptance-coverage-map.md`, and operation IDs from `docs/developer/user-operation-coverage-matrix.md`. If no requirement ID or operation ID exists for the changed behavior, the plan must add one before implementation.

The plan must either add/update automated coverage or record why existing browser acceptance automation already covers the change. For automated operation IDs, the plan must also preserve operation evidence generation through `npm run acceptance:browser` or `npm run acceptance:evidence`. A plan cannot be moved to `completed/` when UI-interaction behavior changed but requirement coverage, operation coverage, and operation evidence impact were not reviewed.
