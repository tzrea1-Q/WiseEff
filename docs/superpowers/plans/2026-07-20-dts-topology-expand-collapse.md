# DTS Topology Pointer Expand/Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Chinese: [中文](../../zh-CN/superpowers/plans/2026-07-20-dts-topology-expand-collapse.md)

**Goal:** Give parent nodes in `DtsTopologyNavigator` a dedicated pointer/touch disclosure control that toggles children without selecting the node, while keeping row clicks as selection-only and preserving existing keyboard/roving-focus behavior.

**Architecture:** Replace the nested-button-impossible row `<button role="treeitem">` with a focusable `role="treeitem"` container that owns a separate native disclosure `<button tabIndex={-1}>`. Reuse existing `setExpanded` / `visibleNodeIds` / Left-Right keyboard paths. No API, tree-builder, identity, or submission changes.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Lucide React, WiseEff CSS tokens, playwright-cli browser checks.

**Design spec:** [`docs/superpowers/specs/2026-07-20-dts-topology-expand-collapse-design.md`](../specs/2026-07-20-dts-topology-expand-collapse-design.md)

## Global Constraints

- Disclosure activation must not call `onSelectNode` and must not change the parameter-list filter.
- Tree-item activation must not toggle expansion.
- Disclosure is not a second Tab stop (`tabIndex={-1}`); pointer toggle returns focus to the tree item.
- Leaf nodes render no disclosure control.
- Collapsing an ancestor must not discard the selected descendant identity.
- Left/Right, Up/Down, Home/End, Enter, and Space behavior stay unchanged.
- Touch layouts: disclosure target ≥ 44×44 CSS px with visible hover/focus affordance.
- Disclosure accessible names use Chinese UI copy already used by the workbench: `展开 ${label}` / `折叠 ${label}`.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `src/components/parameter-topology/DtsTopologyNavigator.test.tsx` | Prove disclosure toggle, non-select, select-without-toggle, leaf absence, keyboard still green |
| `src/components/parameter-topology/DtsTopologyNavigator.tsx` | treeitem container + disclosure button + focus restore |
| `src/styles.css` | disclosure button sizing, hover/focus, mobile 44×44 |

---

### Task 1: Lock disclosure pointer contracts with failing tests

**Files:**
- Modify: `src/components/parameter-topology/DtsTopologyNavigator.test.tsx`
- Test: same file

**Interfaces:**
- Consumes: existing `DtsTopologyNavigator` props and fixture tree (`effective-i2c`, `effective-sc8562`, `effective-mt5788`)
- Produces: four new `it(...)` cases that fail until Task 2 lands

- [ ] **Step 1: Add the four disclosure tests after the existing keyboard suite**

Append these tests (keep all existing tests):

```tsx
  it("toggles descendants from the disclosure control without selecting the parent", () => {
    const onSelectNode = vi.fn();
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={onSelectNode}
      />
    );

    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });
    const disclosure = within(i2c).getByRole("button", { name: "折叠 i2c@FDF5E000" });

    fireEvent.click(disclosure);
    expect(i2c).toHaveAttribute("aria-expanded", "false");
    expect(within(navigator).queryByRole("treeitem", { name: /sc8562@6E/ })).not.toBeInTheDocument();
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(i2c).toHaveFocus();

    fireEvent.click(within(i2c).getByRole("button", { name: "展开 i2c@FDF5E000" }));
    expect(i2c).toHaveAttribute("aria-expanded", "true");
    expect(within(navigator).getByRole("treeitem", { name: /sc8562@6E/ })).toBeInTheDocument();
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(i2c).toHaveFocus();
  });

  it("selects from the tree item without toggling expansion", () => {
    const onSelectNode = vi.fn();
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={onSelectNode}
      />
    );

    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });
    expect(i2c).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(i2c);
    expect(onSelectNode).toHaveBeenCalledWith("effective-i2c");
    expect(i2c).toHaveAttribute("aria-expanded", "true");
    expect(within(navigator).getByRole("treeitem", { name: /sc8562@6E/ })).toBeInTheDocument();
  });

  it("does not render a disclosure control on leaf nodes", () => {
    render(
      <DtsTopologyNavigator
        view="effective"
        nodes={tree}
        selectedNodeId="effective-sc8562"
        onSelectNode={vi.fn()}
      />
    );

    const sc8562 = screen.getByRole("treeitem", { name: /sc8562@6E/ });
    expect(within(sc8562).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the selected descendant identity while its ancestor is collapsed", () => {
    function Harness() {
      const [selectedNodeId, setSelectedNodeId] = useState<string | null>("effective-sc8562");
      return (
        <DtsTopologyNavigator
          view="effective"
          nodes={tree}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      );
    }

    render(<Harness />);
    const navigator = screen.getByRole("tree", { name: "生效 DTS 拓扑" });
    const i2c = within(navigator).getByRole("treeitem", { name: /i2c@FDF5E000/ });

    fireEvent.click(within(i2c).getByRole("button", { name: "折叠 i2c@FDF5E000" }));
    expect(within(navigator).queryByRole("treeitem", { name: /sc8562@6E/ })).not.toBeInTheDocument();

    fireEvent.click(within(i2c).getByRole("button", { name: "展开 i2c@FDF5E000" }));
    const sc8562 = within(navigator).getByRole("treeitem", { name: /sc8562@6E/ });
    expect(sc8562).toHaveAttribute("aria-selected", "true");
  });
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- src/components/parameter-topology/DtsTopologyNavigator.test.tsx`

Expected: new disclosure tests FAIL (no `button` named `折叠 …` / nesting or missing control). Existing keyboard tests still pass or fail only if name queries break after a partial edit — do not change production code yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/components/parameter-topology/DtsTopologyNavigator.test.tsx
git commit -m "$(cat <<'EOF'
test(parameters): lock DTS topology disclosure pointer contracts

EOF
)"
```

---

### Task 2: Implement treeitem container and disclosure button

**Files:**
- Modify: `src/components/parameter-topology/DtsTopologyNavigator.tsx` (renderNodes item markup ~175–254)

**Interfaces:**
- Consumes: `setExpanded(nodeId, expanded)`, `focusNode(nodeId)`, `onSelectNode`, existing keyboard handlers
- Produces: parent nodes expose `getByRole("button", { name: "展开|折叠 <label>" })` with `tabIndex={-1}`

- [ ] **Step 1: Replace the row button with a treeitem container + disclosure button**

Replace the current `<button role="treeitem" …>` block inside `renderNodes` with:

```tsx
          <div
            ref={(element) => {
              if (element) itemRefs.current.set(node.id, element);
              else itemRefs.current.delete(node.id);
            }}
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-selected={selectedNodeId === node.id}
            tabIndex={tabbableId === node.id ? 0 : -1}
            className={`dts-topology-navigator__item${selectedNodeId === node.id ? " is-selected" : ""}`}
            onFocus={() => setActiveNodeId(node.id)}
            onClick={() => {
              focusNode(node.id);
              onSelectNode(node.id);
            }}
            onKeyDown={(event) => {
              // keep the existing Enter/Space/Arrow*/Home/End body unchanged
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                className="dts-topology-navigator__disclosure"
                aria-label={expanded ? `折叠 ${node.label}` : `展开 ${node.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setExpanded(node.id, !expanded);
                  focusNode(node.id);
                }}
              >
                {expanded
                  ? <ChevronDown size={15} strokeWidth={2} aria-hidden="true" />
                  : <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
              </button>
            ) : (
              <span className="dts-topology-navigator__disclosure" aria-hidden="true" />
            )}
            <code className="dts-topology-navigator__label">{node.label}</code>
            <span className="dts-topology-navigator__meta">
              <span className="dts-topology-navigator__count">{node.bindingCount} 个参数</span>
              {node.attentionCount > 0 ? (
                <span className="dts-topology-navigator__attention">
                  <CircleAlert size={12} strokeWidth={2} aria-hidden="true" />
                  {node.attentionCount} 个待处理
                </span>
              ) : null}
            </span>
          </div>
```

Keep the existing `onKeyDown` body byte-for-byte (only move it onto the `div`). Do not change `indexTree`, expansion sync effects, or `visibleNodeIds`.

- [ ] **Step 2: Run component tests**

Run: `npm test -- src/components/parameter-topology/DtsTopologyNavigator.test.tsx`

Expected: all tests PASS, including the four new disclosure cases and the prior keyboard/roving suite.

- [ ] **Step 3: Commit**

```bash
git add src/components/parameter-topology/DtsTopologyNavigator.tsx
git commit -m "$(cat <<'EOF'
feat(parameters): add DTS topology pointer disclosure control

EOF
)"
```

---

### Task 3: Style disclosure hit target and touch affordance

**Files:**
- Modify: `src/styles.css` (`.dts-topology-navigator__disclosure` ~19753 and mobile `@media (max-width: 820px)` block ~20438)

**Interfaces:**
- Consumes: new `button.dts-topology-navigator__disclosure` from Task 2
- Produces: desktop hover/focus ring; touch layout min 44×44

- [ ] **Step 1: Update disclosure CSS**

Replace `.dts-topology-navigator__disclosure` and add button-specific rules:

```css
.dts-topology-navigator__disclosure {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  color: #7f8ea4;
  font-size: 13px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

button.dts-topology-navigator__disclosure:hover,
button.dts-topology-navigator__disclosure:focus-visible {
  color: var(--dts-workbench-blue);
  background: #e8f1fc;
  border-color: #c8dcf7;
  outline: none;
}
```

Inside `@media (max-width: 820px)` next to `.dts-topology-navigator__item { min-height: 44px; }`, add:

```css
  button.dts-topology-navigator__disclosure {
    width: 44px;
    height: 44px;
  }
```

If the 20px first grid column clips the larger control, widen `.dts-topology-navigator__item` first column from `20px` to `minmax(28px, auto)` (and rely on the 44px media rule for touch).

- [ ] **Step 2: Smoke the component tests again**

Run: `npm test -- src/components/parameter-topology/DtsTopologyNavigator.test.tsx`

Expected: PASS (styles do not affect RTL assertions).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
style(parameters): size DTS topology disclosure for pointer and touch

EOF
)"
```

---

### Task 4: Verification gate

**Files:** none required unless a regression surfaces

- [ ] **Step 1: Targeted tests + build**

```bash
npm test -- src/components/parameter-topology/DtsTopologyNavigator.test.tsx
npm run build
```

Expected: tests PASS; `tsc -b` + Vite build succeed.

- [ ] **Step 2: Browser verification with playwright-cli**

With `npm run dev:all` already serving `http://127.0.0.1:5173/` and API on `8787`:

1. Open `/parameters` (API mode), log in if needed with seeded Admin credentials from local docs.
2. Viewports: `1440x900`, `768x1024`, `390x844`.
3. For each viewport: snapshot + screenshot under `work/ui-checks/dts-topology-disclosure-*.png`.
4. Click a parent disclosure → descendants hide; click again → restore; confirm parameter filter does not jump solely from disclosure.
5. Click a treeitem body → selection/filter updates; expansion unchanged.
6. `console error` must be clean; no page-level horizontal overflow.

- [ ] **Step 3: Mark plan checkboxes complete in this file once verified**

---

## Self-Review

1. **Spec coverage:** dedicated disclosure, select-without-toggle, leaf absence, selection identity retention, keyboard unchanged, 44×44 touch, hover/focus — covered by Tasks 1–3 and browser Step 2.
2. **Placeholders:** none; exact selectors, copy, CSS, and commands included.
3. **Type consistency:** reuses `setExpanded` / `focusNode` / `DtsWorkbenchTreeNode.label`; no new exported types.

## Documentation Impact

Per the confirmed design: no API/schema/runbook updates. This plan + bilingual Chinese companion are the only doc additions for the interaction follow-up. Parent workbench redesign docs already describe expandable hierarchy.
