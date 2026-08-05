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
- `exec-plans/active/2026-07-16-parameter-topology-schema-management.md`: replace path-derived parameter identity with source/effective DTS topology, versioned schemas, stable project bindings, full historical migration, and an atomic fail-closed cutover. Supersedes residual path-derived identity and optional production schema-validation debt from TD-039/TD-040; prior closeouts `2026-07-15-dts-hardening-closeout.md` and `2026-07-15-parameter-import-wizard-td035.md` are archived under `completed/`.
- `exec-plans/active/2026-07-16-parameter-topology-e2e-review-blockers.md`: fix merge-blocking review findings so ingest, identity mapping, fail-closed validate/toolchain pin, typed edit writeback, frontend, spec review queue, migration/cutover, and browser acceptance share one real production path (branch `fix/parameter-topology-e2e-review-blockers`).
- `exec-plans/active/2026-07-16-parameter-topology-cutover-workflow-review.md`: second-round review blockers — post-cutover semantic workflows without legacy PPV, real spec-review application, precise occurrence writeback, candidate/validation FSMs, honest inferred-spec cutover gates, identity continuity, frontend provenance, and acceptance without DB bypass (branch `fix/parameter-topology-cutover-workflow-review`).
- `exec-plans/active/2026-07-16-parameter-topology-semantic-cutover-round3.md`: third-round — real vendor dt-schema, semantic dashboard/hotspot, inferred stage/finalize, precise merge writeback, scoped matcher/review blockers, manifest backfill, UI unmatched review, strict acceptance (branch `fix/parameter-topology-semantic-cutover-round3`).
- `exec-plans/active/2026-07-16-parameter-topology-round4-review-blockers.md`: fourth-round — real dt-validate schemas, durable stage→finalize CLI, exact locked merge writeback, scoped matcher/review, honest manifest gates, global-spec hotspots, unmatched create+mismatch audit, acceptance/browser evidence (branch `fix/parameter-topology-round4-review-blockers`).
- `exec-plans/active/2026-07-16-parameter-topology-round5-review-blockers.md`: fifth-round — immutable base binding revisions, fail-closed writeback deps, stage/finalize phase audit, tenant-owned review resolve, draft→activate createSpec, acceptance fixture honesty (branch `fix/parameter-topology-round5-review-blockers`).
- `exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md`: Round 6 Review blockers — historical scope reconcile, lossless spec identity, global-spec activation authz, full valueShape activate, real merge acceptance, tenant-scoped cleanup, stable test:all (branch `fix/parameter-topology-round6-review-blockers`). TD-042 remains BLOCKER.
- `exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`: restore the mature parameter workbench as the API-mode page framework and deeply integrate nested DTS topology, semantic binding rows, provenance, typed drafts, responsive UX, and visible acceptance without reviving flat identity.
- `exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`: product-boundary realignment — manageable parameter surface, module→parameters UX, project DTS maintenance, toolchain L2 off edit hot path (RFC + cut matrix).
- `exec-plans/active/2026-07-23-local-post-cutover-seed.md`: local `db:seed:m1` / `dev:all` defaults to semantic-only + local post-cutover finalize so typed binding submit works without dirty-DB cutover (branch `feat/local-post-cutover-seed`).
- `exec-plans/active/2026-07-23-local-demo-credentials-seed.md`: development-only M0 seed upserts fixed ChargeLab demo usernames + shared password for local API login (branch `feat/local-demo-credentials-seed`).
- `exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`: retire platform `wiseeff-power-base.dts`; seed/writeback = one project-primary DTS; admins maintain module↔driver only (RFC).
- `exec-plans/active/2026-07-21-instance-submodule-seed.md`: Type U/N/C instance submodules + driver groups; ingest ensure; Admin discovery for unmapped drivers (spec + agent plan).
- `exec-plans/active/2026-07-28-module-logical-kind-and-manual-reclassify.md`: add `kind=logical` for DTS nodes without compatible evidence and open controlled kind reclassify on edit (branch `feat/module-logical-kind`; ADR-0006).
- `exec-plans/active/2026-07-28-driver-registry.md`: declare supported drivers before DTS upload — registration is a curated driver group plus its exact compatible rules, the registry surface is a view with parse/observed coverage columns, the unclassified queue becomes "observed but not registered", and upload returns a one-shot registered-versus-unregistered summary (planning only; branch `feat/driver-registry`; ADR-0007).
- `exec-plans/active/2026-07-29-org-driver-schema-overlay.md`: close the "parse uncovered" dead end — an organization-owned manual driver schema (exact compatible plus property definitions) merges into the schema registry as the lowest releasable tier, while `schemas/dts` stays repository-managed (planning only; branch `feat/org-driver-schema-overlay`; ADR-0008).
- `exec-plans/active/2026-08-01-attribution-deferred-implementation.md`: ship locked D-AG-01–04 — PR1 editable nature/cardinality + overlay-only claim honesty; PR2 drop `driverModule` (TD-047); PR3 registration default placement + auto replay (TD-046); branches `feat/attribution-editable-nature-cardinality`, `feat/drop-parameter-spec-driver-module`, `feat/attribution-registration-placement`.
- `exec-plans/active/2026-07-27-module-attribution-redesign.md`: module attribution redesign — modules state `kind`/`origin` instead of being guessed from their names, the inert `driver` match kind is retired, the unclassified queue becomes filterable and dismissible so it can reach empty, rules preview their impact then apply scoped and collect emptied buckets, tree actions are kind-scoped, and importance is inherited from the business category (branches `feat/module-attribution-model` and `feat/module-attribution-ui`; ADR-0004, ADR-0005).
- `exec-plans/active/2026-07-30-attribution-tree-is-taxonomy-not-topology.md`: attribution tree is taxonomy, not topology — retire per-instance modules, rename `logical` to `node-type`, levers become `compatible` and `node-type`, bindings attach to driver groups and node-type units only, spec library states `attributionModules` instead of predicting, workbench enables `groupByDevice` for per-instance browsing (branch `feat/attribution-taxonomy-not-topology`; ADR-0010; supersedes parts of ADR-0004/0005/0006).
- `exec-plans/active/2026-07-30-attribution-subjects-and-versioned-specs.md`: attribution subjects + versioned parameter definitions — PR0–PR6 landed on `feat/attribution-subject-versioned-specs` (ADR-0013/0014); follow-up PR7–PR9 and governance PR1–PR3 merged via #212–#215; residual closeout completed via #216; deferred D-AG-* owned by `2026-08-01-attribution-deferred-implementation.md`.
- `exec-plans/active/2026-08-02-parameter-admin-ux-polish.md`: parameter admin UX polish — repair the mobile project-list breakage caused by unscoped desktop column rules, move the attribution column filter onto the column it filters, fix the structure-browser stacking fault, close the tab/table ARIA gaps, then unify the four project tabs into one container and empty-state language and put governance signals on the project list (branch `feat/parameter-admin-ux-polish`; stays inside ADR-0001).
- `exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md`: consolidate organization admin into two entries — parameter definition management (library + embedded spec review; identity mapping nested and conditional) and module management (unchanged); planning only; branch `feat/parameter-admin-org-ia`; ADR-0015.
- `exec-plans/active/2026-08-03-parameter-spec-editor-fidelity.md`: make the parameter definition editor agree with the write contract — persist or remove the edits the API silently drops (policy target, constraint removal, clearing units, the activate path), delete the fields that can only be placeholders, give the JSON editors a real affordance, and fix the modal stacking, scroll boundary, and focus handling; decisions SE-D1–SE-D6 settled 2026-08-03; branch `feat/parameter-spec-editor-fidelity`.
- `exec-plans/active/2026-08-05-project-operations-dialog-hardening.md`: harden the project operations surface that PR #224 moved into a modal — **POD-D1 settled 2026-08-05: return the four views to full-page routes, reaffirming ADR-0001** while preserving PR #224's project-list scroll fix and today's deep links; build one shared dialog primitive (focus trap, initial focus/restore, background inertness, top-most Escape, paired backdrop dismissal, one z-index scale) for the dialogs that remain; style the unstyled `StructuredValueEditor`; add confirmation and enforcement to baseline release/rollback and conflict arbitration; remove teaching/mock affordances and raw internals from the four views (branch `feat/project-operations-dialog-hardening`; owns the shared modal primitive consumed by `2026-08-03-parameter-spec-editor-fidelity.md`).
- `exec-plans/completed/2026-08-01-governance-platform-closeout.md`: governance/platform closeout merged (#216) — archived three source plans, closed TD-054, Platform `PLAT-ROLE-*` evidence, parameter-governance Admin acceptance IDs.
- `exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md`: parameter-admin state machines completed (soft deprecation, identity mapping decision split, governance convergence; #212–#214; ADR-0011/0012). Residuals → closeout #216; deferred D1–D8 remain in design-docs.
- `exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`: attribution follow-up PR7–PR9 merged (#215). Residuals → closeout #216; D-AG-01–04 locked → `2026-08-01-attribution-deferred-implementation.md`.
- `exec-plans/completed/2026-07-30-platform-tier-and-super-admin.md`: platform-admin + driver schema platform tier merged (#209–#210; ADR-0009). Residuals → closeout #216.
- `exec-plans/completed/2026-07-27-dts-node-enablement.md`: treat DTS `status` as node enablement rather than a parameter — structural-key SSOT, derived enablement/reachability, tree/workbench visibility, three-state editing on the shared draft pipeline, vendor schemas no longer feed `status` into matching (branch `feat/dts-node-enablement`; ADR-0003).
- `exec-plans/completed/2026-07-25-parameter-admin-redesign.md`: parameter admin product redesign — governance-scope information architecture, project-scoped routes replacing the modal, mock/API parity through the topology port, identity mapping governance moved into the admin, admin-owned state, and single-step retirement of the old surface (branch `feat/refactor-parameter-admin`; ADR-0001, ADR-0002).

## Completed Plans

Completed historical plans are preserved under `exec-plans/completed/`, including M0-M5 productization work, M5.1 documentation governance, Chinese developer documentation, M5.3 documentation system completion, M5.4-M5.12 browser acceptance hardening, M6.1 self-hosted runtime baseline, M3.5 commercial readiness hardening, local account lifecycle, Pi Agent provider adapter rounds, the complex debugging-node value model, Device Bridge zero-friction Phase B (`2026-06-25-wiseeff-device-bridge-zero-friction-phase-b.md`), Xiaoze sole Agent cleanup (`2026-06-26-xiaoze-sole-agent-wiseagent-cleanup.md`), Xiaoze thread persistence (`2026-06-24-wiseeff-xiaoze-thread-persistence.md`), dead code cleanup (`2026-06-30-wiseeff-dead-code-cleanup.md`), parameter debugging interim hide (`2026-07-01-wiseeff-parameter-debugging-platform-redesign.md`), the parameter-home production redesign (`2026-07-07-parameter-home-production-redesign.md`), hierarchical module trees (`2026-07-09-wiseeff-hierarchical-modules.md`), project parameter DTS/JSON files with bidirectional sync (`2026-07-11-project-parameter-files.md`), the DTS parameter management structural refactor program (`2026-07-14-dts-management-program.md` with P0/P1/P2/P3/P3.1 phase plans — CST parser, config sets/baselines/dtc gate, structured product UI, and edit→CR→writeback loop), the full DTS seed and reproducible dtc toolchain (`2026-07-15-dts-full-seed-and-toolchain.md`), DTS hardening closeout (`2026-07-15-dts-hardening-closeout.md`), parameter import wizard TD-035 (`2026-07-15-parameter-import-wizard-td035.md`), retire Superpowers agent harness and adopt Matt Pocock skills (`2026-07-25-retire-superpowers-adopt-matt-skills.md`), and older feature-specific plans that once lived under a parallel Superpowers plans tree. Residual path-derived identity and production schema validation debt are superseded by the active topology/schema cutover plan. Use `exec-plans/completed/README.md` to interpret completed plans as historical evidence rather than current implementation contracts.

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

Run `npm run docs:check` before finishing a non-trivial plan. The check also guards key documentation entry points, local markdown links, and required `.env.example` coverage.

## UI Interaction Automation Rule

After M5.4 lands, any implementation plan that changes user-facing interaction behavior must review browser acceptance coverage. This applies to route changes, forms, tables, filters, uploads, modals, drawers, approvals, navigation, frontend API clients, backend API responses that drive visible UI state, permissions, Agent actions, and device actions initiated from the UI.

The plan must name the affected `e2e/acceptance/` spec, acceptance requirement IDs from `docs/developer/browser-acceptance-coverage-map.md`, and operation IDs from `docs/developer/user-operation-coverage-matrix.md`. If no requirement ID or operation ID exists for the changed behavior, the plan must add one before implementation.

The plan must either add/update automated coverage or record why existing browser acceptance automation already covers the change. For automated operation IDs, the plan must also preserve operation evidence generation through `npm run acceptance:browser` or `npm run acceptance:evidence`. A plan cannot be moved to `completed/` when UI-interaction behavior changed but requirement coverage, operation coverage, and operation evidence impact were not reviewed.
