# Deterministic tech-debt parallel closeout — wave 2

> Status: **Completed 2026-08-22**
> Date: 2026-08-22
> Planning branch: `docs/deterministic-tech-debt-parallel-closeout-wave2-plan`
> Closeout branch: `docs/deterministic-td-parallel-closeout-wave2`
> Implementation PRs: #580 (TD-109), #582 (TD-018), #583 (TD-077), #585 (TD-114)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md)
> Tracker: [Technical Debt Tracker](../tech-debt-tracker.md)

## Goal

Close four independent tracker rows that require neither hardware, target-environment evidence, expert-labelled data, KMS, real delivery volume, nor an unresolved product decision:

- **TD-018** — validate Xiaoze suggest request/response and emitted AG-UI CUSTOM frames at the existing contract seams.
- **TD-077** — retire the remaining raw CSS/source-style tests and make structural CSS assertions plus a zero-stock lint rule the durable contract.
- **TD-109** — remove the newly duplicated DTS-reload promotion eligibility state machine from the server/mock adapters.
- **TD-114** — remove all review-page `full` layout hooks by expressing the already-full-row action panel as one column.

Each row closes only after its own implementation PR, focused/full gates, two-axis review, and the shared tracker/archive closeout have landed.

## Audit conclusions and fixed decisions

- `origin/main` at planning time is `3da2212a`.
- TD-018 is a narrow contract slice. TD-003 and TD-012 remain Open for the other handwritten clients and endpoint schemas.
- `@wiseeff/xiaoze-protocol` remains dependency-free. Zod schemas live in server DTO contracts; they validate actual emitted frames without wrapping or replacing `@ag-ui/client` stream parsing.
- TD-077's original 17-file CSS-text migration already landed in `8be6f459`. This track owns only the concentrated residuals and a zero-stock lint rule; unrelated architecture/source tests are not rewritten merely because they use `readFileSync`.
- TD-109 shares eligibility decisions and stable reason/details only. Server and mock adapters retain their own presentation/error messages and storage details; `src/` never imports `server/`.
- TD-114 does not add a Button variant or layout prop. The current two-column panel has every action spanning both columns, so a one-column panel is behavior-equivalent and removes the local hooks.

## Non-goals

- TD-072 queue-fake retirement, TD-075 registry unification, or TD-076 acceptance-fixture consolidation.
- TD-062 workbench shell stretch, TD-110 API user-directory design, TD-112 table scope clarification, or a TD-113 stock-burn wave.
- Changing Xiaoze product behavior, suggest ranking, or the AG-UI protocol package dependency model.
- Changing DTS reload promotion policy or user-facing error copy.
- Redesigning review/submission actions, workflow permissions, or primary-action hierarchy.

## Git and PR workflow

The four implementation tracks use isolated worktrees from the refreshed `main` after this plan merges. Implementation agents commit only their owned code/tests/docs and do not open or merge PRs. The parent rebases, verifies, reviews, opens, merges, and finally lands shared tracker/plan updates.

| Track | Branch | Owner files | Explicit exclusions |
| --- | --- | --- | --- |
| TD-018 | `fix/td-018-xiaoze-contracts` | agent DTO schemas/registry, suggest route/hook, emitted-frame contract tests, directly affected API docs | No tracker/plan edits; no protocol-package dependency; no stream-parser wrapper |
| TD-077 | `test/td-077-style-contracts` | residual style tests, `cssAssertions`, ESLint rule/config/tests, directly related quality evidence | No production CSS/component changes; no tracker/plan edits; no unrelated source-test cleanup |
| TD-109 | `refactor/td-109-promotion-guard` | shared DTS reload promotion guard, server/mock adapters and focused tests | No visible copy changes; no tracker/plan edits; no imports from `server/` into `src/` |
| TD-114 | `fix/td-114-action-panel-layout` | review/submission pages, scoped action-panel CSS and focused tests | No Button interface/variant change; no workflow behavior change; no tracker/plan edits |
| Shared closeout | `docs/deterministic-td-parallel-closeout-wave2` | EN/ZH tracker, this plan, PLANS indexes, stale current-state references | No implementation changes |

Before every merge: fetch `origin/main`, rebase, run `npx tsc -b` and affected tests, then re-check shared plan/TD state. Merge non-visible tracks first, TD-114 after them, and shared documentation last.

## Confirmed TDD seams

These public seams are fixed before tests are written:

1. **TD-018 contract seam** — suggest route request validation, `useXiaozeSuggestions` response parsing/fail-closed behavior, and schemas applied to real CUSTOM frames produced by `xiaozeTurnStream`.
2. **TD-077 style-test seam** — an ESLint rule rejects direct raw CSS text assertions; visual declarations are queried through `cssAssertions`; existing Playwright quality/acceptance cases retain computed-style and interaction coverage.
3. **TD-109 domain seam** — a shared promotion-eligibility result discriminates allowed runs from stable rejection reasons/details; server and mock adapters map the result independently.
4. **TD-114 layout seam** — rendered review/submission actions carry no `full` hook, and the structured CSS contract reports a one-column `.action-panel` with unchanged action order and variants.

Every track works in vertical red → green slices. No real sleeps, private-method tests, SQL/source-format assertions, or speculative refactors.

## Tasks

### Track A — TD-018

1. Add red tables for invalid suggest input/output and every real CUSTOM frame family.
2. Add dependency-free-facing Zod schemas under the server contract module and bind suggest OpenAPI metadata to concrete schemas.
3. Validate the server request and frontend response; preserve the hook's honest empty-list degradation while reporting contract drift through the existing seam.
4. Run focused frontend/server/contract tests, `contract:check`, typecheck, build, and docs gates.

### Track B — TD-077

1. Add a red lint-rule fixture for direct CSS reads followed by raw `toMatch`/`toContain` assertions.
2. Migrate `DtsParameterWorkbench`, Xiaoze approval, retired-homepage, and truly style-related source conventions to structural CSS or rendered DOM/primitive contracts.
3. Keep unrelated architectural source tests outside the rule's scope; prove formatting/reordering does not break structural assertions.
4. Run focused tests, full frontend tests, lint, UI standards, and the existing `/parameters` quality plus Xiaoze approval coverage.

### Track C — TD-109

1. Add a red table for verified, restore-baseline, unverifiable acknowledgement, and other-status outcomes.
2. Implement the shared eligibility result and adopt it from server and mock adapters without sharing presentation copy.
3. Keep adapter-specific DB/store work local and add parity/sensitivity tests.
4. Run focused server/mock/domain tests, full frontend/server tests as proportionate, typecheck, and build.

### Track D — TD-114

1. Add red DOM and structured-CSS tests for hook-free actions and one-column layout.
2. Remove all six `full` classes, delete `.action-panel .full` and dead `.button.full`, and preserve action order/variants.
3. Run focused/full frontend gates and relevant parameter review/reject acceptance.
4. Use `playwright-cli` in API mode on `/parameter-review` and `/parameter-submissions` at 1440×900, 768×1024, and 390×844 with snapshots, screenshots, interaction, console, and network checks.

### Shared closeout

1. After all implementation PRs merge, move TD-018, TD-077, TD-109, and TD-114 from Open to Completed in both tracker languages with exact evidence.
2. Update only stale current-state references in older active plans; preserve historical partial facts.
3. Move this plan from `active/` to `completed/` in both languages and update both PLANS indexes.
4. Run the combined documentation, contract, UI, build, lint, frontend/server, and diff gates from refreshed `main`.

## Success criteria

- Four independently reviewable implementation PRs merge without cross-track code conflicts.
- TD-018 concretely validates suggest plus all emitted CUSTOM frame families while TD-003/012 stay Open.
- TD-077 has no in-scope raw CSS/source-style assertions and a zero-stock lint rule prevents recurrence.
- TD-109 has one shared promotion eligibility state machine, adapter-specific copy remains unchanged, and mock/server parity is proven.
- TD-114 has no review/submission `full` hooks or matching CSS rules and passes two-route, three-viewport browser QA.
- Final Standards and Spec reviews report zero remaining findings for every implementation and the shared closeout diff.
- Both tracker languages list all four rows under Completed and this plan exists only under `completed/`.

## Verification

```bash
npx tsc -b
npm test
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run docs:check
npm run contract:check
git diff --check
```

Track-specific commands, red/green evidence, and browser artifact paths are recorded in implementation PRs and final tracker entries.

## Closeout evidence

- **TD-109 — #580 (`8d8f06bd`):** domain/mock 23/23 and server promotion 9/9 passed. Implementation-time full suites passed 402 frontend files / 3001 tests and 346 server files / 2682 tests, with 2 files / 8 tests skipped. Repository CI passed 402/3001 frontend tests and 347 server files / 2686 tests, with 1 file / 4 tests skipped.
- **TD-018 — #582 (`693a4da8`):** focused frontend 12/12 and server/CUSTOM 44/44 passed. Implementation-time full suites passed 401 frontend files / 2991 tests and 348 server files / 2698 tests, with 2 files / 8 tests skipped. Repository CI passed 403/3005 frontend tests and 349 server files / 2711 tests, with 1 file / 4 tests skipped.
- **TD-077 — #583 (`c3937904`):** repository CI passed 404 frontend files / 3005 tests and 349 server files / 2711 tests, with 1 file / 4 tests skipped; script coverage passed 500 tests with 5 existing skips. The final seven residual files use structural/rendered/primitive contracts, and the error-level regression rule passed its 6/6 focused cases.
- **TD-114 — #585 (`bf3739a2`):** local focused coverage passed 4 files / 148 tests, the implementation-time frontend suite passed 402 files / 2993 tests, and parameter acceptance passed 3/3. Repository CI passed 405/3010 frontend tests and 349 server files / 2711 tests, with 1 file / 4 tests skipped; Acceptance quality passed 97 tests and Acceptance smoke passed 4 tests. API-mode QA covered `/parameter-review` and `/parameter-submissions` at 1440×900, 768×1024, and 390×844 with snapshots, screenshots, reject/approve/withdraw requests at HTTP 200, zero overflow, and zero console errors. It found and fixed mobile rule ordering, history-card specificity, and an implicit merge-link grid track; the remaining console warning was the local CopilotKit license warning.
- All four PRs passed the repository Detect, Build and test, Acceptance quality, Acceptance smoke, and Merge bar gates. Their final independent Standards and Spec reviews each reported zero findings.
- This shared closeout updates only the EN/ZH trackers, plans, indexes, and stale current-state references. Repository maps, product specifications, runbooks, security rules, design-system rules, and ADR-0031 were reviewed and remain unchanged; #582 already carries the required API/OpenAPI artifact changes, and #583 carries the quality-rule changes.
- This closure supplies local and repository-CI implementation evidence only. Path-filtered local non-HDC and target-synthetic jobs were skipped. It does **not** claim HDC/device-lab, target-environment, target-synthetic, or live model/provider evidence.

## Documentation Impact Matrix

| Area | Status | Files / evidence |
| --- | --- | --- |
| Repository maps | Reviewed — no change | `AGENTS.md`, `ARCHITECTURE.md`, and `docs/README.md` still route the same files; no navigation change |
| Planning | Updated | this EN/ZH plan, both PLANS indexes, and stale current-state references |
| Technical debt | Updated | EN/ZH tracker rows TD-018/077/109/114 moved to Completed; TD-003/012 and TD-072/075/076 remain Open |
| Product specs | No change | no workflow or product decision changes |
| Architecture/domain | Reviewed — no additional change | #580 owns the domain guard and #582 owns the contract placement; existing architecture boundaries remain accurate |
| Quality/testing | Reviewed — no additional change | #583 owns the error-level lint/structural contract; tracker evidence records the gate without duplicating implementation detail |
| Reliability/runbooks | No change | no runtime/operator workflow or readiness claim |
| Security/governance | Reviewed — no change | malformed contracts fail closed; no authz, secret, audit, or device-write change |
| Frontend/design | Reviewed — no additional change | #585 is a behavior-equivalent layout cleanup with browser evidence; the existing design rules remain accurate |
| API/generated artifacts | Updated in #582 | concrete suggest/OpenAPI contracts were generated and checked in the implementation PR |
| References | Reviewed — no change | ADR-0031 remains dependency-free and needs no amendment |

## Documentation Update Gate

The batch cannot be marked complete until:

- every Update/Review row is updated or recorded unchanged with evidence;
- EN/ZH tracker and plan state agree;
- the plan filename exists only under `completed/` after closure;
- `npm run docs:check` and `git diff --check` pass on the closeout branch;
- TD-114 evidence records both routes, all three viewports, interactions, screenshots, console/network checks, and issues found/fixed;
- skipped target/HDC/model-provider gates remain explicitly outside the closure claim.
