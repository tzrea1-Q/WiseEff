# Parameter debugging refinement

> Chinese: [参数调试整改](../../zh-CN/exec-plans/active/2026-10-15-parameter-debugging-refinement.md)

Scope: `/dts-reload`, its parameter inspector, batch, preflight/result/history, shared Bridge entry and organisation reload configuration. Base: `24b5bc2f0`; branch: `codex/frontend-ui-20261015`. The user authorised all findings from the local UI audit. No production deployment or physical device write is part of this work.

## Acceptance checklist

- [x] Protect pending inspector and batch changes on project switches, navigation and reload.
- [x] Isolate asynchronous candidates, preflight, deployment, restore, history and residue by current context; expose retry/loading/unknown states.
- [x] Refresh history and last-reload metadata after operations without clearing current edits; canonicalise run links.
- [x] Separate success/information from errors and keep the next action visible.
- [x] Consolidate project/protocol controls; use one main work area scroll and clear section navigation.
- [x] Keep all row actions visible at 1440×900 and 1280×800; prevent settings footer overlap.
- [x] Use one parameter editor with immediate validation, useful meaning/constraints and contextual syntax examples.
- [x] Retain read-only details for blocked parameters and show staged values in the candidate list.
- [x] Explain filter scope, distinguish empty states and provide a unified reset.
- [x] Lead results with parameter differences and next steps; disclose source/hash/step details progressively.
- [x] Use Chinese-facing dates/statuses and preserve technical identifiers as secondary information.
- [x] Group organisation configuration, show effective settings and modification metadata, associate field hints and labels.
- [x] Fail closed on configuration load errors, offer retry, and reject stale concurrent saves on the server.
- [ ] Run affected tests/static checks/build, inspect API-mode desktop interactions, and independently review concurrency changes.

## Audit finding closure

| # | Finding and implemented correction |
| --- | --- |
| 1 | Batch loss: project/route/reload guards protect staged and inspector edits. |
| 2 | Covered final configuration field: grouped fields and the following summary let the log selector scroll completely above the shared sticky save bar. |
| 3 | Clipped compact row actions: the local candidate table can shrink to its available width and wraps values. |
| 4 | False red error after preflight: successful preflight and missing-Bridge guidance use an informational status. |
| 5 | Stale history: start/deploy/restore refresh history and last-reload metadata. |
| 6 | Scattered controls: project, protocol, selection count and preflight share one taskbar. |
| 7 | Nested scrolling: the task area owns primary scrolling; table, tray and source panels no longer impose competing scroll areas. |
| 8 | Duplicate editors: the tray shows differences and opens the same parameter inspector. |
| 9 | Missing batch context: table rows show baseline, staged value and change state. |
| 10 | Hidden meaning/misleading examples: meaning, constraints and units precede technical detail; examples explain syntax only. |
| 11 | Technical-first results: differences and the next action precede folded source/steps/hash evidence. |
| 12 | Opaque filters: scope summaries and one reset expose all intersecting filters. |
| 13 | Sparse configuration: grouped controls, effective preview, organisation scope and modification metadata explain the result. |
| 14 | Mixed language: Chinese date/status/action labels; technical identifiers remain available as secondary detail. |
| 15 | Stale asynchronous results: context/request generations isolate candidates, runs, history, target detection and residue. |
| 16 | Inconsistent run links: write canonical runId links and continue reading legacy run links. |
| 17 | Blocked parameters hide details: read-only inspection remains available while selection/editing is disabled. |
| 18 | Failed configuration loads allow editing: disable edits/save, show the error and provide retry. |
| 19 | Concurrent configuration overwrites: require the exact revision and reject stale saves with conflict recovery that preserves the draft. |
| 20 | Incomplete accessibility: connect labels, help and errors; retain focus return, tabs and keyboard operation. |
| Extra | Residue lookup failure is unknown with retry. Pending distil/promote only clear the original unchanged batch; newer edits/projects remain protected by the leave guard. |

## Documentation Impact Matrix

| Document | Impact |
| --- | --- |
| This plan and Chinese companion | Track scope, decisions and observed completion. |
| UI design system, English/Chinese | Update the parameter debugging interaction and organisation configuration contracts. |
| OpenAPI contract | Regenerate/check if the configuration concurrency precondition changes the published contract. |

## Documentation Update Gate

Update both language companions for changed durable behaviour. Keep local unit/component, PostgreSQL and browser evidence separate. Run the repository's affected selector and required static/build/docs checks; report unavailable checks rather than claiming acceptance. Do not replace visual baselines or weaken required checks.

## Verification

Implementation is complete; the local full selected regression was not green. The implementation evidence below was collected in the isolated worktree based on `24b5bc2f0`. The user subsequently requested a PR and merge after passing CI for this rendered candidate. Current delivery head, CI results and merge status belong in that PR; local evidence is not deployment evidence.

| Evidence | Observed result |
| --- | --- |
| Full frontend, selector command using `vite.config.ts` in mock mode | Earlier full pass: 505 files / 4595 tests passed. Final-source related pass: 11 files / 167 tests passed, including pending distil/promote edits and project switches. |
| Full server, selector command in mock mode against owned PostgreSQL on port 55443 | 650 files passed, 6 failed; 5490 tests passed, 21 failed, 12 skipped. Failures identify a fixed lane905 port requirement, missing dt-validate, and evidence capture rejecting mock mode. |
| API-mode server follow-up with the pinned toolchain | 27 files / 262 tests passed: the complete dts-reload module plus the five environment-affected release readiness/evidence files. A new task-owned pgvector container on the required port 55438 then passed the remaining canonical Agent file, 13/13 tests. These follow-ups resolve the six initial failed-file paths under their required environments; the original full mock-mode result remains recorded above. |
| Full scripts, selector command in mock mode | 147 files passed, 9 failed; 2780 tests passed, 22 failed, 18 skipped. PostgreSQL/Docker three-store/target rehearsal prerequisites are absent or point to a different store. The operation-evidence mock/API mismatch passed on API-mode follow-up (37 tests). |
| Full Bridge | 21 files / 142 tests passed. |
| Static/build/docs | Changed-file ESLint and affected TypeScript checks passed; build passed (existing large-chunk warning). UI standards passed. Documentation governance and database-schema artifact checks passed against owned PostgreSQL. |
| Independent review | Concurrency/CAS/context/leave-guard review completed. Detector and pending distil/promote findings were fixed with regression cases and independently re-reviewed; no remaining P1/P2 in the reviewed scope. |
| Native quality fallback | Full quality was attempted with snapshot updates disabled. The accessibility phase passed (29 including warmup), then the unrelated home baseline expected 1440×900 while the current main-content capture was 1440×812. The run was interrupted without changing baselines. A subsequent layout attempt exposed a local navigator-width override; it was removed to retain the shared geometry contract. The final related consistency/compact/responsive follow-up passed 18/18. This does not replace the uncompleted full quality fallback. |
| Full native business acceptance | All 63 specs / 276 cases were selected: 223 passed, 12 failed, 28 skipped and 13 did not run; 29.8 minutes. Relevant debugging-admin (5), reload deployment/handoff/promotion (4), and reload-to-knowledge (1) cases passed. Seven failures stopped at the required Catalog port check. The other five were two unexpected validation audit records in configuration/rollback scenarios, two unavailable simulator-target detections (409), and zero proactive Xiaoze suggestions. Their causes are not established as regressions from this change. |
| Native environment follow-up | The self-hosted canonical reload handoff/preflight/promotion/re-entry/product-review case passed in the task-owned port-55438 database (1/1). The other six blocked Catalog specs passed 22 tests, with 4 existing skips, in the same owned cluster. This closes the seven initial Catalog environment failures and the cases blocked by their setup; it does not relabel the full run as green. The five other failed cases remain unresolved. |

API-mode browser observations cover `/dts-reload` and `/debugging-admin` at 1440×900, plus the candidate list at 1280×800. Confirmed validation, baseline/batch differences, project/route leave cancellation, successful real API preflight, immediate history refresh, runId links, filter reset, Escape/focus return, and an operable log select with the shared sticky save bar. Configuration preview edits were discarded. The final compact table measured 674px for both available width and scroll width, with complete row actions. Screenshots are retained locally under this task's visualization directory. A clean reload produced no new console errors; earlier development hot-reload dependency-array warnings were not treated as runtime acceptance failures.

The user's follow-up about the floating selection count was fixed by removing the primary-action slot's duplicate automatic margin only within this taskbar. API-mode checks at both desktop widths confirmed a 12px count-to-button gap with no page overflow; UI standards and diff checks passed, and the browser reported no console errors.

The local toolchain reuses installed dtc/fdtoverlay 1.8.1 and dtschema 2026.6; the required version check passed. The task-owned Catalog container is `wiseeff-frontend-ui-20261015-catalog-postgres`, separate from all existing containers, with databases `wiseeff_lane_898`, `wiseeff_lane_905` and `wiseeff_lane_810`. Native environment follow-ups use unmodified tests that host their own disposable runtime, with the shared warmup disabled because that shared runtime is not used. No real Bridge/device deployment or recovery was exercised.

During PR delivery, CI run `38848493780` produced a single Linux `/dts-reload` light replacement. The human explicitly approved that exact candidate image before its supplied patch was applied. No other baseline, tolerance or masking changed. The native operation-column fixture also retained a stale 96px expectation and an unrelated text button; it now checks the intended 64px column with the production 32px icon-action class, preserves centering, and additionally checks the usable button dimensions. The focused browser check passed 2/2 including warmup; final CI and merge status remain in PR #1206.
