# Tech view shows project-primary DTS source — design

> Date: 2026-07-24  
> Status: approved for implementation  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md`](../../zh-CN/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md)  
> Branch: `feat/tech-view-primary-dts-source`

## Problem

The workbench header toggle「技术视图」currently swaps the **left navigator** from the business module tree to a DTS topology tree, while the **right results pane** remains the parameter table. Operators who want to inspect the project’s factual DTS source still lose the module navigator and do not get a source view.

Desired behavior: keep the module navigator fixed; replace only the results pane with a read-only rendering of the project-primary DTS file.

## Goals

-「技术视图」replaces the right-hand parameter table with a read-only project-primary DTS source viewer.
- Left navigator always shows the business module tree (never the topology tree for this toggle).
- Selecting a module best-effort scrolls/highlights related DTS lines (via binding `sourceLine` / path).
- In tech view, search finds within DTS text; export downloads the current primary DTS and shows `fileName · vN`.
- Remove the old「tech view = topology navigator」semantics and update tests/docs accordingly.

## Non-goals

- In-workbench editing or writeback of DTS text.
- Keeping a parallel「left topology navigator」mode.
- Multi-file picker UI (only the project-primary / single enabled board DTS).
- Perfect mapping for every module (missing `sourceLine` → status message, not a hard error).

## Design

### State model

Replace `navigatorMode: "module" | "topology"` with a **results mode**:

```ts
type WorkbenchResultsMode = "parameters" | "dtsSource";
```

- Left pane: always `moduleTree` via `DtsTopologyNavigator` (title always「模块导航」).
- Header toggle labels may remain「模块导航」/「技术视图」but they control `resultsMode` only:
  - `parameters` → existing `DtsParameterWorkbenchTable`
  - `dtsSource` → new `ProjectPrimaryDtsViewer` (name may vary slightly)

Clear topology-tree construction path from the toggle (may keep `buildDtsTopologyTree` unused by this toggle or delete dead call sites if nothing else needs it in the workbench).

### Data loading

`ApiProjectTopologyWorkspace` (or equivalent coordinator) supplies:

```ts
loadPrimaryDtsSource(): Promise<{
  fileName: string;
  versionNumber: number;
  text: string;
}>
```

Implementation sketch:

1. `ParameterFileRepository.listFiles(projectId)`
2. Choose the project-primary DTS (enabled `format: "dts"` board / sole primary member — match existing seed/product convention `{projectId}-board.dts` when present; otherwise the single enabled DTS file)
3. `downloadVersion(projectId, fileId, currentVersionId)` → decode UTF-8 text
4. Cache per `projectId` + version id while the workbench stays mounted

Loading / error / empty states render inside the results pane with retry.

### Viewer UX

`ProjectPrimaryDtsViewer`:

- Monospace read-only text with line numbers
- Imperative or prop-driven `scrollToLine(line: number)` + temporary highlight
- In-document find: highlight matches; Enter / controls for next match (minimum viable)
- Header/meta strip: `fileName · v{versionNumber}`

### Module → line mapping

When `resultsMode === "dtsSource"` and the user selects a module node:

1. Collect workbench rows under that module subtree (same filtering rules as the parameter list for that selection).
2. Pick the smallest positive `sourceLine` among those rows (fallback: first row with a parseable path match in text if line missing — optional; v1 may line-only).
3. If found → `scrollToLine` + highlight.
4. If not → polite status:「当前模块暂无源码行定位」.

### Toolbar

| Control | `parameters` | `dtsSource` |
| --- | --- | --- |
| Search | Filter parameter rows (unchanged) | Find in DTS text |
| Result count | `显示 N / M 个参数` | Match count or hidden; prefer match status |
| Export | CSV of visible rows (unchanged) | Download current DTS bytes/text as `fileName`; show `fileName · vN` near the control |

### Testing

- Update tests that click「技术视图」and assert topology navigator / topology filtering.
- Add: after tech view, navigator still「模块导航」/ module tree; results show DTS text (mock `loadPrimaryDtsSource`).
- Add: selecting a module with `sourceLine` calls scroll/highlight (mock viewer or assert status).
- Add: search placeholder/behavior and export download labeling in dts mode.
- Update FRONTEND EN/ZH one sentence describing the new tech-view meaning.

## Success criteria

1. Tech view: left = module tree; right = primary DTS source.
2. Module-nav toggle restores the parameter table.
3. Module click with `sourceLine` scrolls to that line.
4. Search operates on DTS text; export downloads file with name + version visible.
5. Targeted workbench tests and docs:check pass.

## Documentation impact (brief)

| Area | Action |
| --- | --- |
| This design pair | Update (this change) |
| `docs/FRONTEND.md` + ZH | Update (tech view sentence) |
| Product / domain | Review; update only if they describe topology tech view |
| API contract | No change (reuse parameter-file download) |
