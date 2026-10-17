# Project parameter workbench refinement

> Chinese: [项目参数工作台整改](../../zh-CN/exec-plans/active/2026-10-16-project-parameter-workbench-refinement.md)

Status: **implementation complete; delivery acceptance tracked in the PR**. All 21 findings have local implementations and focused checks. Real API desktop checks, the DTS submit/review/restart/delete flow, JSON review/deletion, exact comparison/history, scoped accessibility, static checks and build passed; independent reviews found no remaining issues. Initial broad local runs encountered failures and were interrupted under heavy shared-host load, including legacy topology upload timeouts and the dedicated Catalog lane requirement. These local gaps are not full-suite acceptance; the delivery PR records required checks for its final pushed head. The user authorized GitHub delivery and merge after CI passes. This plan adds no approval step and makes no deployment claim.

The follow-up demo DTS work completes node and label definitions in all three project boards and vendor sources, preserves all 360 board business occurrences and their identities/normalized values, and compiles six actual sources without a synthetic companion. Seed integrity rejects undefined references while ignoring reference-like comments and strings. A fresh isolated local database loaded M0–M3 with 120 canonical bindings per project and zero resolution diagnostics; the earlier database and two drafts remain preserved. Focused seed checks passed 66 tests, alongside the raw/effective DTB compile, generated-artifact checks, static checks, documentation checks and build. The real API workbench at 1440×900 shows the completed source and no dangling-overlay notice. These are local results; Hosted acceptance is recorded in the PR.

## Scope and recovery

The user requested every finding from the project parameter workbench audit to be fixed, including merging view/edit and polishing all child surfaces. Work only in `codex/frontend-ui-20261016`, based on `56ef3d941`, in the isolated worktree. The primary checkout stays preserved. Runtime is real API mode with task-owned local services; production, target-device writes and deployment remain outside this task.

Read [Frontend](../../FRONTEND.md#unified-project-parameter-details) for the durable interaction contract. The coordinator owns integration, final verification and actual commit/PR status. Resume from the current diff and tests; preserve each worker's disjoint edits.

## Finding-to-implementation checklist

All rows require the stated acceptance before closeout; implementation presence alone does not mark a row accepted. Paths are relative to the repository.

| Finding | Implementation owner/seam | Required acceptance |
| --- | --- | --- |
| Separate view/edit pages and competing row actions | `DtsBindingDetailDialog`, `DtsParameterWorkbenchTable` | One detail entry; configuration/history/compare/source tabs; keyboard access and focus return. |
| Saving one draft loses sibling input or interrupts a batch | `DtsParameterWorkbench`, `ApiProjectTopologyWorkspace` | Edit two bindings, save one, retain the other; save failure/retry preserves both. |
| Resume loses server target/reason/delete action | DTS workbench and `JsonBindingPanel` | Reopen a saved set/delete draft and restore exact target, reason and action. |
| Valid boolean properties appear empty or cannot be saved/submitted | `formatDtsRawValueForUi`, detail, tray, initialization merge | Typed boolean/empty values round-trip with empty raw text; unknown blank remains invalid; raw labels never enter payloads. |
| Opening an editor creates false dirty work | DTS/JSON local edit baseline | Open/close without edits creates no draft/leave warning; reverting to baseline clears dirty state. |
| Same-name parameters hide instance identity | DTS/JSON table identity columns; initialization source locators | Distinguish two equal keys in different devices/configuration instances before editing/selecting. |
| “Unmapped” conflicts with valid business attribution | `buildDtsWorkbenchRows`, table badges | A missing matching rule does not claim missing module attribution or bypass a real warning. |
| Search and module scope are unclear | DTS/JSON workbench scope bars | Current module path, visible/total result count, active search/filter and one reset remain understandable. |
| Single editing is buried in batch forms and dangerous actions | Unified detail/editor; `DtsBindingDraftTray` | One current value/target/reason; reasoned deletion; batch selection/submission stays in tray with original ownership. |
| Repeated names, empty cards, borders and technical IDs dominate | Detail layouts and shared tokens | Readable hierarchy, units/constraints, hidden absent fields, bounded source text, fixed usable footer at desktop widths. |
| History repeats IDs and omits reason/actor | `DtsBindingHistoryDiffDialog`, canonical history adapter | Time/difference/reason lead; actor shown only when available; unknown metadata stays unknown; technical provenance is folded. |
| Comparison repeats prompts and conflates source instances | Embedded `DtsBindingCompareDialog` | Exact project/configuration/binding selection, clear baseline/target, previewed quote; confirm replacing dirty input. |
| DTS source lacks visible provenance/location | DTS detail/source viewer | File, version and read-only context visible; locate parameter/source without losing local edits. |
| Node enablement is hard to discover or lacks impact | `DtsParameterWorkbench`, `DtsNodeEnablementDialog` | Contextual state/action and affected parameter range; node review boundary retained. |
| Personal history reserves empty detail space and uses reviewer language | `ReviewInbox`, `ParameterSubmissionsPage` | Empty/unselected full-width list; personal scope/copy; no duplicate project/author columns; reviewer behavior retained. |
| Initialization shows technical names, unknown risk and false boolean uncertainty | Wizard, initialization DTO and canonical source read | Pinned-revision name plus key; unknown risk visibly unassessed; typed presence valid; search exact source instances. |
| Initialization details are below the fold; review shows only a count | Wizard and `project-parameter-initialization.css` | Detail visible beside table and focus returned; final snapshot lists each selected parameter/source/value; four steps/cancel/error guards retained. |
| JSON has duplicate entries and different lifecycle feedback | `JsonBindingPanel` | One detail with configuration/history/source; read-only/pending states, saved restore, close/reopen retention and reasoned set/delete. |
| Draft tray lacks clear continuation and removal context | `DtsBindingDraftTray`, API owner | Current→target, reason, resume/remove and selected submit count; failed delete keeps draft and reports failure. |
| Refresh/format changes destroy active state | `ApiProjectTopologyWorkspace` mounted background refresh and format panels | Saving/reloading/changing format and asynchronous DTS/JSON arrival retain active input and panel identity; project changes ignore stale responses and use leave guard. |
| Inconsistent loading/error/empty/accessibility behavior | All affected components | Read-only account, pending save, error retry, validation failure, tab/keyboard operation and close focus are covered. |

## Execution and completion

1. Integrate the owned DTS/dialog/state, typed-value/JSON/history and initialization/submission slices. Completion: each row has code and a focused behavior check; preserve authorization, tenant isolation, source pins, review and audit invariants.
2. Run one coordinator-owned final affected frontend/server pass, changed-file static checks and required build. Completion: exact commands/results recorded in the final task/PR summary; unavailable or failing checks remain explicit.
3. Inspect real API routes and child states at `1440x900`, adding `1280x800` for layout risk. Completion: list/detail/tray, all DTS/JSON tabs, source, node enablement, initialization's four steps and personal history are operable; independent review findings are resolved or explicitly outstanding.
4. Update this plan's status only after acceptance. Completion: report remaining risks and actual commit/PR state; keep local, PostgreSQL, browser, Hosted and deployment evidence distinct.

## Documentation Impact Matrix

| Document | Change |
| --- | --- |
| `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` | Replace split view/edit descriptions; document local/server draft lifecycle, typed values, history/compare/source, initialization and personal tracking. |
| This plan and its Chinese companion | Recover scope, owners, acceptance cases and remaining coordinator work. |
| Existing API/schema documentation | Additive optional initialization `displayName` reads the immutable effective Definition revision; optional nullable history `actor` is shared by topology/Catalog response schemas and generated OpenAPI. No new route or changed write/review authority. |

## Documentation Update Gate

Keep both language companions consistent with the final source. Run documentation governance and relative-link checks after edits; use existing database-schema documentation checks when selected. Do not mark unrun browser/regression checks passed, fabricate evidence, update baselines to hide a failure, or infer deployment from local results. Documentation updates are part of the authorized implementation and do not introduce a user confirmation gate.
