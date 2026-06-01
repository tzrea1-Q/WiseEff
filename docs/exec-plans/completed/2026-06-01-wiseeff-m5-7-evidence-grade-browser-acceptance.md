# M5.7 Evidence-Grade Browser Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade browser acceptance from pass/fail reports into evidence-grade, replayable acceptance packages for every automated user operation.

**Architecture:** Build on M5.6 operation IDs. Each automated operation will emit a structured evidence record containing operation metadata, screenshots, Playwright trace references, key API responses, DB/audit summaries, request IDs, artifact paths, and failure diagnostics; the runner will fail if evidence is missing for required automated operations.

**Tech Stack:** Playwright Test, TypeScript, Vitest, JSON/Markdown evidence artifacts, existing `scripts/run-browser-acceptance.ts`, M5.6 `operationMatrix`.

---

## Background

M5.5 made browser acceptance stricter. M5.6 makes coverage honest at the user-operation level. M5.7 makes the results auditable. A commercial pilot needs more than "27 passed": it needs a reviewer to open a generated package and see what user operation ran, which role performed it, what API/DB/audit evidence proves it, and where to replay the browser trace if it failed.

M5.7 does not add large new product coverage. It upgrades evidence collection and reporting for the coverage that M5.6 makes explicit.

## Scope

In scope:

- Structured evidence records for automated operation IDs.
- A Playwright evidence helper that writes per-operation JSON and Markdown snippets.
- Screenshots and trace references attached to operation evidence.
- API, DB, audit, and artifact summary hooks that specs can call without copying boilerplate.
- A runner-level evidence validator that fails when required automated operations lack evidence.
- A generated evidence index under `docs/generated/`.
- Documentation for reviewing evidence packages during manual or PR acceptance.

Out of scope:

- New broad operation coverage. Missing operations belong to M5.6 or later coverage plans.
- AI exploratory QA.
- Visual regression SaaS.
- Long-term external artifact hosting. M5.7 records local artifact paths; CI upload can be added later.

## Acceptance Requirement IDs Affected

M5.7 affects all automated IDs from M5.6. At minimum:

- `AUTH-RUNTIME-001`
- `SHELL-DIAG-001`
- `PARAM-REASON-001`
- `PARAM-ASSIGNEE-001`
- `PARAM-ASSIGNEE-002`
- `PARAM-ASSIGNEE-003`
- `PARAM-HAPPY-001`
- `PARAM-ADMIN-001`
- `PARAM-DRAFT-EDIT-001`
- `PARAM-REJECT-001`
- `LOG-HAPPY-001`
- `LOG-REANALYZE-001`
- `DEBUG-SIM-001`
- `DEBUG-PERM-001`
- `AGENT-APPROVAL-001`
- `AGENT-UNAUTH-001`
- `PERM-GOV-001`
- `PERM-MATRIX-001`
- `PERM-MATRIX-002`
- `PERM-USER-MGMT-001`

Conditional ID:

- `HDC-LAB-001`

## Files

- Create: `e2e/acceptance/helpers/operationEvidence.ts`
- Create: `scripts/check-operation-evidence.ts`
- Create: `scripts/check-operation-evidence.test.ts`
- Create: `docs/generated/acceptance-operation-evidence.md`
- Create: `docs/generated/acceptance-operation-evidence/index.json`
- Modify: `e2e/acceptance/helpers/evidence.ts`
- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `scripts/run-browser-acceptance.test.ts`
- Modify: all automated `e2e/acceptance/*.acceptance.spec.ts` touched by M5.6
- Modify: `package.json`
- Modify: `playwright.acceptance.config.ts`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify if needed: `docs/PLANS.md`

---

## Task 1: Define The Operation Evidence Record Contract

**Files:**

- Create: `e2e/acceptance/helpers/operationEvidence.ts`
- Create: `scripts/check-operation-evidence.test.ts`

- [ ] **Step 1: Write failing evidence contract tests**

Create `scripts/check-operation-evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildOperationEvidenceRecord,
  evaluateOperationEvidence,
  renderOperationEvidenceIndex,
  type OperationEvidenceRecord
} from "./check-operation-evidence";

describe("operation evidence", () => {
  it("builds a normalized operation evidence record", () => {
    const record = buildOperationEvidenceRecord({
      operationId: "PARAM-DRAFT-EDIT-001",
      status: "passed",
      role: "Hardware User",
      route: "/parameters",
      assertions: ["ui", "api", "audit"],
      artifacts: ["test-results/acceptance/param-draft.png"],
      api: [{ method: "POST", path: "/api/v1/parameter-drafts", status: 201 }],
      audit: [{ kind: "parameter-draft", targetId: "draft-1" }]
    });

    expect(record).toMatchObject({
      operationId: "PARAM-DRAFT-EDIT-001",
      status: "passed",
      role: "Hardware User",
      route: "/parameters"
    });
    expect(record.recordedAt).toMatch(/T/);
  });

  it("fails when a required automated operation has no evidence", () => {
    const result = evaluateOperationEvidence({
      requiredOperationIds: ["PARAM-DRAFT-EDIT-001"],
      records: []
    });

    expect(result.status).toBe("failed");
    expect(result.missingOperationIds).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("renders an evidence markdown index", () => {
    const record: OperationEvidenceRecord = buildOperationEvidenceRecord({
      operationId: "PARAM-DRAFT-EDIT-001",
      status: "passed",
      role: "Hardware User",
      route: "/parameters",
      assertions: ["ui"],
      artifacts: ["trace.zip"]
    });

    const markdown = renderOperationEvidenceIndex([record]);

    expect(markdown).toContain("| `PARAM-DRAFT-EDIT-001` | passed | Hardware User | `/parameters` |");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts
```

Expected: fail because the checker does not exist.

- [ ] **Step 3: Implement shared evidence types**

Create `e2e/acceptance/helpers/operationEvidence.ts`:

```ts
export type OperationEvidenceStatus = "passed" | "failed" | "skipped";
export type OperationEvidenceAssertion = "ui" | "api" | "db" | "audit" | "artifact";

export type OperationEvidenceApiSummary = {
  method: string;
  path: string;
  status: number;
  requestId?: string;
};

export type OperationEvidenceDbSummary = {
  table: string;
  key: string;
  value: string;
};

export type OperationEvidenceAuditSummary = {
  kind: string;
  targetId: string | null;
  requestId?: string;
};

export type OperationEvidenceRecord = {
  operationId: string;
  status: OperationEvidenceStatus;
  role: string;
  route: string;
  recordedAt: string;
  assertions: OperationEvidenceAssertion[];
  artifacts: string[];
  api?: OperationEvidenceApiSummary[];
  db?: OperationEvidenceDbSummary[];
  audit?: OperationEvidenceAuditSummary[];
  notes?: string;
};

export function buildOperationEvidenceRecord(
  input: Omit<OperationEvidenceRecord, "recordedAt"> & { recordedAt?: string }
): OperationEvidenceRecord {
  return {
    ...input,
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };
}
```

- [ ] **Step 4: Implement checker exports**

Create `scripts/check-operation-evidence.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceOperations } from "../e2e/acceptance/operationMatrix";
import {
  buildOperationEvidenceRecord,
  type OperationEvidenceRecord
} from "../e2e/acceptance/helpers/operationEvidence";

export { buildOperationEvidenceRecord, type OperationEvidenceRecord };

export type OperationEvidenceEvaluation = {
  status: "passed" | "failed";
  missingOperationIds: string[];
  failedOperationIds: string[];
};

export function evaluateOperationEvidence(input: {
  requiredOperationIds: string[];
  records: OperationEvidenceRecord[];
}): OperationEvidenceEvaluation {
  const recordsByOperation = new Map(input.records.map((record) => [record.operationId, record]));
  const missingOperationIds = input.requiredOperationIds.filter((id) => !recordsByOperation.has(id));
  const failedOperationIds = input.records
    .filter((record) => record.status === "failed")
    .map((record) => record.operationId);

  return {
    status: missingOperationIds.length === 0 && failedOperationIds.length === 0 ? "passed" : "failed",
    missingOperationIds,
    failedOperationIds
  };
}

export function renderOperationEvidenceIndex(records: OperationEvidenceRecord[]) {
  return [
    "# Acceptance Operation Evidence",
    "",
    "| Operation ID | Status | Role | Route | Assertions | Artifacts |",
    "| --- | --- | --- | --- | --- | --- |",
    ...records.map((record) =>
      [
        `| \`${record.operationId}\``,
        record.status,
        record.role,
        `\`${record.route}\``,
        record.assertions.join(", "),
        record.artifacts.join("<br>"),
        "|"
      ].join(" | ")
    ),
    ""
  ].join("\n");
}

export function readOperationEvidenceRecords(root = "test-results/acceptance/operation-evidence") {
  if (!existsSync(root)) return [];

  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed = JSON.parse(readFileSync(join(root, name), "utf8")) as OperationEvidenceRecord | OperationEvidenceRecord[];
      return Array.isArray(parsed) ? parsed : [parsed];
    });
}

export function requiredAutomatedOperationIds() {
  return acceptanceOperations
    .filter((operation) => operation.coverage === "automated" && operation.priority !== "P2")
    .map((operation) => operation.id);
}

export function writeOperationEvidenceIndex(
  records: OperationEvidenceRecord[],
  markdownOut = "docs/generated/acceptance-operation-evidence.md",
  jsonOut = "docs/generated/acceptance-operation-evidence/index.json"
) {
  mkdirSync(dirname(markdownOut), { recursive: true });
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(markdownOut, renderOperationEvidenceIndex(records), "utf8");
  writeFileSync(jsonOut, `${JSON.stringify({ records }, null, 2)}\n`, "utf8");
}

export function runOperationEvidenceCheck() {
  const records = readOperationEvidenceRecords();
  const result = evaluateOperationEvidence({
    requiredOperationIds: requiredAutomatedOperationIds(),
    records
  });

  writeOperationEvidenceIndex(records);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runOperationEvidenceCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
```

- [ ] **Step 5: Verify evidence contract tests pass**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts
```

Expected: pass.

## Task 2: Add Playwright Operation Evidence Helper

**Files:**

- Modify: `e2e/acceptance/helpers/operationEvidence.ts`
- Create or modify tests: `scripts/check-operation-evidence.test.ts`

- [ ] **Step 1: Write failing tests for stable evidence paths**

Add:

```ts
import { operationEvidenceFileName } from "../e2e/acceptance/helpers/operationEvidence";

it("creates filesystem-safe operation evidence file names", () => {
  expect(operationEvidenceFileName("PARAM-DRAFT-EDIT-001", "edits draft before submit")).toBe(
    "PARAM-DRAFT-EDIT-001-edits-draft-before-submit.json"
  );
});
```

- [ ] **Step 2: Implement file name helper**

Add:

```ts
export function operationEvidenceFileName(operationId: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${operationId}-${slug || "evidence"}.json`;
}
```

- [ ] **Step 3: Implement `recordOperationEvidence`**

Add to `operationEvidence.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "playwright/test";

export async function recordOperationEvidence(
  page: Page,
  testInfo: TestInfo,
  input: Omit<OperationEvidenceRecord, "recordedAt" | "artifacts"> & {
    title: string;
    artifacts?: string[];
    screenshot?: boolean;
  }
) {
  const evidenceDir = join(testInfo.outputDir, "operation-evidence");
  mkdirSync(evidenceDir, { recursive: true });

  const artifacts = [...(input.artifacts ?? [])];
  if (input.screenshot !== false) {
    const screenshotPath = join(evidenceDir, `${input.operationId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(screenshotPath);
  }

  const record = buildOperationEvidenceRecord({
    ...input,
    artifacts
  });
  const filePath = join(evidenceDir, operationEvidenceFileName(input.operationId, input.title));
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await testInfo.attach(`operation-evidence-${input.operationId}`, {
    path: filePath,
    contentType: "application/json"
  });

  return record;
}
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts
```

Expected: pass.

## Task 3: Instrument Acceptance Specs With Operation Evidence

**Files:**

- Modify: `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters.acceptance.spec.ts`
- Modify: `e2e/acceptance/parameters-negative.acceptance.spec.ts`
- Modify: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/agent.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions.acceptance.spec.ts`
- Modify: `e2e/acceptance/permissions-matrix.acceptance.spec.ts`

- [ ] **Step 1: Add evidence to auth runtime**

In `auth-runtime.acceptance.spec.ts`, import `recordOperationEvidence` and append:

```ts
await recordOperationEvidence(page, testInfo, {
  operationId: "AUTH-RUNTIME-001",
  title: "loads API-mode current user",
  status: "passed",
  role: "Admin",
  route: "/parameters",
  assertions: ["ui", "api"],
  api: [{ method: "GET", path: "/api/v1/me", status: 200 }]
});
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/auth-runtime.acceptance.spec.ts
```

Expected: pass and attach operation evidence JSON.

- [ ] **Step 2: Add evidence to parameter operations**

For each parameter operation test, call `recordOperationEvidence` after final assertions:

```ts
await recordOperationEvidence(page, testInfo, {
  operationId: "PARAM-HAPPY-001",
  title: "parameter submit review merge audit",
  status: "passed",
  role: "Admin",
  route: "/parameters",
  assertions: ["ui", "api", "db", "audit"],
  api: [
    { method: "POST", path: "/api/v1/parameter-submission-rounds", status: 201 },
    { method: "POST", path: "/api/v1/parameter-change-requests/:id/review", status: 200 }
  ],
  audit: [{ kind: "parameter-review", targetId: completedRequestId }]
});
```

Repeat for:

- `PARAM-REASON-001`
- `PARAM-ASSIGNEE-001`
- `PARAM-ASSIGNEE-002`
- `PARAM-ASSIGNEE-003`
- `PARAM-DRAFT-EDIT-001`
- `PARAM-REJECT-001`
- `PARAM-ADMIN-001`

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts e2e/acceptance/parameters-negative.acceptance.spec.ts
```

Expected: pass and produce evidence JSON per operation.

- [ ] **Step 3: Add evidence to log operations**

Record evidence for `LOG-HAPPY-001` and `LOG-REANALYZE-001`:

```ts
await recordOperationEvidence(page, testInfo, {
  operationId: "LOG-HAPPY-001",
  title: "log upload complete evidence feedback archive unsupported",
  status: "passed",
  role: "Admin",
  route: "/logs",
  assertions: ["ui", "api", "db", "audit", "artifact"],
  api: [
    { method: "POST", path: "/api/v1/log-files", status: 201 },
    { method: "POST", path: "/api/v1/logs/:id/archive", status: 200 }
  ],
  audit: [{ kind: "log-feedback", targetId: completedLog.id }]
});
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
```

Expected: pass.

- [ ] **Step 4: Add evidence to debugging operations**

Record evidence for `DEBUG-SIM-001` and `DEBUG-PERM-001`:

```ts
await recordOperationEvidence(page, testInfo, {
  operationId: "DEBUG-SIM-001",
  title: "simulator read write mismatch rollback audit",
  status: "passed",
  role: "Admin",
  route: "/debugging",
  assertions: ["ui", "api", "audit"],
  api: [
    { method: "POST", path: "/api/v1/debugging/nodes/read", status: 200 },
    { method: "POST", path: "/api/v1/debugging/nodes/write", status: 200 }
  ],
  audit: [{ kind: "debug-node-write", targetId: sessionId }]
});
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts
```

Expected: pass.

- [ ] **Step 5: Add evidence to Agent and permissions operations**

Record evidence for:

- `AGENT-APPROVAL-001`
- `AGENT-UNAUTH-001`
- `PERM-GOV-001`
- `PERM-MATRIX-001`
- `PERM-MATRIX-002`
- `PERM-USER-MGMT-001`

Use role, route, API, DB, and audit summaries that match each test. For permission matrix loops, write one evidence record per role:

```ts
await recordOperationEvidence(page, testInfo, {
  operationId: `PERM-MATRIX-001:${expectation.role}`,
  title: `role matrix ${expectation.role}`,
  status: "passed",
  role: expectation.role,
  route: "/parameter-review",
  assertions: ["ui", "api"],
  notes: "Per-role evidence for PERM-MATRIX-001."
});
```

The validator should accept child records whose ID starts with `PERM-MATRIX-001:` when parent operation `PERM-MATRIX-001` is required.

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts
```

Expected: pass.

## Task 4: Aggregate Operation Evidence In The Browser Acceptance Runner

**Files:**

- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `scripts/run-browser-acceptance.test.ts`
- Modify: `e2e/acceptance/helpers/evidence.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing runner evidence tests**

Add to `scripts/run-browser-acceptance.test.ts`:

```ts
it("fails browser acceptance when required operation evidence is missing", () => {
  const result = evaluateBrowserAcceptanceRun({
    mode: "local-non-hdc",
    preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
    playwright: { status: "passed" },
    workflows: [],
    requirementCoverage: { status: "passed", coveredIds: [], missingRequiredIds: [], unknownIds: [] },
    operationEvidence: {
      status: "failed",
      missingOperationIds: ["PARAM-DRAFT-EDIT-001"],
      failedOperationIds: []
    }
  });

  expect(result.status).toBe("failed");
  expect(result.blockers).toContain("Operation evidence is missing required IDs: PARAM-DRAFT-EDIT-001.");
});
```

- [ ] **Step 2: Extend evidence types**

In `e2e/acceptance/helpers/evidence.ts`, add:

```ts
export type BrowserAcceptanceOperationEvidence = {
  status: BrowserAcceptanceOverallStatus;
  missingOperationIds: string[];
  failedOperationIds: string[];
};
```

Add optional `operationEvidence` to `BrowserAcceptanceEvidenceInput`.

- [ ] **Step 3: Render operation evidence summary**

In `buildBrowserAcceptanceEvidence`, add:

```ts
"### Operation Evidence",
"",
`- Evidence status: \`${operationEvidence?.status ?? "unknown"}\``,
`- Missing operation IDs: ${formatInlineList(operationEvidence?.missingOperationIds ?? [])}`,
`- Failed operation IDs: ${formatInlineList(operationEvidence?.failedOperationIds ?? [])}`,
"- Evidence index: docs/generated/acceptance-operation-evidence.md",
```

- [ ] **Step 4: Wire checker into runner**

In `scripts/run-browser-acceptance.ts`, import:

```ts
import {
  evaluateOperationEvidence,
  readOperationEvidenceRecords,
  requiredAutomatedOperationIds,
  writeOperationEvidenceIndex
} from "./check-operation-evidence";
```

After Playwright runs:

```ts
const operationRecords = readOperationEvidenceRecords();
const operationEvidence = evaluateOperationEvidence({
  requiredOperationIds: requiredAutomatedOperationIds(),
  records: operationRecords
});
writeOperationEvidenceIndex(operationRecords);
```

Pass `operationEvidence` to `evaluateBrowserAcceptanceRun` and `buildEvidence`.

- [ ] **Step 5: Add `acceptance:evidence` script**

Modify `package.json`:

```json
"acceptance:evidence": "tsx scripts/check-operation-evidence.ts"
```

- [ ] **Step 6: Verify runner unit tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts scripts/check-operation-evidence.test.ts
```

Expected: pass.

## Task 5: Preserve And Publish Evidence Artifacts

**Files:**

- Modify: `playwright.acceptance.config.ts`
- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`

- [ ] **Step 1: Ensure traces are retained for acceptance review**

Review `playwright.acceptance.config.ts`. If traces are only retained on failure, keep that default for storage control, but ensure operation screenshots and JSON are always written. Add this comment near `trace`:

```ts
// Operation evidence JSON and screenshots are always recorded by specs.
// Full Playwright traces remain retain-on-failure to keep local evidence size manageable.
```

- [ ] **Step 2: Add artifact path summary to browser evidence**

Ensure `artifactPaths` includes:

```ts
"docs/generated/acceptance-operation-evidence.md",
"docs/generated/acceptance-operation-evidence/index.json",
"test-results/acceptance"
```

- [ ] **Step 3: Document review procedure**

In `docs/runbooks/manual-acceptance.md`, add:

```md
### Reviewing Operation Evidence

After `npm run acceptance:browser`, open `docs/generated/acceptance-operation-evidence.md`. For each failed or questioned operation, inspect the linked JSON record, screenshot, and Playwright report. Treat missing P0/P1 automated operation evidence as a blocking acceptance failure.
```

- [ ] **Step 4: Add Chinese review procedure**

In `docs/zh-CN/manual-acceptance.md`, add:

```md
### 操作级证据复核

运行 `npm run acceptance:browser` 后，先查看 `docs/generated/acceptance-operation-evidence.md`。每个自动化 operation 都应有角色、路由、断言类型、API/DB/审计摘要和截图路径。P0/P1 自动化 operation 缺少证据时，验收不得通过。
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
- Update on run: `docs/generated/acceptance-operation-evidence.md`
- Update on run: `docs/generated/acceptance-operation-evidence/index.json`

- [ ] **Step 1: Run unit gates**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts scripts/check-acceptance-operation-matrix.test.ts
```

Expected: pass.

- [ ] **Step 2: Run evidence and browser gates**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:browser
npm run acceptance:evidence
```

Expected: all pass. `acceptance:browser` should generate both browser evidence and operation evidence indexes.

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

- [ ] **Step 4: Review generated evidence**

Open:

- `docs/generated/acceptance-browser-evidence.md`
- `docs/generated/acceptance-operation-evidence.md`
- `docs/generated/acceptance-operation-evidence/index.json`

Confirm:

- every automated P0/P1 operation has at least one evidence record.
- no evidence record is failed.
- every record has role, route, assertions, and artifact paths.
- HDC is recorded as skipped unless explicitly enabled.

## Documentation Impact Matrix

| Area | Files | Action | Reason |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | Add links only if generated evidence review becomes part of standard onboarding. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | M5.7 adds evidence-grade acceptance as a post-M5 quality stage. |
| Product specs | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | Update only if evidence work reveals product behavior gaps. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Evidence records may need to be documented as test architecture. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/QUALITY_SCORE.md` | Update | Add `acceptance:evidence` and operation evidence review procedure. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md`, `docs/RELIABILITY.md` | Update | Human acceptance must know how to inspect operation evidence packages. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md` | Review | Update if evidence artifacts include sensitive data handling rules. |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/DESIGN.md` | Review | Update only if screenshot/evidence conventions affect frontend testability. |
| Generated artifacts | `docs/generated/acceptance-browser-evidence.md`, `docs/generated/acceptance-operation-evidence.md`, `docs/generated/acceptance-operation-evidence/index.json` | Update | Regenerate from final real acceptance run. |
| References | `docs/references/*` | Review | Update only if agent-facing references need evidence-package semantics. |
| Chinese docs | `docs/zh-CN/README.md`, `docs/zh-CN/manual-acceptance.md` | Update | Chinese manual acceptance must explain operation evidence review. |

## Documentation Update Gate

- [ ] Every `Update` row in the Documentation Impact Matrix has been updated.
- [ ] Every `Review` row has been checked and either updated or recorded as unchanged in this plan.
- [ ] `docs/generated/acceptance-operation-evidence.md` is generated by a real acceptance run.
- [ ] `docs/generated/acceptance-operation-evidence/index.json` is generated by a real acceptance run.
- [ ] `docs/runbooks/manual-acceptance.md` and `docs/zh-CN/manual-acceptance.md` explain evidence review.
- [ ] `npm run docs:check` passes.

## Execution Notes

- M5.7 depends on M5.6. Do not implement M5.7 before M5.6 has operation IDs and `npm run acceptance:operations`.
- Use TDD for evidence contracts and runner evaluation before modifying specs.
- Evidence records should summarize enough to audit the operation without storing secrets or full payloads.
- Do not include raw bearer tokens, LLM API keys, or sensitive log content in generated evidence.
- Keep Playwright full traces retain-on-failure unless storage policy changes; operation screenshots and JSON are always recorded.
