# Plans

> Chinese: [Chinese](zh-CN/PLANS.md)

Execution plans are first-class repository artifacts. Use them for work that has more than a tiny local change or that affects product behavior, architecture, security, reliability, or multiple files.

## Locations

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Technical debt: `exec-plans/tech-debt-tracker.md`

## Current Active Plan

This list is only plans that still have remaining work. Finished implementation lives under `exec-plans/completed/` — including the 2026-08-17 archive of path-reachable C1–C4, product feedback, topology review rounds 3–6, the notification center, and the project-configuration-workbench defect repair. Do not reopen those as active work.

### Waiting on external inputs or a target environment

- `exec-plans/active/2026-08-12-agent-log-analysis-system.md`: P1–P3b are on `main`. Remaining work is expert-annotated golden cases, a second pilot domain, and human judge-calibration reviews — not an open PR. Residuals: TD-090, TD-103, TD-105, TD-116.
- `exec-plans/active/2026-07-16-parameter-topology-schema-management.md`: semantic identity implementation landed; **TD-042** still blocks claiming production cutover until a clean snapshot rehearsal. Review-round plans are under `completed/`.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`: M5.2 staging pilot evidence.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`: M5.2 non-HDC target evidence.
- `exec-plans/active/2026-06-02-wiseeff-m6-2-identity-user-governance.md`: self-hosted OIDC identity (TD-020 / TD-021).
- `exec-plans/active/2026-06-02-wiseeff-m6-3-self-hosted-storage-backup.md`: object storage and backup/restore drills (TD-023).
- `exec-plans/active/2026-06-02-wiseeff-m6-4-durable-queue.md`: durable queue target evidence (TD-007).
- `exec-plans/active/2026-06-02-wiseeff-m6-5-observability-operations.md`: self-hosted observability.
- `exec-plans/active/2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md`: release, rollback, capacity, and target synthetic gates (TD-019 / TD-024 / TD-025).

### Remaining product and UX work

- `exec-plans/active/2026-08-03-parameter-spec-editor-fidelity.md`: remaining write-contract SE-2 / SE-5 / SE-D6.
- `exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md`: org admin IA (planning; ADR-0015).
- `exec-plans/active/2026-08-02-parameter-admin-ux-polish.md`: parameter-admin UX polish.
- `exec-plans/active/2026-08-04-parameter-definition-identity-correction.md`: definition identity correction follow-through.
- `exec-plans/active/2026-08-01-attribution-deferred-implementation.md`: locked D-AG-01–04 follow-through.
- `exec-plans/active/td-031-xiaoze-run-timeline-streaming.md`: confirm residual vs the landed `xiaozeTurnStream` module (TD-070 closed).

### Still in `active/` pending a later archive pass

These files remain in `active/` until a follow-up confirms residual scope. They are not a build order.

- `exec-plans/active/development-roadmap.md`
- `exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`
- `exec-plans/active/2026-07-20-dts-workbench-module-refocus.md`
- `exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`
- `exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`
- `exec-plans/active/2026-07-21-instance-submodule-seed.md`
- `exec-plans/active/2026-07-23-local-post-cutover-seed.md`
- `exec-plans/active/2026-07-23-local-demo-credentials-seed.md`
- `exec-plans/active/2026-07-27-module-attribution-redesign.md`
- `exec-plans/active/2026-07-28-module-logical-kind-and-manual-reclassify.md`
- `exec-plans/active/2026-07-28-driver-registry.md`
- `exec-plans/active/2026-07-29-org-driver-schema-overlay.md`
- `exec-plans/active/2026-07-30-attribution-tree-is-taxonomy-not-topology.md`
- `exec-plans/active/2026-07-30-attribution-subjects-and-versioned-specs.md`
- `exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md`
- `exec-plans/active/2026-07-06-parameter-batch-import-wizard.md`
- `exec-plans/active/2026-07-06-parameter-excel-export.md`
- `exec-plans/active/2026-07-07-wiseeff-debug-logs-org-scope-decoupling.md`
- `exec-plans/active/2026-07-08-parameter-home-personal-overview.md`
- `exec-plans/active/2026-07-08-project-hotspot-scoring-redesign.md`
- `exec-plans/active/2026-06-21-wiseeff-adb-hdc-debugging-protocol.md`
- `exec-plans/active/2026-06-22-wiseeff-adb-auto-device-lab-config.md`
- `exec-plans/active/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md`
- `exec-plans/active/2026-06-23-wiseeff-debugging-admin-modal-layout-redesign.md`
- `exec-plans/active/2026-06-23-wiseeff-local-device-bridge-phase1.md`
- `exec-plans/active/2026-06-23-wiseeff-local-device-bridge-phase2.md`
- `exec-plans/active/2026-06-25-xiaoze-turn-state-ux.md`
- `exec-plans/active/2026-06-27-wiseeff-device-bridge-cors-bootstrap-fix.md`

## Completed Plans

Completed historical plans are preserved under `exec-plans/completed/`, including the 2026-08-17 archive of path-reachable C1–C4, Internal Beta product feedback, topology review rounds 3–6, the notification center (`2026-07-06-wiseeff-notification-center.md`), and the project-configuration-workbench defect repair (`2026-08-08-project-configuration-workbench-defect-repair.md`); also including M0-M5 productization work, M5.1 documentation governance, Chinese developer documentation, M5.3 documentation system completion, M5.4-M5.12 browser acceptance hardening, M6.1 self-hosted runtime baseline, M3.5 commercial readiness hardening, local account lifecycle, Pi Agent provider adapter rounds, the complex debugging-node value model, Device Bridge zero-friction Phase B (`2026-06-25-wiseeff-device-bridge-zero-friction-phase-b.md`), Xiaoze sole Agent cleanup (`2026-06-26-xiaoze-sole-agent-wiseagent-cleanup.md`), Xiaoze thread persistence (`2026-06-24-wiseeff-xiaoze-thread-persistence.md`), dead code cleanup (`2026-06-30-wiseeff-dead-code-cleanup.md`), parameter debugging interim hide (`2026-07-01-wiseeff-parameter-debugging-platform-redesign.md`), the parameter-home production redesign (`2026-07-07-parameter-home-production-redesign.md`), hierarchical module trees (`2026-07-09-wiseeff-hierarchical-modules.md`), project parameter DTS/JSON files with bidirectional sync (`2026-07-11-project-parameter-files.md`), the DTS parameter management structural refactor program (`2026-07-14-dts-management-program.md` with P0/P1/P2/P3/P3.1 phase plans — CST parser, config sets/baselines/dtc gate, structured product UI, and edit→CR→writeback loop), the full DTS seed and reproducible dtc toolchain (`2026-07-15-dts-full-seed-and-toolchain.md`), DTS hardening closeout (`2026-07-15-dts-hardening-closeout.md`), parameter import wizard TD-035 (`2026-07-15-parameter-import-wizard-td035.md`), retire Superpowers agent harness and adopt Matt Pocock skills (`2026-07-25-retire-superpowers-adopt-matt-skills.md`), and older feature-specific plans that once lived under a parallel Superpowers plans tree. Residual path-derived identity and production schema validation debt are superseded by the active topology/schema cutover plan. Use `exec-plans/completed/README.md` to interpret completed plans as historical evidence rather than current implementation contracts.

## Plan Rules

- Plans should name the goal, architecture, files, tasks, verification commands, and expected outcomes.
- Keep active plans updated as decisions change.
- Move finished plans to `completed/` after implementation and verification.
- If a plan leaves known follow-up work, add it to `tech-debt-tracker.md`.
- Do not rely on chat history for durable execution details.
- **Agent skills:** Use Matt Pocock skills (for example `implement`, `tdd`, `to-spec`, `triage`) together with `docs/agents/*`. Do not create or update `docs/superpowers/**` or instruct workers to call `superpowers:*` skills. In-progress implementation tracking stays in `docs/exec-plans/active/`.

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

A plan filename must not exist in both `active/` and `completed/` (English or Chinese trees). `npm run docs:check` fails on that duplicate so finished work cannot keep an active copy.

Run `npm run docs:check` before finishing a non-trivial plan. The check also guards key documentation entry points, local markdown links, required `.env.example` coverage, and duplicate plan filenames.

## UI Interaction Automation Rule

After M5.4 lands, any implementation plan that changes user-facing interaction behavior must review browser acceptance coverage. This applies to route changes, forms, tables, filters, uploads, modals, drawers, approvals, navigation, frontend API clients, backend API responses that drive visible UI state, permissions, Agent actions, and device actions initiated from the UI.

The plan must name the affected `e2e/acceptance/` spec, acceptance requirement IDs from `docs/developer/browser-acceptance-coverage-map.md`, and operation IDs from `docs/developer/user-operation-coverage-matrix.md`. If no requirement ID or operation ID exists for the changed behavior, the plan must add one before implementation.

The plan must either add/update automated coverage or record why existing browser acceptance automation already covers the change. For automated operation IDs, the plan must also preserve operation evidence generation through `npm run acceptance:browser` or `npm run acceptance:evidence`. A plan cannot be moved to `completed/` when UI-interaction behavior changed but requirement coverage, operation coverage, and operation evidence impact were not reviewed.
