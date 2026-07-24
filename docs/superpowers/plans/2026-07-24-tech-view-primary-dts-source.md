# Tech View Primary DTS Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose workbench「技术视图」so the left module navigator stays fixed and the right results pane shows a read-only project-primary DTS source viewer (with module→line jump, in-text find, and DTS download).

**Architecture:** Introduce `WorkbenchResultsMode = "parameters" | "dtsSource"`. Always render `moduleTree` in `DtsTopologyNavigator`. Add `ProjectPrimaryDtsViewer` for monospace source + line scroll/highlight + find. Coordinator (`ApiProjectTopologyWorkspace`) injects `loadPrimaryDtsSource` via `ParameterFileRepository.listFiles` + `downloadVersion`. Remove topology-navigator toggle semantics from the workbench.

**Tech Stack:** React + Vite, Vitest (`npm test -- …` for `src/**`), `ParameterFileRepository` HTTP client, CSS in `src/styles.css`.

**Spec:** [`docs/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md`](../specs/2026-07-24-tech-view-primary-dts-source-design.md)  
**Chinese:** [`docs/zh-CN/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md`](../../zh-CN/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md)  
**Chinese plan summary:** [`docs/zh-CN/superpowers/plans/2026-07-24-tech-view-primary-dts-source.md`](../../zh-CN/superpowers/plans/2026-07-24-tech-view-primary-dts-source.md)

## Global Constraints

- Left navigator is **always** the business module tree; never swap to topology tree for「技术视图」.
- Right pane in tech view is **read-only** project-primary DTS text (no edit/writeback).
- `loadPrimaryDtsSource(): Promise<{ fileName: string; versionNumber: number; text: string }>`
- Prefer enabled file named `{projectId}-board.dts`; else the sole enabled `format: "dts"` file; else fail with a clear error.
- Module→line: smallest positive `sourceLine` among rows in the selected module subtree; if none → status「当前模块暂无源码行定位」.
- Search in dts mode = find in text; export = download current DTS and show `fileName · vN`.
- No multi-file picker. No parallel left topology mode.
- Branch: `feat/tech-view-primary-dts-source` (already exists with design commit).
- Implementation agents commit on the feature branch only; parent opens/merges the PR.
- `docs/superpowers/` is gitignored — force-add EN plan/spec with `git add -f` when needed.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work on `feat/tech-view-primary-dts-source`, implement, test, commit |
| Implementation agent | Must not push to `main`, open/merge GitHub PRs, or fast-forward local `main` |
| Parent agent | Review, create PR, merge, `git pull origin main` |

## File map

| File | Responsibility |
| --- | --- |
| `src/components/parameter-topology/ProjectPrimaryDtsViewer.tsx` | Read-only DTS text + line numbers + scroll/highlight + find |
| `src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx` | Viewer unit tests |
| `src/application/parameters/selectPrimaryProjectDtsFile.ts` | Pure file-pick helper |
| `src/application/parameters/selectPrimaryProjectDtsFile.test.ts` | Helper tests |
| `src/components/parameter-topology/DtsParameterWorkbench.tsx` | `resultsMode`; always module nav; wire viewer/toolbar |
| `src/components/parameter-topology/DtsParameterWorkbench.test.tsx` | Replace topology assertions; add dts-source cases |
| `src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx` | Implement/pass `loadPrimaryDtsSource` |
| `src/styles.css` | Viewer layout styles |
| `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` | One-sentence tech-view meaning |
| Spec/plan EN+ZH | Already authored |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Superpowers spec/plan | EN+ZH under `docs/superpowers` / `docs/zh-CN/superpowers` | Review (approved) |
| FRONTEND | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update |
| Product / domain / API | — | Review; change only if they still say tech view = topology navigator |
| ARCHITECTURE / SECURITY / RELIABILITY | — | No change |
| Exec-plans / tech-debt | — | No change |

## Documentation Update Gate

Blocking before complete:

- [ ] FRONTEND EN+ZH tech-view sentence updated
- [ ] `npm run docs:check` passes
- [ ] Targeted workbench + viewer tests pass
- [ ] Optional browser check: tech view shows DTS; module nav unchanged

---

### Task 1: `ProjectPrimaryDtsViewer` (TDD)

**Files:**
- Create: `src/components/parameter-topology/ProjectPrimaryDtsViewer.tsx`
- Create: `src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx`
- Modify: `src/styles.css` (minimal `.project-primary-dts-viewer*` rules)

**Interfaces:**
- Produces:

```tsx
export type ProjectPrimaryDtsViewerProps = {
  fileName: string;
  versionNumber: number;
  text: string;
  /** 1-based line to scroll into view and highlight; null clears highlight */
  focusLine?: number | null;
  /** Controlled find query from workbench search box (optional) */
  findQuery?: string;
  /** Bumps to advance to next find match */
  findNextToken?: number;
  onFindStatusChange?: (status: { matchCount: number; activeIndex: number }) => void;
  className?: string;
};
```

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectPrimaryDtsViewer } from "./ProjectPrimaryDtsViewer";

describe("ProjectPrimaryDtsViewer", () => {
  it("renders meta, line numbers, and source text", () => {
    render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={3}
        text={"line-one\nline-two\nline-three"}
      />
    );
    expect(screen.getByText(/aurora-board\.dts · v3/)).toBeInTheDocument();
    expect(screen.getByText("line-two")).toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });

  it("marks focusLine as highlighted", () => {
    const { container } = render(
      <ProjectPrimaryDtsViewer
        fileName="aurora-board.dts"
        versionNumber={1}
        text={"a\nb\nc"}
        focusLine={2}
      />
    );
    expect(container.querySelector('[data-line="2"]')).toHaveClass("is-focused");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx`

- [ ] **Step 3: Minimal implementation**

Implement a scrollable `<pre>`/`div` with per-line rows (`data-line`), meta strip, `useEffect` scrolling `focusLine` into view, and optional find highlighting driven by `findQuery` / `findNextToken` (can be stubbed lightly in Task 1 and completed in Task 3 if needed — prefer basic find in Task 1).

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/parameter-topology/ProjectPrimaryDtsViewer.tsx \
  src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx src/styles.css
git commit -m "$(cat <<'EOF'
feat: add read-only project primary DTS viewer

EOF
)"
```

---

### Task 2: Primary DTS file selection helper (TDD)

**Files:**
- Create: `src/application/parameters/selectPrimaryProjectDtsFile.ts`
- Create: `src/application/parameters/selectPrimaryProjectDtsFile.test.ts`

**Interfaces:**
- Consumes: `ProjectParameterFile[]` from `@/application/ports/ParameterFileRepository`
- Produces:

```ts
export function selectPrimaryProjectDtsFile(
  projectId: string,
  files: ProjectParameterFile[]
): ProjectParameterFile | null;
```

Rules: only `enabled && format === "dts"`; prefer `fileName === `${projectId}-board.dts``; else if exactly one enabled DTS return it; else `null`.

- [ ] **Step 1: Failing tests** covering prefer board name, sole enabled DTS, none/ambiguous → null

- [ ] **Step 2: Run FAIL** — `npm test -- src/application/parameters/selectPrimaryProjectDtsFile.test.ts`

- [ ] **Step 3: Implement helper**

- [ ] **Step 4: PASS + commit**

```bash
git add src/application/parameters/selectPrimaryProjectDtsFile.ts \
  src/application/parameters/selectPrimaryProjectDtsFile.test.ts
git commit -m "$(cat <<'EOF'
feat: select project-primary DTS file for tech view

EOF
)"
```

---

### Task 3: Rewire workbench results mode (TDD)

**Files:**
- Modify: `src/components/parameter-topology/DtsParameterWorkbench.tsx`
- Modify: `src/components/parameter-topology/DtsParameterWorkbench.test.tsx`
- Optionally leave `sourceNodes`/`effectiveNodes` props for API compat but stop using topology tree for the toggle

**Interfaces:**
- Add optional prop:

```ts
loadPrimaryDtsSource?: () => Promise<{
  fileName: string;
  versionNumber: number;
  text: string;
}>;
```

- Replace `NavigatorMode` with `WorkbenchResultsMode = "parameters" | "dtsSource"`
- Header buttons set `resultsMode`; left nav **always** module tree (`ariaLabel="业务模块树"`, title「模块导航」)
- When `resultsMode === "dtsSource"`, render viewer (loading/error/retry) instead of table

- [ ] **Step 1: Rewrite failing/updated tests**

Replace `keeps module-first browse…` and any test that expects「生效 DTS 拓扑」after「技术视图」:

```tsx
  it("keeps module navigator and shows DTS source in tech view", async () => {
    const loadPrimaryDtsSource = vi.fn().mockResolvedValue({
      fileName: "aurora-board.dts",
      versionNumber: 2,
      text: "/ {\n  board_id = \"aurora\";\n};"
    });
    renderWorkbench({ loadPrimaryDtsSource });

    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));

    await waitFor(() => expect(loadPrimaryDtsSource).toHaveBeenCalled());
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "生效 DTS 拓扑" })).not.toBeInTheDocument();
    expect(await screen.findByText(/aurora-board\.dts · v2/)).toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });
```

Also fix `filters by the selected topology subtree when tech view is enabled` — either delete or rewrite as module-filter still applying only in parameters mode (tech view does not filter a table).

- [ ] **Step 2: Run FAIL** — `npm test -- src/components/parameter-topology/DtsParameterWorkbench.test.tsx`

- [ ] **Step 3: Implement mode switch + load on enter dtsSource**

Remove `buildDtsTopologyTree` usage from this toggle path. Keep module selection state shared.

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: tech view swaps results pane to DTS source

EOF
)"
```

---

### Task 4: Module jump, find, and DTS download toolbar

**Files:**
- Modify: `DtsParameterWorkbench.tsx` (+ tests)
- Reuse viewer find props from Task 1

**Interfaces:**
- On module select while `dtsSource`: compute `focusLine` from smallest positive `sourceLine` in subtree rows; else set status「当前模块暂无源码行定位」
- Search input: if dtsSource, drive `findQuery`; Enter increments `findNextToken`
- Export button: if dtsSource and source loaded, download text as `fileName` via `Blob` + temporary `<a download>`; show meta `fileName · vN` near control; disable when not loaded

- [ ] **Step 1: Failing tests** for (a) module with `sourceLine` sets focused line / status, (b) export button name or adjacent text includes file meta in tech view, (c) search placeholder or aria reflects DTS find

- [ ] **Step 2: FAIL → implement → PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: jump find and download in DTS tech view

EOF
)"
```

---

### Task 5: Wire `ApiProjectTopologyWorkspace` + FRONTEND docs

**Files:**
- Modify: `src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx`
- Modify: `src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` (or workbench-level mock already sufficient — add one coordinator test if patterns exist)
- Modify: `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`

**Interfaces:**
- Resolve `ParameterFileRepository` via `resolveParameterFileRepository` (same pattern as admin files page)
- `loadPrimaryDtsSource` implementation:

```ts
async function loadPrimaryDtsSource() {
  const files = await parameterFileRepository.listFiles(projectId);
  const file = selectPrimaryProjectDtsFile(projectId, files);
  if (!file?.currentVersionId || file.currentVersionNumber == null) {
    throw new Error("未找到可用的项目主 DTS 文件");
  }
  const downloaded = await parameterFileRepository.downloadVersion(
    projectId,
    file.id,
    file.currentVersionId
  );
  const text = new TextDecoder().decode(downloaded.bytes);
  return {
    fileName: downloaded.fileName ?? file.fileName,
    versionNumber: file.currentVersionNumber,
    text
  };
}
```

Pass into `DtsParameterWorkbench`.

- [ ] **Step 1: Update FRONTEND EN/ZH** — replace “optional DTS topology tech view” with “tech view shows read-only project-primary DTS in the results pane; module navigator stays”

- [ ] **Step 2: `npm run docs:check`**

- [ ] **Step 3: Targeted tests**

```bash
npm test -- src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx
npm test -- src/application/parameters/selectPrimaryProjectDtsFile.test.ts
npm test -- src/components/parameter-topology/DtsParameterWorkbench.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add -f docs/superpowers/plans/2026-07-24-tech-view-primary-dts-source.md
git add docs/zh-CN/superpowers/plans/2026-07-24-tech-view-primary-dts-source.md \
  docs/FRONTEND.md docs/zh-CN/frontend.md \
  src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx
git commit -m "$(cat <<'EOF'
feat: load primary DTS for workbench tech view

EOF
)"
```

---

### Task 6: Verification gate

- [ ] Re-run targeted tests above + `npm run docs:check`
- [ ] Optional browser: `/parameters` → 技术视图 → module tree still visible; DTS text shown; click module with sourceLine scrolls
- [ ] Parent opens PR when ready

---

## Self-review

1. **Spec coverage:** results mode, always module nav, viewer, load helper, module jump, find, download meta, docs — all tasked.
2. **Placeholders:** none; commands and signatures concrete.
3. **Type consistency:** `loadPrimaryDtsSource` return type matches across tasks.
