# M5.6 User Operation Coverage Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert browser acceptance from requirement-marker coverage into a role-aware user-operation coverage matrix that says exactly which user actions are automated, manual, blocked, or deferred.

**Architecture:** Keep Playwright as the deterministic execution engine, but add a typed operation inventory above the existing acceptance requirement IDs. The matrix will map user roles, pages, UI actions, API boundaries, DB/audit assertions, and owning specs; a new gate will fail when critical operations lack executable coverage or documented deferral.

**Tech Stack:** TypeScript, Playwright Test, Vitest, existing `e2e/acceptance/requirements.ts`, `scripts/check-acceptance-coverage.ts`, `docs:check`.

---

## Background

M5.5 closed the first large gap in browser acceptance by adding requirement IDs and strict browser diagnostics. That still leaves a truth gap: a requirement ID can cover a broad workflow while many concrete user operations remain untested. WiseEff needs a matrix that answers:

- Which role can perform which operation?
- Which page, control, API endpoint, database state, and audit event prove the operation worked?
- Is the operation automated, manual-only, conditionally skipped, or explicitly deferred?
- Which acceptance spec owns the operation?

M5.6 builds that matrix and turns it into a gate.

## Scope

In scope:

- A typed operation matrix for all current high-value user operations across parameter management, log analysis, debugging, Agent, and permissions.
- A coverage gate that validates every P0/P1 operation has a coverage status and either executable automation or an explicit deferral reason.
- New or updated Playwright coverage for the highest-risk missing operations discovered by the matrix.
- Generated developer documentation that is easier to inspect than raw TypeScript.
- Updates to planning and verification docs so future UI/API changes must update the operation matrix.

Out of scope:

- AI exploratory browser agents. Those remain a later optional enhancement after deterministic coverage is honest.
- Visual regression SaaS.
- Real HDC lab execution beyond keeping `HDC-LAB-001` conditional.
- M5.7 evidence packaging; M5.6 records ownership and assertions, but does not yet build full evidence bundles.

## Acceptance Requirement IDs Affected

Existing IDs reviewed by this plan:

- `AUTH-RUNTIME-001`
- `SHELL-DIAG-001`
- `PARAM-REASON-001`
- `PARAM-ASSIGNEE-001`
- `PARAM-ASSIGNEE-002`
- `PARAM-ASSIGNEE-003`
- `PARAM-HAPPY-001`
- `PARAM-ADMIN-001`
- `LOG-HAPPY-001`
- `DEBUG-SIM-001`
- `HDC-LAB-001`
- `AGENT-APPROVAL-001`
- `PERM-GOV-001`
- `PERM-MATRIX-001`
- `PERM-MATRIX-002`

New IDs to add during implementation:

- `PARAM-DRAFT-EDIT-001`: edit and remove a draft item before submission.
- `PARAM-REJECT-001`: reject a parameter review and verify status, audit, and visible feedback.
- `LOG-REANALYZE-001`: rerun log analysis and verify a new run, progress, and audit record.
- `DEBUG-PERM-001`: verify write controls are hidden or blocked for roles without write permission.
- `AGENT-UNAUTH-001`: reject direct execution of an unapproved Agent write tool.
- `PERM-USER-MGMT-001`: Admin can create/update a non-self user role while non-Admin cannot.

## Files

- Create: `e2e/acceptance/operationMatrix.ts`
- Create: `scripts/check-acceptance-operation-matrix.ts`
- Create: `scripts/check-acceptance-operation-matrix.test.ts`
- Create: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `e2e/acceptance/requirements.ts`
- Modify: `scripts/check-acceptance-coverage.ts`
- Modify: `scripts/check-acceptance-coverage.test.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/agent.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions-matrix.acceptance.spec.ts`
- Modify: `package.json`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/PLANS.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Update on final run: `docs/generated/acceptance-browser-evidence.md`

---

## Task 1: Add A Typed User Operation Matrix

**Files:**

- Create: `e2e/acceptance/operationMatrix.ts`
- Create: `scripts/check-acceptance-operation-matrix.test.ts`

- [ ] **Step 1: Write failing matrix validation tests**

Add `scripts/check-acceptance-operation-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateOperationMatrix,
  type AcceptanceOperation
} from "./check-acceptance-operation-matrix";

const coveredSpec = {
  file: "e2e/acceptance/parameters.acceptance.spec.ts",
  content: "// @operation PARAM-DRAFT-EDIT-001\n// @acceptance PARAM-DRAFT-EDIT-001"
};

describe("acceptance operation matrix", () => {
  it("fails when a P0 automated operation has no operation marker", () => {
    const operations: AcceptanceOperation[] = [
      {
        id: "PARAM-DRAFT-EDIT-001",
        priority: "P0",
        area: "parameters",
        route: "/parameters",
        roles: ["Hardware User"],
        action: "Edit and remove a draft item before submission.",
        coverage: "automated",
        acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
        specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
        assertions: ["ui", "api", "db", "audit"]
      }
    ];

    const result = evaluateOperationMatrix({
      operations,
      specFiles: [{ file: coveredSpec.file, content: "" }]
    });

    expect(result.status).toBe("failed");
    expect(result.missingOperationMarkers).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("passes when every automated P0 operation has markers and assertions", () => {
    const operations: AcceptanceOperation[] = [
      {
        id: "PARAM-DRAFT-EDIT-001",
        priority: "P0",
        area: "parameters",
        route: "/parameters",
        roles: ["Hardware User"],
        action: "Edit and remove a draft item before submission.",
        coverage: "automated",
        acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
        specFiles: [coveredSpec.file],
        assertions: ["ui", "api", "db", "audit"]
      }
    ];

    const result = evaluateOperationMatrix({ operations, specFiles: [coveredSpec] });

    expect(result.status).toBe("passed");
    expect(result.coveredOperations).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("requires a deferral reason for manual or future P0/P1 operations", () => {
    const operations: AcceptanceOperation[] = [
      {
        id: "HDC-LAB-001",
        priority: "P1",
        area: "debugging",
        route: "/node-debugging",
        roles: ["Admin"],
        action: "Run real HDC write/readback lab.",
        coverage: "conditional",
        acceptanceIds: ["HDC-LAB-001"],
        specFiles: ["e2e/acceptance/hdc-device-lab.acceptance.spec.ts"],
        assertions: ["api", "audit"]
      }
    ];

    const result = evaluateOperationMatrix({ operations, specFiles: [] });

    expect(result.status).toBe("failed");
    expect(result.missingDeferralReasons).toEqual(["HDC-LAB-001"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- scripts/check-acceptance-operation-matrix.test.ts
```

Expected: fail because `scripts/check-acceptance-operation-matrix.ts` does not exist.

- [ ] **Step 3: Create the matrix types and initial operation inventory**

Create `e2e/acceptance/operationMatrix.ts`:

```ts
export type OperationPriority = "P0" | "P1" | "P2";
export type OperationCoverage = "automated" | "manual" | "conditional" | "future";
export type OperationArea = "auth" | "shell" | "parameters" | "logs" | "debugging" | "agent" | "permissions";
export type OperationAssertion = "ui" | "api" | "db" | "audit" | "artifact";

export type AcceptanceOperation = {
  id: string;
  priority: OperationPriority;
  area: OperationArea;
  route: string;
  roles: string[];
  action: string;
  coverage: OperationCoverage;
  acceptanceIds: string[];
  specFiles: string[];
  assertions: OperationAssertion[];
  deferralReason?: string;
};

export const acceptanceOperations: AcceptanceOperation[] = [
  {
    id: "AUTH-RUNTIME-001",
    priority: "P0",
    area: "auth",
    route: "/parameters",
    roles: ["Admin", "Hardware User", "Software User", "Hardware Committer", "Software Committer"],
    action: "Load API-mode browser runtime with the same bearer-token contract used by local development.",
    coverage: "automated",
    acceptanceIds: ["AUTH-RUNTIME-001"],
    specFiles: ["e2e/acceptance/auth-runtime.acceptance.spec.ts"],
    assertions: ["ui", "api"]
  },
  {
    id: "PARAM-DRAFT-EDIT-001",
    priority: "P0",
    area: "parameters",
    route: "/parameters",
    roles: ["Hardware User", "Software User", "Hardware Committer", "Software Committer", "Admin"],
    action: "Create a draft, edit the target value, remove it, recreate it, and submit only the final item.",
    coverage: "automated",
    acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PARAM-REJECT-001",
    priority: "P0",
    area: "parameters",
    route: "/parameter-review",
    roles: ["Hardware Committer", "Software Committer"],
    action: "Reject a submitted parameter change and show the rejection reason to the submitter.",
    coverage: "automated",
    acceptanceIds: ["PARAM-REJECT-001"],
    specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "LOG-REANALYZE-001",
    priority: "P1",
    area: "logs",
    route: "/log-admin",
    roles: ["Admin"],
    action: "Rerun analysis for a completed log and verify a new run, progress, and audit event.",
    coverage: "automated",
    acceptanceIds: ["LOG-REANALYZE-001"],
    specFiles: ["e2e/acceptance/log-analysis.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "DEBUG-PERM-001",
    priority: "P0",
    area: "debugging",
    route: "/debugging",
    roles: ["Guest", "Hardware User"],
    action: "Verify roles without write permission cannot perform simulator or node write operations.",
    coverage: "automated",
    acceptanceIds: ["DEBUG-PERM-001"],
    specFiles: ["e2e/acceptance/debugging-simulator.acceptance.spec.ts"],
    assertions: ["ui", "api", "audit"]
  },
  {
    id: "AGENT-UNAUTH-001",
    priority: "P0",
    area: "agent",
    route: "/agent",
    roles: ["Admin", "Hardware Committer", "Software Committer"],
    action: "Reject direct execution of an Agent write tool when the tool call has not been approved.",
    coverage: "automated",
    acceptanceIds: ["AGENT-UNAUTH-001"],
    specFiles: ["e2e/acceptance/agent.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "PERM-USER-MGMT-001",
    priority: "P0",
    area: "permissions",
    route: "/user-permissions",
    roles: ["Admin", "Hardware User"],
    action: "Admin can create or update a non-self user's role; non-Admin cannot access the same operation.",
    coverage: "automated",
    acceptanceIds: ["PERM-USER-MGMT-001"],
    specFiles: ["e2e/acceptance/permissions.acceptance.spec.ts"],
    assertions: ["ui", "api", "db", "audit"]
  },
  {
    id: "HDC-LAB-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Admin"],
    action: "Run real HDC read/write/readback and rollback smoke when a real device lab is explicitly enabled.",
    coverage: "conditional",
    acceptanceIds: ["HDC-LAB-001"],
    specFiles: ["e2e/acceptance/hdc-device-lab.acceptance.spec.ts"],
    assertions: ["api", "audit"],
    deferralReason: "Requires real HDC hardware and explicit write approval."
  }
];
```

- [ ] **Step 4: Export shared types from the checker**

Implement `scripts/check-acceptance-operation-matrix.ts` so the tests compile:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptanceOperations,
  type AcceptanceOperation
} from "../e2e/acceptance/operationMatrix";

export type { AcceptanceOperation };

export type OperationSpecInput = {
  file: string;
  content: string;
};

export type OperationCoverageResult = {
  status: "passed" | "failed";
  coveredOperations: string[];
  missingOperationMarkers: string[];
  missingDeferralReasons: string[];
  missingAssertions: string[];
};

const operationMarkerPattern = /@operation\s+([A-Z]+-[A-Z0-9-]+)/g;

export function parseOperationIdsFromSpec(content: string) {
  return Array.from(content.matchAll(operationMarkerPattern), (match) => match[1]);
}

export function evaluateOperationMatrix(input: {
  operations: AcceptanceOperation[];
  specFiles: OperationSpecInput[];
}): OperationCoverageResult {
  const coveredOperations = Array.from(
    new Set(input.specFiles.flatMap((specFile) => parseOperationIdsFromSpec(specFile.content)))
  ).sort();
  const coveredSet = new Set(coveredOperations);
  const requiredOperations = input.operations.filter((operation) => operation.priority !== "P2");

  const missingOperationMarkers = requiredOperations
    .filter((operation) => operation.coverage === "automated" && !coveredSet.has(operation.id))
    .map((operation) => operation.id);
  const missingDeferralReasons = requiredOperations
    .filter((operation) => operation.coverage !== "automated" && !operation.deferralReason?.trim())
    .map((operation) => operation.id);
  const missingAssertions = requiredOperations
    .filter((operation) => operation.assertions.length === 0)
    .map((operation) => operation.id);

  return {
    status:
      missingOperationMarkers.length === 0 &&
      missingDeferralReasons.length === 0 &&
      missingAssertions.length === 0
        ? "passed"
        : "failed",
    coveredOperations,
    missingOperationMarkers,
    missingDeferralReasons,
    missingAssertions
  };
}

export function readOperationSpecFiles(root = "e2e/acceptance"): OperationSpecInput[] {
  if (!existsSync(root)) return [];

  return readdirSync(root)
    .filter((name) => name.endsWith(".acceptance.spec.ts"))
    .map((name) => {
      const file = join(root, name);
      return { file, content: readFileSync(file, "utf8") };
    });
}

export function runOperationMatrixCheck() {
  const result = evaluateOperationMatrix({
    operations: acceptanceOperations,
    specFiles: readOperationSpecFiles()
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runOperationMatrixCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
```

- [ ] **Step 5: Verify the matrix tests pass**

Run:

```bash
npm test -- scripts/check-acceptance-operation-matrix.test.ts
```

Expected: pass.

## Task 2: Add Operation IDs To Acceptance Requirements And Coverage Gates

**Files:**

- Modify: `e2e/acceptance/requirements.ts`
- Modify: `scripts/check-acceptance-coverage.ts`
- Modify: `scripts/check-acceptance-coverage.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write a failing coverage test for operation IDs**

Add this test to `scripts/check-acceptance-coverage.test.ts`:

```ts
it("fails when a required operation id is not declared as an acceptance requirement", () => {
  const result = evaluateAcceptanceCoverage({
    requirements: [
      { id: "PARAM-HAPPY-001", workflow: "B", title: "Parameter happy path.", required: true }
    ],
    specFiles: [
      {
        file: "e2e/acceptance/parameters.acceptance.spec.ts",
        content: "// @acceptance PARAM-HAPPY-001\n// @operation PARAM-DRAFT-EDIT-001"
      }
    ]
  });

  expect(result.status).toBe("failed");
  expect(result.unknownIds).toContain("PARAM-DRAFT-EDIT-001");
});
```

Expected: this fails until `parseAcceptanceIdsFromSpec` also parses `@operation` markers or the requirement inventory includes the new IDs.

- [ ] **Step 2: Add new IDs to `acceptanceRequirements`**

Append these entries to `e2e/acceptance/requirements.ts`:

```ts
{
  id: "PARAM-DRAFT-EDIT-001",
  workflow: "B",
  title: "Parameter draft edit and remove operations work before final submission.",
  required: true
},
{
  id: "PARAM-REJECT-001",
  workflow: "B",
  title: "Parameter rejection records status, reason, and audit evidence.",
  required: true
},
{
  id: "LOG-REANALYZE-001",
  workflow: "D",
  title: "Log reanalysis creates a new run with progress and audit evidence.",
  required: true
},
{
  id: "DEBUG-PERM-001",
  workflow: "E",
  title: "Debug write controls are unavailable to roles without write permission.",
  required: true
},
{
  id: "AGENT-UNAUTH-001",
  workflow: "G",
  title: "Unapproved Agent write tool execution is rejected.",
  required: true
},
{
  id: "PERM-USER-MGMT-001",
  workflow: "H",
  title: "Admin user-management mutations work while non-Admin users remain blocked.",
  required: true
}
```

- [ ] **Step 3: Add the npm script**

Modify `package.json`:

```json
"acceptance:operations": "tsx scripts/check-acceptance-operation-matrix.ts"
```

- [ ] **Step 4: Run the coverage and operation gates**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts scripts/check-acceptance-operation-matrix.test.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: unit tests pass; both gates fail until later tasks add `@acceptance` and `@operation` markers for new automated operations.

## Task 3: Automate The Highest-Risk Missing User Operations

**Files:**

- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/agent.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`

- [ ] **Step 1: Add failing parameter draft edit/remove coverage**

In `parameters.acceptance.spec.ts`, add a new Playwright test with both markers:

```ts
test("edits and removes draft items before final parameter submission", async ({ page }) => {
  // @acceptance PARAM-DRAFT-EDIT-001
  // @operation PARAM-DRAFT-EDIT-001
  await page.goto("/parameters?project=aurora");
  await createDraftForParameter(page, "fast_charge_current_limit_ma", "3100", "M5.6 draft edit first value");
  await expect(page.locator(".modified-parameters-section")).toContainText("3100");

  await page.locator(".modified-parameters-section").getByRole("button", { name: /编辑|Edit/i }).click();
  await page.locator(".parameter-draft-dialog .parameter-target-editor").fill("3150");
  await page.locator(".parameter-draft-dialog .button.primary").click();
  await expect(page.locator(".modified-parameters-section")).toContainText("3150");

  await page.locator(".modified-parameters-section").getByRole("button", { name: /移除|Remove/i }).click();
  await expect(page.locator(".modified-parameters-section")).not.toContainText("3150");
});
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts
```

Expected: fail if the current UI lacks accessible edit/remove controls or stable selectors.

- [ ] **Step 2: Implement the smallest selector or UI-state fixes needed**

If the test fails because controls exist but lack reliable names, update the component that renders draft item actions with stable accessible labels:

```tsx
<button type="button" aria-label={`编辑草稿 ${item.parameterName}`} onClick={() => onEdit(item.id)}>
  编辑
</button>
<button type="button" aria-label={`移除草稿 ${item.parameterName}`} onClick={() => onRemove(item.id)}>
  移除
</button>
```

Run the same acceptance spec again. Expected: pass.

- [ ] **Step 3: Add parameter rejection coverage**

Add a test in `parameters.acceptance.spec.ts`:

```ts
test("rejects a parameter review and records reason plus audit evidence", async ({ page }) => {
  // @acceptance PARAM-REJECT-001
  // @operation PARAM-REJECT-001
  const requestId = await submitOneParameterChange(page, {
    targetValue: "3125",
    reason: "M5.6 rejection coverage"
  });

  await page.goto("/parameter-review?project=aurora");
  await page.getByText("M5.6 rejection coverage").click();
  await page.getByRole("button", { name: /驳回|Reject/i }).click();
  await page.getByLabel(/驳回原因|Reject reason/i).fill("M5.6 rejection reason");
  await page.getByRole("button", { name: /确认驳回|Confirm reject/i }).click();

  await expect.poll(async () => readChangeRequestStatus(page, requestId)).toBe("已驳回");
  await expect.poll(async () => auditContains(page, "parameter-review", requestId)).toBe(true);
});
```

Expected: fail first if rejection is not exposed or audit lookup is missing.

- [ ] **Step 4: Add log reanalysis coverage**

Add to `log-analysis.acceptance.spec.ts`:

```ts
test("reruns a completed log analysis and records a new audited run", async ({ page }) => {
  // @acceptance LOG-REANALYZE-001
  // @operation LOG-REANALYZE-001
  const log = await uploadAndCompleteSupportedLog(page, "M5.6 reanalysis coverage");
  await page.goto("/log-admin");
  await page.locator('input[type="search"]').fill(log.fileName);
  await page.getByRole("row").filter({ hasText: log.fileName }).first().click();

  await page.locator('button:has(svg[class*="lucide-refresh"])').click();
  await expect.poll(async () => latestRunCount(page, log.id)).toBeGreaterThan(1);
  await expect.poll(async () => auditContains(page, "log-rerun", log.id)).toBe(true);
});
```

Expected: fail first if reanalysis lacks an auditable state transition or stable control.

- [ ] **Step 5: Add debugging permission coverage**

Add to `debugging-simulator.acceptance.spec.ts`:

```ts
test("hides or blocks debug write controls for roles without write permission", async ({ page }) => {
  // @acceptance DEBUG-PERM-001
  // @operation DEBUG-PERM-001
  await page.goto("/debugging");
  await switchPrototypeRole(page, "Guest");
  await expect(page.getByRole("heading", { name: /Permission denied/i })).toBeVisible();

  await switchPrototypeRole(page, "Hardware User");
  await page.goto("/debugging");
  await expect(page.getByRole("button", { name: /写入|Write/i })).toHaveCount(0);
});
```

Expected: fail first if write controls remain visible to a role that should not write.

- [ ] **Step 6: Add Agent unauthorized execution coverage**

Add to `agent.acceptance.spec.ts`:

```ts
test("rejects direct execution of an unapproved Agent write tool", async ({ page }) => {
  // @acceptance AGENT-UNAUTH-001
  // @operation AGENT-UNAUTH-001
  const session = await createAgentSession(page, { projectId: "aurora" });
  const response = await page.request.post(apiRoute(`/api/v1/agent/sessions/${session.id}/tool-calls/fake-call/approve`), {
    headers: smokeHeaders(),
    data: { expectedToolCallStatus: "pending_approval" }
  });

  expect(response.status()).toBe(404);
});
```

Expected: pass only when direct unapproved or nonexistent write execution is rejected.

- [ ] **Step 7: Add Admin user-management coverage**

Add to `permissions.acceptance.spec.ts`:

```ts
test("allows Admin to update a non-self user role and blocks non-Admin access", async ({ page }) => {
  // @acceptance PERM-USER-MGMT-001
  // @operation PERM-USER-MGMT-001
  await page.goto("/user-permissions");
  await page.getByRole("row").filter({ hasText: "Liu Min" }).getByRole("button", { name: /编辑|Edit/i }).click();
  await page.getByLabel("Role").selectOption("software-committer");
  await page.getByRole("button", { name: /保存|Save/i }).click();
  await expect.poll(async () => userHasRole(page, "u-liu-min", "software-committer")).toBe(true);

  await switchPrototypeRole(page, "Hardware User");
  await page.goto("/user-permissions");
  await expect(page.getByRole("heading", { name: /Permission denied/i })).toBeVisible();
});
```

Expected: fail first if role update is not wired to API-mode persistence or lacks stable controls.

- [ ] **Step 8: Verify all new operation coverage**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts e2e/acceptance/log-analysis.acceptance.spec.ts e2e/acceptance/debugging-simulator.acceptance.spec.ts e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: targeted acceptance specs pass; both gates pass.

## Task 4: Generate A Human-Readable User Operation Matrix

**Files:**

- Modify: `scripts/check-acceptance-operation-matrix.ts`
- Create: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`

- [ ] **Step 1: Write a failing markdown renderer test**

Add to `scripts/check-acceptance-operation-matrix.test.ts`:

```ts
import { renderOperationMatrixMarkdown } from "./check-acceptance-operation-matrix";

it("renders a developer-readable operation matrix", () => {
  const markdown = renderOperationMatrixMarkdown([
    {
      id: "PARAM-DRAFT-EDIT-001",
      priority: "P0",
      area: "parameters",
      route: "/parameters",
      roles: ["Hardware User"],
      action: "Edit draft.",
      coverage: "automated",
      acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
      specFiles: ["e2e/acceptance/parameters.acceptance.spec.ts"],
      assertions: ["ui", "api"]
    }
  ]);

  expect(markdown).toContain("| `PARAM-DRAFT-EDIT-001` | P0 | parameters | automated |");
});
```

- [ ] **Step 2: Implement the renderer**

Add:

```ts
export function renderOperationMatrixMarkdown(operations: AcceptanceOperation[]) {
  return [
    "# User Operation Coverage Matrix",
    "",
    "This file is generated from `e2e/acceptance/operationMatrix.ts`.",
    "",
    "| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Spec Files |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...operations.map((operation) =>
      [
        `| \`${operation.id}\``,
        operation.priority,
        operation.area,
        operation.coverage,
        `\`${operation.route}\``,
        operation.roles.join(", "),
        operation.assertions.join(", "),
        operation.specFiles.map((file) => `\`${file}\``).join("<br>"),
        "|"
      ].join(" | ")
    ),
    ""
  ].join("\n");
}
```

- [ ] **Step 3: Write the generated matrix file**

When `npm run acceptance:operations` passes, write `docs/developer/user-operation-coverage-matrix.md` from the renderer output. Keep this file committed so developers can review operation coverage without reading TypeScript.

- [ ] **Step 4: Link the matrix from the existing coverage map**

Add to `docs/developer/browser-acceptance-coverage-map.md`:

```md
For operation-level coverage, see `docs/developer/user-operation-coverage-matrix.md`. Requirement IDs explain what must be covered; operation IDs explain the concrete user actions and assertions that prove it.
```

## Task 5: Documentation And Governance

**Files:**

- Modify: `docs/PLANS.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`

- [ ] **Step 1: Update plan governance**

In `docs/PLANS.md`, strengthen the UI Interaction Automation Rule:

```md
Plans that change user-facing interaction behavior must name both affected acceptance requirement IDs and affected operation IDs from `docs/developer/user-operation-coverage-matrix.md`. If no operation ID exists, the plan must add one before implementation.
```

- [ ] **Step 2: Update verification matrix**

Add `npm run acceptance:operations`:

```md
| `npm run acceptance:operations` | Validates operation-level browser coverage metadata. | Run after any UI/API interaction change and before `npm run acceptance:browser`. |
```

- [ ] **Step 3: Update Chinese manual acceptance docs**

Add a Chinese section:

```md
### 用户操作覆盖矩阵

M5.6 之后，浏览器验收不仅检查 requirement ID，还检查 operation ID。开发者修改任何用户可见交互时，必须确认 `docs/developer/user-operation-coverage-matrix.md` 中是否已有对应操作；没有则先新增操作 ID，再补自动化或记录明确的人工/条件性验收原因。
```

- [ ] **Step 4: Update roadmap**

Add M5.6 after the M5.5 section:

```md
## 10.4 M5.6 User Operation Coverage Matrix

M5.6 deepens M5.5 by replacing broad workflow confidence with a role-aware user-operation matrix. It adds operation IDs, `npm run acceptance:operations`, generated operation coverage docs, and targeted Playwright coverage for high-risk missing actions such as draft edit/remove, review rejection, log reanalysis, debug write permissions, unapproved Agent write execution, and Admin user management.
```

- [ ] **Step 5: Verify docs**

Run:

```bash
npm run docs:check
```

Expected: pass.

## Task 6: Final Verification

**Files:**

- Update on run: `docs/generated/acceptance-browser-evidence.md`
- Modify if needed: `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Run unit gates**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts scripts/check-acceptance-operation-matrix.test.ts scripts/browserDiagnostics.test.ts scripts/run-browser-acceptance.test.ts
```

Expected: pass.

- [ ] **Step 2: Run operation and browser gates**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:browser
```

Expected: all pass; HDC remains skipped in local non-HDC mode.

- [ ] **Step 3: Run standard gates**

Run:

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
git diff --check
```

Expected: all pass. Existing Vite chunk-size warning remains non-blocking.

- [ ] **Step 4: Record deferred operation gaps**

If any P0/P1 operation remains manual, conditional, or future, add a row to `docs/exec-plans/tech-debt-tracker.md` with:

- operation ID.
- affected page/API.
- why automation is deferred.
- required external dependency or product change.
- target milestone.

## Documentation Impact Matrix

| Area | Files | Action | Reason |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | Add links only if new commands or reading order need top-level visibility. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | Operation IDs become mandatory planning artifacts for UI/API changes. |
| Product specs | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | Update only if newly automated operations expose product behavior changes. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Operation matrix may need to be documented as part of test architecture. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/QUALITY_SCORE.md` | Update | Add the new operation gate and generated matrix. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md`, `docs/RELIABILITY.md` | Update | Explain how operation coverage changes manual acceptance scope. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md`, permissions documentation | Review | Update if new permission or Agent negative paths clarify security behavior. |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/DESIGN.md` | Review | Update only if stable selector or accessibility-label conventions change. |
| Generated artifacts | `docs/generated/acceptance-browser-evidence.md` | Update | Regenerate from the final real browser acceptance run. |
| References | `docs/references/*` | Review | Update only if agent-facing references need the operation matrix. |
| Chinese docs | `docs/zh-CN/README.md`, `docs/zh-CN/manual-acceptance.md` | Update | Chinese developer guidance must mention operation IDs and `acceptance:operations`. |

## Documentation Update Gate

- [ ] Every `Update` row in the Documentation Impact Matrix has been updated.
- [ ] Every `Review` row has been checked and either updated or recorded as unchanged in this plan.
- [ ] `docs/developer/user-operation-coverage-matrix.md` exists and lists all P0/P1 operations.
- [ ] `docs/PLANS.md` requires future UI/API plans to name operation IDs.
- [ ] `docs/zh-CN/manual-acceptance.md` explains operation-level browser acceptance.
- [ ] `npm run docs:check` passes.

## Execution Notes

- Use TDD for every checker, renderer, helper, and browser behavior change.
- Do not weaken server-side auth, validation, or audit rules to make browser tests pass.
- Do not mark an operation automated unless a Playwright test has both `@acceptance` and `@operation` markers and validates at least UI plus one backend evidence layer.
- M5.7 should not start until `npm run acceptance:operations` passes and the generated operation matrix is committed.
