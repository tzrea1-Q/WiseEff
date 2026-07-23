# Merge Link Visibility After Software Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After software merge (`已合入`), show the stored http(s) merge link as a dedicated detail card and as a clickable link in the workflow timeline on `/parameter-review`.

**Architecture:** Frontend-only. Gate on `status === "已合入"` and `isValidMergeLink(reviewerNote)`. Extend `VerticalTimelineItem.body` to `ReactNode` so the merge step can render an `<a>`. Add a `merge-link-card` above「变更历史」, parallel to `rejection-reason-card`. No API/schema changes.

**Tech Stack:** React + Vite, Vitest (`src/App.test.tsx`), CSS in `src/styles.css`, `isValidMergeLink` from `@/domain/parameters/mergeLink`.

**Spec:** [`docs/superpowers/specs/2026-07-24-merge-link-visibility-design.md`](../specs/2026-07-24-merge-link-visibility-design.md)  
**Chinese:** [`docs/zh-CN/superpowers/specs/2026-07-24-merge-link-visibility-design.md`](../../zh-CN/superpowers/specs/2026-07-24-merge-link-visibility-design.md)  
**Chinese plan summary:** [`docs/zh-CN/superpowers/plans/2026-07-24-merge-link-visibility.md`](../../zh-CN/superpowers/plans/2026-07-24-merge-link-visibility.md)

## Global Constraints

- Visibility only when `status === "已合入"` **and** `isValidMergeLink(reviewerNote)`.
- Links: `target="_blank"` and `rel="noopener noreferrer"`.
- Do not show the read-only surfaces while status is still `软件User合入` (input `#review-merge-link` stays the only UI there).
- No backend / DTO / list-column changes.
- Continue on existing feature branch `feat/merge-link-required` (merge-gate work already in progress); do not open/merge PRs from implementation subagents.
- Implementation agents commit on the feature branch only; parent opens/merges the PR.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Work on `feat/merge-link-required`, implement, test, commit on branch |
| Implementation agent | Must not push to `main`, open/merge GitHub PRs, or fast-forward local `main` |
| Parent agent | Review, create PR, merge, `git pull origin main` |

## File map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Gate helper, merge-link card, timeline body as ReactNode, clean pending plain-text branch |
| `src/styles.css` | `.merge-link-card` (+ link styles) |
| `src/App.test.tsx` | Visibility + href tests; keep merge-link-required test green |
| `docs/product-specs/prototype-functional-spec.md` | One-line visibility note |
| `docs/zh-CN/product-specs/prototype-functional-spec.md` | Matching Chinese one-liner |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Product specs | `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | Update |
| Superpowers spec | `docs/superpowers/specs/2026-07-24-merge-link-visibility-design.md`, ZH twin | Review (already approved) |
| Repo maps / ARCHITECTURE / FRONTEND | — | No change |
| API / security / reliability / runbooks | — | No change |
| `docs/PLANS.md` / exec-plans | Optional pointer only if parent wants active tracking | No change unless parent adds |

## Documentation Update Gate

Blocking before complete:

- [ ] EN + ZH prototype functional specs updated (or recorded unchanged with evidence)
- [ ] `npm run docs:check` passes
- [ ] Browser evidence for history detail merge-link card + timeline link

---

### Task 1: Failing tests for merged-link visibility

**Files:**
- Modify: `src/App.test.tsx` (after the existing `requires an http(s) merge link…` test ~line 1067)

**Interfaces:**
- Consumes: existing `App` test harness, `initialState`, `createAppParameterRepository`
- Produces: tests that expect `getByRole("link", { name: "https://example.com/mr/99" })` in complementary「审阅详情」when history row is `已合入` with that `reviewerNote`

- [ ] **Step 1: Write the failing tests**

```tsx
  it("shows the merge link card and timeline link after software merge", async () => {
    window.history.replaceState(null, "", "/parameter-review");
    const merged = {
      ...initialState.changeRequests.find((request) => request.status === "已合入")!,
      id: "merged-with-link",
      status: "已合入" as const,
      reviewerNote: "https://example.com/mr/99"
    };
    const parameterRepository = createAppParameterRepository({
      listChangeRequests: vi.fn().mockResolvedValue([merged])
    });

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-chen-na",
              organizationId: "org-chargelab",
              name: "Chen Na",
              email: "chen@chargelab.cn",
              title: "Software Integrator",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "software-user" }],
            permissions: ["parameter:view", "parameter:edit"]
          })
        }}
        initialAppState={{ ...initialState, activeRoleId: "software-user", changeRequests: [merged] }}
        parameterRepository={parameterRepository}
        runtimeMode="api"
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "历史审阅" }));
    const reviewDetail = await screen.findByRole("complementary", { name: "审阅详情" });
    // Prefer selecting the merged row if the queue does not auto-select it
    const row = screen.getByText(merged.title);
    fireEvent.click(row.closest("tr") ?? row);

    const links = within(reviewDetail).getAllByRole("link", { name: "https://example.com/mr/99" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://example.com/mr/99");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
    expect(within(reviewDetail).getByText("合入链接", { selector: ".merge-link-card * , .section-label span" })).toBeTruthy();
  });

  it("does not show merge link surfaces without a valid reviewerNote URL", async () => {
    window.history.replaceState(null, "", "/parameter-review");
    const merged = {
      ...initialState.changeRequests.find((request) => request.status === "已合入")!,
      id: "merged-without-link",
      status: "已合入" as const,
      reviewerNote: "legacy free-text note"
    };
    const parameterRepository = createAppParameterRepository({
      listChangeRequests: vi.fn().mockResolvedValue([merged])
    });

    render(
      <App
        authClient={{
          getCurrentAuthContext: async () => ({
            user: {
              id: "u-chen-na",
              organizationId: "org-chargelab",
              name: "Chen Na",
              email: "chen@chargelab.cn",
              title: "Software Integrator",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "software-user" }],
            permissions: ["parameter:view", "parameter:edit"]
          })
        }}
        initialAppState={{ ...initialState, activeRoleId: "software-user", changeRequests: [merged] }}
        parameterRepository={parameterRepository}
        runtimeMode="api"
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "历史审阅" }));
    const reviewDetail = await screen.findByRole("complementary", { name: "审阅详情" });
    expect(within(reviewDetail).queryByRole("link", { name: /https?:\/\// })).toBeNull();
    expect(reviewDetail.querySelector(".merge-link-card")).toBeNull();
  });
```

If `getByText("合入链接", { selector: ... })` is awkward with the testing-library version in-repo, assert `reviewDetail.querySelector(".merge-link-card")` and that it contains the link instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/App.test.tsx -t "shows the merge link card|does not show merge link"`

Expected: FAIL (no `.merge-link-card` / fewer than 2 links)

- [ ] **Step 3: Commit**

```bash
git add src/App.test.tsx
git commit -m "$(cat <<'EOF'
test: expect merge link visibility after software merge

EOF
)"
```

---

### Task 2: Timeline ReactNode body + merge-link card UI

**Files:**
- Modify: `src/App.tsx` (`VerticalTimelineItem`, `selectedWorkflowItems`, rejection-card neighbor, `VerticalTimeline`)
- Modify: `src/styles.css` (after `.rejection-reason-card` block ~4450)

**Interfaces:**
- Consumes: `isValidMergeLink`, `selected.reviewerNote`, `selected.status`
- Produces:
  - `type VerticalTimelineItem = { body: ReactNode; ... }`
  - Helper (inline or local): `const showMergedLink = selected.status === "已合入" && isValidMergeLink(selected.reviewerNote)`
  - Card DOM: `div.merge-link-card` with SectionLabel「合入链接」and `<a href={url}>`

- [ ] **Step 1: Extend VerticalTimelineItem and renderer**

In `src/App.tsx`:

```tsx
type VerticalTimelineItem = {
  body: ReactNode;
  isCurrent?: boolean;
  marker?: string;
  time: string;
  title: string;
};

function VerticalTimeline({ items }: { items: VerticalTimelineItem[] }) {
  return (
    <div className="vertical-timeline">
      {items.map(({ body, isCurrent, marker, time, title }) => (
        <div className={`vertical-timeline-item${isCurrent ? " vertical-timeline-item--current" : ""}`} key={`${time}-${title}`}>
          <span className="timeline-dot" />
          <div className="vertical-timeline-meta">
            <small>{time}</small>
            {marker ? <span className="vertical-timeline-current-badge">{marker}</span> : null}
          </div>
          <strong>{formatWorkflowDisplayText(title)}</strong>
          <p>{typeof body === "string" ? formatWorkflowDisplayText(body) : body}</p>
        </div>
      ))}
    </div>
  );
}
```

Ensure `ReactNode` is imported from `react` (already used elsewhere in the file).

- [ ] **Step 2: Build workflow items + card for 已合入**

Replace the pending-only plain-text merge-link branch in `selectedWorkflowItems` with merged-only rich body. Sketch:

```tsx
const mergeUrl =
  selected.status === "已合入" && selected.reviewerNote && isValidMergeLink(selected.reviewerNote)
    ? selected.reviewerNote.trim()
    : null;

// Inside map for 软件User合入 item when building history/current display:
// When status is 已合入, the early return prepends current status item — also set
// workflowItems[2] (软件User合入) body to include link when mergeUrl is set.

body: mergeUrl ? (
  <>
    {formatWorkflowDisplayText(
      `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。合入链接：`
    )}
    <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
      {mergeUrl}
    </a>
  </>
) : (
  `软件开发人员：${getUserName(state.users, selected.workflowAssignees?.softwareUserId)}。`
)
```

Apply `mergeUrl` body to the **软件User合入** workflow item whenever `mergeUrl` is non-null (including when the current marker sits on `已合入` prepended item). Remove the old branch that injected plain text only for `软件User合入` + valid note.

Insert card before the grow detail-card:

```tsx
{mergeUrl ? (
  <div className="merge-link-card">
    <SectionLabel icon={<Link2 size={16} />} label="合入链接" />
    <p>
      <a href={mergeUrl} target="_blank" rel="noopener noreferrer">
        {mergeUrl}
      </a>
    </p>
  </div>
) : null}
```

Import `Link2` from `lucide-react` if not already imported (or reuse an existing icon already imported, e.g. `ExternalLink` / `Link` — prefer one already in the import list to avoid churn).

Compute `mergeUrl` once near other `selected*` derived values so both the card and timeline share it.

- [ ] **Step 3: Add CSS**

```css
.merge-link-card {
  padding: 13px;
  color: #003d9b;
  background: #eef6ff;
  border: 1px solid #b9d8ff;
  border-radius: 10px;
}

.merge-link-card p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.58;
  word-break: break-all;
}

.merge-link-card a,
.vertical-timeline-item a {
  color: #005de0;
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/App.test.tsx -t "merge link"`

Expected: PASS for required + visibility + negative cases

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css src/App.test.tsx
git commit -m "$(cat <<'EOF'
feat: show stored merge link on merged review detail

EOF
)"
```

---

### Task 3: Prototype specs + docs check + browser verification

**Files:**
- Modify: `docs/product-specs/prototype-functional-spec.md`
- Modify: `docs/zh-CN/product-specs/prototype-functional-spec.md`

**Interfaces:**
- Consumes: Task 2 UI
- Produces: documented product expectation + browser evidence under `work/ui-checks/`

- [ ] **Step 1: Update EN spec**

In the paragraph that already mentions merge-link required (near top / review section), append:

> After merge completes (`已合入`), that link is shown on the review detail as a dedicated card and as a clickable link on the software-merge workflow step.

Or add a bullet under the review workbench section matching the ZH list style.

- [ ] **Step 2: Update ZH spec**

Under §5.2 after the merge-link-required bullet, add:

> - 合入完成后（状态为「已合入」），审阅详情展示独立的「合入链接」卡片，并在流程时间线的「软件User合入」步骤中提供可点击外链。

- [ ] **Step 3: docs:check**

Run: `npm run docs:check`  
Expected: PASS

- [ ] **Step 4: Browser verification**

With `npm run dev` (and API if needed):

```bash
playwright-cli -s=merge-vis open http://127.0.0.1:5173/parameter-review
# Switch to 历史审阅, select an 已合入 row that has reviewerNote URL (seed or prior merge)
playwright-cli -s=merge-vis resize 1440 900
playwright-cli -s=merge-vis snapshot
playwright-cli -s=merge-vis screenshot --filename=work/ui-checks/merge-link-visible-desktop.png
playwright-cli -s=merge-vis resize 768 1024
playwright-cli -s=merge-vis screenshot --filename=work/ui-checks/merge-link-visible-tablet.png
playwright-cli -s=merge-vis resize 390 844
playwright-cli -s=merge-vis screenshot --filename=work/ui-checks/merge-link-visible-mobile.png
playwright-cli -s=merge-vis console error
playwright-cli -s=merge-vis close
```

If no seeded merged row has a URL, use the software-user path to merge one request with `https://example.com/mr/vis`, then open 历史审阅.

Expected: `.merge-link-card a` and timeline `a` present; 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add docs/product-specs/prototype-functional-spec.md docs/zh-CN/product-specs/prototype-functional-spec.md
git commit -m "$(cat <<'EOF'
docs: note merge link visibility after software merge

EOF
)"
```

---

## Spec coverage self-check

| Spec requirement | Task |
| --- | --- |
| Card + timeline when 已合入 + valid link | Task 2 |
| Clickable `target=_blank` + noopener | Task 1 asserts, Task 2 implements |
| No surfaces when invalid / pending-only | Task 1 negative + Task 2 gate |
| No API changes | Global constraint |
| Prototype EN/ZH + docs:check + browser | Task 3 |
| Remove pending plain-text injection | Task 2 |

## Placeholder scan

No TBD / “similar to Task N” / vague validation steps remain.
