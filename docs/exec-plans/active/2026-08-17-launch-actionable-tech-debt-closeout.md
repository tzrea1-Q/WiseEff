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
| `fix/td-079-acceptance-semantic-fixtures` | **TD-079** leftover `project_parameter_value_id` fixtures before flipping the shared CI acceptance job | Record ownership only |
| `chore/td-082-apierror-status-codemod` | **TD-082** mechanical `ApiError` third-argument deletion | Record ownership only |

Merge-time: re-check `docs/PLANS.md` and both tech-debt tracker twins against `origin/main` before requesting merge. Those files collide often.

## Success criteria

- This plan exists EN+ZH, is listed from `docs/PLANS.md` / `docs/zh-CN/PLANS.md`, and every open tracker row that this launch cut cares about has an explicit Done / Deferred / Blocked status below.
- Attribution deferred plan (`2026-08-01-attribution-deferred-implementation.md`) moved to `completed/` after acceptance registration + playwright-cli evidence (Batch 1).
- **TD-056** lands in a later commit on this branch only if attribution closeout is already committed and green. **TD-057 / TD-064 / TD-065** stay out of this session unless TD-056 is fully committed and tests are green (then they still belong to Batch 3, not this session's default).
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

### Batch 3 — Next launch-visible product slices (not this session unless Batch 2 is complete and green)

Do **not** start these in the same sitting as Batch 2 unless Batch 2 is fully committed and tests are green. Default: leave for a follow-up branch.

| ID | Why it is next | Notes |
| --- | --- | --- |
| **TD-057** | Revision gate is missing on the surface that publishes baselines | Give the config-set view a real revision source, then restore the gate. Do not invent `revision-teaching-1`. |
| **TD-064** | Workbench → `/dts-reload` hand-off | Only after the standalone reload surface stays stable. |
| **TD-065** | Wider DTS reload value shapes | Ticket-by-ticket with overlay + preflight fixtures; no silent encodings. |

### Later product/platform batches (not launch-blocking in this cut)

Hygiene and architecture leftovers that are real but should not steal the launch window: TD-003 / TD-008 / TD-012 / TD-018 (generated clients), TD-005 (completed-plan hygiene), TD-013 / TD-014 (approvals/catalog), TD-048–TD-053 / TD-055 / TD-117 (governance deferred questions), TD-059 (leftover dialogs), TD-063 / TD-066 / TD-067 / TD-068 (reload/bridge/security follow-ups), TD-071–TD-077 (test architecture), TD-097 / TD-109 / TD-110 / TD-112 / TD-114 (frontend residue). Pick them when touching those surfaces; do not bundle them here.

## Per-TD status for this launch cut

Legend: **Done** = closed or closeable in a batch above; **In progress (sibling)** = owned by a named parallel branch; **Deferred** = out of the launch window by choice; **Blocked** = cannot close without hardware, experts, or a target environment; **Open (later)** = real work, not this branch.

| ID | Status | Batch / owner |
| --- | --- | --- |
| Attribution plan closeout (DRV-REG-004 / `DRV-REG-005`) | Done in Batch 1 (this branch) | Batch 1 |
| TD-046 / TD-047 | Done (already closed on `main`) | Evidence + archive in Batch 1 |
| TD-056 | Done in Batch 2 (this branch) | This branch after Batch 1 |
| TD-057 | Open (later) | Batch 3 |
| TD-064 / TD-065 | Open (later) | Batch 3; not this session by default |
| TD-079 | In progress (sibling) | `fix/td-079-acceptance-semantic-fixtures` |
| TD-082 | Done on `main` via #507 | `chore/td-082-apierror-status-codemod` |
| TD-001 | Deferred | Long-running mock/API parity constraint, not a ticket |
| TD-033 | Deferred | Archive-only leftover debugging catalog tables |
| TD-031 | Deferred | Env-var rename; high confusion risk in the launch window |
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
| Remaining open rows (TD-003, TD-005, TD-008, TD-012–014, TD-018, TD-048–055, TD-059, TD-063, TD-066–068, TD-071–077, TD-097, TD-109–112, TD-114, TD-117, …) | Open (later) | Not this branch |

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
| Tech debt | Update | EN+ZH tracker: TD-056 closed; TD-079 / TD-082 remain sibling-owned without rewriting Next Action details |

## Documentation Update Gate

A batch cannot be called complete until:

1. Every Impact Matrix `Update` / `Review` row for that batch is updated or recorded unchanged with evidence.
2. EN+ZH tracker rows that this batch closes or advances are updated. TD-079 / TD-082 stay sibling-owned.
3. `npm run docs:check` is green.
4. UI-interaction coverage for that batch is registered (planned stub + supplemental playwright-cli is honest; fake `@acceptance` markers are not).
5. Moving a plan to `completed/` does not leave the same filename in `active/` (EN or ZH).

Deferred or blocked work stays in `tech-debt-tracker.md`; do not delete those rows.
