# Project configuration workbench inspector and file history (#230)

> Status: **Completed**
> Date: 2026-08-07
> Branch: `feat/project-configuration-workbench-inspector-history`
> Issue: [#230](https://github.com/tzrea1-Q/WiseEff/issues/230), child of [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> Blocked by: [#229](https://github.com/tzrea1-Q/WiseEff/issues/229) (merged at `b12166b003094b31093675f1f65ab255c26d990f`)
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-07-project-configuration-workbench-inspector-history.md)
> Design: [Project configuration workbench](../../design-docs/2026-08-06-project-configuration-workbench-design.md)
> Starts at: `b12166b003094b31093675f1f65ab255c26d990f`

## Goal

Add the read-only contextual inspection model on top of source-located navigation. An Admin can inspect the selected Config set, file, DTS node, or property; traverse back through object context; browse immutable file-version history; download a selected version; and temporarily enter historical or comparison source modes without losing the previous Working-source position.

## Scope and success criteria

1. Config set, file, node, and property selections open the corresponding inspector content without changing source identity unexpectedly.
2. Inspector back navigation follows property → node → file → Config set and preserves the source selection.
3. File inspection shows format, member role, active version, immutable version history, origin, creator/time where known, and per-version download.
4. Node and property inspection shows source path/span, labels or compatible, typed raw/normalized values, risk, provenance, and read permission state.
5. Historical and released source are visibly read-only and cannot be mistaken for Working configuration.
6. Entering and leaving history, unified diff, or side-by-side diff restores the previous source target and scroll position.
7. File version, Working configuration, Candidate file version placeholder, and Release baseline identities remain independently labeled.
8. The inspector overlays the default desktop composition and becomes persistent only when the resulting source canvas remains at least 640px (measure workbench available width — PCW-D15).
9. Inspector navigation, history, download, source-mode, accessibility, and browser-layout tests pass in mock and API modes; register `PROJ-CONFIG-INSPECT-001`.

## Non-goals

- Candidate upload/activation (#231+), structured EDIT submit (#233), conflicts, release readiness, cutover.
- Free-form DTS text editing (canvas stays read-only).
- Merging, cherry-picking, or copying implementation from `codex/prototype-config-workbench` / `e941f236`.
- Closing #230 or opening/merging a PR from the implementation agent.

## Architecture and seams

| Seam | Behavior | TDD evidence |
| --- | --- | --- |
| Workbench component | Inspector content by selection level; back stack; source mode switches; identity labels; width persistence (≥640px source) | `ProjectConfigurationWorkbench` tests |
| Ports | List file versions / download historical version via existing `ParameterFileRepository` (and `DtsStructuredRepository` as needed); no page-level HTTP | workbench + mock/HTTP port tests |
| Mock + HTTP parity | History list/download parity for teaching and API runtimes | `mockParameterFileRepository` / `parameterFileClient` tests |
| Source canvas modes | `working` \| `history` \| `unified-diff` \| `side-by-side` (MVP for AC); restore scroll/selection on exit | workbench component tests |
| Contracts/docs | Only if new public API fields appear | contract/docs gate |
| API-mode browser | `PROJ-CONFIG-INSPECT-001` | acceptance coverage + e2e + playwright-cli evidence |

Tests observe public behavior only (no private reducers / effect order / CSS internals).

Legacy URL values `sourceMode=structured|raw` remain aliases of Working canvas mode so #229 deep links keep working.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work and commit on `feat/project-configuration-workbench-inspector-history`; do **not** push/merge `main`, open a PR, or close #230 |
| Parent agent | Review commits, open/merge the PR, sync local `main`, and close #230 when accepted |

The branch starts at `b12166b003094b31093675f1f65ab255c26d990f` (merge of PR #243 / source-located navigation).

## Tasks

### 0. Register plan

- [x] Create bilingual active plans and add them to EN/ZH `PLANS.md` Current Active Plan lists.
- [x] Claim issue #230 (`gh issue edit 230 --add-assignee @me`).
- [x] Lock the TDD seams above.

### A. Inspector levels + back stack

- [x] Red: selecting config set / file / node / property opens matching inspector content without unexpected source identity change.
- [x] Red: inspector back follows property → node → file → Config set and preserves source selection.
- [x] Green: extend workbench inspector beyond Phase-1 read-only note.

### B. File history + download via ports

- [x] Red/Green: file inspector lists immutable versions (format, role, active version, origin, creator/time) and downloads via `ParameterFileRepository.listVersions` / `downloadVersion`.
- [x] Confirm mock + HTTP parity; no page-level HTTP.

### C. Node/property inspection fields

- [x] Red/Green: show path/span, labels/compatible, typed raw/normalized, risk, provenance, read permission (honest read-only in this phase; no new public API fields unless required).

### D. Source modes + restore

- [x] Red/Green: working / history / unified-diff / side-by-side MVP; historical/released visibly read-only and labeled apart from Working.
- [x] Entering/leaving restores previous source target and scroll position.
- [x] Independently label file version, Working configuration, Candidate placeholder, Release baseline.

### E. Overlay vs persistent inspector (PCW-D15)

- [x] Red/Green: default desktop overlay; persistent only when measured workbench width leaves source ≥640px.

### F. Acceptance + docs + completion

- [x] Register `PROJ-CONFIG-INSPECT-001` in EN/ZH coverage maps, `requirements.ts`, `operationMatrix.ts`, and e2e.
- [x] Update FRONTEND (and ZH); contracts only if new public fields.
- [x] Run verification matrix, three-viewport UI evidence under `work/ui-checks/project-configuration-workbench-inspector-history/`, Standards vs Spec review vs `b12166b0`, fix findings.
- [x] Move plans to `completed/` and flip checkboxes after gates pass.

## Browser acceptance mapping

| Requirement | Operation | Acceptance behavior | Evidence |
| --- | --- | --- | --- |
| `PROJ-CONFIG-INSPECT-001` | `PROJ-CONFIG-INSPECT-001` | Admin opens flagged workbench; selects config set/file/node/property → matching inspector; back stack preserves source; file history + download; history/unified/side-by-side modes restore target/scroll; identities labeled; overlay vs persistent ≥640px source | Dedicated acceptance coverage in `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + playwright-cli under `work/ui-checks/project-configuration-workbench-inspector-history/` |

## Verification

Development loop (targeted):

```bash
npm test -- src/components/project-configuration-workbench
npm test -- src/infrastructure/mock/mockParameterFileRepository.test.ts src/infrastructure/http/parameterFileClient.test.ts
```

Completion gates:

```bash
npm test
TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff_unit npm run test:server -- server/modules/parameter-files
npm run acceptance:coverage && npm run acceptance:operations
npm run acceptance:e2e -- e2e/acceptance/project-configuration-workbench.acceptance.spec.ts
npm run docs:check
npm run build
```

Frontend-visible: playwright-cli three viewports `1440x900`, `768x1024`, `390x844` with snapshot+screenshot under `work/ui-checks/project-configuration-workbench-inspector-history/`; console error check. Use `VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED=true` when starting/reusing local dev.

Review gate: two parallel reviews (Standards vs Spec) against fixed point `b12166b003094b31093675f1f65ab255c26d990f` and issue #230; fix findings; re-run impacted tests.

## Documentation Impact Matrix

| Area | Action | Exact paths / evidence |
| --- | --- | --- |
| Planning | Update | this plan + ZH companion; `docs/PLANS.md`; `docs/zh-CN/PLANS.md` |
| Frontend / design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — inspector levels, history modes, PCW-D15 persistence |
| API contract | Review | Update only if new public API fields appear |
| Quality / testing | Update | EN/ZH browser acceptance map and operation matrix; `requirements.ts`, `operationMatrix.ts`, e2e |
| Generated artifacts | Review | OpenAPI/db-schema only if contracts change |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Product specs | Review | product-spec / prototype-functional-spec — update only if delivered workflow stale |
| Architecture / domain / ADR | Review | `CONTEXT.md`, relevant ADRs, locked design |
| Reliability / security | Review | `docs/RELIABILITY.md`, `docs/SECURITY.md` |
| Environment | Review | env docs only if new flag/vars beyond existing workbench flag |

## Documentation Update Gate

- [x] Every `Update` row is delivered in English and Chinese where applicable.
- [x] Every `Review` row is either updated or recorded here as unchanged with concrete evidence.
- [x] Acceptance requirement/operation coverage and evidence ownership are registered before completion.
- [x] `npm run docs:check` passes.
- [x] No deferred #230 acceptance remains; follow-ups belong to later child issues of #227.

Review evidence for unchanged rows: `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, ADR set, `docs/RELIABILITY.md`, and `docs/SECURITY.md` were checked against the delivered inspector/history boundary; no architecture/security/reliability map change was required beyond FRONTEND and acceptance maps. API contract / OpenAPI / db-schema were unchanged because no new public HTTP fields were introduced. Environment docs unchanged beyond the existing workbench flag.

Browser evidence is retained under `work/ui-checks/project-configuration-workbench-inspector-history/` (`workbench-1440x900.png`, `workbench-768x1024.png`, `workbench-390x844.png`, matching snapshots, overflow JSON, and empty `console-errors.json`).

Known follow-ups (not blocking #230): released-baseline canvas entry remains identity-labeled only until a later epic child adds baseline content compare; deeper scroll-position e2e assertions can extend `PROJ-CONFIG-INSPECT-001` once viewer exposes an observable scroll seam.
