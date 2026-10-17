# Parameter administration refinement

> Chinese: [整改计划](../../zh-CN/exec-plans/active/2026-10-15-parameter-admin-refinement.md)

Status: Implementation complete; full native/browser acceptance remains pending. Base: `38d47f2ff4ed95944b4f42bce30a50c126bd08d1`.
Scope: implement the user's 25-point administration audit in the isolated
`codex/frontend-polish-local-20261015` worktree. No production mutation,
permission expansion, automatic approval, deployment or baseline replacement.

## Acceptance checklist

- [x] 1. Editing correction inputs invalidates the frozen preview.
- [x] 2. Import Back preserves the preview and explicit item selection.
- [x] 3. Empty configuration sets have an executable, authorization-preserving initialization path.
- [x] 4. Read-only definition details include the complete readable specification.
- [x] 5. Definition editor protects unsaved input and pending submissions.
- [x] 6. Content publication exposes refreshable completion/failure state.
- [x] 7. Project request failure is distinct from missing project and offers retry.
- [x] 8. Administration name and navigation hierarchy identify the current task compactly.
- [x] 9. Catalog actions reflect permissions and review context.
- [x] 10. Definition navigation and columns prioritize recognizable business information.
- [x] 11. Definition detail prioritizes specification over internal identifiers.
- [x] 12. Selecting a module filters its subject/definition context.
- [x] 13. Module subpages avoid duplicate subject lists and refresh controls.
- [x] 14. Subject definitions link to existing definition details.
- [x] 15. Workbench selection and version information avoid redundant controls.
- [x] 16. Property inspection presents editing before secondary metadata.
- [x] 17. Conflicts view contains conflict work rather than duplicate session tasks.
- [x] 18. Administration surfaces use consistent tokens and density.
- [x] 19. Import parsing and completion communicate progress and the next destination.
- [x] 20. Identity correction chooses affected projects by name, only when relevant.
- [x] 21. Definition history is pageable/readable; identity history remains accessible after pending work clears.
- [x] 22. Publication selectors include all authorized pages.
- [x] 23. Projects support reversible archival and default filtering without losing history.
- [x] 24. Project navigation preserves list context and displays the project name.
- [x] 25. Current workflow language replaces stale implementation/retired-path instructions.

## Verification

Implementers own focused regression tests and changed-file lint/type checks;
the coordinator owns the integrated build, UI/static gates and real API browser
checks at 1440x900 plus a compact 1280x800 layout check. Use `test:impact` and
record both fallback flags; selection is not execution. Keep publication and
source-review permissions, frozen previews, stale evidence checks, audit,
tenant isolation and immutable history intact. Independently review any changed
authorization, migration, concurrency or destructive seam.

Existing acceptance ownership: `PARAM-ADMIN-IA-001`, `PARAM-ADMIN-DIALOG-001`,
`PARAM-IDENTITY-MAP-ADMIN-001`, `PARAM-IMPORT-DTS-FULL-001`,
`PARAM-IMPORT-REVIEW-META-001`, `PCAT-DEFINITION-DETAIL-001`,
`PCAT-TIMELINE-001`, `PCAT-READY-ACTIONS-001`,
`PCAT-CONFLICT-RECONFIRM-001`, `PCAT-DEFINITION-COLLECTION-001`,
`PCAT-DEFINITION-LIFECYCLE-001`, `PROJ-CONFIG-READ-001`,
`PROJ-CONFIG-CONFLICT-001`, `PROJ-CONFIG-READINESS-001`,
`PROJ-CONFIG-CUTOVER-001`, and `MOD-ATTR-TREE-001`.
Relevant browser specs are parameter-catalog*, parameter-topology,
parameter-import-dts-td035, hierarchical-modules and
project-configuration-workbench under `e2e/acceptance/`; the selector determines
the final affected inventory. New archival behavior must receive its own
operation/acceptance entry before implementation if no existing contract covers it.

## Documentation Impact Matrix

| Content | English / Chinese owner |
| --- | --- |
| Implementation checklist and verification limits | This plan and its Chinese companion |
| Current navigation, import and archive behavior | Closest user guide sections, both languages |
| Operation/acceptance ownership | Coverage and operation maps, both languages where maintained |
| Architecture and release invariants | Unchanged unless implementation proves a required change |

## Documentation Update Gate

Update applicable companions, inspect the complete diff and run `docs:check`
before marking this plan complete. Record actual passes, failures and skips;
do not claim Hosted, target-host, production or Linux visual acceptance from
local evidence.

## Module administration follow-up (32 findings)

- [x] M01. Navigation/container hierarchy
- [x] M02. Task-specific navigation
- [x] M03. Typography/information hierarchy
- [x] M04. Task actions and read-only guidance
- [x] M05. Compact searchable module tree
- [x] M06. Reveal selected deep module
- [x] M07. Consistent uncovered filter
- [x] M08. Synchronized tree/list scope
- [x] M09. Contextual module summary
- [x] M10. Readable module overview
- [x] M11. Compact subjects and useful filters
- [x] M12. Restore list context
- [x] M13. Preserve failed mutation dialogs
- [x] M14. Safe move destination
- [x] M15. Protect pending move dismissal
- [x] M16. Isolate placement requests
- [x] M17. Keep row failures local
- [x] M18. Refresh full confirmation evidence
- [x] M19. Disambiguate destination paths
- [x] M20. Protect dirty governance forms
- [x] M21. Supported target initialization
- [x] M22. Actionable discovery empty state
- [x] M23. Project-scoped discovery and honest search
- [x] M24. Recognizable observation identity
- [x] M25. Retry later pages in place
- [x] M26. Pageable and exact review links
- [x] M27. Executable explicit review destinations
- [x] M28. Keep proposal completion actionable
- [x] M29. Search/filter/sort historical registry
- [x] M30. Explain historical context and expose details
- [x] M31. Load only active tasks and guard requests
- [x] M32. Keyboard tree/menu behavior

## Results

All 25 implementation items are addressed; integrated verification is recorded below. `PROJ-ARCHIVE-001` has an operation/requirement entry and remains future coverage pending dedicated end-to-end evidence, rather than claiming complete operation acceptance from a partial manual check.

Independent review led to fixes for preview Select freezing, new-preview execution keys, transient publication-poll recovery, SPA leave protection, membership-preflight feedback, and conflict-request failure being reported as an empty queue.

Real API browser checks cover 1440x900 and 1280x800 layout, module filtering and definition deep links, read-only specifications, list-context returns, role-page project names, property editing and discard confirmation, focused conflicts, and archive/restore. Aurora was restored; database status and both project-status audit records were checked. Import reached a conflict preview and correctly blocked application: this seed lacks complete source pins. Catalog adoption keeps authoring/publication disabled; success states have component regression coverage, without claiming a successful publication in this environment.


### Initial 25-item candidate checks (before the module follow-up)

- Build, app/node TypeScript, UI standards and bilingual documentation checks passed. Changed-code ESLint reported zero errors and 35 warnings; the final import-copy file also passed separately.
- `test:impact` at the stated base reports `fullFallback: true` and `browser.fullFallback: true` (shared operation/navigation configuration and unmapped paths). It selected frontend/server/scripts/bridge plus 38 quality routes and 63 acceptance specs. This is selection, not a claim that all browser gates ran.
- The stable full frontend run passed all 507 files / 4541 tests; the final focused workbench run passed 84/84. The full Bridge suite passed 21 files / 142 tests. These are mock-mode test results, distinct from the real-API browser checks above.
- `acceptance:coverage` and `acceptance:operations` passed. These static inventory checks do not replace the pending dedicated archival end-to-end case.
- The full scripts suite failed: 144 files passed / 9 failed; 2722 tests passed / 22 failed / 18 skipped. Failures include required PostgreSQL configuration and isolated-database guards, missing object-store snapshots, unavailable Redis/target services, and rehearsal fixtures being created outside the fixed Docker container used by export. One operation-evidence test received the full run's explicit mock mode while expecting API mode; a focused rerun with API mode passed all 37 tests in that file. No infrastructure guard or test expectation was weakened.
- The full native server attempt was interrupted with exit 143 after observed failures and an idle cluster lease blocked further progress. Six Xiaoze cases reject this dev database port before fixture work (the dedicated test requires 55438 or its named CI lane); seven cases were skipped. A test held advisory key 4201659 in `postgres`, blocking migration replay; schema and offline MOD capture cases timed out. Server sources/config were unchanged. The owned process tree was stopped, and the lock count returned to zero. Do not relax the frozen lane precondition or call this native acceptance.
- Full Playwright quality/acceptance and Linux visual-baseline review were not run. Manual real-API checks are bounded to the affected PC surfaces, with no app-console errors observed. Source-pin-dependent import staging, Catalog authoring/publication success, target-host and production evidence remain unproven here. No publication activation, privilege expansion or baseline replacement was performed.
- Screenshot artifacts are in the current Codex task's local visualization directory: `refined-admin-final.png`, `refined-modules-compact.png`, `refined-workbench-property.png`, `refined-workbench-compact.png`, `refined-workbench-conflicts.png`, and `refined-import-preview.png`. Import created a non-applied preview only; the local session draft was discarded and the archived project restored.
- No commit, push, PR, merge or deployment. The primary checkout's existing topology-test modification and untracked `--help` remain untouched.

### Module follow-up implementation and evidence

All M01–M32 implementation items are addressed. Modules retain the shared navigator workbench; discovery and historical records have dedicated list views without an unrelated tree. Tree and subject query state survives URL navigation, and tree matches constrain subject subtrees. Canonical inventory arrives progressively with explicit partial-read scope and writes disabled until complete. Historical records expose read-only attributes without inventing a timeline.

The registration command now accepts an explicit new destination under a same-organization business parent. Target creation, required attribution projection, registration, placement and idempotency commit share the existing guarded transaction. Review resolution accepts an exact destination through the existing tenant/type resolver. No migration, production publication switch or legacy typed-write endpoint was changed. An independent review found no remaining transaction/tenant/type/idempotency blocker. Other independent findings (pending menus and stale review confirmation refresh) were fixed with regressions.

Native server verification: 4 files / 59 tests passed, including real PostgreSQL concurrent first initialization/replay, wrong organization/type parent refusal and deferred-constraint rollback. Frontend owners passed tree/maintenance 57 tests, final review 55 tests and progressive subject 16 tests; these overlapping focused counts are not a full-suite total. The full frontend run passed 509 files / 4579 tests. Subsequent bookmark-return cleanup and final copy/style adjustments passed their affected checks (15 navigation/mutation tests and 6 presentation tests); the final build and UI checks passed afterward. OpenAPI contract, app/node TypeScript and documentation checks passed. Full changed-code ESLint reported zero errors / 53 warnings before the last location-reset effect; the affected final MappingPanel lint reported zero errors / 3 warnings (one additional effect warning).

`PCAT-REGISTRATION-INITIALIZE-001` records the new operation as future browser coverage: component/native evidence does not substitute for a dedicated browser write/audit receipt. Both impact fallback flags remain true, selecting all four Vitest suites, 38 quality routes and 63 acceptance specs. Full native/server/scripts/Bridge and Playwright/Hosted/target-host runs were not repeated for this follow-up; previous environment failures above remain distinct from current focused acceptance. The default `acceptance:coverage` command currently fails because its existing browser JSON report (2026-10-15 09:37 local) contains 275 skipped tests; its ID/map inventories contain no missing or orphan IDs. The report was preserved, not removed to obtain green. `acceptance:operations` passed.

Real API browser checks at 1440x900 and 1280x800 covered tree/subject scope, the zero-coverage filter, deep selection after reload, module Back navigation, subject search/expanded parameters after returning from exact pinned definition details, read-only module details, historical search/details/numeric sorting, and discovery project selection/empty guidance. Screenshots: `module-refined-final.png`, `module-refined-compact.png`, `module-refined-registry.png`, `module-refined-discovery.png` in this task's visualization directory. These were read-only product checks; populated review/write flows remain supported by component/native evidence, not a claimed browser write. During integration an incorrect constant import caused transient Vite/HMR errors; the import was fixed before the final reload and verification. The branch remains uncommitted at the stated base, with no PR/push/deployment; the primary checkout remains untouched.
