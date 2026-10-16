# Shared UI contracts and verification feedback

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-10-15-ui-contract-verification.md)
> Status: baseline frozen; implementation candidate checkpoint recorded below; full CI, trusted diagnostic activation and measured outcomes pending. #1187/#1199 remain open.
> Owner: [#1187](https://github.com/tzrea1-Q/WiseEff/issues/1187); baseline [#1188](https://github.com/tzrea1-Q/WiseEff/issues/1188). Observed 2026-10-15 UTC.

## Frozen scope and remaining work

GitHub `main` was rechecked at `68f79c59702d5a914a734c9dd02dc6c7b7ec942e`. It contains [#1186](https://github.com/tzrea1-Q/WiseEff/pull/1186), whose final head was `edb67dc74edb386088ebd927c084df2b24b156b8`; its tree equals the merge tree. This snapshot is a baseline, not permission to reset later changes. The accepted spec owns requirements; this pair freezes the starting inventory and measurements, rather than creating a new run ledger.

| Existing capability to retain | Concrete remaining gap / owner |
| --- | --- |
| Radix single-select, shared menu/filter skin, outlined row actions; 60 native-select replacements and unified node editing already delivered | Manual modal-layer flags and caller knowledge remain. Automatic ownership/sizing trial #1189; compatible migrations #1190/#1191; remove old interface #1192. Do not redo #1186. |
| API browser consistency already checks select alignment, feedback toolbar, topbar and node-filter geometry | Extend existing scenarios for real modal hit targets, Escape/focus and supported nested popups; no route × theme × state multiplication. #1189–#1192. |
| Shared interaction preparation waits for the synchronization banner to disappear | Banner absence is a CSS proxy, not an explicit loading/ready/error contract; the transition itself is not tested by merely waiting. #1193. |
| Impact selection, conservative fallback, isolated browser runner, phase timing and baseline-review tools exist | Trace CSS/fixture/cross-route dependencies and expose actual changed-file static coverage. #1194/#1196. Local selection remains non-authoritative for CI. |
| Existing lint/UI ratchet and real Merge bar | Prevent new raw native selects in migrated surfaces (#1195); no subjective aesthetic lint or reduced CI coverage. |
| Immutable sanitized evidence and workflow-context-only bootstrap diagnostic | Accepted trusted compact index/publication (#1197, coordinated with #828), then navigation/status guidance (#1198). Never copy raw candidate text into bootstrap diagnostics. |
| Session-owned PostgreSQL regression, controlled third clone and cleanup cases | Source audit found no demonstrated missing behavior requiring a new database rewrite. Evidence distinction below; extend only for a concrete reproducer. |

## Consumer ownership

Inventory at the frozen tree: 31 production TSX modules mention `withinModal` (including primitives and forwarding wrappers; this is not a count of JSX calls). The following rows assign all discovered consumers of SelectControl/DebugAdminSelectControl, RowActionMenu, ModuleTreeSelect, MultiSelectDropdown and direct Select primitives. Re-scan at implementation time; newly discovered callers join their domain owner. A filename denotes its existing module, not a new abstraction.

| Owner | Consumers / dependencies |
| --- | --- |
| #1189 shared expansion; #1192 contract | Common `SelectControl`, `RowActionMenu`, `ModuleTreeSelect`; `MultiSelectDropdown`; UI `select`, `dialog`, `sheet`; common `ModalDialog`; layout `AdminListPage`. Radix Select/Menu portals and ModuleTreeSelect's optional body portal must inherit ownership across portals; MultiSelectDropdown is inline. ModalDialog also portals to body. Preserve dismissal, inertness, focus and scroll behavior. |
| #1190 root/account/initialization | `App`, `NodeDebuggingPage`, `UserPermissionsPage`, `ProjectParameterInitializationWizard`. The project initializer belongs here; parameter import belongs to #1191. |
| #1190 admin and wrappers | Admin `AuditWorkspace`, `CreateDebugParameterDialog`, `DebugAdminSelectControl` (alias), `DebugModuleManagementDialog`, `DebugModuleMoveDialog`, `DebugNodeEditorDialog`, `DebugParameterBindingsDialog`, `DebugParameterDefinitionDialog`, `DebugParameterLibraryTable`, `LibrarySelectFilter`, `ModuleDefinitionForm`, `ModuleManagementRowActions`, `ModuleManagementTreeRows`, `ProjectAdminFormDialog`, `ReloadConfigurationAdminPanel`. Forwarding wrappers retain compatibility until both batches finish. |
| #1190 logs/feedback | `LogsPage`, `FeedbackAdminDrawer`, `FeedbackAdminPage`, `FeedbackDialog`. |
| #1191 parameters/governance | `ParametersPage`; Catalog `CatalogPage`; governance `DefinitionEditorBody`, `ProposalPanel`, `PublicationDialog`, `RegistrationDialog`, `ReviewResolutionDialog`; review `CanonicalBatchSubmitDialog`, `CanonicalMemberRemovalSubmitDialog`, `ReviewInbox`; parameter-home `AnalysisContextControls` (direct UI Select). |
| #1191 import/topology | Import `ImportReviewCard`, `steps/StepSourceAndProject`; topology `DtsBindingCompareDialog`, `DtsBindingDraftTray`, `DtsNodeEnablementDialog`, `ModuleAttributionTree`, `ModuleMoveDialog`, `ValueShapeFields`; parameter-admin-next `CanonicalSubjectPlacementPanel`; `DtsReloadPage`. |
| #1191 configuration workbench | `ProjectConfigurationWorkbench`, `WorkbenchCandidateActivateDialog`, `WorkbenchCanonicalConflictDecision`, `WorkbenchCanonicalManualSyncDialog`, `WorkbenchCommandBar`, `WorkbenchInspectorPanel`, `WorkbenchRevisionGate`, `WorkbenchSourceRollbackDialog`, `WorkbenchSourceTree`. |

Styles/DOM dependencies are part of each migration: shared `select-control.css`, `row-action-menu.css`, global/pilot styles, `data-slot="select-trigger"`, `.dropdown-trigger`, `.row-action-menu`, and the old modal classes. #1192 owns final removal of shared obsolete selectors; domain tickets update their consumers without breaking the other batch.

Existing fixture/test owners:

- #1189/#1192: common SelectControl/RowActionMenu/ModuleTreeSelect/MultiSelectDropdown/selectionMenus, `compactControls`, shared consistency-style tests; quality consistency collector and accessibility/visual/compact scenarios. Reuse current fixtures and phase timings.
- #1190: initializer, admin module styles, row actions, project table layout, log upload/primary-action fixtures; debugging-admin/simulator, logs and notifications acceptance. Stylesheet fixtures must load the shared CSS; keyboard helpers must close menus before continuing.
- #1191: parameter import source/review fixtures; parameter-home, parameters, DTS import/wizard acceptance and configuration-workbench scenarios; preserve cross-route navigation and role flows.
- #1193: shared `prepareInteractionSurface` and every current navigation/reload consumer (debugging-admin/simulator, logs, notifications, parameter-home, parameters, import DTS and import wizard); keep intentionally loading/error tests separate. Quality readiness helpers are sibling consumers to inspect, not authority to replace their domain settlement with a blanket wait.
- #1196: impact/browser maps and isolated runner; `quality-consistency`/visual-mask script tests and user-guide capture consume shared DOM/quality behavior. UI/CI policy remains unchanged.

## Frozen CI observations

Definitions are the spec's: `T_green` is creation to successful required Merge bar plus accepted required jobs/artifacts; `T_exec` starts at the first required job; `R_total` sums non-skipped job execution across every attempt, including failures/cancellations. Overlapping jobs are compute, never wall time. Below, all inspected runs have attempt 1 and `ubuntu-latest` labels. Unknown cache/image details remain unknown; these rows alone do not establish matched warm/cold cohorts.

| Cohort / run | Head | Result | Initial queue / T_exec / T_green (s) | R_total (job-s) |
| --- | --- | --- | --- | --- |
| Full-acceptance PR [38710188830](https://github.com/tzrea1-Q/WiseEff/actions/runs/38710188830) | `edb67dc74edb` | success | 2 / 1300 / 1302 | 8659 |
| Ordinary PR [38668145955](https://github.com/tzrea1-Q/WiseEff/actions/runs/38668145955) | `0184fee20355` | success | 3 / 670 / 673 | 4165 |
| Main [38675798011](https://github.com/tzrea1-Q/WiseEff/actions/runs/38675798011) | `3b399cb2361c` | success | 3 / 1109 / 1112 | 8388 |
| Current main [38713055282](https://github.com/tzrea1-Q/WiseEff/actions/runs/38713055282) | `68f79c59702d` | failure | 2 / 1326 to failed gate / unavailable | 8477 |
| Earlier ordinary PR [38664065226](https://github.com/tzrea1-Q/WiseEff/actions/runs/38664065226) | `e391fd9cc787` | success, scheduling-change reference | 3 / 809 / 812 | 4524 |
| Earlier main [38659845353](https://github.com/tzrea1-Q/WiseEff/actions/runs/38659845353) | `1cff8a639139` | success, pre quality rebalance | 3 / 1209 / 1212 | 8201 |
| Earlier nightly [38618073666](https://github.com/tzrea1-Q/WiseEff/actions/runs/38618073666) | `88136adda68f` | success, pre backend/quality rebalance | 4 / 1279 / 1283 | 8910 |

The first three are prospective references, not interchangeable cohorts: ordinary PR skipped native L2 workers; full PR/main executed four native shards, two backend shards and four quality lanes, with smoke/L1 and required aggregates. Minimal-upgrade and target-host jobs were skipped, not proved. Source/test inventory grew in #1186. The successful full PR's base is `3b399cb2361c365b57842bdeb28de68e17219625`; current main has that first parent and final PR head as second parent. Earlier scheduling changes cannot be pooled as current-topology samples. Current-topology reference counts are ordinary PR 1, full PR 1, main 1, nightly 0; cold/warm classification and exact selected-inventory equivalence still need matching. No descriptive median (minimum 5) or P95 (minimum 20 per side) is established.

Bounded logs establish npm, DTS-toolchain and Playwright Chromium 1.59.1 **cache hits** for the full PR's critical native shard 3 and current main's failing native shard 1. Other workers, lint cache and older rows were not classified; this partial observation cannot label the entire run warm. Reproduce metadata from Actions run and jobs APIs (`per_page=100`), preserving run/attempt/head, job labels and all step timestamps; check attempt count before summing. Record remaining cache hit/miss, runner image and native receipts/selected inventories in the implementation PR. Do not infer warm caches from a short install. Quality reports already attach navigation/readiness/axe/capture timings; these internal phase totals were not downloaded or claimed here. No broad artifact retrieval or new CI was needed for this freeze.

### Setup, execution and finalization reference

For full PR 38710188830, creation was 09:04:00Z; Detect started 09:04:02Z; the critical native shard 3 started 09:04:50Z, completed 09:25:18Z; Merge bar completed 09:25:42Z. Terminal workflow metadata updated 09:25:43Z (1303s), distinct from `T_green` 1302s. Critical shard: setup through Gate0 start 83s; owned Gate0 1119s (includes its owned runtime setup); safety/finalizer 15s; full upload 5s; diagnostic publication/settlement 1s; remaining post/cleanup/terminal interval 5s. Shard completion to Merge bar 24s includes aggregation/queue, not test execution. Queue before each later job is included in wall time; no separate fleet-wide queue claim is made.

Quality gate step seconds for visual / accessibility / consistency-1 / consistency-2 were **228 / 422 / 448 / 704**. Their dependency-install steps were 20/26/14/26s, Chromium installation 10/13/11/13s, migration/seed 61/64/55/64s and evidence uploads 2/1/2/4s. Static/build job: build 71s, UI ratchet 1s, lint 43s. These step intervals are not browser-only test durations; use existing phase reports for the ≤30s browser sub-budget. All are historical single observations, not promised performance.

### Failures, cancellation and delivery cost

The #1186 delivery entered CI at 07:36:44Z and reached green at 09:25:42Z: **6538s**. Seven logical runs, one attempt each, cost **36935 job-s**, including **10826 job-s** in four cancelled runs. Final green alone accounts for 8659 job-s; two failed runs account for 17450 job-s. Preserve these costs instead of reporting only the final green. Wall intervals overlap and must not be added. User-decision waiting versus active/local work was not measured by Actions and remains unknown here.

| Earlier run | Outcome | R_total (job-s) |
| --- | --- | --- |
| [38699919019](https://github.com/tzrea1-Q/WiseEff/actions/runs/38699919019) | cancelled | 59 |
| [38699920829](https://github.com/tzrea1-Q/WiseEff/actions/runs/38699920829) | cancelled | 392 |
| [38700106097](https://github.com/tzrea1-Q/WiseEff/actions/runs/38700106097) | cancelled | 9163 |
| [38702320985](https://github.com/tzrea1-Q/WiseEff/actions/runs/38702320985) | cancelled | 1212 |
| [38702778746](https://github.com/tzrea1-Q/WiseEff/actions/runs/38702778746) | failed | 8507 |
| [38706323333](https://github.com/tzrea1-Q/WiseEff/actions/runs/38706323333) | failed | 8943 |

Current-main failure is bounded, separate evidence: [job 116349220710](https://github.com/tzrea1-Q/WiseEff/actions/runs/38713055282/job/116349220710), native shard 1/4, failed the canonical-dashboard case “counts active bindings and follows draft, rejection, approval and deletion” at a `toHaveURL` assertion. The second inventory row reports browser-command failure propagation, not an independent second defect. L1 and quality succeeded; native aggregate and Merge bar failed. Product versus harness cause remains **unknown** without a controlled reproduction/trace; this is not proof of a new readiness defect, a flake, or healthy current main. No unrelated repair or rerun was performed. #1199 retains this risk and excludes the run from green statistics.

## Database evidence retained

The current `server/testing/testDatabase.test.ts` scopes advisory-lock observations by unique `PGAPPNAME`, holds a legitimate third real clone while checking callback ownership, propagates readiness failure with `Promise.race`, and releases both gates before `Promise.allSettled` cleanup. The separate exclusive-clone case checks callback and connection-setup failure cleanup; lock helpers have controlled borrowed-lease/contender cases. These already-delivered assertions must remain. The failed global “no lock exists” assumption is not a new product lock defect.

#1186's final CI backend shard 2 succeeded; earlier local reporting recorded 32 PostgreSQL tests. Those are **historical** passes. This baseline task inspected current source and CI metadata only; it did not rerun PostgreSQL or claim new database/browser acceptance. No demonstrated additional ownership gap was found in the touched cases/helpers. A later concrete reproducer may justify a scoped extension; absence of a new run is not a new pass.

## One cumulative budget and reporting contract

| Metric | Fixed initiative-wide bound |
| --- | --- |
| Matched T_green median | increase ≤5% **and** ≤60s; descriptive comparison needs ≥5 successes |
| Matched T_green P95 | increase ≤10% **and** ≤120s; ≥20 observations on each side; use nearest rank `ceil(0.95 × n)` |
| Full-coverage R_total median | increase ≤5%; include failed/replaced work separately |
| Added browser / static work | ≤30s browser execution in an existing affected quality lane; ≤10s static/scripts execution in its existing job |
| Safe failure index | ≤5s local processing per failed shard and ≤256 KiB; preserve trusted publication limits |

Every ticket compares its cumulative net effect against this same frozen profile, never the previous ticket's enlarged allowance. Reuse normal candidate CI, warm scenarios and existing reports. Record matched phase deltas and extra local verification time in the PR; metadata/log reads add no CI jobs or runner seconds. This baseline added no test execution. Sampling allowance for the **whole initiative** is at most one dedicated base/head full-CI pair; none used here. Accumulate normal runs rather than run a sampling campaign. Unknown cache/inventory/topology or insufficient sample counts yields provisional/observation-pending; do not claim the budget statistically met or waive it. Preserve required checks, assertions, retries/timeouts, cleanup and human image approval.

Record three independent states in the existing implementation PR/report: **effect-approved** (specific human approval), **affected-regression-complete** (actual commands/counts and missing evidence), **merge-ready** (current head's required checks/artifacts/review). UI approval is not merge evidence; a merged implementation is not measured-outcome completion. #1199 owns the normal-run quality/outcome window and reports unresolved current-main acceptance separately. No new approval service or per-run evidence ledger.

## Implementation outcome checkpoint — 2026-10-15

#1188–#1198 have candidate source implementations on the integration branch, through `f686ee0f9da7ff8dc547f55d8138c87945dacbfc` before this checkpoint. Controls infer popup ownership, consumers no longer pass the retired flag, readiness is explicit and domain-scoped, and the normal entry points check actual changed-file coverage. Compact-index and navigation code (#1197/#1198) is implemented; accepted-base trusted publication/activation and positive two-minute availability remain **pending**. This is not a declaration that the complete spec is accepted. #1199 and parent #1187 must remain open while required outcome evidence is missing.

| Metric / protection | Raw before → candidate observation | Acceptance status / smallest remaining step |
| --- | --- | --- |
| Full PR T_green / R_total | Frozen 1302s / 8659 job-s, one historical observation → no full candidate CI yet | `observation-pending`; run the normal reviewed final candidate once, record its actual required gate/artifacts in the PR, then accumulate comparable natural samples. |
| Ordinary PR / main / nightly statistics | Frozen reference counts 1 / 1 / 0; cache/inventory matching incomplete → no new application-coverage successes | No matched median or P95. Docs-only [run 38723428695](https://github.com/tzrea1-Q/WiseEff/actions/runs/38723428695) attempt 1 cost 115 job-s (6 executed/9 skipped), gate wall 97s (metadata update 98s); application/backend/browser were skipped, so retain its delivery cost without filling these cohorts. |
| New nodes quality protection | Same route/themes: command 14.169s → 15.341s; case execution excluding warmup 6.003s → 7.941s (+1.938s) | Provisional local sub-budget evidence, not lane/CI budget acceptance. Final contract check: 3 passed/14.4s (warmup 2.6s, light 4.0s, dark 4.3s). |
| Actual added static/UI guard | Quiet 89-file check at `22ba53d7`: 8.076s; UI ratchet 0.547s → 1.065s (+0.518s); provisional combined guard 8.594s | Bounded local diagnostic observation against ≤10s; inventory grew afterward, so final-range/Hosted cost remains to be checked. Do not compound budgets per ticket. |
| Complete native uncached lint entry | Baseline 16.03s → candidate 28.016s (raw +11.986s) | Provisional observations, not proof of overall CI budget compliance. Preserve native work and measure the same final inventory/profile in normal CI. |
| Contended measurement cost | 53.31s total / 18.879s helper during concurrent API execution; native lint phase alone ≈34.43s and ≈10.4 GiB swap observed | Excluded from matched latency comparison because of observed contention; retained as additional local measurement cost. No CI sampling run was created. |
| Readiness / feedback / import API | New pointer/loading/error/retry regression: 3.017s plus 1.877s warmup, command 34.449s; existing feedback 2 passed/21.138s; import 2 passed/32.461s | Actual isolated local API evidence. The new pointer case crosses completion; strict diagnostics remain. No Hosted/device claim. |
| Real isolated selection entry | At `8ab465af`, UserPermissionsPage selection: static 1.898s; quality 61 passed in 162.946s including setup/seed/teardown; acceptance 43 passed, 4 skipped in 111.101s | Selected source only. Four password-capability cases and Linux visual on macOS were explicitly skipped. Whole-branch selector retains both full-fallback flags; no whole-branch acceptance substitution. |
| Safe index cost / activation | ≤256 KiB and failure/rejection contracts have focused script checks; no active accepted-base publisher measurement yet | ≤5s processing and two-minute navigation outcome remain pending until legitimate trusted publication. No candidate-controlled diagnostic promotion. |
| First-full-green rate / repair loops | One historical #1186 delivery, 7 runs; current normal full-candidate deliveries 0 | No ≥20-delivery outcome window; ≥80% green-rate / ≤0.3 confirmed harness loops per delivery and improvement comparisons remain pending. |

Additional bounded baseline logs identify full-PR static job 116339697048 as Ubuntu 24.04 image `20261004.327.1`, with primary npm and ESLint cache hits. Candidate ESLint configuration changes the cache key, so its cache profile must be read from actual CI logs rather than assumed comparable; no dedicated baseline pair was triggered.

The long-label API check caught a **product focus defect before PR full CI**: dependent asynchronous loading disabled a select trigger before Radix focus return (2 failed/1 passed, 33.2s local command). Shared deferred focus restoration corrected it without per-caller busy workarounds and preserves user-moved focus. Final light/dark screenshots were inspected at 1440×900. This is source protection evidence, not a CI-only defect or a confirmed harness flake. Earlier new-readiness attempts failed on an ambiguous test locator and an undeclared deliberate transport fault; the setup was corrected to a specifically declared GET/503 response without relaxing diagnostics. These local attempts remain cost; they do not establish statistical flakiness.

Current-main acceptance is still the frozen `68f79c5` failure in run 38713055282, with root cause unknown; PR/draft or selected local success cannot change that status. Independent review, final build and exact final-head CI are coordinator-owned pending evidence at this checkpoint. No production/device execution is established; an unavailable local Bridge exercised graceful no-device behavior. Local verification time was not fully instrumented across concurrent workers: preserve the available raw durations in the existing PR/report, state the missing total, and never sum overlapping command walls as delivery elapsed time.

The small pure `ci-outcomes` scripts helper checks arithmetic on supplied observations: sum every job attempt including failed/cancelled attempts, retain missing/invalid times as unknown, separate cohorts by event/coverage/runner/topology/cache, and require both sides' 5/20 sample thresholds. P95 uses the frozen nearest-rank method; even-sized medians average the central pair. Unknown cohort fields suppress comparisons; missing cost suppresses aggregate R_total and its median comparison rather than becoming zero. The helper neither collects runs nor grants acceptance. Fixed-input tests are not real CI samples. No collector, dashboard, CLI, per-run ledger, benchmark pipeline or extra sampling campaign was added. The initiative's dedicated full-CI pair allowance remains unused.

Further natural CI measurements belong in the implementation PR/report after final-source review; do not roll CI again merely to commit its run number into this frozen checkpoint. A budget breach requires optimizing duplicated work or scheduling while preserving inventory, never a threshold, assertion, retry/timeout or coverage relaxation.

## Documentation Impact Matrix

| Documentation | Impact / owner |
| --- | --- |
| This English/Chinese plan pair and Plans index | #1188 freezes scope, ownership, observations and shared budget; #1199 adds outcome summary without rewriting historical results. |
| Frontend guide and UI checklist, both languages | Component contracts/examples with #1189/#1192; readiness #1193. Existing PC/API obligations stay. |
| Verification matrix, contributing/workflow guides, both languages | Coverage/selection usage #1194/#1196; status/diagnostic navigation #1198. Retain #828 trust boundary and shadow-disabled policy. |

## Documentation Update Gate

Maintain the English/Chinese pair together; check relative links and existing documentation governance before commit. This documentation-only baseline requires no application build, browser, fresh PostgreSQL run, new workflow or prose-mirroring test. #1188 is frontier-ready when the source inventory, run identities, unknowns and fixed budget are recorded and checked; it does not require five/twenty manufactured samples. Implementation and measured outcomes remain separate pending states.
