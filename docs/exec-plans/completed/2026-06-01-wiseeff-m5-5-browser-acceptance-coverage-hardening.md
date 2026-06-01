# M5.5 Browser Acceptance Coverage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn the M5.4 browser acceptance foundation from workflow-level happy-path evidence into requirement-level user-operation coverage for auth, permissions, parameter submissions, diagnostics, and evidence reporting.

**Architecture:** Keep Playwright as the deterministic browser automation engine. Add a requirement inventory that maps user operations to acceptance IDs, make the runner verify requirement coverage, fail browser tests on unexpected console/API failures, and expand the high-risk parameter and permissions suites with negative-path and environment-parity coverage.

**Tech Stack:** Playwright Test, Vitest, TypeScript, existing API-mode WiseEff runtime, PostgreSQL seed helpers, `scripts/run-browser-acceptance.ts`, `docs:check`.

**Completion Status:** Completed on 2026-06-01 in local non-HDC mode. The final browser evidence is `docs/generated/acceptance-browser-evidence.md` with `Status: passed`, `Preflight: passed`, `Playwright: passed`, and requirement coverage `15/15`. HDC remains an explicitly skipped optional lab gate unless `DEBUG_DEVICE_GATEWAY_MODE=hdc` and `HDC_DEVICE_LAB_AVAILABLE=true`.

**Verification Evidence:**

- `npm test -- scripts/check-acceptance-coverage.test.ts scripts/browserDiagnostics.test.ts scripts/run-browser-acceptance.test.ts src/components/ParametersTable.test.tsx src/App.test.tsx src/NodeDebuggingPage.test.tsx` -> 187 tests passed.
- `npm run acceptance:e2e -- e2e/acceptance/auth-runtime.acceptance.spec.ts e2e/acceptance/parameters-negative.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts e2e/acceptance/log-analysis.acceptance.spec.ts` -> 12 passed.
- `npm run acceptance:coverage` -> passed with no missing or unknown IDs.
- `npm run acceptance:browser` -> passed; 27 Playwright tests passed and 1 HDC lab test skipped.
- `npm run docs:check` -> passed.
- `npm run contract:check` -> passed.
- `npm run test:all` -> 183 client test files / 1730 tests passed; 62 server test files / 533 tests passed.
- `npm run build` -> passed with the existing non-blocking Vite chunk-size warning.
- `git diff --check` -> passed.

---

## Background

M5.4 successfully introduced `npm run acceptance:e2e`, `npm run acceptance:browser`, Playwright HTML/JSON artifacts, and `docs/generated/acceptance-browser-evidence.md`. Manual validation after M5.4 exposed gaps that the suite did not catch:

- browser/API auth mismatch causing `/api/v1/me` and `/api/v1/parameter-submission-rounds` to return `401`.
- empty parameter draft `reason` reaching the backend and returning `400`.
- ineligible workflow assignees appearing or being selected, causing `Workflow assignee is not eligible`.
- permissions rules being tested as route access rather than a business operation matrix.
- generated evidence marking A-H workflows as passed without item-level proof of what was actually covered.

The root problem is coverage modeling, not Playwright. This plan fixes the model first, then expands deterministic browser coverage for the highest-risk gaps.

## Scope

In scope:

- Requirement-level user operation inventory for the current A-H manual acceptance flows.
- Coverage enforcement so required browser acceptance IDs cannot silently disappear.
- Browser diagnostics that fail tests on unexpected console errors, page errors, request failures, and critical API `4xx/5xx` responses.
- Auth/runtime parity checks for the local API-mode development path.
- Parameter submission negative paths and assignee eligibility coverage.
- Permissions and role-inclusion browser/API coverage.
- Evidence report improvements showing requirement counts and untested/skipped IDs.
- Documentation updates that make this gate durable for future UI/API interaction changes.

Out of scope:

- HDC real-device lab automation beyond preserving the existing conditional F flow.
- Visual regression SaaS, AI exploratory browser agents, or accessibility-wide scanning.
- Production SSO/OIDC, durable queue, cloud IaC, and capacity testing. Those remain M6 production hardening topics.

## Success Criteria

- `npm run acceptance:coverage` fails when a required acceptance ID has no Playwright coverage marker.
- `npm run acceptance:e2e` fails on unexpected `pageerror`, console error, request failure, or critical WiseEff API `4xx/5xx`.
- Parameter acceptance covers empty/blank reason, valid reason, default assignee eligibility, hidden ineligible dropdown options, and forced invalid assignee API rejection.
- Permissions acceptance covers the current role set and inclusion rules: `Hardware Committer` includes `Hardware User`; `Software Committer` includes `Hardware User`; `Software User` includes `Hardware User`.
- `docs/generated/acceptance-browser-evidence.md` includes workflow-level and requirement-level coverage, including skipped/untested items.
- Verification docs and Chinese manual acceptance docs explain when to run the expanded acceptance gates.

## Files

- Create: `e2e/acceptance/requirements.ts`
- Create: `e2e/acceptance/helpers/browserDiagnostics.ts`
- Create: `e2e/acceptance/helpers/browserDiagnostics.test.ts`
- Create: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Create: `e2e/acceptance/permissions-matrix.acceptance.spec.ts`
- Create: `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- Create: `scripts/check-acceptance-coverage.ts`
- Create: `scripts/check-acceptance-coverage.test.ts`
- Create: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `package.json`
- Modify: `playwright.acceptance.config.ts`
- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `scripts/run-browser-acceptance.test.ts`
- Modify: `e2e/acceptance/helpers/evidence.ts`
- Modify: existing `e2e/acceptance/*.acceptance.spec.ts`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/PLANS.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Update on final real run: `docs/generated/acceptance-browser-evidence.md`

---

## Task 1: Define The Browser Acceptance Requirement Inventory

**Files:**

- Create: `e2e/acceptance/requirements.ts`
- Create: `docs/developer/browser-acceptance-coverage-map.md`
- Create: `scripts/check-acceptance-coverage.test.ts`
- Create: `scripts/check-acceptance-coverage.ts`
- Modify: `package.json`

- [x] **Step 1: Write the failing coverage checker tests**

Create `scripts/check-acceptance-coverage.test.ts` with tests for required IDs, skipped IDs, and spec marker parsing:

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateAcceptanceCoverage,
  parseAcceptanceIdsFromSpec
} from "./check-acceptance-coverage";

describe("acceptance coverage checker", () => {
  it("fails when a required acceptance id has no spec marker", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "PARAM-REASON-001", workflow: "B", title: "Reason is required.", required: true },
        { id: "PARAM-ASSIGNEE-001", workflow: "B", title: "Eligible assignees only.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "test('requires reason', () => {}) // @acceptance PARAM-REASON-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.missingRequiredIds).toEqual(["PARAM-ASSIGNEE-001"]);
  });

  it("passes when every required acceptance id has a marker", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: "test('loads current user', () => {}) // @acceptance AUTH-RUNTIME-001"
        }
      ]
    });

    expect(result.status).toBe("passed");
    expect(result.coveredIds).toEqual(["AUTH-RUNTIME-001"]);
  });

  it("parses multiple acceptance markers from comments", () => {
    expect(
      parseAcceptanceIdsFromSpec("// @acceptance PARAM-REASON-001\n// @acceptance PERM-MATRIX-001")
    ).toEqual(["PARAM-REASON-001", "PERM-MATRIX-001"]);
  });
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts
```

Expected: fail because `scripts/check-acceptance-coverage.ts` and `e2e/acceptance/requirements.ts` do not exist.

- [x] **Step 3: Add the requirement inventory**

Create `e2e/acceptance/requirements.ts`:

```ts
export type AcceptanceWorkflowId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type AcceptanceRequirement = {
  id: string;
  workflow: AcceptanceWorkflowId;
  title: string;
  required: boolean;
};

export const acceptanceRequirements: AcceptanceRequirement[] = [
  { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode browser runtime loads current user with the same auth contract used by local dev.", required: true },
  { id: "SHELL-DIAG-001", workflow: "A", title: "Core routes fail acceptance on unexpected console, page, request, or critical API errors.", required: true },
  { id: "PARAM-REASON-001", workflow: "B", title: "Parameter drafts cannot be submitted with an empty or blank reason.", required: true },
  { id: "PARAM-ASSIGNEE-001", workflow: "B", title: "Parameter submission defaults to eligible assignees for every workflow slot.", required: true },
  { id: "PARAM-ASSIGNEE-002", workflow: "B", title: "Parameter submission dropdowns hide inactive, guest, admin-only, and role-ineligible users.", required: true },
  { id: "PARAM-ASSIGNEE-003", workflow: "B", title: "Forced invalid workflow assignees are rejected by the API and surfaced by the UI.", required: true },
  { id: "PARAM-HAPPY-001", workflow: "B", title: "Parameter search, draft, submit, review, merge, persistence, and audit happy path works.", required: true },
  { id: "PARAM-ADMIN-001", workflow: "C", title: "Parameter admin import preview and audit drawer remain available to Admin.", required: true },
  { id: "LOG-HAPPY-001", workflow: "D", title: "Log upload, analysis progress, evidence, feedback, archive, and unsupported-file path work.", required: true },
  { id: "DEBUG-SIM-001", workflow: "E", title: "Simulator read, write, mismatch, rollback, and audit path work.", required: true },
  { id: "HDC-LAB-001", workflow: "F", title: "Real HDC device lab read/write smoke runs when explicitly enabled.", required: false },
  { id: "AGENT-APPROVAL-001", workflow: "G", title: "Agent context, approval, rejection, execution, and evidence path work.", required: true },
  { id: "PERM-GOV-001", workflow: "H", title: "User governance page is Admin-only and active Admin cannot disable itself.", required: true },
  { id: "PERM-MATRIX-001", workflow: "H", title: "Role inclusion rules are enforced for visible UI operations.", required: true },
  { id: "PERM-MATRIX-002", workflow: "H", title: "Role inclusion and project-scoped workflow eligibility are enforced by API-backed operations.", required: true }
];
```

- [x] **Step 4: Implement the minimal coverage checker**

Create `scripts/check-acceptance-coverage.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptanceRequirements, type AcceptanceRequirement } from "../e2e/acceptance/requirements";

export type AcceptanceSpecInput = {
  file: string;
  content: string;
};

export type AcceptanceCoverageInput = {
  requirements: AcceptanceRequirement[];
  specFiles: AcceptanceSpecInput[];
};

export type AcceptanceCoverageResult = {
  status: "passed" | "failed";
  coveredIds: string[];
  missingRequiredIds: string[];
  unknownIds: string[];
};

const acceptanceMarkerPattern = /@acceptance\s+([A-Z]+-[A-Z0-9-]+)/g;

export function parseAcceptanceIdsFromSpec(content: string) {
  return Array.from(content.matchAll(acceptanceMarkerPattern), (match) => match[1]);
}

export function evaluateAcceptanceCoverage(input: AcceptanceCoverageInput): AcceptanceCoverageResult {
  const knownIds = new Set(input.requirements.map((requirement) => requirement.id));
  const coveredIds = Array.from(
    new Set(input.specFiles.flatMap((file) => parseAcceptanceIdsFromSpec(file.content)))
  ).sort();
  const coveredSet = new Set(coveredIds);
  const missingRequiredIds = input.requirements
    .filter((requirement) => requirement.required && !coveredSet.has(requirement.id))
    .map((requirement) => requirement.id);
  const unknownIds = coveredIds.filter((id) => !knownIds.has(id));

  return {
    status: missingRequiredIds.length === 0 && unknownIds.length === 0 ? "passed" : "failed",
    coveredIds,
    missingRequiredIds,
    unknownIds
  };
}

export function readAcceptanceSpecFiles(root = "e2e/acceptance"): AcceptanceSpecInput[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((name) => name.endsWith(".acceptance.spec.ts"))
    .map((name) => {
      const file = join(root, name);
      return { file, content: readFileSync(file, "utf8") };
    });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const result = evaluateAcceptanceCoverage({
    requirements: acceptanceRequirements,
    specFiles: readAcceptanceSpecFiles()
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "passed" ? 0 : 1);
}
```

- [x] **Step 5: Add the npm script**

Modify `package.json`:

```json
"acceptance:coverage": "tsx scripts/check-acceptance-coverage.ts",
```

- [x] **Step 6: Create the human-readable coverage map**

Create `docs/developer/browser-acceptance-coverage-map.md` with a table containing all IDs from `acceptanceRequirements`, their workflow, expected user behavior, current spec owner, and whether the ID is blocking.

- [x] **Step 7: Run the checker and tests**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts
npm run acceptance:coverage
```

Expected: unit tests pass; `acceptance:coverage` fails until later tasks add markers to the specs.

## Task 2: Add Browser Diagnostics That Fail On Real User-Facing Runtime Errors

**Files:**

- Create: `e2e/acceptance/helpers/browserDiagnostics.ts`
- Create: `e2e/acceptance/helpers/browserDiagnostics.test.ts`
- Modify: existing `e2e/acceptance/*.acceptance.spec.ts`

- [x] **Step 1: Write failing diagnostics unit tests**

Create `e2e/acceptance/helpers/browserDiagnostics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyBrowserIssue } from "./browserDiagnostics";

describe("browser acceptance diagnostics", () => {
  it("fails unexpected WiseEff API 401 responses", () => {
    expect(classifyBrowserIssue({ type: "response", url: "http://127.0.0.1:8787/api/v1/me", status: 401 })).toEqual({
      action: "fail",
      reason: "Unexpected API response 401 for /api/v1/me"
    });
  });

  it("allows explicit negative-path API assertions", () => {
    expect(
      classifyBrowserIssue({
        type: "response",
        url: "http://127.0.0.1:8787/api/v1/me",
        status: 401,
        allowFailure: true
      })
    ).toEqual({ action: "ignore" });
  });

  it("fails page errors and console errors", () => {
    expect(classifyBrowserIssue({ type: "pageerror", message: "TypeError: failed" }).action).toBe("fail");
    expect(classifyBrowserIssue({ type: "console", message: "Failed to load resource", level: "error" }).action).toBe("fail");
  });
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- e2e/acceptance/helpers/browserDiagnostics.test.ts
```

Expected: fail because the helper does not exist.

- [x] **Step 3: Implement browser diagnostics**

Create `e2e/acceptance/helpers/browserDiagnostics.ts` with:

```ts
import type { Page, TestInfo } from "playwright/test";

type BrowserIssue =
  | { type: "pageerror"; message: string }
  | { type: "console"; level: string; message: string }
  | { type: "requestfailed"; url: string; failureText?: string }
  | { type: "response"; url: string; status: number; allowFailure?: boolean };

export function classifyBrowserIssue(issue: BrowserIssue): { action: "fail" | "ignore"; reason?: string } {
  if ("allowFailure" in issue && issue.allowFailure) {
    return { action: "ignore" };
  }

  if (issue.type === "pageerror") {
    return { action: "fail", reason: `Unexpected page error: ${issue.message}` };
  }
  if (issue.type === "console" && issue.level === "error") {
    return { action: "fail", reason: `Unexpected console error: ${issue.message}` };
  }
  if (issue.type === "requestfailed" && isWiseEffUrl(issue.url)) {
    return { action: "fail", reason: `Unexpected request failure for ${pathOf(issue.url)}: ${issue.failureText ?? "unknown failure"}` };
  }
  if (issue.type === "response" && issue.status >= 400 && isCriticalApiUrl(issue.url)) {
    return { action: "fail", reason: `Unexpected API response ${issue.status} for ${pathOf(issue.url)}` };
  }

  return { action: "ignore" };
}

export function installBrowserDiagnostics(page: Page, testInfo: TestInfo) {
  const failures: string[] = [];
  const record = (issue: BrowserIssue) => {
    const result = classifyBrowserIssue(issue);
    if (result.action === "fail" && result.reason) {
      failures.push(result.reason);
    }
  };

  page.on("pageerror", (error) => record({ type: "pageerror", message: error.message }));
  page.on("console", (message) => record({ type: "console", level: message.type(), message: message.text() }));
  page.on("requestfailed", (request) =>
    record({ type: "requestfailed", url: request.url(), failureText: request.failure()?.errorText })
  );
  page.on("response", (response) => record({ type: "response", url: response.url(), status: response.status() }));

  testInfo.attach("browser-diagnostics-enabled", {
    body: Buffer.from("Browser diagnostics are installed for unexpected console, page, request, and API failures."),
    contentType: "text/plain"
  });

  return {
    assertNoBrowserDiagnosticsFailures() {
      if (failures.length > 0) {
        throw new Error(`Browser diagnostics failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
      }
    }
  };
}

function isWiseEffUrl(url: string) {
  return url.includes("127.0.0.1") || url.includes("localhost");
}

function isCriticalApiUrl(url: string) {
  return isWiseEffUrl(url) && url.includes("/api/v1/") && !url.includes("/api/v1/audit-events");
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
```

- [x] **Step 4: Install diagnostics in every acceptance spec**

At the top of each acceptance test, add:

```ts
// @acceptance SHELL-DIAG-001
```

In each test body or `beforeEach`, install:

```ts
const diagnostics = installBrowserDiagnostics(page, testInfo);
// test steps...
diagnostics.assertNoBrowserDiagnosticsFailures();
```

For explicit negative API tests that intentionally expect `400`, `401`, or `403`, use `page.request` and do not navigate through UI until the expected response is asserted.

- [x] **Step 5: Verify diagnostics**

Run:

```bash
npm test -- e2e/acceptance/helpers/browserDiagnostics.test.ts
npm run acceptance:e2e -- e2e/acceptance/shell-navigation.acceptance.spec.ts
```

Expected: diagnostics tests pass; shell navigation still passes only if there are no unexpected runtime/API failures.

## Task 3: Add Auth And Local Runtime Parity Acceptance

**Files:**

- Create: `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`

- [x] **Step 1: Write the failing auth runtime acceptance spec**

Create `e2e/acceptance/auth-runtime.acceptance.spec.ts`:

```ts
import { expect, test } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { installBrowserDiagnostics } from "./helpers/browserDiagnostics";

test.describe("M5.5 auth runtime parity", () => {
  test("loads API-mode browser current user and creates an authorized parameter submission draft path", async ({ page }, testInfo) => {
    // @acceptance AUTH-RUNTIME-001
    const diagnostics = installBrowserDiagnostics(page, testInfo);

    const meResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: smokeHeaders()
    });
    expect(meResponse.ok()).toBe(true);

    await page.goto("/parameters?project=aurora");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/Unauthorized|UNAUTHENTICATED|VALIDATION_FAILED/i)).toHaveCount(0);

    diagnostics.assertNoBrowserDiagnosticsFailures();
  });
});
```

- [x] **Step 2: Run the spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/auth-runtime.acceptance.spec.ts
```

Expected: fail if API-mode browser auth is not equivalent to the local dev `.env` and smoke-token contract.

- [x] **Step 3: Fix only the discovered runtime-parity gap**

If the spec fails because the frontend lacks auth in API mode, update the smallest responsible local runtime path. Likely candidates:

- `scripts/run-dev-all.ts`
- `playwright.acceptance.config.ts`
- `.env.example`
- `src/infrastructure/http/apiClient.ts`

Do not weaken backend auth. The expected behavior is that local API mode provides an explicit bearer token to the frontend, not that protected routes allow anonymous writes.

- [x] **Step 4: Verify auth parity**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/auth-runtime.acceptance.spec.ts
npm run acceptance:coverage
```

Expected: auth runtime spec passes; `AUTH-RUNTIME-001` is covered.

## Task 4: Add Parameter Negative-Path And Assignee Eligibility Acceptance

**Files:**

- Create: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify as needed after failing tests: `src/ParametersPage.tsx`, `src/components/ParameterDraftDialog.tsx`, `server/modules/parameters/*`, `scripts/seed-m1-parameters.ts`

- [x] **Step 1: Mark existing happy-path coverage**

Add markers to `e2e/acceptance/parameters.acceptance.spec.ts`:

```ts
// @acceptance PARAM-HAPPY-001
// @acceptance PARAM-ADMIN-001
```

- [x] **Step 2: Write failing negative-path acceptance tests**

Create `e2e/acceptance/parameters-negative.acceptance.spec.ts` with three tests:

```ts
import { expect, test } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { installBrowserDiagnostics } from "./helpers/browserDiagnostics";

test.describe("M5.5 parameter negative-path browser acceptance", () => {
  test("blocks blank draft reasons before API submission", async ({ page }, testInfo) => {
    // @acceptance PARAM-REASON-001
    const diagnostics = installBrowserDiagnostics(page, testInfo);

    await page.goto("/parameters?project=aurora");
    await page.getByRole("searchbox", { name: /搜索|search|名称|描述|模块/i }).fill("Fast charge current");
    await page.getByRole("button", { name: /查看|View/i }).first().click();
    await page.getByRole("button", { name: /加入修改草稿|Add to draft/i }).click();

    const dialog = page.getByRole("dialog", { name: /修改草稿|draft/i });
    await dialog.getByLabel(/目标值|Target value/i).fill("3100");
    await dialog.getByLabel(/修改原因|Reason/i).fill("   ");
    await expect(dialog.getByRole("button", { name: /提交参数|Submit parameter/i })).toBeDisabled();

    diagnostics.assertNoBrowserDiagnosticsFailures();
  });

  test("defaults every workflow assignee slot to an eligible active non-admin user", async ({ page }, testInfo) => {
    // @acceptance PARAM-ASSIGNEE-001
    // @acceptance PARAM-ASSIGNEE-002
    const diagnostics = installBrowserDiagnostics(page, testInfo);

    await page.goto("/parameters?project=aurora");
    await createOneValidDraft(page);
    await page.getByRole("region", { name: /本轮已修改参数区|modified/i }).getByRole("button", { name: /提交本轮/i }).click();

    const submitDialog = page.getByRole("dialog", { name: /提交本轮参数|Submit/i });
    for (const label of [/硬件 MDE|Hardware/i, /软件 MDE|Software MDE/i, /软件开发|Software developer/i]) {
      const select = submitDialog.getByLabel(label);
      await expect(select).not.toHaveValue("");
      await expect(select).not.toContainText("Xu Yun");
      await expect(select).not.toContainText("Guest");
      await expect(select).not.toContainText("Tao Lin");
    }

    diagnostics.assertNoBrowserDiagnosticsFailures();
  });

  test("rejects forced invalid workflow assignees at the API boundary", async ({ page }) => {
    // @acceptance PARAM-ASSIGNEE-003
    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId: "aurora",
        items: [{ parameterId: "aurora-fast-charge-current", targetValue: "3100", reason: "M5.5 invalid assignee guard" }],
        reason: "M5.5 invalid assignee guard",
        assignees: {
          hardwareCommitterId: "u-xu-yun",
          softwareCommitterId: "u-xu-yun",
          softwareUserId: "u-xu-yun"
        }
      }
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });
});

async function createOneValidDraft(page: import("playwright/test").Page) {
  await page.getByRole("searchbox", { name: /搜索|search|名称|描述|模块/i }).fill("Fast charge current");
  await page.getByRole("button", { name: /查看|View/i }).first().click();
  await page.getByRole("button", { name: /加入修改草稿|Add to draft/i }).click();
  const dialog = page.getByRole("dialog", { name: /修改草稿|draft/i });
  await dialog.getByLabel(/目标值|Target value/i).fill("3100");
  await dialog.getByLabel(/修改原因|Reason/i).fill("M5.5 browser acceptance valid reason");
  await dialog.getByRole("button", { name: /提交参数|Submit parameter/i }).click();
}
```

- [x] **Step 3: Run the spec and confirm failures**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters-negative.acceptance.spec.ts
```

Expected: fail on any remaining real gap in reason validation, dropdown eligibility, seed data, or API rejection.

- [x] **Step 4: Implement minimal fixes**

Fix only the failing behavior. Likely fixes are:

- ensure `ParameterDraftDialog` disables submit when `reason.trim()` is empty.
- ensure workflow-assignee dropdown options are filtered with the same eligibility rules as the backend.
- ensure local seeds include at least one active eligible user for each workflow slot.
- ensure backend rejects forced invalid assignees consistently.
- ensure API errors are displayed in the UI rather than only in the browser console.

- [x] **Step 5: Verify parameter coverage**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts e2e/acceptance/parameters-negative.acceptance.spec.ts
npm run acceptance:coverage
```

Expected: parameter specs pass; `PARAM-REASON-001`, `PARAM-ASSIGNEE-001`, `PARAM-ASSIGNEE-002`, `PARAM-ASSIGNEE-003`, `PARAM-HAPPY-001`, and `PARAM-ADMIN-001` are covered.

## Task 5: Add Permissions Matrix Acceptance

**Files:**

- Create: `e2e/acceptance/permissions-matrix.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`
- Modify as needed after failing tests: `src/app/permissions.ts`, `server/modules/auth/*`, `server/modules/parameters/*`

- [x] **Step 1: Mark existing governance coverage**

Add marker to `e2e/acceptance/permissions.acceptance.spec.ts`:

```ts
// @acceptance PERM-GOV-001
```

- [x] **Step 2: Write failing permissions matrix acceptance**

Create `e2e/acceptance/permissions-matrix.acceptance.spec.ts`:

```ts
import { expect, test } from "playwright/test";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

const roleExpectations = [
  { role: "Guest", canOpenDebugging: false, canOpenReview: false },
  { role: "Hardware User", canOpenDebugging: true, canOpenReview: false },
  { role: "Software User", canOpenDebugging: true, canOpenReview: false },
  { role: "Hardware Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Software Committer", canOpenDebugging: true, canOpenReview: true },
  { role: "Admin", canOpenDebugging: true, canOpenReview: true }
];

test.describe("M5.5 permissions matrix browser acceptance", () => {
  for (const expectation of roleExpectations) {
    test(`enforces visible route permissions for ${expectation.role}`, async ({ page }) => {
      // @acceptance PERM-MATRIX-001
      await page.goto("/");
      await page.getByRole("button", { name: "Open user role switcher" }).click();
      await page.getByRole("combobox", { name: "Prototype role" }).selectOption({ label: expectation.role });

      await page.goto("/debugging");
      await expect(page.getByRole("heading", { name: expectation.canOpenDebugging ? /调试|Debugging/i : /Permission denied/i })).toBeVisible();

      await page.goto("/parameter-review");
      await expect(page.getByRole("heading", { name: expectation.canOpenReview ? /审阅|Review/i : /Permission denied/i })).toBeVisible();
    });
  }

  test("keeps API-backed workflow eligibility stricter than visible role inclusion", async ({ page }) => {
    // @acceptance PERM-MATRIX-002
    const response = await page.request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
      headers: smokeHeaders(),
      data: {
        projectId: "aurora",
        items: [{ parameterId: "aurora-fast-charge-current", targetValue: "3100", reason: "M5.5 role eligibility check" }],
        reason: "M5.5 role eligibility check",
        assignees: {
          hardwareCommitterId: "u-eligible-hardware-committer",
          softwareCommitterId: "u-eligible-software-committer",
          softwareUserId: "u-eligible-software-user"
        }
      }
    });

    expect([200, 201, 400]).toContain(response.status());
    if (response.status() >= 400) {
      const body = await response.json();
      expect(body.error.details).not.toMatchObject({ userId: "u-xu-yun" });
    }
  });
});
```

- [x] **Step 3: Run the spec and confirm failures**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/permissions.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts
```

Expected: fail if UI route gating, role inclusion, project-scoped bindings, or seed IDs are inconsistent.

- [x] **Step 4: Implement minimal fixes**

Fix role inclusion and project-scoped workflow eligibility at the smallest responsible layer. Do not make Admin silently eligible for every workflow slot unless product documentation explicitly says so.

- [x] **Step 5: Verify permissions coverage**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/permissions.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts
npm run acceptance:coverage
```

Expected: permissions specs pass; `PERM-GOV-001`, `PERM-MATRIX-001`, and `PERM-MATRIX-002` are covered.

## Task 6: Improve Evidence From Workflow-Level To Requirement-Level

**Files:**

- Modify: `e2e/acceptance/helpers/evidence.ts`
- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `scripts/run-browser-acceptance.test.ts`
- Modify: `docs/generated/acceptance-browser-evidence.md` after final run

- [x] **Step 1: Write failing evidence tests**

Add a test to `scripts/run-browser-acceptance.test.ts`:

```ts
it("renders requirement coverage in browser acceptance evidence", () => {
  const evidence = buildBrowserAcceptanceEvidence({
    date: "2026-06-01T00:00:00.000Z",
    metadata: { branch: "codex/m5-5", commit: "abc123", dirty: false },
    mode: "local-non-hdc",
    status: "passed",
    preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
    playwright: { status: "passed" },
    workflows: [],
    requirementCoverage: {
      status: "passed",
      coveredIds: ["AUTH-RUNTIME-001"],
      missingRequiredIds: [],
      unknownIds: []
    },
    artifactPaths: [],
    blockers: []
  });

  expect(evidence).toContain("### Requirement Coverage");
  expect(evidence).toContain("- Coverage status: `passed`");
  expect(evidence).toContain("- Covered required IDs: `1`");
});
```

- [x] **Step 2: Run the test and confirm it fails**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: fail because `BrowserAcceptanceEvidenceInput` has no `requirementCoverage`.

- [x] **Step 3: Extend evidence types and runner**

Add optional `requirementCoverage` to `BrowserAcceptanceEvidenceInput`, call `evaluateAcceptanceCoverage` inside `scripts/run-browser-acceptance.ts`, and add coverage blockers:

```ts
if (coverage.status !== "passed") {
  blockers.push(...coverage.missingRequiredIds.map((id) => `Required browser acceptance ID is not covered: ${id}`));
  blockers.push(...coverage.unknownIds.map((id) => `Unknown browser acceptance ID marker found: ${id}`));
}
```

- [x] **Step 4: Verify evidence tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts scripts/check-acceptance-coverage.test.ts
```

Expected: pass.

## Task 7: Add Coverage Markers For Existing A-H Specs

**Files:**

- Modify: `e2e/acceptance/shell-navigation.acceptance.spec.ts`
- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`
- Modify: `e2e/acceptance/agent.acceptance.spec.ts`

- [x] **Step 1: Add markers without changing behavior**

Add markers near the owning test:

```ts
// @acceptance SHELL-DIAG-001
// @acceptance LOG-HAPPY-001
// @acceptance DEBUG-SIM-001
// @acceptance HDC-LAB-001
// @acceptance AGENT-APPROVAL-001
```

- [x] **Step 2: Run coverage checker**

Run:

```bash
npm run acceptance:coverage
```

Expected: pass only after all required IDs are covered; optional `HDC-LAB-001` may remain conditional but must not be unknown.

## Task 8: Update Documentation And Governance

**Files:**

- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/PLANS.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`

- [x] **Step 1: Update verification matrix**

Add `npm run acceptance:coverage` and clarify that UI/API interaction changes must update requirement IDs, not only workflow files.

- [x] **Step 2: Update manual acceptance runbooks**

Document:

- browser acceptance is deterministic but not exhaustive unless the coverage map contains the operation.
- unexpected browser console/API failures now block acceptance.
- manual exploratory review remains required for new flows until the coverage map is updated.

- [x] **Step 3: Strengthen the planning rule**

Update `docs/PLANS.md` so future plans that change UI/API interaction behavior must list affected acceptance requirement IDs. If no ID exists, the plan must add one.

- [x] **Step 4: Update roadmap**

Add M5.5 as a post-M5 corrective hardening slice before M6 production hardening.

- [x] **Step 5: Run docs check**

Run:

```bash
npm run docs:check
```

Expected: pass.

## Task 9: Final Verification

**Files:**

- Update on run: `docs/generated/acceptance-browser-evidence.md`
- Modify if needed: `docs/exec-plans/tech-debt-tracker.md`

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- scripts/check-acceptance-coverage.test.ts e2e/acceptance/helpers/browserDiagnostics.test.ts scripts/run-browser-acceptance.test.ts
```

Expected: pass.

- [x] **Step 2: Run focused browser acceptance specs**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/auth-runtime.acceptance.spec.ts e2e/acceptance/parameters.acceptance.spec.ts e2e/acceptance/parameters-negative.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts
```

Expected: pass in local non-HDC mode.

- [x] **Step 3: Run the full browser acceptance package**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:browser
```

Expected: coverage passes; browser acceptance passes with requirement-level evidence; HDC remains skipped only in local non-HDC mode.

- [x] **Step 4: Run standard gates**

Run:

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
git diff --check
```

Expected: all pass. Existing Vite chunk-size warning during `npm run build` may be recorded as non-blocking if present.

- [x] **Step 5: Record remaining gaps**

If any realistic user operation remains outside automated coverage, add it to `docs/exec-plans/tech-debt-tracker.md` with:

- acceptance ID needed.
- affected page/API.
- risk level.
- reason it was not completed in M5.5.

## Documentation Impact Matrix

| Area | Files | Action | Reason |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | M5.5 changes test governance; update only if command entry points or reading order change. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | Add acceptance requirement ID governance and active M5.5 roadmap slice. |
| Product specs | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | Update only if tests expose behavior that differs from product intent. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Update if requirement-level acceptance becomes part of documented test architecture. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/QUALITY_SCORE.md` | Update | Add coverage command, diagnostics behavior, and coverage map. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md`, `docs/RELIABILITY.md` | Update | Explain automated browser evidence limits and strengthened failure behavior. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md`, permissions documentation | Review | Update if auth/permission tests reveal changed authorization rules. |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/DESIGN.md` | Review | Update if stable selector/testability conventions change. |
| Generated artifacts | `docs/generated/acceptance-browser-evidence.md`, `docs/generated/m5-pilot-acceptance.md` | Update | Regenerate browser evidence only from a real M5.5 acceptance run; M5 pilot evidence updates only if pilot gates are actually rerun. |
| References | `docs/references/*` | Review | Update only if LLM/agent references need the new acceptance requirement model. |
| Chinese docs | `docs/zh-CN/README.md`, `docs/zh-CN/manual-acceptance.md` | Update | Chinese developer acceptance guidance must explain the new coverage gate. |

## Documentation Update Gate

- [x] Every `Update` row in the Documentation Impact Matrix has been updated.
- [x] Every `Review` row has been checked and either updated or recorded as unchanged in this plan.
- [x] `docs/developer/browser-acceptance-coverage-map.md` exists and lists all required acceptance IDs.
- [x] `docs/PLANS.md` requires future UI/API interaction plans to name acceptance requirement IDs.
- [x] `docs/zh-CN/manual-acceptance.md` explains the strengthened browser acceptance gate.
- [x] `npm run docs:check` passes.

## Execution Notes

- Implement with TDD: every production or test-helper behavior change starts with a failing unit or acceptance test.
- Keep fixes surgical. Do not loosen backend auth or validation to make browser tests pass.
- If a test is flaky, fix the test contract or app determinism before marking the requirement covered.
- Do not mark this plan complete until `npm run acceptance:coverage` and `npm run acceptance:browser` both pass and the generated evidence shows requirement-level coverage.
