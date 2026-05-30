# WiseEff M5.4 Browser Acceptance Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Completion Summary

Completed on 2026-05-30 in local non-HDC mode.

- Added deterministic Playwright browser acceptance coverage for manual flows A-H, with HDC flow F conditional on real device-lab variables.
- Added `npm run acceptance:e2e` and `npm run acceptance:browser`.
- Added preflight/runtime startup, API-mode frontend authorization injection, mode-specific pass/fail rules, and generated browser acceptance evidence.
- Added workflow-level evidence derived from `test-results/acceptance/results.json` so skipped or failed required workflows cannot be over-reported as passed.
- Added durable documentation governance requiring future UI-interaction frontend/backend logic changes to update or explicitly review browser acceptance automation.

Verification evidence:

- `npm test -- scripts/run-browser-acceptance.test.ts scripts/run-acceptance-preflight.test.ts`: passed, 43 tests.
- `npm run acceptance:browser`: passed in local non-HDC mode, 16 passed and 1 skipped HDC test, generated `docs/generated/acceptance-browser-evidence.md`.
- `npm run docs:check`: passed.
- `npm run contract:check`: passed.
- `npm run test:all`: passed, 179 frontend/shared test files and 61 server test files.
- `npm run build`: passed with the existing non-blocking Vite chunk-size warning.
- `git diff --check`: passed.

Documentation review notes:

- Repository maps: no update needed; new commands are recorded in verification/manual acceptance docs, not primary onboarding.
- Product specs: no update needed; automation follows existing A-H manual acceptance behavior.
- Architecture/testing docs: no architecture shift beyond adding Playwright acceptance; verification matrix records the gate.
- Security/governance docs: no separate update needed; bearer token handling is documented through environment/manual acceptance guidance and tests redact secrets.
- Frontend/design docs: no update needed; no new selector convention or design-system behavior was introduced.
- Generated artifacts: `docs/generated/acceptance-browser-evidence.md` was generated from the final local non-HDC acceptance run.

**Goal:** Convert the manual browser acceptance flows A-H into deterministic Playwright browser acceptance gates with generated evidence for local non-HDC, target non-HDC, and full pilot-ready reviews.

**Architecture:** Keep Playwright as the release-grade browser automation engine and reuse the existing API-mode E2E foundation. Add a focused acceptance suite under `e2e/acceptance/`, a small evidence recorder used by the tests, and a runner script that combines preflight, Playwright execution, and markdown evidence generation. AI browser agents and visual SaaS tools remain out of scope for this plan.

**Tech Stack:** Playwright Test, TypeScript, PostgreSQL seed scripts, existing WiseEff API-mode runtime, Node.js filesystem APIs, existing `npm run acceptance:preflight`, existing docs governance.

---

## Scope Boundary

This plan includes Phase 1 and Phase 2 from the browser acceptance automation roadmap:

- Phase 1: deterministic Playwright acceptance coverage for the current manual browser workflows A-H, with HDC kept as a conditional real-device suite.
- Phase 2: evidence capture for screenshots, trace references, API assertions, audit IDs, operation IDs, environment metadata, and a generated markdown acceptance report.
- Documentation rules that require future UI-interaction frontend/backend logic changes to update browser acceptance automation.

This plan does not include:

- AI exploratory browser agents such as Stagehand, Browser Use, Skyvern, or Playwright MCP.
- Paid visual regression platforms such as Percy, Chromatic, or Applitools.
- New production infrastructure such as OIDC, durable queues, cloud object storage IaC, monitoring, or capacity testing.
- Claiming HDC pilot readiness without real hardware variables and lab evidence.

## Success Criteria

- `npm run acceptance:e2e` runs the deterministic browser acceptance suite in API mode.
- `npm run acceptance:browser` runs preflight plus browser acceptance and writes markdown evidence.
- Local non-HDC acceptance passes when `deviceGateway` is the only pilot-readiness blocker, or when the local auto-started deterministic Agent leaves exactly `deviceGateway` plus `agentProvider` blocked.
- Target non-HDC acceptance can run against an externally managed target with `--no-start-runtime`.
- Full pilot mode fails unless HDC, pilot readiness, and strict target evidence are actually available.
- The generated evidence file records branch, commit, dirty state, environment mode, workflow outcomes derived from the Playwright JSON report, screenshots/trace/report locations, key API responses, audit IDs, and known blockers.
- Documentation governance requires acceptance automation updates for future UI-interaction behavior changes.

## File Structure

Create:

- `playwright.acceptance.config.ts`: acceptance-specific Playwright config that reuses the local API/frontend web servers and writes acceptance artifacts plus `test-results/acceptance/results.json`.
- `e2e/acceptance/helpers/runtime.ts`: shared API base URL, auth headers, route helpers, and response parsing for acceptance tests.
- `e2e/acceptance/helpers/database.ts`: PostgreSQL seed and cleanup helpers extracted from the current milestone E2E tests.
- `e2e/acceptance/helpers/evidence.ts`: in-test evidence recorder for steps, screenshots, API assertions, audit IDs, and generated markdown sections.
- `e2e/acceptance/shell-navigation.acceptance.spec.ts`: manual flow A automation.
- `e2e/acceptance/parameters.acceptance.spec.ts`: manual flows B and C automation.
- `e2e/acceptance/log-analysis.acceptance.spec.ts`: manual flow D automation.
- `e2e/acceptance/debugging-simulator.acceptance.spec.ts`: manual flow E automation.
- `e2e/acceptance/agent.acceptance.spec.ts`: manual flow G automation.
- `e2e/acceptance/permissions.acceptance.spec.ts`: manual flow H automation.
- `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`: manual flow F conditional real-device automation.
- `scripts/run-browser-acceptance.ts`: runner for preflight, Playwright acceptance, and evidence output.
- `scripts/run-browser-acceptance.test.ts`: focused tests for runner argument parsing, mode validation, and command construction.

Modify:

- `package.json`: add `acceptance:e2e` and `acceptance:browser`.
- `docs/runbooks/manual-acceptance.md`: document the automated browser acceptance path and when manual review is still required.
- `docs/zh-CN/manual-acceptance.md`: add the same operator guidance in Chinese.
- `docs/developer/verification-matrix.md`: add the new acceptance commands and change-trigger rules.
- `docs/PLANS.md`: keep the UI interaction automation update rule as a permanent planning constraint.
- `docs/generated/m5-pilot-acceptance.md`: only updated with real evidence when the runner is executed for an acceptance candidate.

## Phase 1: Deterministic Browser Acceptance Suite

### Task 1: Add Acceptance Config And NPM Commands

**Files:**
- Create: `playwright.acceptance.config.ts`
- Modify: `package.json`
- Test: `scripts/run-browser-acceptance.test.ts`

- [x] **Step 1: Write the failing runner command test**

Add a test that expects the runner to invoke Playwright with the acceptance config:

```ts
expect(buildBrowserAcceptanceCommand({ mode: "local-non-hdc", evidenceOut: undefined })).toEqual({
  command: "npm",
  args: ["run", "acceptance:e2e", "--", "--reporter=list"]
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL because `scripts/run-browser-acceptance.ts` does not exist.

- [x] **Step 3: Add the minimal acceptance config**

Create `playwright.acceptance.config.ts` by importing the existing `playwright.config.ts` defaults where practical, then set:

```ts
testDir: "./e2e/acceptance",
outputDir: "test-results/acceptance",
reporter: [["list"], ["html", { outputFolder: "playwright-report/acceptance", open: "never" }]],
use: {
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
  video: "retain-on-failure"
}
```

- [x] **Step 4: Add npm scripts**

Update `package.json` scripts:

```json
"acceptance:e2e": "playwright test --config playwright.acceptance.config.ts",
"acceptance:browser": "tsx -- scripts/run-browser-acceptance.ts"
```

- [x] **Step 5: Run the focused test and script discovery**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
npm run acceptance:e2e -- --list
```

Expected: the unit test passes after the runner skeleton exists; `--list` succeeds once at least one acceptance spec is present.

### Task 2: Add Shared Acceptance Helpers

**Files:**
- Create: `e2e/acceptance/helpers/runtime.ts`
- Create: `e2e/acceptance/helpers/database.ts`
- Create: `e2e/acceptance/helpers/evidence.ts`
- Test: `scripts/run-browser-acceptance.test.ts`

- [x] **Step 1: Write failing evidence builder tests**

Add tests for stable markdown output:

```ts
const markdown = buildBrowserAcceptanceEvidence({
  metadata: { branch: "codex/example", commit: "abc123", dirty: false },
  mode: "local-non-hdc",
  workflows: [{ id: "A", name: "Shell navigation", status: "passed", evidence: ["screenshot: shell.png"] }],
  blockers: []
});
expect(markdown).toContain("## Browser Acceptance Evidence");
expect(markdown).toContain("| A | Shell navigation | passed |");
```

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL because the evidence builder is not implemented.

- [x] **Step 3: Implement runtime helpers**

Add helper functions:

```ts
export function apiBaseUrl() {
  return process.env.VITE_WISEEFF_API_BASE_URL ?? process.env.WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
}

export function smokeHeaders() {
  const authorization = process.env.M5_SMOKE_AUTHORIZATION ?? process.env.WISEEFF_SMOKE_AUTHORIZATION;
  return authorization ? { Authorization: authorization } : {};
}
```

- [x] **Step 4: Implement evidence helpers**

Expose:

```ts
export type AcceptanceWorkflowStatus = "passed" | "failed" | "skipped";
export type AcceptanceMode = "local-non-hdc" | "target-non-hdc" | "full-pilot";
export function buildBrowserAcceptanceEvidence(input: BrowserAcceptanceEvidenceInput): string;
```

The builder must escape markdown table cells, include metadata, include workflow rows, and include blockers as plain bullet points.

- [x] **Step 5: Implement database helper extraction**

Move duplicated seed command helpers from existing E2E files into `e2e/acceptance/helpers/database.ts`:

```ts
export function runNpmScript(script: string): void;
export async function withPgClient<T>(callback: (client: Client) => Promise<T>): Promise<T>;
```

Acceptance specs may continue to own workflow-specific cleanup SQL.

- [x] **Step 6: Run helper tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

### Task 3: Automate Flow A, Shell Navigation And Access

**Files:**
- Create: `e2e/acceptance/shell-navigation.acceptance.spec.ts`
- Modify: `e2e/acceptance/helpers/evidence.ts`

- [x] **Step 1: Write the failing shell navigation spec**

The spec must open `/`, then visit these routes:

```ts
const routes = [
  "/parameters",
  "/parameter-review",
  "/parameter-admin",
  "/logs",
  "/log-admin",
  "/debugging",
  "/node-debugging",
  "/debugging-admin",
  "/user-permissions"
];
```

Assert that each route has a non-empty page shell and no visible crash text.

- [x] **Step 2: Run the spec and verify failures are real**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/shell-navigation.acceptance.spec.ts
```

Expected: FAIL until the spec imports working helpers and records evidence.

- [x] **Step 3: Implement shell assertions**

Use stable locators where available:

```ts
await expect(page.locator("body")).not.toContainText(/runtime error|uncaught|cannot read/i);
await expect(page.locator("main, .app-shell, body")).toBeVisible();
```

Capture one screenshot after the initial shell load.

- [x] **Step 4: Run the shell spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/shell-navigation.acceptance.spec.ts
```

Expected: PASS in local API mode.

### Task 4: Automate Flows B And C, Parameter Management And Governance

**Files:**
- Create: `e2e/acceptance/parameters.acceptance.spec.ts`
- Reuse: `e2e/parameter-management.api.spec.ts`

- [x] **Step 1: Write the failing parameter acceptance spec**

Port the existing M1 loop into the acceptance folder and add governance coverage for:

- parameter table search and filters
- detail dialog history and cross-project context
- draft creation
- submission round
- staged review advancement
- merged value persistence after reload
- `/parameter-admin?audit=open` audit drawer
- parameter admin search and import preview entry point

- [x] **Step 2: Run the parameter acceptance spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts
```

Expected: FAIL until cleanup/seed helpers and selectors are wired.

- [x] **Step 3: Implement the browser loop**

Use the existing API assertion pattern:

```ts
const auditResponse = await page.request.get(`${apiBaseUrl()}/api/v1/audit-events`, { headers: smokeHeaders() });
expect(auditResponse.ok()).toBe(true);
```

Record the merged request ID and audit event target ID in evidence.

- [x] **Step 4: Run the parameter acceptance spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts
```

Expected: PASS in local API mode with PostgreSQL seeds.

### Task 5: Automate Flow D, Log Analysis

**Files:**
- Create: `e2e/acceptance/log-analysis.acceptance.spec.ts`
- Reuse: `e2e/log-analysis.api.spec.ts`

- [x] **Step 1: Write the failing log acceptance spec**

Cover:

- upload `test-fixtures/logs/charging-foldback.log`
- question `Why did fast charging fold back?`
- staged progress to `complete`
- conclusion with thermal/foldback evidence
- evidence card anchors a raw log line
- admin helpful feedback audit
- archive hides the item from default history
- upload `test-fixtures/logs/unsupported.bin`
- unsupported file reaches `failed` with unsupported-format reason

- [x] **Step 2: Run the log spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
```

Expected: FAIL until the acceptance helper extraction is complete.

- [x] **Step 3: Implement log evidence recording**

Record the uploaded log ID, analysis run status, feedback audit presence, archive state, and unsupported failure reason.

- [x] **Step 4: Run the log spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
```

Expected: PASS in local API mode.

### Task 6: Automate Flow E And Conditional Flow F, Debugging

**Files:**
- Create: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Create: `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`
- Reuse: `e2e/debugging.api.spec.ts`

- [x] **Step 1: Write the failing simulator acceptance spec**

Cover:

- `Aurora Simulator 1` online
- `Fast charge current` reads `3000`
- safe write to `3100`
- readback confirms `3100`
- `Cycle count` is read-only in the UI
- `Readback mismatch probe` with `2` reports mismatch
- rollback restores fast charge current to `3000`
- write and rollback audit events exist

- [x] **Step 2: Write the conditional HDC spec**

The HDC spec must skip unless:

```ts
process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc" &&
process.env.HDC_DEVICE_LAB_AVAILABLE === "true"
```

When enabled, it must require the existing `HDC_SMOKE_*` variables and restore the written node through snapshot rollback.

- [x] **Step 3: Run simulator acceptance**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts
```

Expected: PASS in simulator mode.

- [x] **Step 4: Run HDC discovery in simulator mode**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts
```

Expected: SKIPPED unless the real HDC environment variables are set.

### Task 7: Automate Flows G And H, Agent And Permissions

**Files:**
- Create: `e2e/acceptance/agent.acceptance.spec.ts`
- Create: `e2e/acceptance/permissions.acceptance.spec.ts`
- Reuse: `e2e/agent.api.spec.ts`

- [x] **Step 1: Write the failing Agent acceptance spec**

Cover:

- open WiseAgent from `/parameters`
- context appears in the panel
- read-only suggestion or summary action produces a visible answer
- approval-required draft action opens an approval dialog
- reject path leaves state unchanged
- approve path executes and records trace/audit evidence

- [x] **Step 2: Write the failing permissions acceptance spec**

Cover:

- user list loads
- role and activation state are visible
- role change affects protected route access
- inactive user cannot perform protected actions
- system does not allow removing the last active admin
- permission changes create audit evidence when the API exposes it

- [x] **Step 3: Run the focused specs**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts
```

Expected: FAIL until missing selectors, seed setup, or API hooks are added.

- [x] **Step 4: Implement minimal helpers and assertions**

Prefer accessible roles and existing CSS hooks. If a needed element has no stable selector, add a `data-testid` in the smallest owning component and cover that selector in the acceptance spec.

- [x] **Step 5: Run the focused specs**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts
```

Expected: PASS or a documented failing product gap added to `docs/exec-plans/tech-debt-tracker.md`.

### Task 8: Run The Full Phase 1 Gate

**Files:**
- Modify: `docs/developer/verification-matrix.md`

- [x] **Step 1: Run the full acceptance suite**

Run:

```bash
npm run acceptance:e2e
```

Expected: PASS for local non-HDC workflows; HDC spec is skipped unless real-device variables are present.

- [x] **Step 2: Run existing milestone gates**

Run:

```bash
npm run test:e2e
npm run test:all
npm run build
```

Expected: PASS.

- [x] **Step 3: Update verification matrix**

Add `npm run acceptance:e2e` as the browser workflow gate for frontend/backend UI interaction changes.

## Phase 2: Evidence Reporter And Acceptance Runner

### Task 9: Add Browser Acceptance Runner Modes

**Files:**
- Create: `scripts/run-browser-acceptance.ts`
- Create: `scripts/run-browser-acceptance.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing argument parsing tests**

Cover:

```ts
expect(parseBrowserAcceptanceArgs(["--mode", "target-non-hdc", "--no-start-runtime"])).toMatchObject({
  mode: "target-non-hdc",
  startRuntime: false
});
```

Also assert that invalid modes throw a useful error.

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL until the parser exists.

- [x] **Step 3: Implement runner options**

Support:

```text
--mode local-non-hdc
--mode target-non-hdc
--mode full-pilot
--env-file <path>
--evidence-out <path>
--skip-preflight
--no-start-runtime
--headed
```

Defaults:

```text
mode=local-non-hdc
envFile=.env
evidenceOut=docs/generated/acceptance-browser-evidence.md
startRuntime=true
```

- [x] **Step 4: Run parser tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

### Task 10: Integrate Preflight And Playwright Execution

**Files:**
- Modify: `scripts/run-browser-acceptance.ts`
- Test: `scripts/run-browser-acceptance.test.ts`

- [x] **Step 1: Write command construction tests**

Assert:

- local non-HDC runs `npm run acceptance:preflight -- --evidence-out <temp-preflight>`
- target non-HDC adds `--no-start-runtime`
- full pilot adds `--require-pilot-ready`
- Playwright receives `--config playwright.acceptance.config.ts`

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL until command construction is implemented.

- [x] **Step 3: Implement command execution**

Use `spawnSync` with `shell: process.platform === "win32"` and return structured command results:

```ts
type RunnerCommandResult = {
  name: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
};
```

- [x] **Step 4: Run tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

### Task 11: Generate Markdown Evidence

**Files:**
- Modify: `scripts/run-browser-acceptance.ts`
- Modify: `e2e/acceptance/helpers/evidence.ts`
- Create or update on run: `docs/generated/acceptance-browser-evidence.md`

- [x] **Step 1: Write evidence output tests**

Assert that generated markdown includes:

- date
- branch
- commit
- dirty worktree state
- acceptance mode
- preflight result
- Playwright result
- workflow table
- artifact locations
- blockers

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL until evidence generation is complete.

- [x] **Step 3: Implement artifact references**

Record these locations in markdown:

```text
playwright-report/acceptance/index.html
test-results/acceptance/results.json
test-results/acceptance/
docs/generated/acceptance-browser-evidence.md
```

When a screenshot is captured, store a relative artifact path in the workflow evidence list.

- [x] **Step 4: Run tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

### Task 12: Add Mode-Specific Pass/Fail Rules

**Files:**
- Modify: `scripts/run-browser-acceptance.ts`
- Test: `scripts/run-browser-acceptance.test.ts`

- [x] **Step 1: Write pass/fail tests**

Rules:

- `local-non-hdc`: pass when preflight returns `pilot_ready` or `non_hdc_local`, browser acceptance passes, and HDC is skipped.
- `target-non-hdc`: pass when preflight passes without local runtime startup and the only accepted blocker is HDC.
- `full-pilot`: pass only when preflight returns `pilot_ready`, browser acceptance passes, and HDC spec is not skipped.

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: FAIL until mode evaluation exists.

- [x] **Step 3: Implement mode evaluation**

Expose:

```ts
export function evaluateBrowserAcceptanceRun(input: BrowserAcceptanceRunResult): {
  status: "passed" | "failed";
  blockers: string[];
};
```

- [x] **Step 4: Run tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

### Task 13: Update Runbooks And Developer Docs

**Files:**
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/PLANS.md`

- [x] **Step 1: Update manual acceptance runbook**

Add:

```bash
npm run acceptance:browser
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run acceptance:browser -- --mode full-pilot --no-start-runtime
```

Explain that manual review remains required for ambiguous visual judgment, real HDC safety approval, backup/restore, rollback rehearsal, and any flow not yet represented in the generated evidence.

- [x] **Step 2: Update Chinese manual acceptance runbook**

Add the same commands and pass/fail interpretation in Chinese.

- [x] **Step 3: Update verification matrix**

Add:

| Gate | Command | Use when |
| --- | --- | --- |
| Browser acceptance | `npm run acceptance:browser` | Before accepting UI-interaction behavior changes in API mode. |

- [x] **Step 4: Confirm planning rule**

Ensure `docs/PLANS.md` says every active plan that changes UI interaction behavior must list the acceptance specs to add or update.

### Task 14: Run Phase 2 Verification

**Files:**
- All files changed by this plan

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
```

Expected: PASS.

- [x] **Step 2: Run browser acceptance**

Run:

```bash
npm run acceptance:browser
```

Expected: PASS for local non-HDC acceptance, with `docs/generated/acceptance-browser-evidence.md` generated.

- [x] **Step 3: Run documentation and build gates**

Run:

```bash
npm run docs:check
npm run test:all
npm run build
git diff --check
```

Expected: PASS. Existing Vite chunk-size warnings remain non-blocking if the build exits successfully.

## Documentation Impact Matrix

| Area | Files | Disposition | Required action |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | Update only if new commands become primary onboarding commands. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | Add the UI interaction automation update rule and keep this plan listed while active. |
| Product specs | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | Update only if automated acceptance reveals product behavior that differs from the spec. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Update if acceptance automation changes the documented testing architecture. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/QUALITY_SCORE.md` | Update | Add `acceptance:e2e` and `acceptance:browser` gates once implemented. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md`, `docs/RELIABILITY.md` | Update | Replace manual-only browser review guidance with automated browser evidence guidance. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md` | Review | Update if acceptance automation changes auth token handling or evidence retention. |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/DESIGN.md` | Review | Update if stable selector or UI testability conventions are added. |
| Generated artifacts | `docs/generated/acceptance-browser-evidence.md`, `docs/generated/m5-pilot-acceptance.md` | Update | Generate evidence only from real acceptance runs. |
| References | `docs/references/` | No change | No reference artifact is required for Phase 1 or Phase 2. |
| Chinese docs | `docs/zh-CN/README.md`, `docs/zh-CN/manual-acceptance.md` | Update | Link or describe the browser acceptance automation in the Chinese acceptance guide. |

## Documentation Update Gate

Before this plan can move to `docs/exec-plans/completed/`:

- [x] Every `Update` row in the Documentation Impact Matrix has been updated.
- [x] Every `Review` row has either been updated or has a short evidence note in this plan explaining why no change was needed.
- [x] `docs/PLANS.md` contains the durable UI interaction automation update rule.
- [x] `docs/developer/verification-matrix.md` includes the implemented browser acceptance commands.
- [x] `docs/runbooks/manual-acceptance.md` and `docs/zh-CN/manual-acceptance.md` explain how to run and interpret generated browser acceptance evidence.
- [x] `npm run docs:check` passes.

## UI Interaction Automation Rule

After this plan lands, any future active implementation plan that changes user-facing interaction behavior must identify which browser acceptance spec is affected. This applies to:

- route changes
- form, modal, drawer, table, upload, approval, filter, or navigation behavior
- frontend repository/API client behavior that changes visible state
- backend API behavior that changes what the UI renders, enables, disables, persists, or audits
- auth, permission, role, or production-token behavior visible in the browser
- Agent or device actions initiated from the UI

The future plan must either add or update an acceptance spec under `e2e/acceptance/`, or record a precise reason why the change is covered by an existing acceptance spec. A plan cannot be marked complete when UI-interaction behavior changed but browser acceptance coverage was not reviewed.

## Commit Plan

- Commit 1: `test: add browser acceptance runner contract tests`
- Commit 2: `feat: add browser acceptance Playwright suite`
- Commit 3: `feat: generate browser acceptance evidence`
- Commit 4: `docs: document browser acceptance governance`

## Final Verification Commands

Run before creating a PR:

```bash
npm test -- scripts/run-browser-acceptance.test.ts
npm run acceptance:browser
npm run docs:check
npm run test:all
npm run build
git diff --check
```

Expected final result: all commands pass, except HDC acceptance is skipped in local non-HDC mode unless real HDC device-lab variables are configured.
