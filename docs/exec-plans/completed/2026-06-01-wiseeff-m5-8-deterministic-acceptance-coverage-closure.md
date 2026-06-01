# WiseEff M5.8 Deterministic Acceptance Coverage Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Behavior-changing fixes discovered during execution must follow `superpowers:test-driven-development`: write a failing test first, verify the failure, implement the smallest fix, then verify green.

**Goal:** Close the remaining deterministic browser-acceptance gaps without introducing AI browser agents, so WiseEff can explain every important user operation as automated, conditional, or explicitly deferred.

**Architecture:** M5.6 made the browser suite honest at the user-operation level and M5.7 made the results evidence-grade. M5.8 stays on the deterministic path: it expands the requirement map, operation matrix, and Playwright specs for the operations still labeled `future` or `conditional`, then keeps docs, runbooks, and generated evidence aligned. If a behavior is still a product gap, the plan keeps that gap explicit instead of masking it behind broader workflow passes or AI exploratory tooling.

**Tech Stack:** Playwright Test, TypeScript, Vitest, node-postgres, existing acceptance scripts, existing browser diagnostics helpers, Markdown docs, generated evidence artifacts.

---

## Background

M5.4 introduced deterministic browser acceptance. M5.5 added requirement-level coverage. M5.6 added a role-aware operation matrix. M5.7 upgraded the browser suite into replayable evidence packages.

What remains is not AI. It is the deterministic closure of the browser gaps still labeled `future` or `conditional`. The browser validation system should answer, with one source of truth, which non-AI user operations are automated, which are still intentionally deferred, and why.

Current gap set:

- `PARAM-DRAFT-EDIT-001`
- `PARAM-REJECT-001`
- `LOG-REANALYZE-001`
- `DEBUG-PERM-001`
- `AGENT-UNAUTH-001`
- `PERM-USER-MGMT-001`
- `HDC-LAB-001` remains conditional and is not part of this non-AI closure plan.

## Scope

In scope:

- Add the missing requirement IDs and operation IDs for the remaining deterministic user operations.
- Implement or stabilize the UI/API flows so the operations become automated where the contract already exists.
- Keep any true product gaps explicit with stable deferral reasons instead of silent coverage.
- Update browser coverage docs, operation matrix docs, runbooks, Chinese docs, and the roadmap.
- Preserve operation evidence generation and browser diagnostics.

Out of scope:

- AI exploratory QA, Stagehand, Browser Use, Skyvern, or other non-deterministic browser agents.
- Staging/HDC/device-lab pilot closure.
- OIDC/SSO, durable queue, cloud IaC, observability, or capacity testing.
- Replacing Playwright with another browser automation stack.

## Sequenced Horizon

M5.8 is the next non-AI step. Later non-AI hardening should follow only after this plan lands:

- M5.9 State Model & Contract-Driven Testing
- M5.10 Evidence-Grade Upgrade
- M5.11 Accessibility / Visual / Responsive Gates
- M5.12 Staging Synthetic & CI Evidence Archiving

## Success Criteria

- `npm run acceptance:coverage` passes with no unknown required IDs.
- `npm run acceptance:operations` passes with every automated operation marked and no missing deferral reasons.
- `npm run acceptance:evidence` passes and the generated operation evidence index covers every automated P0/P1 operation.
- `npm run acceptance:browser` passes and regenerates browser evidence.
- `docs:check`, `npm run build`, and `git diff --check` all pass.
- Any remaining `future` or `conditional` operations are explicitly documented with stable reasons.

## Files

- Modify: `e2e/acceptance/requirements.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `scripts/check-acceptance-coverage.ts`
- Modify: `scripts/check-acceptance-coverage.test.ts`
- Modify: `scripts/check-acceptance-operation-matrix.ts`
- Modify: `scripts/check-acceptance-operation-matrix.test.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/agent.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`
- Modify if needed: `src/UserPermissionsPage.tsx`
- Modify if needed: `src/UserPermissionsPage.test.tsx`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify: `docs/PLANS.md`
- Review: `docs/QUALITY_SCORE.md`
- Review: `docs/design-docs/testing-strategy.md`
- Review: `docs/FRONTEND.md`
- Review: `docs/SECURITY.md`
- Review: `docs/product-specs/product-spec.md`
- Review: `docs/product-specs/prototype-functional-spec.md`
- Review: `docs/README.md`
- Review: `docs/references/productization-api-contract-draft.md`
- Update on run: `docs/generated/acceptance-browser-evidence.md`
- Update on run: `docs/generated/acceptance-operation-evidence.md`
- Update on run: `docs/generated/acceptance-operation-evidence/index.json`

## Task 1: Add the missing requirement and operation IDs

**Files:**

- Modify: `e2e/acceptance/requirements.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `scripts/check-acceptance-coverage.test.ts`
- Modify: `scripts/check-acceptance-operation-matrix.test.ts`

- [ ] **Step 1: Write failing coverage tests for the remaining non-AI operations**

Add this shape to `scripts/check-acceptance-coverage.test.ts`:

```ts
it("treats the remaining non-AI browser gaps as required coverage", () => {
  const result = evaluateAcceptanceCoverage({
    requirements: [
      ...acceptanceRequirements,
      { id: "PARAM-DRAFT-EDIT-001", workflow: "B", title: "Draft edit/remove before submission.", required: true },
      { id: "PARAM-REJECT-001", workflow: "B", title: "Reject a parameter review.", required: true },
      { id: "LOG-REANALYZE-001", workflow: "D", title: "Rerun log analysis.", required: true },
      { id: "DEBUG-PERM-001", workflow: "E", title: "Block write controls for read-only roles.", required: true },
      { id: "AGENT-UNAUTH-001", workflow: "G", title: "Reject unapproved Agent execution.", required: true },
      { id: "PERM-USER-MGMT-001", workflow: "H", title: "Admin user-role management.", required: true }
    ],
    specFiles: readAcceptanceSpecFiles()
  });

  expect(result.status).toBe("failed");
  expect(result.missingRequiredIds).toEqual([
    "PARAM-DRAFT-EDIT-001",
    "PARAM-REJECT-001",
    "LOG-REANALYZE-001",
    "DEBUG-PERM-001",
    "AGENT-UNAUTH-001",
    "PERM-USER-MGMT-001"
  ]);
});
```

Add this shape to `scripts/check-acceptance-operation-matrix.test.ts`:

```ts
const nextOperations: AcceptanceOperation[] = [
  {
    id: "PARAM-DRAFT-EDIT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User"],
    action: "Edit and remove draft items before submission.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
    specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-REJECT-001",
    priority: "P1",
    area: "parameters",
    route: "/parameter-review",
    roles: ["Hardware Committer", "Software Committer"],
    action: "Reject a parameter review and show status, reason, and audit evidence.",
    coverage: "automated",
    acceptanceIds: ["PARAM-REJECT-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "LOG-REANALYZE-001",
    priority: "P1",
    area: "logs",
    route: "/logs",
    roles: ["Software User", "Software Committer", "Admin"],
    action: "Rerun log analysis and verify a new run, progress, and audit record.",
    coverage: "automated",
    acceptanceIds: ["LOG-REANALYZE-001"],
    specFiles: ["e2e/acceptance/log-analysis.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "DEBUG-PERM-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Guest", "Hardware User", "Software User"],
    action: "Verify roles without write permission cannot perform node write operations.",
    coverage: "automated",
    acceptanceIds: ["DEBUG-PERM-001"],
    specFiles: ["e2e/acceptance/debugging-simulator.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "AGENT-UNAUTH-001",
    priority: "P1",
    area: "agent",
    route: "/agent",
    roles: ["Guest", "Hardware User", "Software User"],
    action: "Reject direct execution of an unapproved Agent write tool.",
    coverage: "automated",
    acceptanceIds: ["AGENT-UNAUTH-001"],
    specFiles: ["e2e/acceptance/agent.acceptance.spec.ts"],
    assertions: ["api", "audit"]
  },
  {
    id: "PERM-USER-MGMT-001",
    priority: "P1",
    area: "permissions",
    route: "/user-permissions",
    roles: ["Admin"],
    action: "Admin can create or update a non-self user's role while non-Admin cannot access the same operation.",
    coverage: "automated",
    acceptanceIds: ["PERM-USER-MGMT-001"],
    specFiles: ["e2e/acceptance/permissions.acceptance.spec.ts"],
    assertions: ["ui", "api", "audit"]
  }
];

it("automates the remaining non-AI browser operations", () => {
  const result = evaluateOperationMatrix({
    operations: [...acceptanceOperations, ...nextOperations],
    specFiles: [
      { file: "e2e/acceptance/parameters-negative.acceptance.spec.ts", content: "// @acceptance PARAM-DRAFT-EDIT-001\n// @operation PARAM-DRAFT-EDIT-001" },
      { file: "e2e/acceptance/parameters.acceptance.spec.ts", content: "// @acceptance PARAM-REJECT-001\n// @operation PARAM-REJECT-001" },
      { file: "e2e/acceptance/log-analysis.acceptance.spec.ts", content: "// @acceptance LOG-REANALYZE-001\n// @operation LOG-REANALYZE-001" },
      { file: "e2e/acceptance/debugging-simulator.acceptance.spec.ts", content: "// @acceptance DEBUG-PERM-001\n// @operation DEBUG-PERM-001" },
      { file: "e2e/acceptance/agent.acceptance.spec.ts", content: "// @acceptance AGENT-UNAUTH-001\n// @operation AGENT-UNAUTH-001" },
      { file: "e2e/acceptance/permissions.acceptance.spec.ts", content: "// @acceptance PERM-USER-MGMT-001\n// @operation PERM-USER-MGMT-001" }
    ],
    knownAcceptanceIds: [
      ...acceptanceRequirements.map((requirement) => requirement.id),
      "PARAM-DRAFT-EDIT-001",
      "PARAM-REJECT-001",
      "LOG-REANALYZE-001",
      "DEBUG-PERM-001",
      "AGENT-UNAUTH-001",
      "PERM-USER-MGMT-001"
    ]
  });

  expect(result.status).toBe("passed");
  expect(result.missingAutomatedOperationIds).toEqual([]);
});
```

- [ ] **Step 2: Implement the registry entries**

```ts
// e2e/acceptance/requirements.ts
{ id: "PARAM-DRAFT-EDIT-001", workflow: "B", title: "Draft edit/remove before submission.", required: true },
{ id: "PARAM-REJECT-001", workflow: "B", title: "Reject a parameter review.", required: true },
{ id: "LOG-REANALYZE-001", workflow: "D", title: "Rerun log analysis.", required: true },
{ id: "DEBUG-PERM-001", workflow: "E", title: "Block write controls for read-only roles.", required: true },
{ id: "AGENT-UNAUTH-001", workflow: "G", title: "Reject unapproved Agent execution.", required: true },
{ id: "PERM-USER-MGMT-001", workflow: "H", title: "Admin user-role management.", required: true }
```

```ts
// e2e/acceptance/operationMatrix.ts
// add the six entries above with coverage: "automated"
```

- [ ] **Step 3: Verify the registry tests fail first, then pass**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts scripts/check-acceptance-operation-matrix.test.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Expected:

- The first test run fails before the implementation lands.
- The second and third commands pass after the registry entries and markers are in place.

## Task 2: Close the parameter workflow gaps

**Files:**

- Modify: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify if needed: `server/modules/parameters/routes.test.ts`
- Modify if needed: `server/modules/parameters/service.test.ts`
- Modify if needed: `server/modules/parameters/policy.test.ts`

- [ ] **Step 1: Write the failing draft-edit/remove and review-reject acceptance tests**

Add to `parameters-negative.acceptance.spec.ts`:

```ts
test("edits and removes a draft before final submission", async ({ page }, testInfo) => {
  // @acceptance PARAM-DRAFT-EDIT-001
  // @operation PARAM-DRAFT-EDIT-001
  // seed and open the draft, modify the target value, remove the draft, and assert no submission round was created
  await recordOperationEvidence({
    operationId: "PARAM-DRAFT-EDIT-001",
    title: "draft edit and remove before submit",
    status: "passed",
    role: "Hardware User",
    route: "/parameters",
    assertions: ["ui", "api", "db", "audit"]
  });
});
```

Add to `parameters.acceptance.spec.ts`:

```ts
test("rejects a parameter review with a visible reason and audit trail", async ({ page }, testInfo) => {
  // @acceptance PARAM-REJECT-001
  // @operation PARAM-REJECT-001
  // seed a reviewable request, reject it with a reason, and assert the status becomes rejected
  await recordOperationEvidence({
    operationId: "PARAM-REJECT-001",
    title: "parameter review rejection",
    status: "passed",
    role: "Hardware Committer",
    route: "/parameter-review",
    assertions: ["ui", "api", "db", "audit"]
  });
});
```

- [ ] **Step 2: Implement the minimum UI/API behavior needed for those tests**

- Draft edit/remove must preserve the draft until explicit remove, allow the modified value to be resubmitted, and leave the list empty after removal.
- Review rejection must persist the rejected status, the reason, and the audit event, and the review page must show the rejected state after reload.
- If the current route already supports the interaction, keep the change to selector, state, or seed stability only.

- [ ] **Step 3: Verify the parameter flows**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters-negative.acceptance.spec.ts e2e/acceptance/parameters.acceptance.spec.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: both browser specs pass and the new operation IDs remain visible in evidence.

## Task 3: Close the logs and debugging gaps

**Files:**

- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify if needed: `server/modules/logs/routes.test.ts`
- Modify if needed: `server/modules/logs/worker.test.ts`
- Modify if needed: `server/modules/debugging/routes.test.ts`
- Modify if needed: `server/modules/debugging/policy.test.ts`

- [ ] **Step 1: Write the failing reanalysis and debug-permission tests**

Add to `log-analysis.acceptance.spec.ts`:

```ts
test("re-runs analysis from an existing completed log", async ({ page }, testInfo) => {
  // @acceptance LOG-REANALYZE-001
  // @operation LOG-REANALYZE-001
  // reopen the completed log, trigger rerun, wait for the new run id, and assert progress plus audit
  await recordOperationEvidence({
    operationId: "LOG-REANALYZE-001",
    title: "log rerun analysis",
    status: "passed",
    role: "Software User",
    route: "/logs",
    assertions: ["ui", "api", "db", "audit"]
  });
});
```

Add to `debugging-simulator.acceptance.spec.ts`:

```ts
test("hides or blocks write controls for roles without write permission", async ({ page }, testInfo) => {
  // @acceptance DEBUG-PERM-001
  // @operation DEBUG-PERM-001
  // log in as a read-only role, verify write controls are hidden or disabled, and force the API path to return 403
  await recordOperationEvidence({
    operationId: "DEBUG-PERM-001",
    title: "debug write permission rejection",
    status: "passed",
    role: "Hardware User",
    route: "/node-debugging",
    assertions: ["ui", "api"]
  });
});
```

- [ ] **Step 2: Implement the minimum behavior**

- Log reanalysis should create a fresh run, link the new progress to the selected log, and write a separate audit event instead of mutating the old run in place.
- Debug permission should continue to reject write attempts for Guest/Hardware User/Software User and keep write controls hidden or disabled in the UI.

- [ ] **Step 3: Verify the logs/debugging flows**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts e2e/acceptance/debugging-simulator.acceptance.spec.ts
npm run acceptance:operations
npm run acceptance:evidence
```

Expected: pass and emit evidence for the two operation IDs.

## Task 4: Close the agent and user-management gaps

**Files:**

- Modify: `e2e/acceptance/agent.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`
- Modify if needed: `server/modules/agent/routes.test.ts`
- Modify if needed: `server/modules/agent/orchestrator.test.ts`
- Modify if needed: `src/UserPermissionsPage.tsx`
- Modify if needed: `src/UserPermissionsPage.test.tsx`

- [ ] **Step 1: Write the failing unauthorized Agent and admin user-management tests**

Add to `agent.acceptance.spec.ts`:

```ts
test("rejects direct execution of an unapproved Agent write tool", async ({ page }, testInfo) => {
  // @acceptance AGENT-UNAUTH-001
  // @operation AGENT-UNAUTH-001
  // send the tool path without approval and assert the response is forbidden or approval-required
  await recordOperationEvidence({
    operationId: "AGENT-UNAUTH-001",
    title: "unauthorized agent write tool",
    status: "passed",
    role: "Software User",
    route: "/agent",
    assertions: ["api", "audit"]
  });
});
```

Add to `permissions.acceptance.spec.ts`:

```ts
test("lets Admin create or update a non-self user role while non-Admin cannot", async ({ page }, testInfo) => {
  // @acceptance PERM-USER-MGMT-001
  // @operation PERM-USER-MGMT-001
  // create or update a different user, verify the role change is visible after reload, and verify the same operation is blocked for a non-Admin session
  await recordOperationEvidence({
    operationId: "PERM-USER-MGMT-001",
    title: "admin user management",
    status: "passed",
    role: "Admin",
    route: "/user-permissions",
    assertions: ["ui", "api", "audit"]
  });
});
```

- [ ] **Step 2: Implement the minimum deterministic behavior**

- Agent unauthorized execution must fail before tool execution, keep the approval boundary intact, and expose a stable error code for the browser suite.
- User-management must use the existing `/user-permissions` page controls and should keep the non-self update visible after reload; if the current page is local-prototype state only, document that explicitly in the operation matrix rather than pretending it is durable backend state.

- [ ] **Step 3: Verify the agent and permissions flows**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts
npm run acceptance:operations
npm run acceptance:evidence
```

Expected: pass.

## Task 5: Update the docs and generated evidence contract

**Files:**

- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify: `docs/PLANS.md`
- Review: `docs/QUALITY_SCORE.md`
- Review: `docs/design-docs/testing-strategy.md`
- Review: `docs/FRONTEND.md`
- Review: `docs/SECURITY.md`
- Review: `docs/product-specs/product-spec.md`
- Review: `docs/product-specs/prototype-functional-spec.md`
- Review: `docs/README.md`
- Review: `docs/references/productization-api-contract-draft.md`

- [ ] **Step 1: Update the coverage and operation matrices**

- Add the six requirement IDs to `docs/developer/browser-acceptance-coverage-map.md`.
- Move the six matching operation IDs from `future` or `conditional` to `automated` in `docs/developer/user-operation-coverage-matrix.md` if their contract is now deterministic.
- If any item must stay deferred, keep the row explicit and add a stable reason instead of silently hiding it.

- [ ] **Step 2: Update the manual acceptance runbooks**

Add a short review rule in `docs/runbooks/manual-acceptance.md` and `docs/zh-CN/manual-acceptance.md`:

- `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:evidence`, and `npm run acceptance:browser` are all part of the non-AI browser gate.
- Missing requirement IDs, missing operation IDs, or missing operation evidence are blocking failures.
- `future` or `conditional` operation rows must explain why they are not automated yet.

- [ ] **Step 3: Update the roadmap and plan index**

Add the M5.8 plan to `docs/PLANS.md` and add a new non-AI horizon section to `docs/exec-plans/active/development-roadmap.md` for M5.8 through M5.12.

- [ ] **Step 4: Verify documentation gates**

Run:

```bash
npm run docs:check
```

Expected: pass.

## Task 6: Final verification and evidence regeneration

**Files:**

- Update on run: `docs/generated/acceptance-browser-evidence.md`
- Update on run: `docs/generated/acceptance-operation-evidence.md`
- Update on run: `docs/generated/acceptance-operation-evidence/index.json`

- [ ] **Step 1: Run the targeted unit gates**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts scripts/check-acceptance-operation-matrix.test.ts scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts
```

Expected: pass.

- [ ] **Step 2: Run the browser acceptance gates**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:evidence
npm run acceptance:browser
```

Expected: all pass, and the generated browser evidence matches the updated operation matrix.

- [ ] **Step 3: Run the repository gates**

Run:

```bash
npm run docs:check
npm run build
git diff --check
```

Expected: pass.

- [ ] **Step 4: Review the generated evidence**

Open:

- `docs/generated/acceptance-browser-evidence.md`
- `docs/generated/acceptance-operation-evidence.md`
- `docs/generated/acceptance-operation-evidence/index.json`

Confirm:

- Every automated P0/P1 operation has evidence.
- No evidence record is failed.
- Every record carries role, route, assertion types, and artifact paths.
- Any still-deferred row is explained instead of being hidden.

## Documentation Impact Matrix

| Area | Files | Action | Reason |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | Confirm the non-AI acceptance horizon is discoverable from the repo entry points. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | M5.8 becomes the next active non-AI implementation phase. |
| Product specs | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | Check whether any newly automated user behavior reveals a product-scope mismatch. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Make sure the browser-validation story still matches the architecture and test strategy. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/QUALITY_SCORE.md` | Update | Add the new requirement and operation coverage, plus the gate that keeps future UI changes honest. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md` | Update | Teach reviewers how to read the new non-AI browser gate. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md` | Review | Confirm no approval or permission rule changed beyond the existing policy. |
| Frontend/design docs | `docs/FRONTEND.md` | Review | Ensure the new acceptance coverage matches the visible UI interaction contract. |
| Generated artifacts | `docs/generated/acceptance-browser-evidence.md`, `docs/generated/acceptance-operation-evidence.md`, `docs/generated/acceptance-operation-evidence/index.json` | Update | Regenerate from a real passing acceptance run. |
| References | `docs/references/productization-api-contract-draft.md` | Review | Check whether the coverage expansion affects the API contract notes. |

## Documentation Update Gate

- [ ] Every `Update` row in the Documentation Impact Matrix has been updated.
- [ ] Every `Review` row has been checked and either updated or explicitly recorded as unchanged in this plan.
- [ ] All new or changed UI-interaction behavior has matching acceptance requirement IDs and operation IDs.
- [ ] All automated P0/P1 operation IDs produce evidence during `npm run acceptance:browser` or `npm run acceptance:evidence`.
- [ ] Any remaining `future` or `conditional` operation has a stable, documented reason.
- [ ] `npm run docs:check` passes before this plan can be marked complete.

## Execution Notes

- Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` for implementation.
- Use TDD for every behavior-changing fix: failing test first, minimal implementation second, verification third.
- Keep AI-based browser exploration out of the release gate for this plan.
- If a gap cannot be closed deterministically, record the reason in the operation matrix and tech-debt tracker instead of weakening the gate.
