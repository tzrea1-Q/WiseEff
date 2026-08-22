# Launch-actionable tech-debt closeout

> Status: **Active** — executable batches only; do not pretend to close the whole tracker in one PR  
> Date: 2026-08-17  
> Branch: `feat/launch-actionable-td-closeout`  
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`](../../zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md)  
> Tracker: [`docs/exec-plans/tech-debt-tracker.md`](../tech-debt-tracker.md)

## Goal

Close the launch-visible product and documentation gaps that can be finished **without** HDC hardware, expert-annotated logs, or a target environment (self-hosted Linux / real OIDC / production-like snapshot). Keep every remaining tracker row honest as **Done**, **Deferred**, or **Blocked**.

This plan is the launch cut of the open tracker. It does **not** close ~61 rows in one merge. Later batches stay listed so the next agent does not reopen blocked work.

## Non-goals

- HDC device-lab smoke or hardware write evidence.
- Expert-annotated golden logs or live-model quality claims.
- Target-environment evidence (self-hosted Linux, real OIDC, capacity, rollback rehearsal, object-store restore, production-like identity cutover snapshot).
- KMS envelope encryption or webhook-outbox work that needs real delivery volume.
- Long-running constraints that are not tickets (mock-mode existence, archive-only debugging catalog tables).
- High-risk / low-yield launch-window work (env-var rename, large token-burn waves, PCW stretch LOC, optional Admin L2 toolchain panel).
- Implementing **TD-079** or **TD-082** on this branch. Those belong to named sibling branches; do not edit their files.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/launch-actionable-td-closeout` from latest `origin/main`; may `git push -u origin HEAD`; do not open or merge GitHub PRs |
| Parent agent | Review, open/merge the PR, then sync local `main` |

Branch: `feat/launch-actionable-td-closeout`, checked out from latest `origin/main` in an isolated worktree. Do not push `main`, do not `--no-verify`, do not amend published history.

One plan → one branch. Sequential commits on this branch are slices (plan → attribution closeout → TD-056). Stop on a complete committed slice if time runs out.

### Parallel sibling branches (do not touch their files)

| Branch | Owns | This plan's duty |
| --- | --- | --- |
| `fix/td-079-acceptance-semantic-fixtures` / `#509` | First TD-079 leftover-PPV slice | Landed on `main` |
| `fix/td-079-acceptance-remaining` / `#510` | IMPACT + PERM-MATRIX-002 | Landed on `main` |
| `chore/td-082-apierror-status-codemod` / `#507` | **TD-082** mechanical `ApiError` third-argument deletion | Landed on `main` |
| `fix/td-079-hierarchical-modules` / `#511` | **TD-079** hierarchical-modules fixture | Landed on `main` |
| `fix/td-079-import-wizard` / `#512` | **TD-079** import-wizard fixture | Landed on `main` |
| `feat/td-057-config-set-revision-gate` / `#513` | **TD-057** config-set revision gate | Landed on `main` |
| `fix/td-079-workbench-semantic` / `#516` | **TD-079** workbench leftover-PPV fixtures | Landed on `main` |
| `feat/td-079-parameter-files-semantic-sync` / `#519` | **TD-079** semantic file-sync | Landed on `main` |
| `feat/dts-reload-handoff-and-shapes` / `#517` | **TD-064** / **TD-065** | Landed on `main` |
| `feat/openapi-client-or-dto-validation` / `#515` | Schema-level DTO validation (TD-003/012/018 partial; TD-008 closed with residual) | Landed on `main` |
| `test/td-073-render-harness` / `#518` | **TD-073** partial (harness + 4 page tests) | Landed on `main` |
| `docs/parameter-governance-deferred-adr` / `#520` | D1–D8 / TD-117 / TD-063 ADR lock (TD-050 / TD-053 closed) | Landed on `main` |

Merge-time: re-check `docs/PLANS.md` and both tech-debt tracker twins against `origin/main` before requesting merge. Those files collide often.

## Success criteria

- This plan exists EN+ZH, is listed from `docs/PLANS.md` / `docs/zh-CN/PLANS.md`, and every open tracker row that this launch cut cares about has an explicit Done / Deferred / Blocked status below.
- Attribution deferred plan (`2026-08-01-attribution-deferred-implementation.md`) moved to `completed/` after acceptance registration + playwright-cli evidence (Batch 1).
- **Batch 4** landed 2026-08-18 (#516 workbench, #519 file-sync, #517 TD-064/065, #515 DTO validation, #518 TD-073 partial, #520 governance ADRs). **TD-079 closed** on `fix/td-079-flip-ci-acceptance` (shared CI acceptance is post-cutover).
- `npm run docs:check` green before claiming the docs slice done. UI slices also run targeted tests, `npm run build`, and playwright-cli.

## Batches

### Batch 0 — Plan artifact (this session)

1. Add this plan EN+ZH with Goal, batches, Git & PR, Impact Matrix, Update Gate, verification commands, and per-TD status.
2. Hook it from `docs/PLANS.md` and `docs/zh-CN/PLANS.md`.
3. Point TD-079 / TD-082 tracker rows at the sibling branches without rewriting their Next Action details.

### Batch 1 — Attribution deferred closeout (this session)

Owner plan (archived): `docs/exec-plans/completed/2026-08-01-attribution-deferred-implementation.md` (ZH twin under `docs/zh-CN/exec-plans/completed/`).

PR1–PR3 code is already on `main` (D-AG-01–04, TD-046 / TD-047 closed). Remaining:

1. Register the missing PR3 acceptance/operation ID (`DRV-REG-005` replay-from-registration) and keep `DRV-REG-004` as an honest `required: false` / `@acceptance-planned` stub so the shared pre-cutover CI suite does not grow (TD-079).
2. Collect playwright-cli evidence at `1440x900` / `768x1024` / `390x844` with 0 console errors on `/parameter-admin/modules` (nature/cardinality + replay controls).
3. Record supplemental evidence on the coverage map and operation matrix (EN+ZH). Do **not** flip those IDs to blocking Playwright in the shared CI job.
4. If evidence and the documentation update gate pass, move the attribution plan to `completed/` (both languages; filename must not remain in `active/`) and update `PLANS.md`.

If `playwright-cli` cannot run, stop and report the blocker. Do not claim frontend verification complete.

### Batch 2 — TD-056 parameter-file rollback / display name (this session if Batch 1 is committed)

TDD. API + port + UI + tests + EN/ZH docs. Do not rewrite the configuration workbench.

- Add a promote-to-current / rollback-to-version operation on the parameter-files API and `ParameterFileRepository`.
- Reuse the existing server `origin='rollback'` pointer-version pattern from baseline restore: insert a new current version that carries the chosen bytes forward; do not rewind history.
- Resolve `createdByUserId` to a display name on the version list.
- Extend the version list on the project-operations / files surface that already shows history (POD-C6). ConfirmDialog for blast radius. Chinese product copy.
- Register or extend an acceptance/operation ID if the interaction is new; otherwise record why existing coverage plus playwright-cli is enough.
- Close TD-056 in both tracker twins when verification is green. **Done 2026-08-17** on this branch.

### Batch 3 — Parallel tracks (after Batch 2 on `main`)

Do **not** open a second closeout plan. These tracks ran in parallel from latest `origin/main`. Each track owned only its files. **Landed 2026-08-17:** #511 hierarchical-modules, #512 import-wizard, #513 TD-057.

| Track | Branch | Owns | Do not touch |
| --- | --- | --- | --- |
| TD-079 hierarchical-modules | `fix/td-079-hierarchical-modules` / `#511` | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` plus the semantic list `moduleId` seam it needs (`listSemanticParameters` hydrates `b.module_id`; delete-guard counts bindings) | `parameter-import-wizard.acceptance.spec.ts`; `project-configuration-workbench.acceptance.spec.ts`; `parameter-files.acceptance.spec.ts`; CI env flip |
| TD-079 import wizard | `fix/td-079-import-wizard` / `#512` | `parameter-import-wizard.acceptance.spec.ts` | Do not edit that spec from the other Batch 3 tracks |
| TD-057 revision gate | `feat/td-057-config-set-revision-gate` / `#513` | Config-set revision source, then restore the gate. Do not invent `revision-teaching-1`. | Do not edit `ConfigSetBaselinePanel` / release-baseline product code from the TD-079 fixture tracks |

**Out of this batch (explicit), still open after Batch 3 (later closed):**

- ~~`parameter-files.acceptance.spec.ts` file-sync~~ (#519; `PARAM-FILE-ROLLBACK-001` still skip)
- ~~`project-configuration-workbench.acceptance.spec.ts`~~ (#516)
- ~~`xiaoze-action.acceptance.spec.ts` pre-cutover fallback~~ (`fix/td-079-flip-ci-acceptance`)
- ~~non-acceptance `e2e/parameter-management.api.spec.ts`~~ (`fix/td-079-flip-ci-acceptance`)
- ~~Flipping the shared CI acceptance job / `WISEEFF_SEED_LEGACY_FLAT_IDENTITY`~~ (`fix/td-079-flip-ci-acceptance`)
- ~~**TD-064** / **TD-065**~~ (#517)

### Batch 4 — Later launch-visible product slices

**Landed 2026-08-18** on `main`: #516, #519, #517, #515, #518, #520.

| ID | Why it is next | Notes |
| --- | --- | --- |
| **TD-064** | Workbench → `/dts-reload` hand-off | **Done** via #517. |
| **TD-065** | Wider DTS reload value shapes | **Done** via #517 (deletion = honest preflight failure). |

### Later product/platform batches (not launch-blocking in this cut)

Hygiene and architecture leftovers that are real but should not steal the launch window: TD-003 / TD-012 (generated-client and generic AG-UI/REST remainder; TD-008 and TD-018 are closed), TD-005 (completed-plan hygiene), TD-014 (catalog remainder after #532 import/export), TD-055 (governance implementation), TD-067 / TD-068 (bridge/security follow-ups; TD-063 / TD-066 closed via #547 / #531), TD-075 / TD-076 (test architecture; TD-075 partial), and TD-097 / TD-113 (frontend residue; TD-097 partial via #533). Pick them when touching those surfaces; do not bundle them here. TD-013 closed via #529; TD-048 / TD-049 / TD-050 / TD-051 / TD-052 / TD-053 / TD-059 / TD-063 / TD-071 / TD-073 / TD-074 / TD-117 are closed. TD-059 / TD-071 / TD-073 completed on 2026-08-22 via #577 / #575 / #576; the reload workflow sheet remains outside TD-059. Deterministic closeout wave 2 then closed TD-109 via #580, TD-018 via #582, TD-077 via #583, and TD-114 via #585 without closing the broader TD-003/012/075/076 residuals. Wave 3 subsequently closed TD-072 via #588, TD-110 via #589, TD-031 via #591, and the scoped `/parameter-admin/projects` TD-112 Admin list via #592; those later PRs did not run on this launch-plan branch.

## Per-TD status for this launch cut

Legend: **Done** = closed or closeable in a batch above; **In progress (sibling)** = owned by a named parallel branch; **Deferred** = out of the launch window by choice; **Blocked** = cannot close without hardware, experts, or a target environment; **Open (later)** = real work, not this branch.

| ID | Status | Batch / owner |
| --- | --- | --- |
| Attribution plan closeout (DRV-REG-004 / `DRV-REG-005`) | Done in Batch 1 (this branch) | Batch 1 |
| TD-046 / TD-047 | Done (already closed on `main`) | Evidence + archive in Batch 1 |
| TD-056 | Done in Batch 2 (this branch) | This branch after Batch 1 |
| TD-057 | Done on `main` via #513 | Batch 3: `feat/td-057-config-set-revision-gate` |
| TD-064 / TD-065 | Done on `main` via #517 | Batch 4 |
| TD-079 | **Done** on `fix/td-079-flip-ci-acceptance` | Shared CI acceptance is post-cutover. Xiaoze leftover fallback and `e2e/parameter-management.api.spec.ts` migrated off retired PPV submit. |
| TD-082 | Done on `main` via #507 | `chore/td-082-apierror-status-codemod` |
| TD-001 | Deferred | Long-running mock/API parity constraint, not a ticket |
| TD-033 | Deferred | Archive-only leftover debugging catalog tables |
| TD-031 | Done later via #591 | Deferred from this launch branch, then closed by deterministic Wave 3 with canonical group-atomic `XIAOZE_LLM_*` configuration and an explicit legacy migration fallback. |
| TD-113 | Deferred | Large token-burn waves; continue only on touched surfaces |
| TD-062 | Deferred | PCW stretch 800–1000 LOC; do not reopen #258 |
| TD-043 | Deferred | Optional Admin L2 toolchain panel |
| TD-100 | Blocked | Remaining work is HDC hardware |
| TD-009 / TD-090 | Blocked | Expert logs / live-model quality |
| TD-007 | Blocked | Target Redis/queue evidence |
| TD-019–TD-025 | Blocked | Target OIDC, self-host smoke, backup/restore, capacity, rollback rehearsal |
| TD-022 | Blocked | First deployed Linux target |
| TD-038 / TD-042 | Blocked | Target proof / clean snapshot cutover rehearsal |
| TD-039 / TD-040 | Blocked | Follow the topology cutover; do not reopen a separate program |
| TD-103 / TD-105 / TD-116 | Blocked | Needs KMS or real webhook volume |
| Remaining open rows (TD-003, TD-005, TD-012, TD-014, TD-055, TD-067–068, TD-075–076, TD-097, TD-113, …) | Open (later) | Not this branch. TD-003/012/014/075/097 stay **partially** open. TD-018/077/109/114 closed in deterministic wave 2 via #582/#583/#580/#585; TD-072/110/031/112 later closed in Wave 3 via #588/#589/#591/#592; TD-008/013/048–053/059/063–066/071/073/074/117 were already closed. |

## UI Interaction Automation review

Batch 1 affected spec: `e2e/acceptance/parameter-topology.acceptance.spec.ts`.

| ID | Behavior | Automation |
| --- | --- | --- |
| `DRV-REG-004` | Admin edits `driverNature` / `instanceCardinality`; Org Admin cannot edit platform subjects; platform-admin org edits appear in org audit; singleton change only refreshes publish blockers. | Keep `@acceptance-planned` / `required: false`. Unit + server already on `main`. Supplemental playwright-cli under `work/ui-checks/attribution-deferred/`. Do not enlarge the shared pre-cutover CI suite (TD-079). |
| `DRV-REG-005` | Admin sets registration default business category and runs **replay from registration**; auto driver-groups move; curated stay frozen. | New planned ID + `@acceptance-planned` stub. Unit coverage: `ModuleEditDialog.test.tsx` + server placement tests. Supplemental playwright-cli on the same evidence folder. Blocking Playwright waits for TD-079. |

Batch 2 (TD-056) registered `PARAM-FILE-ROLLBACK-001` (`required: false`, `@acceptance-planned`) on `e2e/acceptance/parameter-files.acceptance.spec.ts` before implementation. Shared Playwright stays blocked on TD-079; this cut's evidence is unit/server tests plus playwright-cli under `work/ui-checks/param-file-rollback/`.

Operation evidence stays on `npm run acceptance:browser` / `npm run acceptance:evidence` when a stub is later automated. This cut's operation evidence is playwright-cli plus unit/server tests.

## Verification

```bash
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# Batch 1 UI evidence (mock frontend is enough for the Admin dialog walk):
# VITE_WISEEFF_RUNTIME_MODE=mock npm run dev
# playwright-cli three viewports + snapshot + screenshot + console error
# Batch 2 (when implemented):
# npx vitest run server/modules/parameter-files/service.test.ts \\
#   server/modules/parameter-files/repository.test.ts \\
#   server/modules/parameter-files/routes.test.ts \\
#   src/infrastructure/mock/mockParameterFileRepository.test.ts \\
#   src/infrastructure/http/parameterFileClient.test.ts \\
#   src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx
# npm run build
# playwright-cli three viewports on /parameter-admin/projects/:id/configuration
#   + inspector version history + restore confirm + console error
# evidence: work/ui-checks/param-file-rollback/
# Batch 3 hierarchical-modules (this track):
# npm run test:server -- server/modules/parameters/parameterModuleRepository.test.ts
# npm run acceptance:e2e -- e2e/acceptance/hierarchical-modules.acceptance.spec.ts
# npm run docs:check
# npm run build
```

Do not run full browser acceptance unless cheap. Do not claim target-environment readiness from local skips.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — no runtime-mode or map change expected |
| Planning | Update | This plan + ZH twin; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; attribution plan move in Batch 1 |
| Product specs | Review | Unchanged: product-spec “rollback” is review/debug snapshot language, not file-history restore. Operator copy lives on the workbench inspector. |
| Domain / glossary | Update | `docs/design-docs/domain-model.md` (+ ZH): file-version `origin` includes `rollback`; dedicated file-history restore uses the same pointer-version rule. |
| Design docs | Review | Attribution deferred-questions stay Locked; no re-grill |
| API | Update | `docs/design-docs/api-contract.md` (+ ZH): `POST .../rollback`, `createdByDisplayName` on version list, `parameter-file-rollback` audit |
| Frontend | Update | `docs/FRONTEND.md` (+ ZH) — workbench inspector restore-as-current + display name; legacy files-panel TD-056 sentence removed |
| Security | Review | Audited write `parameter-file-rollback`; reuses existing parameter-file audit seam; no new secret |
| Reliability / runbooks | No change | No target-environment claim |
| Developer env | No change | No new env keys |
| Quality / acceptance | Update | Coverage map + operation matrix EN+ZH; `PARAM-FILE-ROLLBACK-001` in `requirements.ts` / `operationMatrix.ts` / `parameter-files.acceptance.spec.ts` |
| Generated artifacts | No change | No migration; Batch 2 reuses schema `origin='rollback'` |
| References | Review | Unchanged: productization API draft is not the live contract; live contract updated above |
| Tech debt | Update | EN+ZH tracker: TD-056 closed; Batch 3 landed (#511 hierarchical-modules, #512 import-wizard, #513 TD-057); Batch 4 landed (#516/#519 TD-079 fixtures, #517 TD-064/065, #515 DTO validation, #518 TD-073 partial, #520 ADRs; TD-008/050/053 closed). **TD-079 closed** on `fix/td-079-flip-ci-acceptance` (shared CI post-cutover). TD-082 closed via #507 |

## Documentation Update Gate

A batch cannot be called complete until:

1. Every Impact Matrix `Update` / `Review` row for that batch is updated or recorded unchanged with evidence.
2. EN+ZH tracker rows that this batch closes or advances are updated. **TD-079 closed** on `fix/td-079-flip-ci-acceptance` (shared CI acceptance is post-cutover). TD-082 closed via #507.
3. `npm run docs:check` is green.
4. UI-interaction coverage for that batch is registered (planned stub + supplemental playwright-cli is honest; fake `@acceptance` markers are not).
5. Moving a plan to `completed/` does not leave the same filename in `active/` (EN or ZH).

Deferred or blocked work stays in `tech-debt-tracker.md`; do not delete those rows.
