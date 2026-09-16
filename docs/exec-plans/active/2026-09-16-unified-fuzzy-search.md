# Unified SearchField and fuzzy search

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-16-unified-fuzzy-search.md)

## Goal

Replace duplicated search-box markup and page-local `toLowerCase().includes(...)` filters with two decoupled primitives:

1. `SearchField` — the only search-input UI chrome.
2. A repo-native, domain-agnostic fuzzy search core plus explicit Search Profiles.

Do not put business filtering inside the input component. Do not replace provider-backed or literal-find engines with local fuzzy over the current page.

## Git & PR Workflow

- Scratch branch: `feat/unified-fuzzy-search` from latest `origin/main` (`a730c827b`)
- Risk class: R2 (UI workflow + domain search behavior)
- Stop boundary: targeted Vitest, `npm run typecheck`, `npm run build`, `npm run lint`, `npm run ui:check`, `npm run docs:check`, and playwright-cli browser verification. No GitHub PR from the implementation agent.
- Evidence: search-core unit tests, SearchField component tests, migrated page tests, browser checks at 1440×900 / 768×1024 / 390×844

## Public seam

| Layer | Location | Owns |
| --- | --- | --- |
| UI primitive | `src/components/common/SearchField.tsx` | value, chrome, clear, ARIA, keyboard passthrough |
| Search core | `src/lib/search/` | normalize, match, score, filter, tree ancestor preservation |
| Profiles | `src/lib/search/profiles.ts` | field lists and weights per business type |
| Pages | existing consumers | ColumnFilter, sort, pagination, provider, literal find |

No Fuse.js (or other search library). Local lists are hundreds to low thousands of rows; identifier punctuation and CJK substring matter more than typo-tolerant Levenshtein; a deterministic core is cheaper and fully testable.

## Architecture

```text
SearchField  ── UI only ──► parent state (value / onValueChange)
                                │
                                ├─ local structured ──► searchItems(items, query, profile)
                                ├─ tree              ──► filterTree / filterHierarchicalList
                                ├─ server / repo     ──► existing q / repository.search / submit
                                └─ literal find      ──► existing substring + next/prev
```

Matching model (per query token, against each field value):

1. exact (normalized or compact-identifier)
2. field prefix
3. token prefix (split on whitespace and `_-/:@.`)
4. substring
5. compact-identifier substring (`currentlimit` → `current_limit`, token length ≥ 3)
6. ordered subsequence, identifier tokens only, length ≥ 4

Query tokens (whitespace-split) are AND and may hit different fields. Fields are OR. Empty query returns every item in original order. Equal scores keep original index. Default `rank: false` so user/page sort wins; ranking is opt-in.

No pinyin. No Levenshtein.

## Checkpoints

| CP | Scope |
| --- | --- |
| CP-S0 | Inventory + this plan |
| CP-S1 | SearchField + search core + pure/component tests |
| CP-S2 | Pilot: ParametersTable / ParametersPage, DebuggingPage, NodeDebuggingPage, ParameterSpecLibrary, SpecReviewQueue |
| CP-S3 | Remaining local structured search (see matrix) |
| CP-S4 | Provider-backed and literal-find: Catalog, Audit, Knowledge, Logs raw text, DTS source find, workbench unified search, knowledge parameter-reference picker |
| CP-S5 | Delete unused search chrome CSS and page-local includes helpers |

## Inventory method

`rg` over `src/` for `type="search"`, `role="searchbox"`, placeholders/aria with 搜索/检索/查找/筛选, lucide `Search`, `searchQuery`, `.includes(`, `toLowerCase()`, `onSearch` / `onQueryChange`, `repository.search`, and server `q`.

27 UI search inputs plus several algorithm-only filters (no extra box) and one removed historical surface (`DtsSearchPanel`, gone with #240).

## Migration matrix

Legend: SF = SearchField UI. FE = local fuzzy engine + profile. Provider = keep existing engine.

| # | File / surface | Object | Current fields | Algorithm | Local / controlled / server | Page | Tree | Literal / full-text | SF | FE | Profile | DTO/API | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `ParametersTable.tsx` + `ParametersPage.tsx` | `ParameterRecord` | name, description, module; table also source | includes | local; page may control | table sort, no DataTable page | no | no | yes | yes | `parameterRecord` (name, explanation, description, module, modulePath, configFormat, sourceFileName, sourceNodePath) | no | `ParametersTable.test.tsx`, `ParametersPage.test.tsx` |
| 2 | `DebuggingPage.tsx` | `DebugParameter` | name, key | includes | local | no | no | no | yes | yes | `debugParameter` (+ description, module, modulePath, nodePath, bindings[].nodePath) | no | `DebuggingPage` tests if present |
| 3 | `NodeDebuggingPage.tsx` | runtime rows | name, key, description | includes | local | no | no | no | yes | yes | `debugParameter` | no | `NodeDebuggingPage.test.tsx` |
| 4 | `ParameterSpecLibrary.tsx` | `ParameterSpecLibraryRow` | propertyKey, attribution, driver, compatible, schema, valueType | includes | local | yes, resets on filter | no | no | yes | yes | `parameterSpecLibrary` | **data gap**: list DTO / `ParameterSpecSummary` has no description/documentation (detail only). Do not N+1. Catalog already searches those server-side. Follow-up if this library is revived. | `ParameterSpecLibrary` tests |
| 5 | `SpecReviewQueue.tsx` | review tasks | propertyKey, nodeName, driverModule | includes | local | no | no | no | yes | yes | `specReviewTask` | no | queue tests |
| 6 | `SpecReviewTaskDialog.tsx` | library picker | label, propertyKey, driverModule | includes | local | n/a | no | no | yes | yes | `specReviewLibraryItem` | no | dialog tests |
| 7 | `UserPermissionsPage.tsx` | `UserAccount` | name, email, username, title | includes | local | DataTable | no | no | yes | yes | `userAccount` | no | `UserPermissionsPage.test.tsx` |
| 8 | `LogAdminPage.tsx` table + `logAdminAnalytics.ts` | `LogRecord` | reportId, fileName | includes | local | DataTable 8 | no | no | yes | yes | `logAdminRecord` (add source, conclusion, logDomainName, analysisQuestion; **not** rawLines) | no | `logAdminAnalytics.test.ts` |
| 9 | `LogAdminPage.tsx` domain knowledge filter | `KnowledgeEntry` title | title | includes | local | n/a | no | no | yes | yes | `knowledgeTitle` (title, tags) | no | LogAdmin tests |
| 10 | `DebugParameterLibraryTable.tsx` + `debugAdminLibraryFilters.ts` | debug params | name, key, module, description | includes | local | DataTable 50 | no | no | yes | yes | `debugParameterLibrary` | no | `debugAdminLibraryFilters.test.ts` |
| 11 | `DebugNodeLibraryTable.tsx` | debug nodes | name, description, detailedDescription, module, binding paths | includes | local | DataTable 50 | no | no | yes | yes | `debugNode` | no | node library tests |
| 12 | `DebugModuleManagementDialog.tsx` + `moduleManagementTreeUtils.ts` | module tree | name, description, scope | includes + ancestor keep | local | n/a | **yes** | no | yes | yes | `moduleNode` | no | module dialog / utils tests |
| 13 | `ProjectAdminTable.tsx` | projects | name, code, id | includes | local | DataTable | no | no | yes | yes | `projectAdmin` | no | `ProjectAdminTable.test.tsx` |
| 14 | `FeedbackAdminPage.tsx` | feedback | title, path, description, submitter, **status/type labels** | includes | local | DataTable | no | no | yes | yes | `productFeedback` (drop status/type — ColumnFilter owns those) | no | feedback admin tests |
| 15 | `DtsReloadPage.tsx` + `DtsReloadCandidateTable.tsx` | reload candidates | displayName, propertyKey | includes | local | DataTable 10 | no | no | yes | yes | `dtsReloadCandidate` (+ description, module, nodePath, compatible) | no | `DtsReloadCandidateTable.test.tsx`, page tests |
| 16 | `ProjectParameterInitializationWizard.tsx` | source projects | name, code | includes | local | n/a | no | no | yes | yes | `projectAdmin` | no | `ProjectParameterInitializationWizard.test.tsx` |
| 17 | `TreeFilterOptions.tsx` + `treeFilter.ts` | filter tree | label, path | includes + ancestor keep | local | n/a | **yes** | no | yes | yes | `treeFilterNode` | no | `TreeFilterOptions.test.tsx`, `treeFilter.test.ts` |
| 18 | `DtsNodeTreeView.tsx` | structural nodes | nodePath | includes, **flat — drops ancestors** | local | n/a | **yes, fix ancestors** | no | yes | yes | `dtsNodePath` | no | node tree tests |
| 19 | `ProjectTopologyWorkspace.tsx` + `BindingPropertyTable.tsx` | bindings | propertyKey, driver, instance, locator, rawValue | includes | local | n/a | no | no | yes | yes | `projectBinding` (+ displayName, description, documentation when present) | no | workspace / table tests |
| 20 | `DtsParameterWorkbench.tsx` parameters mode | `DtsParameterWorkbenchRow` | concatenated `searchText` includes | includes | local | no | navigator separate | no | yes | yes | `dtsWorkbenchRow` (identity/explanation/attribution/value; **not** schema/policy/governance) | no | `DtsParameterWorkbench.test.tsx` |
| 21 | `DtsParameterWorkbench.tsx` source mode | DTS text | substring, match count, Enter next | literal | local | n/a | no | **literal find** | yes | **no** | n/a | no | workbench source-find tests |
| 22 | `CatalogPage.tsx` | definitions | server `q` vocabulary | server includes/haystack | **server cursor page** | yes | no | full-text-ish server | yes | **no** | keep catalog kernel | no server change this round | `CatalogPage` tests |
| 23 | `AuditWorkspace.tsx` + `useAuditEvents.ts` | audit events | API `q`; mock action/actor/kind/app/target/trace | server / mock includes | API server; mock local | cursor | no | server | yes | mock only, same fields as server | `auditEvent` mock | **no** API matching change | audit tests |
| 24 | `KnowledgePage.tsx` | published knowledge | `repository.search` on submit | provider | server/mock repo | n/a | no | **full-text** | yes | **no** | n/a | no | `KnowledgePage` tests |
| 25 | `KnowledgeEntryEditorDialog.tsx` | spec references | `parameterReferencePicker.search` on submit | provider | picker | n/a | no | provider | yes | **no** | n/a | no | editor tests |
| 26 | `LogsPage.tsx` | raw log lines | substring, count, next/prev, Ctrl/Cmd+F | literal | local | n/a | no | **literal find** | yes | **no** | n/a | no | LogsPage find tests |
| 27 | `WorkbenchSourceTree.tsx` | DTS structure hits | `repo.search` on submit | provider | server/mock | n/a | results list | provider | yes | **no** | n/a | no | workbench search tests |
| 28 | `domain/parameters/comparison.ts` | comparison rows | key, module, description, values | includes | algorithm only, **no UI box found** | n/a | no | no | n/a | yes | `comparisonRow` | no | `comparison.test.ts` |
| 29 | `DtsSearchPanel` | — | — | — | **removed with #240** | — | — | — | skip | skip | — | — | — |

### Explicit non-migrations

- ColumnFilter menus: categorical, not global search (tree search inside a filter **is** #17).
- `ModuleAttributionTree` “模块树筛选”: ColumnFilter / tree options, not a page search box.
- Status / risk / lifecycle / coverage: stay on ColumnFilter.
- Catalog / Knowledge / Audit API / workbench unified search / log raw find / DTS source find: SearchField chrome only.

## ParameterSpecLibrary description gap

`ParameterSpecSummary` / listSpecs DTO has no `description` or `documentation`. Those exist on `ParameterSpecDetail` only. Extending the list payload is possible but is an API contract change and is **not** required for the live Catalog page, which already searches description/documentation on the server. This round does not add list fields and does not call detail per row.

## Search UX

- lucide `Search` icon, custom clear (hide native WebKit cancel), `aria-label` required-or-placeholder-fallback
- No debounce on local filter; server/submit pages keep their current submit/blur/Enter behavior
- Placeholders stay product-specific
- SearchField does not handle Enter/Escape unless the parent does
- Hit hint “命中：描述” only where a hidden field can recall a row (ParametersTable explanation; Debugging description if the column is absent)

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Planning docs | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan |
| Design system | Update | `docs/design-docs/ui-design-system.md`, `docs/zh-CN/design-docs/ui-design-system.md` |
| Product specs | No change | search is an interaction primitive, not a new workflow |
| Architecture | No change | no new runtime port |
| Quality / testing | No change unless verification-matrix lists search boxes | check during CP-S5 |
| Security / generated | No change | |

## Documentation Update Gate

All Update rows are edited in this change. `npm run docs:check` is a completion gate.

## UI interaction automation

No new browser-acceptance requirement ID. Existing e2e locators that use `input[type="search"]` remain valid. Quality helper comments that mention `.parameters-table-search` are updated to `.search-field`.

## Verification

```bash
npm test -- src/lib/search src/components/common/SearchField.test.tsx src/components/ParametersTable.test.tsx src/components/common/TreeFilterOptions.test.tsx src/domain/tree-filter/treeFilter.test.ts src/debugAdminLibraryFilters.test.ts src/logAdminAnalytics.test.ts
npm run typecheck
npm run build
npm run lint
npm run ui:check
npm run docs:check
```

Browser (playwright-cli), mock or local API as available: `/parameters`, spec library or Catalog, `/debugging`, `/node-debugging`, one admin table, one tree search, Catalog, Knowledge, Logs. Viewports 1440×900, 768×1024, 390×844. Exercise input, clear, description-only, multi-token, empty, ColumnFilter combo, page reset, keyboard, focus, console error, and network on server-backed pages (no per-keystroke N+1).
