# DTS Parameter Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md)

**Goal:** Rebuild API-mode /parameters on the mature parameter workbench framework while deeply integrating nested DTS topology, semantic bindings, provenance, typed drafts, and real submission identity.

**Architecture:** Keep ParametersPage and WorkbenchLayout as the page shell. Keep ApiProjectTopologyWorkspace as the API data coordinator, but replace its topology-only presentation with pure row/tree view models, an embedded topology navigator, a responsive semantic list, the established detail-dialog pattern, and a current-edits tray. Existing topology and binding/spec/candidate contracts remain authoritative.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Lucide React, WiseEff CSS tokens, Playwright acceptance, API-mode topology repository.

**Design:** [DTS Parameter Workbench Deep Redesign](../../superpowers/specs/2026-07-19-dts-parameter-workbench-redesign.md)

---

## Success criteria

1. API-mode /parameters uses the original workbench hierarchy, not a permanent three-pane topology page.
2. gpio_int proves property, driver, instance address, topology path, raw value, value shape, schema/policy state, and source occurrence without path-derived identity.
3. Source/effective nodes render as an expandable hierarchy; selecting a node scopes the list.
4. Search covers property, driver, instance/address, path, source, and raw value. Clear-all preserves drafts.
5. Detail uses the established dialog/sheet interaction and exposes identity, location, provenance, value contract, diagnostics, and typed editing.
6. Drafts appear in a current-edits area and submit only explicit draftId + projectParameterBindingId + parameterSpecId + action items.
7. Project switching clears all project-scoped tree/list/detail/draft state before loading the new project.
8. Mock mode keeps the flat workbench. API mode never renders teaching data or recommendation semantics.
9. Desktop, tablet, and 390px mobile layouts are keyboard-visible and free of page-level horizontal overflow.
10. Tests, build, docs, topology acceptance, and evidence gates pass without production/pilot/cutover claims.

## File map

Create:

- src/domain/parameter-topology/workbenchTypes.ts — semantic row/tree/display contracts.
- src/application/parameters/buildDtsWorkbenchRows.ts and test — pure binding/node/effect/source join.
- src/application/parameters/buildDtsTopologyTree.ts and test — pure nested tree and aggregates.
- src/components/parameter-topology/DtsTopologyNavigator.tsx and test — accessible tree.
- src/components/parameter-topology/DtsParameterWorkbench.tsx and test — toolbar/tree/list/detail/draft coordinator.
- src/components/parameter-topology/DtsParameterWorkbenchTable.tsx — semantic table and mobile cards.
- src/components/parameter-topology/DtsBindingDetailDialog.tsx and test — semantic detail and typed edit.
- src/components/parameter-topology/DtsBindingDraftTray.tsx and test — current edits and semantic submission.

Modify:

- src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx and test.
- src/ParametersPage.tsx and test.
- src/styles.css.
- e2e/acceptance/parameter-topology.acceptance.spec.ts.
- FRONTEND bilingual docs, browser requirement/operation matrices, and clean full-run generated evidence.

## Task 1: Lock the API-mode page boundary

**Files:** Modify/Test src/ParametersPage.test.tsx

- [ ] **Step 1: Add the failing page contract**

~~~tsx
it("keeps the mature workbench shell while API mode uses semantic DTS rows", async () => {
  renderParametersPage({ runtimeMode: "api", topologyRepository: createTopologyRepositoryFixture() });

  expect(await screen.findByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "搜索 DTS 参数" })).toBeInTheDocument();
  expect(screen.getByRole("tree", { name: "生效 DTS 拓扑" })).toBeInTheDocument();
  expect(screen.queryByText("当前 → 推荐")).not.toBeInTheDocument();
  expect(screen.queryByText("推荐值")).not.toBeInTheDocument();
});
~~~

Keep the existing mock-mode ParametersTable and draft-flow assertions.

- [ ] **Step 2: Verify RED**

Run: npm test -- src/ParametersPage.test.tsx

Expected: the new workbench assertions fail; existing mock tests pass.

- [ ] **Step 3: Commit**

~~~bash
git add src/ParametersPage.test.tsx
git commit -m "test(parameters): define integrated DTS workbench boundary"
~~~

## Task 2: Build the semantic DTS row model

**Files:** Create workbenchTypes.ts, buildDtsWorkbenchRows.ts, and mapper test.

- [ ] **Step 1: Define the row contract and RED fixture**

~~~ts
export type DtsParameterWorkbenchRow = {
  bindingId: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  logicalNodeId: string | null;
  propertyKey: string;
  driverModule: string | null;
  instanceName: string | null;
  unitAddress: string | null;
  topologyPath: string;
  topologyNodeId: string | null;
  sourceOccurrenceId: string | null;
  sourceFileName: string | null;
  sourceNodePath: string | null;
  sourceLine: number | null;
  rawValue: string;
  effectiveValue: DtsValue;
  valueShapeSummary: string;
  schemaState: BindingSchemaState;
  policyState: BindingPolicyState;
  mappingOpen: boolean;
  governanceState: "valid" | "attention" | "blocked";
  effects: EffectiveTopologyEffect[];
  searchText: string;
  view: TopologyView;
};
~~~

Use an amba/i2c@FDF5E000/sc8562@6E fixture with gpio_int, <&gpio13 29 0>, and an open mapping. Assert exact path, address, shape, source line, governance, and search text.

- [ ] **Step 2: Verify RED**

Run: npm test -- src/application/parameters/buildDtsWorkbenchRows.test.ts

- [ ] **Step 3: Implement the pure mapper**

~~~ts
export function buildDtsWorkbenchRows(input: {
  view: TopologyView;
  bindings: ProjectParameterBinding[];
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  mappingTasks: IdentityMappingTask[];
}): DtsParameterWorkbenchRow[];
~~~

Use parent logical-node links for display paths. Resolve source occurrence through the latest property effect by sourceOrder. Never use a path as identity. Summarize cell values as phandle-list|cell-array · N bit · M cells.

~~~ts
const governanceState =
  binding.schemaState === "invalid" || binding.policyState === "fail"
    ? "blocked"
    : mappingOpen || binding.schemaState === "unreviewed"
      ? "attention"
      : "valid";
~~~

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm test -- src/application/parameters/buildDtsWorkbenchRows.test.ts src/domain/parameter-topology/types.test.ts
git add src/domain/parameter-topology/workbenchTypes.ts src/application/parameters/buildDtsWorkbenchRows.ts src/application/parameters/buildDtsWorkbenchRows.test.ts
git commit -m "feat(parameters): map DTS bindings into workbench rows"
~~~

## Task 3: Build the nested source/effective navigator

**Files:** Create tree builder/test and DtsTopologyNavigator/test.

- [ ] **Step 1: Write failing hierarchy and ARIA tests**

~~~ts
export type DtsWorkbenchTreeNode = {
  id: string;
  parentId: string | null;
  label: string;
  name: string;
  unitAddress: string | null;
  compatible: string | null;
  bindingIds: string[];
  bindingCount: number;
  attentionCount: number;
  children: DtsWorkbenchTreeNode[];
};
~~~

Assert amba → i2c@FDF5E000 → sc8562@6E, repository order, ancestor counts, role=tree, aria-expanded, selection, and keyboard expansion.

- [ ] **Step 2: Verify RED**

Run: npm test -- src/application/parameters/buildDtsTopologyTree.test.ts src/components/parameter-topology/DtsTopologyNavigator.test.tsx

- [ ] **Step 3: Implement builder and navigator**

~~~ts
export function buildDtsTopologyTree(input: {
  view: TopologyView;
  sourceNodes: SourceTopologyNode[];
  effectiveNodes: EffectiveTopologyNode[];
  rows: DtsParameterWorkbenchRow[];
}): DtsWorkbenchTreeNode[];
~~~

Source uses parentOccurrenceId; effective uses parentLogicalNodeId. Default roots and selected path to expanded. Support Enter/Space selection and ArrowRight/ArrowLeft expansion.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm test -- src/application/parameters/buildDtsTopologyTree.test.ts src/components/parameter-topology/DtsTopologyNavigator.test.tsx
git add src/application/parameters/buildDtsTopologyTree.ts src/application/parameters/buildDtsTopologyTree.test.ts src/components/parameter-topology/DtsTopologyNavigator.tsx src/components/parameter-topology/DtsTopologyNavigator.test.tsx
git commit -m "feat(parameters): add nested DTS topology navigator"
~~~

## Task 4: Create the semantic toolbar and main list

**Files:** Create DtsParameterWorkbench.tsx, DtsParameterWorkbenchTable.tsx, and test.

- [ ] **Step 1: Write failing search/filter/node tests**

~~~tsx
await user.type(screen.getByRole("searchbox", { name: "搜索 DTS 参数" }), "gpio13");
expect(screen.getByRole("row", { name: /gpio_int/ })).toBeInTheDocument();
expect(screen.queryByRole("row", { name: /status/ })).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "清除全部筛选" }));
expect(screen.getByRole("row", { name: /status/ })).toBeInTheDocument();
~~~

Also test selecting sc8562@6E, result counts, status badges, and draft preservation after clearing filters.

- [ ] **Step 2: Verify RED**

Run: npm test -- src/components/parameter-topology/DtsParameterWorkbench.test.tsx

- [ ] **Step 3: Implement coordinator and table**

The workbench owns search, governance filter, source/effective view, selected node, and selected binding. Desktop headers are 属性, 器件 / 驱动, DTS 位置, 生效值, 类型, 治理, 操作. Mobile renders cards. Use binding IDs for keys and data-binding-id. Do not convert semantic rows into legacy ParameterRecord.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm test -- src/components/parameter-topology/DtsParameterWorkbench.test.tsx src/components/parameter-topology/DtsTopologyNavigator.test.tsx
git add src/components/parameter-topology/DtsParameterWorkbench.tsx src/components/parameter-topology/DtsParameterWorkbenchTable.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx
git commit -m "feat(parameters): restore semantic parameter workbench list"
~~~

## Task 5: Integrate the mature detail dialog and typed editing

**Files:** Create DtsBindingDetailDialog.tsx/test; modify workbench/test.

- [ ] **Step 1: Write failing dialog tests**

Assert gpio_int 参数详情, sc8562@6E, full path, source line, shape, and effect. Create draft remains disabled until reason is non-empty.

~~~ts
expect(onCreateDraft).toHaveBeenCalledWith({
  bindingId: "binding-gpio-int",
  rawValue: "<&gpio13 30 0>",
  reason: "Move interrupt line"
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm test -- src/components/parameter-topology/DtsBindingDetailDialog.test.tsx

- [ ] **Step 3: Implement the dialog**

~~~ts
export type DtsBindingDetailDialogProps = {
  row: DtsParameterWorkbenchRow;
  canEdit: boolean;
  onClose: () => void;
  onCreateDraft: (input: { bindingId: string; rawValue: string; reason: string }) => Promise<BindingEditValidation>;
};
~~~

Render labelled sections 身份, DTS 位置, 来源链, 值与约束, 类型化编辑. Use existing modal/sheet focus behavior. Server validation remains authoritative. Closing clears selected binding only.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm test -- src/components/parameter-topology/DtsBindingDetailDialog.test.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx
git add src/components/parameter-topology/DtsBindingDetailDialog.tsx src/components/parameter-topology/DtsBindingDetailDialog.test.tsx src/components/parameter-topology/DtsParameterWorkbench.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx
git commit -m "feat(parameters): add DTS binding workbench detail flow"
~~~

## Task 6: Restore current edits and semantic submission

**Files:** Create DtsBindingDraftTray.tsx/test; modify workbench and API coordinator/tests.

- [ ] **Step 1: Write failing tray and payload tests**

Render typed drafts and assert current→target, reason, action, candidate, remove action, roles, and exact semantic items. No item contains parameterId or recommendedValue.

~~~ts
expect(onSubmit).toHaveBeenCalledWith({
  projectId: "aurora",
  items: [{
    draftId: "draft-gpio-int",
    projectParameterBindingId: "binding-gpio-int",
    parameterSpecId: "spec-gpio-int",
    action: "set",
    targetValue: "<&gpio13 30 0>",
    reason: "Move interrupt line"
  }],
  assignees: {
    hardwareCommitterId: "hardware-committer",
    softwareCommitterId: "software-committer",
    softwareUserId: "software-user"
  }
});
~~~

- [ ] **Step 2: Verify RED**

Run: npm test -- src/components/parameter-topology/DtsBindingDraftTray.test.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx

- [ ] **Step 3: Implement tray and project-safe draft state**

~~~ts
const [pendingDrafts, setPendingDrafts] = useState<PendingBindingDraft[]>([]);

setPendingDrafts((current) => [
  ...current.filter((item) => item.projectParameterBindingId !== draft.projectParameterBindingId),
  draft
]);
~~~

Clear drafts on project change. Ignore late responses through activeProjectIdRef. Disable submit for missing candidates/errors/identity. Removing a draft changes local presentation only and must not invent a server deletion call.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
npm test -- src/components/parameter-topology/DtsBindingDraftTray.test.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx
git add src/components/parameter-topology/DtsBindingDraftTray.tsx src/components/parameter-topology/DtsBindingDraftTray.test.tsx src/components/parameter-topology/DtsParameterWorkbench.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx
git commit -m "feat(parameters): restore semantic current-edits submission tray"
~~~

## Task 7: Replace topology-only composition in ParametersPage

**Files:** Modify API coordinator/test and ParametersPage.tsx/test.

- [ ] **Step 1: Feed pure rows to DtsParameterWorkbench**

After LoadState.ready, derive rows and pass real nodes, mappings, diagnostics, drafts, candidates, and validate/resolve/submit callbacks to the integrated workbench.

- [ ] **Step 2: Preserve original page shell**

Always keep WorkbenchLayout and parameters-page-layout. API mode renders only the semantic workbench; mock mode renders only the flat table/detail/draft flow. Do not restore the pre-e9eb025f API legacy table.

- [ ] **Step 3: Verify and commit**

~~~bash
npm test -- src/ParametersPage.test.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx src/components/parameter-topology/DtsParameterWorkbench.test.tsx
git add src/ParametersPage.tsx src/ParametersPage.test.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.tsx src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx
git commit -m "refactor(parameters): integrate DTS topology into original workbench"
~~~

## Task 8: Apply visual system and responsive layout

**Files:** Modify src/styles.css and new components/tests.

- [ ] **Step 1: Add failing region/class hooks**

Assert dts-parameter-workbench, dts-workbench-topology, dts-workbench-list, and dts-draft-tray on labelled regions.

- [ ] **Step 2: Add icon controls and scoped CSS**

Use Lucide icons; icon-only controls require aria-label. Reuse global .button and tokens.

~~~css
.dts-parameter-workbench {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.dts-workbench-surface {
  min-width: 0;
  background: var(--surface);
  border: 1px solid #dfe5f3;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
}

.dts-workbench-body {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
~~~

Add hover/selected/draft/blocked/focus/disabled/skeleton/empty/error states. Below 1200px collapse topology; below 820px rows become cards; below 480px detail is full-height, targets are at least 44px, and long paths wrap.

- [ ] **Step 3: Verify and commit**

~~~bash
npm test -- src/ParametersPage.test.tsx src/components/parameter-topology src/application/parameters/buildDtsWorkbenchRows.test.ts src/application/parameters/buildDtsTopologyTree.test.ts
npm run build
git add src/styles.css src/components/parameter-topology
git commit -m "feat(parameters): polish integrated DTS workbench UX"
~~~

## Task 9: Visible acceptance, docs, and final gates

**Files:** Modify topology acceptance, FRONTEND bilingual docs, coverage matrices, plan companions; regenerate clean successful full-run evidence.

- [ ] **Step 1: Drive visible workbench acceptance** *(automation updated; actual execution blocked by missing disposable-DB/auth runtime prerequisites)*

Keep operation IDs PARAM-TOPOLOGY-BROWSE-001, PARAM-TOPOLOGY-EDIT-001, and PARAM-HAPPY-001.

~~~ts
await page.getByRole("searchbox", { name: "搜索 DTS 参数" }).fill("gpio_int");
await page.getByRole("treeitem", { name: /sc8562@6E/ }).click();
await expect(page.getByRole("row", { name: /gpio_int/ })).toContainText("<&gpio13 29 0>");
await page.getByRole("button", { name: "查看 gpio_int" }).click();
await expect(page.getByRole("dialog", { name: "gpio_int 参数详情" })).toContainText("phandle-list · 32 bit · 3 cells");
~~~

### Task 9 outcome (2026-07-19)

The topology acceptance keeps `PARAM-TOPOLOGY-BROWSE-001`,
`PARAM-TOPOLOGY-EDIT-001`, and `PARAM-HAPPY-001` and now drives the integrated
workbench contract: semantic search, nested source/effective context,
`gpio_int` detail (including raw value and value shape), typed draft/current
edits, visible role review, semantic merge/writeback, reload, and immutable
base evidence. Selectors use `DTS 参数工作台`, `搜索 DTS 参数`, `源 DTS`, and
`生效 DTS`; no repository or direct business-database bypass was added.

The required browser matrix is 1440×900, 768×1024, and 390×844 with
snapshot/screenshot, console, network, focus, and document-overflow checks.
This worktree did not complete that semantic matrix: the available 5175 runtime
showed the unauthenticated login page and `/api/v1/me` returned 401; the 5174
process belonged to the other workspace and was not stopped. No generated
browser/operation evidence or full-run claim was created. The focused
acceptance failed at line 306 with `DATABASE_URL is required to create the
disposable topology database`. A full `acceptance:e2e` attempt then timed out
because the webServer raised `Production auth verifier is required when
AUTH_MODE=production`; `acceptance:evidence` exits 1 with
`coveredOperationIds=[]` and 54 missing operations, including
`PARAM-HAPPY-001`, `PARAM-TOPOLOGY-BROWSE-001`, and
`PARAM-TOPOLOGY-EDIT-001`. Therefore this round created no generated browser or
operation evidence and makes no clean full-run claim.
Any future standard `acceptance:browser` run remains an honest
external-readiness result: `deviceGateway`, `xiaozeLlm`, and `backups` can block
the outer runner. Isolated topology/full evidence may pass, but must not
overwrite the `latest-full` namespace or be described as production/cutover
readiness. TD-042 remains a BLOCKER until a clean non-customer snapshot
apply → cutover → whole-database restore → old-API smoke rehearsal succeeds.

Continue through reason, typed draft, current edits, role submit, review, merge, reload, and base immutability. Do not add repository/DB business bypasses.

- [x] **Step 2: Update docs and coverage**

Document API /parameters as an integrated semantic workbench, neither a topology-only replacement nor the legacy recommendation table. Record affected requirement/operation IDs or why existing IDs remain sufficient.

- [ ] **Step 3: Run static/full gates** *(blocked: this worktree ran contract/docs/build and focused tests, but the full `test:all` gate was not completed)*

~~~bash
npm run contract:check
npm run docs:check
npm run build
npm run test:all
git diff --check
~~~

- [ ] **Step 4: Run required browser verification** *(blocked: the available 5175 runtime was unauthenticated; semantic workbench interaction could not be exercised)*

Use playwright-cli at 1440×900, 768×1024, and 390×844. Exercise search, nested selection, detail, edit, drafts, clear filters, and project switch. Capture snapshot/screenshot; check console, network, focus, overlap, clipping, and document overflow.

- [ ] **Step 5: Run acceptance/evidence** *(blocked: `DATABASE_URL is required to create the disposable topology database`; standard webServer also timed out because `AUTH_MODE=production` had no production auth verifier)*

~~~bash
npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts
npm run acceptance:browser -- --mode local-non-hdc --frontend-url http://127.0.0.1:5174
npm run acceptance:evidence
~~~

Do not use --skip-preflight or --skip-gates for the claimed standard run. Publish evidence only from a completed clean full run. Keep TD-042/external blockers accurate.

- [ ] **Step 6: Complete documentation gate and commit** *(blocked: generated acceptance artifacts require the missing clean full run; the honest blocker fix is committed separately)*

~~~bash
git add e2e/acceptance/parameter-topology.acceptance.spec.ts docs src
git commit -m "test(parameters): verify integrated DTS workbench acceptance"
~~~

## Implementation constraints

- The current binding DTO does not always provide compatible or full spec detail. Render only proven fields and an explicit unavailable state; do not add an API endpoint inside this frontend plan.
- The current product has no delete-authoring control. Preserve delete rendering and existing acceptance without inventing a new delete action.
- The current semantic coordinator may expose only one safe active candidate chain at a time. The tray uses an array-shaped presentation contract, but implementation must not claim multi-candidate batch safety unless existing server tests prove it; otherwise keep only the latest binding draft and record that limitation in the plan outcome.
- Existing local non-HDC readiness and TD-042 semantics are unchanged.

## Documentation Impact Matrix

| Area | Impact | Paths |
| --- | --- | --- |
| Repository maps | Review | AGENTS.md, ARCHITECTURE.md, docs/README.md; expected unchanged unless routing changes materially |
| Planning | Update | this plan, Chinese companion, docs/PLANS.md, docs/zh-CN/PLANS.md |
| Product specification | Review | product-spec pair; expected workflow policy unchanged |
| Architecture/domain | Review | domain-model pair; semantic identity unchanged |
| API contract | Review | api-contract pair; no endpoint/identity change expected |
| Frontend design | Update | docs/FRONTEND.md, docs/zh-CN/frontend.md, approved design pair |
| Quality/testing | Update | browser acceptance coverage map and user operation matrix; review testing-strategy pair |
| Reliability/runbooks | Review | manual-acceptance pair; runtime/readiness unchanged |
| Security/governance | Review | SECURITY pair; authz/human approval unchanged |
| Generated artifacts | Update (blocked) | No `docs/generated` acceptance evidence is updated in this round: disposable DB and authentication blockers prevented a clean full run; do not reuse or cite an older evidence index. |
| References | Review | productization API contract draft; expected unchanged |
| Technical debt | Review | tech-debt tracker; TD-042 stays BLOCKER |

## Documentation Update Gate

Before completion: implement every Update; record a change or explicit unchanged reason for every Review; pass npm run docs:check; preserve requirement/operation evidence; do not close or weaken TD-042. This gate is currently **BLOCKED** because the Generated-artifacts Update requires a clean full run that the disposable-DB/auth runtime blockers prevented.

## Git & PR Workflow

- Execution branch: fix/parameter-topology-round6-review-blockers.
- This follow-up intentionally shares the Round6 feature branch because its prerequisite semantic topology is not in main; do not squash or rebase history.
- Implementation workers commit only on the feature branch. They do not push, open PRs, merge, or modify main.
- The parent agent reviews and verifies. Preserve user changes, use apply_patch, and avoid destructive reset/checkout.

## Explicit non-claims

Completion proves the integrated frontend workbench and local acceptance only. It does not prove pilot, production, cutover, or merge readiness. TD-042 stays BLOCKER until a clean non-customer snapshot apply → cutover → whole-database restore → old-API smoke rehearsal succeeds.
