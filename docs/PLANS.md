# Plans

> Chinese: [Chinese](zh-CN/PLANS.md)

Execution plans are first-class repository artifacts. Use them for work that has more than a tiny local change or that affects product behavior, architecture, security, reliability, or multiple files.

## Locations

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Technical debt: `exec-plans/tech-debt-tracker.md`

## Current Active Plan

This list is only plans that still have remaining work. Finished implementation lives under `exec-plans/completed/` — including workflow discovery visibility (`2026-08-18-workflow-discovery-visibility.md`, #556); the 2026-08-18 property-key source cutover and remainder (`2026-08-18-property-key-source-cutover.md`, `2026-08-19-property-key-cutover-remainder.md`, #544/#549/#553/#555/#558; TD-117 closed as accepted residual); the 2026-08-18 CI feedback-loop plan (`2026-08-18-ci-feedback-loop-optimization.md`, #523–#525); the 2026-08-17 archive of path-reachable C1–C4, product feedback, topology review rounds 3–6, the notification center, the project-configuration-workbench defect repair, and Xiaoze approval-failure recovery (TD-102 / TD-094); the 2026-08-17 round-2 archive of landed DTS workbench/seed, attribution/driver-registry/overlay, parameter-admin UX/IA, batch import/excel, logs org-scope, personal overview, ADB/HDC, debug-admin, Device Bridge phase 1/2, Xiaoze turn-state UX, and CORS bootstrap plans; definition identity correction (`2026-08-04-parameter-definition-identity-correction.md`, #504); and the 2026-08-17 evidence archive of attribution deferred D-AG-01–04 (`2026-08-01-attribution-deferred-implementation.md`). Do not reopen those as active work.

### Roadmap

- `exec-plans/active/development-roadmap.md`: long-lived delivery roadmap. It is exempt from feature-plan archival metadata and is not part of the bounded TD-005 inventory.

### Waiting on external inputs or a target environment

- `exec-plans/active/2026-08-12-agent-log-analysis-system.md`: P1–P3b are on `main`. Remaining work is expert-annotated golden cases, a second pilot domain, and human judge-calibration reviews — not an open PR. Residuals: TD-090, TD-103, TD-116. TD-105 retention closed separately in Wave 4 via #599.
- `exec-plans/active/2026-07-16-parameter-topology-schema-management.md`: semantic identity implementation landed; **TD-042** still blocks claiming production cutover until a clean snapshot rehearsal. Review-round plans are under `completed/`.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`: M5.2 staging pilot evidence.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`: M5.2 non-HDC target evidence.
- `exec-plans/active/2026-06-02-wiseeff-m6-2-identity-user-governance.md`: self-hosted OIDC identity (TD-020 / TD-021).
- `exec-plans/active/2026-06-02-wiseeff-m6-3-self-hosted-storage-backup.md`: object storage and backup/restore drills (TD-023).
- `exec-plans/active/2026-06-02-wiseeff-m6-4-durable-queue.md`: durable queue target evidence (TD-007).
- `exec-plans/active/2026-06-02-wiseeff-m6-5-observability-operations.md`: self-hosted observability.
- `exec-plans/active/2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md`: release, rollback, capacity, and target synthetic gates (TD-019 / TD-024 / TD-025).

### Self-hosted operator experience

- `exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md`: mature source-checkout upgrade entry — immutable target resolution, pre-downtime build, queue/write quiescence, verified PostgreSQL/object-store/Redis recovery point, full data-preserving service recreation, health gates, resume, and explicit recovery. The implementation includes deployment-user permissions, legacy-image recovery, durable build diagnostics, bundled Node base-image preparation, and a restricted-network proxy/npm-registry/approved-CA contract with a two-key build-only insecure TLS fallback for CA-less hosts. Clean non-customer forward/recovery and CA-less target evidence remain pending.
- `exec-plans/active/2026-08-18-self-hosted-setup-wizard.md`: OpenClaw/Hermes-style TTY setup wizard — ask only human decisions, generate secrets, section reconfigure, doctor. Implementation on `cursor/selfhost-setup-wizard-24de`.
- `exec-plans/active/2026-08-18-self-hosted-ip-lab-profile.md`: no-DNS IP lab profile — secret generation, HTTP or Caddy internal TLS, one-command bootstrap, and ChargeLab-visible demo seed. Prerequisite for the setup wizard.

### Remaining product and UX work

- `exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md`: complete implementation specification for Wayfinder #668. G0 merged through PR #682; Phase A published #683-#735, Phase B/Phase C completed, and S0-ID merged through PR #737 at `origin/main@e84ca078ab8f7b7006fa8e635d722297a287d2a5`. The owner-authorized G0.1 correction now freezes the canonical identity constructors, closed Driver subtype enums, distinct public seven-kind and internal 49-kind legacy registries, complete S0-RAT scan contract, repaired S0-FIX provenance, and fail-closed S2-SCH PostgreSQL gate before Wave 2 integration. The launch graph remains 53 nodes with `CD=90`, `CF=54`, `ID=27`, `RE=18`; S13-PROGRAM and S14-PROGRAM remain deferred. G0.1 is contract work only and claims no target, release, or production evidence.

#### Wayfinder #668 Phase A launch map

The numeric database ID and GraphQL node ID make the mapping durable even if an Issue title is later displayed differently. This publisher-owned map is exact for the Phase A snapshot; Phase B must review and merge this documentation before Phase C may enable S0-ID.

| Node | Issue | Database ID | GraphQL node ID |
| --- | --- | --- | --- |
| `S0-ID` | #683 | `5311617399` | `I_kwDOSVLD3c8AAAABPJjZdw` |
| `S0-RAT` | #684 | `5311620341` | `I_kwDOSVLD3c8AAAABPJjk9Q` |
| `S0-FIX` | #685 | `5311629076` | `I_kwDOSVLD3c8AAAABPJkHFA` |
| `S1-BND` | #686 | `5311629415` | `I_kwDOSVLD3c8AAAABPJkIZw` |
| `S1-CMP` | #687 | `5311629764` | `I_kwDOSVLD3c8AAAABPJkJxA` |
| `S2-SCH` | #688 | `5311630186` | `I_kwDOSVLD3c8AAAABPJkLag` |
| `S2-RBAC` | #689 | `5311630643` | `I_kwDOSVLD3c8AAAABPJkNMw` |
| `S2-PGH` | #690 | `5311630952` | `I_kwDOSVLD3c8AAAABPJkOaA` |
| `S3-RUN` | #691 | `5311631317` | `I_kwDOSVLD3c8AAAABPJkP1Q` |
| `S3-INS` | #692 | `5311631684` | `I_kwDOSVLD3c8AAAABPJkRRA` |
| `S3-VFY` | #693 | `5311632218` | `I_kwDOSVLD3c8AAAABPJkTWg` |
| `S4-REG` | #694 | `5311632561` | `I_kwDOSVLD3c8AAAABPJkUsQ` |
| `S4-EVD` | #695 | `5311632931` | `I_kwDOSVLD3c8AAAABPJkWIw` |
| `S4-REV` | #696 | `5311633318` | `I_kwDOSVLD3c8AAAABPJkXpg` |
| `S5-RSL` | #697 | `5311633687` | `I_kwDOSVLD3c8AAAABPJkZFw` |
| `S5-PRP` | #698 | `5311634056` | `I_kwDOSVLD3c8AAAABPJkaiA` |
| `S6-BND` | #699 | `5311634422` | `I_kwDOSVLD3c8AAAABPJkb9g` |
| `S6-VAL` | #700 | `5311634925` | `I_kwDOSVLD3c8AAAABPJkd7Q` |
| `S6-WFA` | #701 | `5311635272` | `I_kwDOSVLD3c8AAAABPJkfSA` |
| `S7-CLS` | #702 | `5311635603` | `I_kwDOSVLD3c8AAAABPJkgkw` |
| `S7-MAP` | #703 | `5311635944` | `I_kwDOSVLD3c8AAAABPJkh6A` |
| `S7-ARC` | #704 | `5311636452` | `I_kwDOSVLD3c8AAAABPJkj5A` |
| `S7-ORC` | #705 | `5311636772` | `I_kwDOSVLD3c8AAAABPJklJA` |
| `S8-CON` | #706 | `5311637153` | `I_kwDOSVLD3c8AAAABPJkmoQ` |
| `S8-READ` | #707 | `5311637559` | `I_kwDOSVLD3c8AAAABPJkoNw` |
| `S8-GOV` | #708 | `5311638057` | `I_kwDOSVLD3c8AAAABPJkqKQ` |
| `S8-LEG` | #709 | `5311638395` | `I_kwDOSVLD3c8AAAABPJkrew` |
| `S9-PRT` | #710 | `5311638746` | `I_kwDOSVLD3c8AAAABPJks2g` |
| `S9-CAT` | #711 | `5311639049` | `I_kwDOSVLD3c8AAAABPJkuCQ` |
| `S9-GOV` | #712 | `5311639584` | `I_kwDOSVLD3c8AAAABPJkwIA` |
| `S9-BRW` | #713 | `5311639914` | `I_kwDOSVLD3c8AAAABPJkxag` |
| `S10-PER` | #714 | `5311640256` | `I_kwDOSVLD3c8AAAABPJkywA` |
| `S10-VMP` | #715 | `5311640597` | `I_kwDOSVLD3c8AAAABPJk0FQ` |
| `S10-DCP` | #716 | `5311641082` | `I_kwDOSVLD3c8AAAABPJk1-g` |
| `S10-API` | #717 | `5311641367` | `I_kwDOSVLD3c8AAAABPJk3Fw` |
| `S10-UI` | #718 | `5311641721` | `I_kwDOSVLD3c8AAAABPJk4eQ` |
| `S10-RPT` | #719 | `5311642129` | `I_kwDOSVLD3c8AAAABPJk6EQ` |
| `S11-UPG` | #720 | `5311642664` | `I_kwDOSVLD3c8AAAABPJk8KA` |
| `S11-RP` | #721 | `5311643014` | `I_kwDOSVLD3c8AAAABPJk9hg` |
| `S11-APL` | #722 | `5311643358` | `I_kwDOSVLD3c8AAAABPJk-3g` |
| `S11-REC` | #723 | `5311643750` | `I_kwDOSVLD3c8AAAABPJlAZg` |
| `S12-CGH` | #724 | `5311644127` | `I_kwDOSVLD3c8AAAABPJlB3w` |
| `S12-TOP` | #725 | `5311644630` | `I_kwDOSVLD3c8AAAABPJlD1g` |
| `S12-PRJ` | #726 | `5311645008` | `I_kwDOSVLD3c8AAAABPJlFUA` |
| `S12-FIL` | #727 | `5311645321` | `I_kwDOSVLD3c8AAAABPJlGiQ` |
| `S12-AGT` | #728 | `5311645856` | `I_kwDOSVLD3c8AAAABPJlIoA` |
| `S12-LOG` | #729 | `5311646318` | `I_kwDOSVLD3c8AAAABPJlKbg` |
| `S12-DBG` | #730 | `5311646689` | `I_kwDOSVLD3c8AAAABPJlL4Q` |
| `S12-DTS` | #731 | `5311647176` | `I_kwDOSVLD3c8AAAABPJlNyA` |
| `S12-KNW` | #732 | `5311647549` | `I_kwDOSVLD3c8AAAABPJlPPQ` |
| `S12-MOD` | #733 | `5311648036` | `I_kwDOSVLD3c8AAAABPJlRJA` |
| `S12-OPS` | #734 | `5311648532` | `I_kwDOSVLD3c8AAAABPJlTFA` |
| `RI-01` | #735 | `5311648867` | `I_kwDOSVLD3c8AAAABPJlUYw` |

`S13-PROGRAM` is deferred until two real releases, 90 elapsed days, a per-class 30-day zero-use window, and accountable `legacy-read-sunset` approval exist. `S14-PROGRAM` is deferred until S13 completes and a separately approved cleanup release has real retention, recovery-point, restore, and zero-dependency evidence. Neither program is a launch Issue or ready for an agent.
- `exec-plans/completed/2026-08-29-effective-driver-populated-upgrade-repair.md`: closes the Issue #649 populated self-hosted upgrade gap with an append-only repair migration, effective-by-default catalog projection, and a catalog-readiness upgrade gate.
- `exec-plans/active/2026-08-28-user-account-deletion.md`: adds audited permanent deletion for non-self Organization members, cascades account-owned security/transient state, and nulls retained business/audit references through an explicit PostgreSQL foreign-key policy plus API/UI/browser coverage.
- `exec-plans/active/2026-08-28-node-write-observation-outcomes.md`: separates ordinary node-write command execution from post-write observation across service, Bridge, API, mock, and UI surfaces; preserves snapshots/rollback while retiring equality-based mismatch judgments for new writes. Real HDC/ADB readiness remains conditional target evidence.
- `exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`: launch-window closeout of tracker rows that do not need HDC, expert logs, or a target environment. Batch 1 archived attribution evidence and moved `2026-08-01-attribution-deferred-implementation.md` to `completed/`; Batch 2 closed TD-056 (parameter-file rollback / display name); Batch 3 landed on `main` — TD-057 via #513, TD-079 hierarchical-modules via #511, import-wizard via #512. Batch 4 landed 2026-08-18: workbench fixtures #516, semantic file-sync #519, dts-reload handoff/shapes #517, DTO validation #515, render harness #518, governance ADRs #520. **TD-079 closed** on `fix/td-079-flip-ci-acceptance` (shared CI acceptance is post-cutover). TD-082 closed on `main` via #507. Wave 2 H–N (2026-08-18): TD-013 closed via #529, TD-066 closed via #531; TD-075 / TD-097 remain **partially** open, while TD-014 later closed in Wave 4 via #600. The first deterministic closeout closed TD-071 via #575, TD-073 via #576, and TD-059 via #577; the reload workflow sheet remains outside TD-059. Deterministic closeout wave 2 then closed TD-109 via #580, TD-018 via #582, TD-077 via #583, and TD-114 via #585; TD-003/012 and TD-075/076 remain Open for their broader residuals. Wave 3 subsequently closed TD-072 via #588, TD-110 via #589, TD-031 via #591, and the scoped `/parameter-admin/projects` TD-112 Admin list via #592.
- **TD-068 delivery:** ADR-0038 and parent spec #609 define the security model. Ticket #610 establishes the shared trusted-context, policy, and audit seam; #611–#615 then reconstruct durable Xiaoze provenance, migrate DTS reload, carry provenance through parameter submission/governance/writeback, and close the legacy-label/evidence ratchets. TD-068 remains Open until those migration tickets land. TD-123 retains the adjacent debugging device-write audit defect so this work does not become a platform-wide audit rewrite.
## Completed Plans

- `exec-plans/completed/2026-08-27-debug-node-cascade-delete-module-consistency.md`: replaced debug-node history protection with audited transactional cleanup of node operations, events, snapshots, bindings, and the node, while preventing legacy name-only module references from being deleted as empty or reappearing as filter ghosts.
- `exec-plans/completed/2026-08-27-xiaoze-draggable-launcher.md`: completed desktop/tablet draggable Xiaoze launcher; closed-state dragging covers the full safe viewport without toggle activation, and open-state dragging smart-attaches the visible popup above, below, left, or right while preserving mobile full-screen behavior.
- `exec-plans/completed/2026-08-27-xiaoze-draggable-modeless-popup.md`: completed desktop/tablet draggable and resizable modeless Xiaoze companion, with browser-local layout persistence, keyboard drag/resize/reset, cross-route continuity, business-modal ordering, mobile focus-trapped full-screen preservation, and local API-mode acceptance/quality evidence.
- `exec-plans/completed/2026-08-27-issue-640-debug-node-delete.md`: Issue #640 adds guarded permanent deletion for unused debugging nodes, with history protection, binding cascade, redacted audit, API/UI reconciliation, and mock-runtime convergence.
- `exec-plans/completed/2026-08-25-dts-bridge-target-detection.md`: Issue #630 routes DTS target detection through the health-confirmed registered Device Bridge, invalidates stale protocol/Bridge responses, preserves typed errors, and records local browser evidence separately from real Windows/HDC acceptance.
- `exec-plans/completed/2026-08-24-compact-application-footer.md`: completed compact page-ending footer for normal authenticated routes, with a metadata row in the existing rich homepage footer; build-time owner/version/contact configuration; shared current-page product-feedback entry; explicit auth/error/full-height-workbench exclusions; and verified shell, responsive, accessibility, and bilingual documentation gates.
- `exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`: archived after #598–#607. TD-067, TD-105, TD-014, and TD-122 closed with merged evidence; the bounded TD-005 archive-hygiene slice completed while TD-005 correctly remains Open, and the stale hotspot plan was archived without inventing a tracker closure.
- `exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`: TD-122 completed on final clean `main@493a257a1` with owned/fresh Gate0 visual 20/20, browser 127 expected / 29 planned skipped / 0 unexpected, complete operation evidence, 11/11 nested cleanup, exact root cleanup, zero artifact violations, and a valid `latest-full.json`.
- `exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`: archived after the exact four-dimension API contract, bilingual successor documentation, and API-mode Parameter Home browser gate were completed.

Completed historical plans are preserved under `exec-plans/completed/`. The bounded 2026-08-23 plan-hygiene inventory archived Organization administration (#560), local evaluation auth hardening (#563), node-only debugging, and the DTS parameter workbench with explicit implementation/supersession metadata; it is not a repository-wide inventory, so TD-005 remains Open. The 2026-08-22 deterministic parallel closeout (`2026-08-22-deterministic-tech-debt-parallel-closeout.md`) closed TD-071 / TD-073 / TD-059 via #575 / #576 / #577. Wave 2 (`2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md`) closed TD-109 / TD-018 / TD-077 / TD-114 via #580 / #582 / #583 / #585. Wave 3 (`2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`) closed TD-072 / TD-110 / TD-031 / TD-112 via #588 / #589 / #591 / #592 while preserving the broader TD-003/012/075/076 and unrelated frontend residuals. The stale Xiaoze timeline plan was archived as `2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md` after its assistant-message metadata note was added in both languages. Other completed work includes the 2026-08-17 archive of path-reachable C1–C4, Internal Beta product feedback, topology review rounds 3–6, the notification center (`2026-07-06-wiseeff-notification-center.md`), and the project-configuration-workbench defect repair (`2026-08-08-project-configuration-workbench-defect-repair.md`); the 2026-08-17 round-2 archive of landed DTS workbench/seed, attribution/driver-registry/overlay, parameter-admin UX/IA, batch import/excel, logs org-scope, personal overview, ADB/HDC, debug-admin, Device Bridge phase 1/2, Xiaoze turn-state UX, and CORS bootstrap plans; also including M0-M5 productization work, M5.1 documentation governance, Chinese developer documentation, M5.3 documentation system completion, M5.4-M5.12 browser acceptance hardening, M6.1 self-hosted runtime baseline, M3.5 commercial readiness hardening, local account lifecycle, Pi Agent provider adapter rounds, the complex debugging-node value model, Device Bridge zero-friction Phase B (`2026-06-25-wiseeff-device-bridge-zero-friction-phase-b.md`), Xiaoze sole Agent cleanup (`2026-06-26-xiaoze-sole-agent-wiseagent-cleanup.md`), Xiaoze thread persistence (`2026-06-24-wiseeff-xiaoze-thread-persistence.md`), dead code cleanup (`2026-06-30-wiseeff-dead-code-cleanup.md`), parameter debugging interim hide (`2026-07-01-wiseeff-parameter-debugging-platform-redesign.md`), the parameter-home production redesign (`2026-07-07-parameter-home-production-redesign.md`), hierarchical module trees (`2026-07-09-wiseeff-hierarchical-modules.md`), project parameter DTS/JSON files with bidirectional sync (`2026-07-11-project-parameter-files.md`), the DTS parameter management structural refactor program (`2026-07-14-dts-management-program.md` with P0/P1/P2/P3/P3.1 phase plans — CST parser, config sets/baselines/dtc gate, structured product UI, and edit→CR→writeback loop), the full DTS seed and reproducible dtc toolchain (`2026-07-15-dts-full-seed-and-toolchain.md`), DTS hardening closeout (`2026-07-15-dts-hardening-closeout.md`), parameter import wizard TD-035 (`2026-07-15-parameter-import-wizard-td035.md`), retire Superpowers agent harness and adopt Matt Pocock skills (`2026-07-25-retire-superpowers-adopt-matt-skills.md`), and older feature-specific plans that once lived under a parallel Superpowers plans tree. Residual path-derived identity and production schema validation debt are superseded by the active topology/schema cutover plan. Use `exec-plans/completed/README.md` to interpret completed plans as historical evidence rather than current implementation contracts.

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
