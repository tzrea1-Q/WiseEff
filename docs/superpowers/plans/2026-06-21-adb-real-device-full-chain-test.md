# ADB Real Device Full-Chain Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, explicitly gated ADB real-device acceptance flow that proves `/node-debugging` through WiseEff API to a connected ADB device, defaulting to read-only and optionally running write/readback/rollback.

**Architecture:** Add a focused ADB device-lab Playwright spec that mirrors the existing HDC device-lab safety model but includes frontend protocol switching and browser evidence. Keep reusable ADB preflight/config helpers inside the spec for the first implementation to avoid widening test helper APIs prematurely. Update acceptance metadata and bilingual runbooks so the flow is discoverable without becoming default CI.

**Tech Stack:** TypeScript, Playwright acceptance tests, PostgreSQL test helpers, WiseEff debugging API, Node `child_process.spawnSync`, Markdown runbooks, npm verification scripts.

---

## File Structure

- Create `e2e/acceptance/adb-device-lab.acceptance.spec.ts`: local ADB device-lab test with read-only default and optional write/readback/rollback.
- Modify `e2e/acceptance/requirements.ts`: add optional `ADB-LAB-001` acceptance requirement under workflow F.
- Modify `e2e/acceptance/operationMatrix.ts`: add conditional `ADB-LAB-001` operation metadata.
- Create `docs/runbooks/adb-device-lab.md`: English runbook for local ADB device-lab execution.
- Create `docs/zh-CN/runbooks/adb-device-lab.md`: Chinese runbook.
- Modify `docs/runbooks/README.md` and `docs/zh-CN/runbooks/README.md`: link the new runbook.
- Modify `docs/developer/verification-matrix.md` and `docs/zh-CN/developer/verification-matrix.md`: document the ADB device-lab command and evidence meaning.
- Modify `docs/runbooks/manual-acceptance.md` and `docs/zh-CN/runbooks/manual-acceptance.md`: add ADB as a local device-lab supplement, not a replacement for existing HDC full-pilot evidence.
- Generated or mechanically updated by commands when needed: `docs/developer/user-operation-coverage-matrix.md`.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `docs/README.md`, `docs/zh-CN/README.md` | The new flow is routed through existing runbook and verification indexes. |
| Planning docs | Review | `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | Confirm no new planning rule is needed; this plan already includes required matrix and gate. |
| Product specs | No change | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md` | This is verification infrastructure, not product behavior. |
| Architecture docs | No change | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | ADB/HDC architecture was covered by the prior protocol design. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/zh-CN/developer/verification-matrix.md`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`, `docs/developer/user-operation-coverage-matrix.md` | Add the explicit ADB device-lab acceptance path and operation metadata. |
| Reliability/runbooks | Update | `docs/runbooks/adb-device-lab.md`, `docs/zh-CN/runbooks/adb-device-lab.md`, `docs/runbooks/README.md`, `docs/zh-CN/runbooks/README.md`, `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/runbooks/manual-acceptance.md` | Add local ADB hardware procedure and acceptance notes. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md` | Confirm existing device gateway safety language covers ADB; update only if wording is HDC-only. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | Confirm no UI implementation behavior changes beyond test coverage. |
| Generated artifacts | Update | `docs/developer/user-operation-coverage-matrix.md` | Regenerate through `npm run acceptance:operations` after operation matrix update. |
| References | No change | `docs/references/` | No compact reference needs a new entry for this test-only flow. |

## Documentation Update Gate

Before marking this plan complete:

- [ ] Every `Update` row in the Documentation Impact Matrix has been changed and reviewed.
- [ ] Every `Review` row has either been updated or explicitly recorded as unchanged in the implementation summary.
- [ ] English and Chinese human-facing docs are kept in separate linked files.
- [ ] `npm run docs:check` passes.
- [ ] If a planned doc update is deferred, the follow-up is added to `docs/exec-plans/tech-debt-tracker.md`.

---

### Task 1: Add ADB Device-Lab Spec Skeleton And Preflight Helpers

**Files:**
- Create: `e2e/acceptance/adb-device-lab.acceptance.spec.ts`

- [ ] **Step 1: Create the spec with config and ADB preflight helpers**

Use this initial file content:

```ts
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";

type AdbDeviceState = "device" | "unauthorized" | "offline" | "unknown";

type AdbSmokeConfig = {
  projectId: string;
  deviceId: string;
  targetRef: string;
  parameterId: string;
  nodePath: string;
  readValuePattern?: RegExp;
  userId: string;
  writeEnabled: boolean;
  writeValue?: string;
  confirmWrite: string;
  confirmRollback: string;
};

function adbCommandAvailable() {
  const result = spawnSync("adb", ["version"], { encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error
  };
}

function parseAdbDevices(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => {
      const [serial, state = "unknown"] = line.split(/\s+/);
      return { serial, state: state as AdbDeviceState };
    })
    .filter((item) => Boolean(item.serial));
}

function requireSingleReadyAdbTarget(targetRef: string) {
  const available = adbCommandAvailable();
  if (!available.ok) {
    throw new Error(
      [
        "ADB device-lab acceptance requires adb on PATH.",
        available.stderr || available.stdout,
        available.error ? available.error.message : ""
      ].filter(Boolean).join("\n")
    );
  }

  const result = spawnSync("adb", ["devices"], { encoding: "utf8", env: process.env });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`adb devices failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout.trim()}`);
  }

  const matches = parseAdbDevices(stdout).filter((item) => item.serial === targetRef);
  if (matches.length !== 1) {
    throw new Error(
      `ADB target ${targetRef} must appear exactly once in adb devices. Observed: ${parseAdbDevices(stdout)
        .map((item) => `${item.serial}:${item.state}`)
        .join(", ") || "(none)"}`
    );
  }
  if (matches[0].state !== "device") {
    throw new Error(`ADB target ${targetRef} is ${matches[0].state}; expected device.`);
  }
}

function requireAdbSmokeConfig(): AdbSmokeConfig {
  const required = [
    "ADB_SMOKE_PROJECT_ID",
    "ADB_SMOKE_DEVICE_ID",
    "ADB_SMOKE_TARGET_REF",
    "ADB_SMOKE_PARAMETER_ID",
    "ADB_SMOKE_NODE_PATH"
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      [
        `ADB device-lab acceptance requires ${missing.join(", ")} when DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true.`,
        "Set project, WiseEff device id, adb serial, parameter id, and safe node path before running against real hardware."
      ].join(" ")
    );
  }

  const writeEnabled = process.env.ADB_SMOKE_ENABLE_WRITE === "true";
  if (writeEnabled && !process.env.ADB_SMOKE_WRITE_VALUE?.trim()) {
    throw new Error("ADB_SMOKE_WRITE_VALUE is required when ADB_SMOKE_ENABLE_WRITE=true.");
  }

  return {
    projectId: process.env.ADB_SMOKE_PROJECT_ID!.trim(),
    deviceId: process.env.ADB_SMOKE_DEVICE_ID!.trim(),
    targetRef: process.env.ADB_SMOKE_TARGET_REF!.trim(),
    parameterId: process.env.ADB_SMOKE_PARAMETER_ID!.trim(),
    nodePath: process.env.ADB_SMOKE_NODE_PATH!.trim(),
    readValuePattern: process.env.ADB_SMOKE_EXPECT_READ_PATTERN?.trim()
      ? new RegExp(process.env.ADB_SMOKE_EXPECT_READ_PATTERN.trim())
      : undefined,
    userId: process.env.ADB_SMOKE_USER_ID?.trim() || "u-xu-yun",
    writeEnabled,
    writeValue: process.env.ADB_SMOKE_WRITE_VALUE?.trim(),
    confirmWrite: process.env.ADB_SMOKE_CONFIRM_WRITE?.trim() || "confirm-high-risk-write",
    confirmRollback: process.env.ADB_SMOKE_CONFIRM_ROLLBACK?.trim() || "confirm-rollback"
  };
}

test.describe("ADB device-lab preflight", () => {
  test("validates local ADB device-lab configuration", async () => {
    // @acceptance ADB-LAB-001
    // @operation ADB-LAB-001
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE !== "adb",
      "ADB device-lab acceptance only runs when DEBUG_DEVICE_GATEWAY_MODE=adb."
    );
    test.skip(
      process.env.ADB_DEVICE_LAB_AVAILABLE !== "true",
      "ADB device-lab acceptance is skipped unless real hardware is available."
    );

    const config = requireAdbSmokeConfig();
    requireSingleReadyAdbTarget(config.targetRef);
    expect(config.writeEnabled ? config.writeValue : "read-only").toBeTruthy();
  });
});
```

- [ ] **Step 2: Run acceptance coverage to verify the new ID is currently unknown**

Run:

```bash
npm run acceptance:coverage
```

Expected: FAIL with `unknownIds` containing `ADB-LAB-001`.

- [ ] **Step 3: Run operation matrix to verify the new operation ID is currently unknown**

Run:

```bash
npm run acceptance:operations
```

Expected: FAIL with `unknownOperationIds` containing `ADB-LAB-001`.

- [ ] **Step 4: Commit the failing coverage skeleton**

```bash
git add e2e/acceptance/adb-device-lab.acceptance.spec.ts
git commit -m "test: add adb device lab acceptance skeleton"
```

---

### Task 2: Register ADB-LAB Acceptance And Operation Metadata

**Files:**
- Modify: `e2e/acceptance/requirements.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Generated by command: `docs/developer/user-operation-coverage-matrix.md`

- [ ] **Step 1: Add `ADB-LAB-001` to `requirements.ts`**

Insert this requirement immediately after `HDC-LAB-001`:

```ts
  {
    id: "ADB-LAB-001",
    workflow: "F",
    title: "Real ADB device lab read-only smoke runs when explicitly enabled, with optional write and rollback.",
    required: false
  },
```

- [ ] **Step 2: Add `ADB-LAB-001` to `operationMatrix.ts`**

Insert this operation immediately after the `HDC-LAB-001` operation:

```ts
  {
    id: "ADB-LAB-001",
    priority: "P1",
    area: "debugging",
    route: "/node-debugging",
    roles: ["Hardware Committer", "Admin"],
    action: "Run the real ADB device-lab read-only smoke when explicitly enabled, with optional write/readback/rollback.",
    coverage: "conditional",
    acceptanceIds: ["ADB-LAB-001"],
    specFiles: ["e2e/acceptance/adb-device-lab.acceptance.spec.ts"],
    assertions: ["ui", "api", "audit"],
    deferralReason: "Requires DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true with ADB hardware attached."
  },
```

- [ ] **Step 3: Run coverage and operation metadata checks**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: both PASS. The operation command updates `docs/developer/user-operation-coverage-matrix.md`.

- [ ] **Step 4: Inspect generated matrix only for the ADB row**

Run:

```bash
rg -n "ADB-LAB-001" docs/developer/user-operation-coverage-matrix.md e2e/acceptance/requirements.ts e2e/acceptance/operationMatrix.ts
```

Expected: one requirement, one operation, and one generated matrix row for `ADB-LAB-001`.

- [ ] **Step 5: Commit metadata**

```bash
git add e2e/acceptance/requirements.ts e2e/acceptance/operationMatrix.ts docs/developer/user-operation-coverage-matrix.md
git commit -m "test: register adb device lab acceptance metadata"
```

---

### Task 3: Implement Full ADB Device-Lab Browser/API Flow

**Files:**
- Modify: `e2e/acceptance/adb-device-lab.acceptance.spec.ts`

- [ ] **Step 1: Replace the skeleton with the full spec**

Use this complete spec as the implementation target:

```ts
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import type { Client } from "pg";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

type AdbDeviceState = "device" | "unauthorized" | "offline" | "unknown";

type DebugTargetDto = {
  id: string;
  deviceId: string;
  targetRef: string;
  status: string;
  protocol?: string;
};

type DebugSessionDto = {
  id: string;
  protocol?: string;
};

type NodeOperationDto = {
  id?: string;
  status: string;
  protocol?: string;
  nodePath: string;
  readValue: string | null;
  readbackValue: string | null;
  requestedValue: string | null;
  previousValue: string | null;
  verified: boolean;
  failureReason: string | null;
  snapshotId: string | null;
};

type DebugSnapshotDto = {
  id: string;
  status: string;
};

type AuditEventDto = {
  id?: string;
  kind: string;
  action?: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

type AdbSmokeConfig = {
  projectId: string;
  deviceId: string;
  targetRef: string;
  parameterId: string;
  nodePath: string;
  readValuePattern?: RegExp;
  userId: string;
  writeEnabled: boolean;
  writeValue?: string;
  confirmWrite: string;
  confirmRollback: string;
};

function runSeedScript(script: string) {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const errorDetails = result.error
      ? `child_process error: ${result.error.code ?? "unknown"} ${result.error.message ?? ""}`.trimEnd()
      : "";

    throw new Error(
      [
        `npm run ${script} failed with exit code ${result.status}.`,
        stdout,
        stderr,
        errorDetails
      ].filter(Boolean).join("\n")
    );
  }
}

async function seedM3DebuggingPermissions(client: Client) {
  await client.query(
    `
    update roles
    set permissions = $1
    where id = 'admin'
    `,
    [[
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "debugging:admin",
      "logs:upload",
      "logs:view",
      "logs:feedback",
      "logs:analyze",
      "logs:archive",
      "parameter:review",
      "admin:access",
      "users:manage"
    ]]
  );
}

async function cleanupDebuggingAcceptanceState(client: Client, projectId: string) {
  await client.query("delete from audit_events where app = 'debugging' and project_id = $1", [projectId]);
  await client.query("delete from debugging_events where project_id = $1", [projectId]);
  await client.query("update node_operations set snapshot_id = null where project_id = $1", [projectId]);
  await client.query("update debugging_snapshots set operation_id = null where project_id = $1", [projectId]);
  await client.query("delete from node_operations where project_id = $1", [projectId]);
  await client.query("delete from debugging_snapshots where project_id = $1", [projectId]);
  await client.query("delete from debug_device_leases where project_id = $1", [projectId]);
  await client.query("delete from debugging_sessions where project_id = $1", [projectId]);
}

async function prepareAdbAcceptanceState(projectId: string) {
  runSeedScript("db:migrate");
  runSeedScript("db:seed:m0");
  runSeedScript("db:seed:m1");
  runSeedScript("db:seed:m3");

  await withPgClient(async (client) => {
    await seedM3DebuggingPermissions(client);
    await cleanupDebuggingAcceptanceState(client, projectId);
  });
}

function adbCommandAvailable() {
  const result = spawnSync("adb", ["version"], { encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error
  };
}

function parseAdbDevices(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => {
      const [serial, state = "unknown"] = line.split(/\s+/);
      return { serial, state: state as AdbDeviceState };
    })
    .filter((item) => Boolean(item.serial));
}

function requireSingleReadyAdbTarget(targetRef: string) {
  const available = adbCommandAvailable();
  if (!available.ok) {
    throw new Error(
      [
        "ADB device-lab acceptance requires adb on PATH.",
        available.stderr || available.stdout,
        available.error ? available.error.message : ""
      ].filter(Boolean).join("\n")
    );
  }

  const result = spawnSync("adb", ["devices"], { encoding: "utf8", env: process.env });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`adb devices failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout.trim()}`);
  }

  const devices = parseAdbDevices(stdout);
  const matches = devices.filter((item) => item.serial === targetRef);
  if (matches.length !== 1) {
    throw new Error(
      `ADB target ${targetRef} must appear exactly once in adb devices. Observed: ${devices
        .map((item) => `${item.serial}:${item.state}`)
        .join(", ") || "(none)"}`
    );
  }
  if (matches[0].state !== "device") {
    throw new Error(`ADB target ${targetRef} is ${matches[0].state}; expected device.`);
  }
}

function requireAdbSmokeConfig(): AdbSmokeConfig {
  const required = [
    "ADB_SMOKE_PROJECT_ID",
    "ADB_SMOKE_DEVICE_ID",
    "ADB_SMOKE_TARGET_REF",
    "ADB_SMOKE_PARAMETER_ID",
    "ADB_SMOKE_NODE_PATH"
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      [
        `ADB device-lab acceptance requires ${missing.join(", ")} when DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true.`,
        "Set project, WiseEff device id, adb serial, parameter id, and safe node path before running against real hardware."
      ].join(" ")
    );
  }

  const writeEnabled = process.env.ADB_SMOKE_ENABLE_WRITE === "true";
  if (writeEnabled && !process.env.ADB_SMOKE_WRITE_VALUE?.trim()) {
    throw new Error("ADB_SMOKE_WRITE_VALUE is required when ADB_SMOKE_ENABLE_WRITE=true.");
  }

  return {
    projectId: process.env.ADB_SMOKE_PROJECT_ID!.trim(),
    deviceId: process.env.ADB_SMOKE_DEVICE_ID!.trim(),
    targetRef: process.env.ADB_SMOKE_TARGET_REF!.trim(),
    parameterId: process.env.ADB_SMOKE_PARAMETER_ID!.trim(),
    nodePath: process.env.ADB_SMOKE_NODE_PATH!.trim(),
    readValuePattern: process.env.ADB_SMOKE_EXPECT_READ_PATTERN?.trim()
      ? new RegExp(process.env.ADB_SMOKE_EXPECT_READ_PATTERN.trim())
      : undefined,
    userId: process.env.ADB_SMOKE_USER_ID?.trim() || "u-xu-yun",
    writeEnabled,
    writeValue: process.env.ADB_SMOKE_WRITE_VALUE?.trim(),
    confirmWrite: process.env.ADB_SMOKE_CONFIRM_WRITE?.trim() || "confirm-high-risk-write",
    confirmRollback: process.env.ADB_SMOKE_CONFIRM_ROLLBACK?.trim() || "confirm-rollback"
  };
}

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  userId: string
) {
  const response = await request.post(apiRoute(path), {
    data,
    headers: {
      ...smokeHeaders(),
      "x-wiseeff-user": userId
    }
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string; code?: string } } | null;

  expect(response.ok(), `${path} failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  return { body: body as T, response };
}

async function getAuditEvents(request: APIRequestContext, userId: string) {
  const response = await request.get(apiRoute("/api/v1/audit-events"), {
    headers: {
      ...smokeHeaders(),
      "x-wiseeff-user": userId
    }
  });
  const body = (await response.json().catch(() => null)) as { items?: AuditEventDto[] } | null;
  expect(response.ok(), `/api/v1/audit-events failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  return { items: body?.items ?? [], response };
}

function summarizeAudit(events: AuditEventDto[], kind: string, targetId: string) {
  const event = events.find((item) => item.kind === kind && item.targetId === targetId);
  return {
    id: event?.id,
    kind,
    action: event?.action,
    targetId: event?.targetId,
    requestId: event?.traceId,
    metadataSummary: event?.metadata ? JSON.stringify({
      protocol: event.metadata.protocol,
      targetRef: event.metadata.targetRef,
      deviceId: event.metadata.deviceId,
      parameterId: event.metadata.parameterId,
      snapshotId: event.metadata.snapshotId
    }) : undefined
  };
}

async function selectAdbProtocol(page: Page) {
  await page.getByRole("button", { name: /^ADB$/ }).click();
  await expect(page.getByRole("button", { name: /^ADB$/ })).toHaveAttribute("aria-pressed", "true");
}

async function expectAdbUiReady(page: Page, config: AdbSmokeConfig) {
  await page.goto(`/node-debugging?project=${encodeURIComponent(config.projectId)}`);
  await selectAdbProtocol(page);
  await expect(page.getByText(/ADB/i)).toBeVisible({ timeout: 30_000 });
}

test.describe("ADB device-lab full-chain loop", () => {
  test("detects and reads a real ADB target, with optional write/readback/rollback", async ({ page, request }, testInfo) => {
    // @acceptance ADB-LAB-001
    // @operation ADB-LAB-001
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE !== "adb",
      "ADB device-lab acceptance only runs when DEBUG_DEVICE_GATEWAY_MODE=adb."
    );
    test.skip(
      process.env.ADB_DEVICE_LAB_AVAILABLE !== "true",
      "ADB device-lab acceptance is skipped unless real hardware is available."
    );

    const config = requireAdbSmokeConfig();
    requireSingleReadyAdbTarget(config.targetRef);
    await prepareAdbAcceptanceState(config.projectId);
    await expectAdbUiReady(page, config);

    const detected = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId: config.projectId, deviceId: config.deviceId, protocol: "adb" },
      config.userId
    );
    const target = detected.body.items.find((item) => item.targetRef === config.targetRef);
    expect(
      target,
      `ADB target ${config.targetRef} was not detected. Detected targets: ${detected.body.items.map((item) => item.targetRef).join(", ") || "(none)"}`
    ).toBeTruthy();
    expect(target!.status).toBe("detected");

    const sessionResponse = await postJson<{ item: DebugSessionDto }>(
      request,
      "/api/v1/debugging/sessions",
      { projectId: config.projectId, deviceId: config.deviceId, targetId: target!.id, protocol: "adb" },
      config.userId
    );
    expect(sessionResponse.body.item.protocol ?? "adb").toBe("adb");

    const readResponse = await postJson<{ operation: NodeOperationDto }>(
      request,
      "/api/v1/debugging/nodes/read",
      {
        sessionId: sessionResponse.body.item.id,
        parameterId: config.parameterId,
        nodePath: config.nodePath
      },
      config.userId
    );
    expect(readResponse.body.operation.status, `ADB read failed: ${readResponse.body.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
    expect(readResponse.body.operation.readValue, "ADB read did not return a value.").toEqual(expect.any(String));
    if (config.readValuePattern) {
      expect(readResponse.body.operation.readValue ?? "").toMatch(config.readValuePattern);
    }
    const originalReadValue = readResponse.body.operation.readValue!;

    let writeResponse:
      | Awaited<ReturnType<typeof postJson<{ operation: NodeOperationDto }>>>
      | null = null;
    let rollbackResponse:
      | Awaited<ReturnType<typeof postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>>>
      | null = null;
    let restoredReadResponse:
      | Awaited<ReturnType<typeof postJson<{ operation: NodeOperationDto }>>>
      | null = null;

    if (config.writeEnabled) {
      writeResponse = await postJson<{ operation: NodeOperationDto }>(
        request,
        "/api/v1/debugging/nodes/write",
        {
          sessionId: sessionResponse.body.item.id,
          parameterId: config.parameterId,
          nodePath: config.nodePath,
          value: config.writeValue,
          readBack: true,
          confirmationToken: config.confirmWrite
        },
        config.userId
      );
      const snapshotId = writeResponse.body.operation.snapshotId;

      expect(writeResponse.body.operation.status, `ADB write failed: ${writeResponse.body.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
      expect(snapshotId, "ADB write succeeded without operation.snapshotId, so rollback cannot restore the device node.").toEqual(expect.any(String));
      expect(writeResponse.body.operation.verified).toBe(true);
      expect(writeResponse.body.operation.readbackValue).toBe(config.writeValue);

      rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
        request,
        `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId!)}/rollback`,
        { confirmationToken: config.confirmRollback },
        config.userId
      );
      expect(rollbackResponse.body.operations).toHaveLength(1);
      expect(rollbackResponse.body.operations[0].status).toBe("succeeded");
      expect(rollbackResponse.body.operations[0].verified).toBe(true);
      expect(rollbackResponse.body.operations[0].requestedValue).toBe(originalReadValue);
      expect(rollbackResponse.body.operations[0].readbackValue).toBe(originalReadValue);
      expect(rollbackResponse.body.snapshot.status).toBe("consumed");

      restoredReadResponse = await postJson<{ operation: NodeOperationDto }>(
        request,
        "/api/v1/debugging/nodes/read",
        {
          sessionId: sessionResponse.body.item.id,
          parameterId: config.parameterId,
          nodePath: config.nodePath
        },
        config.userId
      );
      expect(restoredReadResponse.body.operation.status).toBe("succeeded");
      expect(restoredReadResponse.body.operation.readValue).toBe(originalReadValue);
    }

    const audit = await getAuditEvents(request, config.userId);
    await recordOperationEvidence({
      operationId: "ADB-LAB-001",
      title: config.writeEnabled ? "adb device lab read write rollback" : "adb device lab read only",
      status: "passed",
      page,
      testInfo,
      role: "Admin",
      route: "/node-debugging",
      assertions: ["ui", "api", "audit"],
      notes: config.writeEnabled
        ? `ADB target ${config.targetRef} read original value, wrote approved value, verified readback, and rolled back snapshot ${writeResponse?.body.operation.snapshotId}.`
        : `ADB target ${config.targetRef} read ${config.parameterId} in read-only mode. Write and rollback were skipped by configuration.`,
      api: [
        summarizeApiResponse(detected.response, {
          method: "POST",
          path: "/api/v1/debugging/targets/detect",
          responseSummary: `detected target ${target!.targetRef}`
        }),
        summarizeApiResponse(sessionResponse.response, {
          method: "POST",
          path: "/api/v1/debugging/sessions",
          responseSummary: `created adb session ${sessionResponse.body.item.id}`
        }),
        summarizeApiResponse(readResponse.response, {
          method: "POST",
          path: "/api/v1/debugging/nodes/read",
          responseSummary: `read ${config.parameterId} status ${readResponse.body.operation.status}`
        }),
        ...(writeResponse
          ? [summarizeApiResponse(writeResponse.response, {
              method: "POST",
              path: "/api/v1/debugging/nodes/write",
              responseSummary: `write ${config.parameterId} status ${writeResponse.body.operation.status}`
            })]
          : []),
        ...(rollbackResponse
          ? [summarizeApiResponse(rollbackResponse.response, {
              method: "POST",
              path: `/api/v1/debugging/snapshots/${writeResponse?.body.operation.snapshotId}/rollback`,
              responseSummary: `rollback status ${rollbackResponse.body.snapshot.status}`
            })]
          : []),
        ...(restoredReadResponse
          ? [summarizeApiResponse(restoredReadResponse.response, {
              method: "POST",
              path: "/api/v1/debugging/nodes/read",
              responseSummary: `restored read status ${restoredReadResponse.body.operation.status}`
            })]
          : []),
        summarizeApiResponse(audit.response, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit events ${audit.items.length}`
        })
      ],
      audit: [
        summarizeAudit(audit.items, "debug-target-detect", target!.id),
        summarizeAudit(audit.items, "debug-session-create", sessionResponse.body.item.id),
        summarizeAudit(audit.items, "debug-node-read", config.parameterId),
        ...(writeResponse ? [summarizeAudit(audit.items, "debug-node-write", config.parameterId)] : []),
        ...(writeResponse?.body.operation.snapshotId
          ? [summarizeAudit(audit.items, "debug-snapshot-rollback", writeResponse.body.operation.snapshotId)]
          : [])
      ],
      runtime: {
        mode: "api",
        apiBaseUrl: process.env.VITE_WISEEFF_API_BASE_URL?.trim() || "http://127.0.0.1:8787",
        envSummary: {
          DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE ?? "unset",
          ADB_DEVICE_LAB_AVAILABLE: process.env.ADB_DEVICE_LAB_AVAILABLE === "true" ? "true" : "false",
          ADB_SMOKE_ENABLE_WRITE: config.writeEnabled ? "true" : "false",
          ADB_SMOKE_PROJECT_ID: config.projectId,
          ADB_SMOKE_DEVICE_ID: config.deviceId,
          ADB_SMOKE_TARGET_REF: config.targetRef,
          ADB_SMOKE_PARAMETER_ID: config.parameterId,
          ADB_SMOKE_NODE_PATH: config.nodePath
        }
      },
      reproduction: {
        steps: [
          "Connect the approved ADB device locally and confirm it appears in adb devices.",
          "Start WiseEff API with DEBUG_DEVICE_GATEWAY_MODE=adb and the frontend in API mode.",
          "Set ADB_SMOKE_* variables for the approved project, device, target, parameter, and node.",
          "Run npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts."
        ]
      }
    });
  });
});
```

- [ ] **Step 2: Run TypeScript/unit-level compile check through the focused Playwright parser**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --list
```

Expected: PASS and list the ADB test. This should not require hardware because `--list` only discovers tests.

- [ ] **Step 3: Run the spec in skip mode**

Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=simulator ADB_DEVICE_LAB_AVAILABLE=false npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

Expected: PASS with the ADB test skipped.

- [ ] **Step 4: Commit the full spec**

```bash
git add e2e/acceptance/adb-device-lab.acceptance.spec.ts
git commit -m "test: add adb real device lab flow"
```

---

### Task 4: Add Bilingual ADB Device-Lab Runbooks

**Files:**
- Create: `docs/runbooks/adb-device-lab.md`
- Create: `docs/zh-CN/runbooks/adb-device-lab.md`
- Modify: `docs/runbooks/README.md`
- Modify: `docs/zh-CN/runbooks/README.md`

- [ ] **Step 1: Create the English runbook**

Write `docs/runbooks/adb-device-lab.md`:

```markdown
# ADB Device Lab Runbook

> Chinese: [Chinese](../zh-CN/runbooks/adb-device-lab.md)

Use this runbook to collect local real-device evidence for the ADB debugging gateway path. This procedure is explicit lab evidence, not a default CI gate.

## Required Read-Only Inputs

- `DEBUG_DEVICE_GATEWAY_MODE=adb`
- `ADB_DEVICE_LAB_AVAILABLE=true`
- `ADB_SMOKE_PROJECT_ID`
- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`
- optional `ADB_SMOKE_EXPECT_READ_PATTERN`
- optional `ADB_SMOKE_USER_ID`

## Optional Write Inputs

Write mode is disabled unless `ADB_SMOKE_ENABLE_WRITE=true`.

- `ADB_SMOKE_ENABLE_WRITE=true`
- `ADB_SMOKE_WRITE_VALUE`
- optional `ADB_SMOKE_CONFIRM_WRITE`, default `confirm-high-risk-write`
- optional `ADB_SMOKE_CONFIRM_ROLLBACK`, default `confirm-rollback`

## Procedure

1. Confirm the ADB device is connected to the same machine that runs the WiseEff API.
2. Run `adb devices` and confirm `ADB_SMOKE_TARGET_REF` is present with state `device`.
3. Confirm the chosen node is safe to read.
4. If write mode is enabled, confirm the node is safe to write and that rollback by snapshot is acceptable.
5. Start the API with `DEBUG_DEVICE_GATEWAY_MODE=adb`.
6. Start the frontend in API mode.
7. Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

## Acceptance

Read-only evidence must show:

- target serial,
- project id and WiseEff device id,
- parameter id and node path,
- successful ADB target detection,
- successful node read,
- request id or audit trace when available,
- browser screenshot and Playwright report location.

Write-mode evidence must additionally show:

- previous value,
- requested value,
- readback value,
- snapshot id,
- rollback result,
- final restored value.

## Safety Notes

- Do not run write mode against customer hardware or unapproved nodes.
- Do not directly write nodes with `adb shell`; the test must use WiseEff APIs so lease, snapshot, readback, rollback, and audit rules apply.
- `unauthorized`, `offline`, missing, or duplicate ADB targets block the run.
- Local ADB evidence supplements HDC and target-environment evidence. It does not replace full-pilot HDC signoff.
```

- [ ] **Step 2: Create the Chinese runbook**

Write `docs/zh-CN/runbooks/adb-device-lab.md`:

```markdown
# ADB Device Lab 运行手册

> English: [English](../../runbooks/adb-device-lab.md)

使用本手册采集 ADB 调试 gateway 路径的本机真实设备证据。该流程是显式实验室证据，不是默认 CI gate。

## 只读模式必需输入

- `DEBUG_DEVICE_GATEWAY_MODE=adb`
- `ADB_DEVICE_LAB_AVAILABLE=true`
- `ADB_SMOKE_PROJECT_ID`
- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`
- 可选 `ADB_SMOKE_EXPECT_READ_PATTERN`
- 可选 `ADB_SMOKE_USER_ID`

## 可选写入输入

除非设置 `ADB_SMOKE_ENABLE_WRITE=true`，否则写入模式关闭。

- `ADB_SMOKE_ENABLE_WRITE=true`
- `ADB_SMOKE_WRITE_VALUE`
- 可选 `ADB_SMOKE_CONFIRM_WRITE`，默认 `confirm-high-risk-write`
- 可选 `ADB_SMOKE_CONFIRM_ROLLBACK`，默认 `confirm-rollback`

## 流程

1. 确认 ADB 设备连接在运行 WiseEff API 的同一台机器上。
2. 运行 `adb devices`，确认 `ADB_SMOKE_TARGET_REF` 以 `device` 状态出现。
3. 确认所选节点可安全读取。
4. 如果启用写入模式，确认该节点可安全写入，并且允许通过 snapshot rollback 恢复。
5. 使用 `DEBUG_DEVICE_GATEWAY_MODE=adb` 启动 API。
6. 使用 API 模式启动前端。
7. 运行：

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

## 验收

只读证据必须展示：

- target serial，
- project id 和 WiseEff device id，
- parameter id 和 node path，
- ADB target 检测成功，
- 节点读取成功，
- 可用的 request id 或 audit trace，
- 浏览器截图和 Playwright report 位置。

写入模式证据还必须展示：

- 原值，
- 请求写入值，
- 回读值，
- snapshot id，
- rollback 结果，
- 最终恢复值。

## 安全说明

- 不要在客户硬件或未审批节点上运行写入模式。
- 不要用 `adb shell` 直接写节点；测试必须使用 WiseEff API，以便执行租约、快照、回读、回滚和审计规则。
- `unauthorized`、`offline`、缺失或重复 ADB target 都会阻塞运行。
- 本机 ADB 证据是 HDC 和目标环境证据的补充，不能替代 full-pilot HDC 签核。
```

- [ ] **Step 3: Link the runbook indexes**

In `docs/runbooks/README.md`, add a bullet near HDC:

```markdown
- [ADB Device Lab](adb-device-lab.md): local real-device ADB evidence collection.
```

In `docs/zh-CN/runbooks/README.md`, add the matching Chinese bullet near HDC:

```markdown
- [ADB Device Lab](adb-device-lab.md)：本机真实 ADB 设备证据采集。
```

- [ ] **Step 4: Run docs check**

Run:

```bash
npm run docs:check
```

Expected: PASS.

- [ ] **Step 5: Commit runbooks**

```bash
git add docs/runbooks/adb-device-lab.md docs/zh-CN/runbooks/adb-device-lab.md docs/runbooks/README.md docs/zh-CN/runbooks/README.md
git commit -m "docs: add adb device lab runbook"
```

---

### Task 5: Update Verification And Manual Acceptance Docs

**Files:**
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/zh-CN/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/runbooks/manual-acceptance.md`
- Review: `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/FRONTEND.md`

- [ ] **Step 1: Add the English verification matrix command**

In `docs/developer/verification-matrix.md`, add this row in the Common Commands table near HDC/browser acceptance entries:

```markdown
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | Local real-device ADB frontend/API/device evidence | When an approved local ADB device is connected and `DEBUG_DEVICE_GATEWAY_MODE=adb` plus `ADB_DEVICE_LAB_AVAILABLE=true` are configured. Defaults to read-only unless `ADB_SMOKE_ENABLE_WRITE=true`. |
```

- [ ] **Step 2: Add the Chinese verification matrix command**

In `docs/zh-CN/developer/verification-matrix.md`, add the corresponding row:

```markdown
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | 本机真实 ADB 前端/API/设备证据 | 已连接审批过的本机 ADB 设备，并配置 `DEBUG_DEVICE_GATEWAY_MODE=adb` 与 `ADB_DEVICE_LAB_AVAILABLE=true` 时使用。默认只读，除非设置 `ADB_SMOKE_ENABLE_WRITE=true`。 |
```

- [ ] **Step 3: Add an English manual acceptance ADB section**

In `docs/runbooks/manual-acceptance.md`, add a subsection after the HDC device-lab section:

```markdown
### F2. ADB Device-Lab Loop

Run only when a local ADB device is connected to the API host and the selected node is approved for the chosen mode. The default mode is read-only.

Required read-only variables:

```text
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=
ADB_SMOKE_DEVICE_ID=
ADB_SMOKE_TARGET_REF=
ADB_SMOKE_PARAMETER_ID=
ADB_SMOKE_NODE_PATH=
ADB_SMOKE_EXPECT_READ_PATTERN=
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

Acceptance:

- [ ] ADB target detection succeeds through the backend gateway.
- [ ] `/node-debugging` can switch to ADB in API mode.
- [ ] Node read succeeds through the WiseEff API.
- [ ] Optional write mode is either explicitly skipped or records write, readback, rollback, and final restore evidence.
```

- [ ] **Step 4: Add the Chinese manual acceptance ADB section**

In `docs/zh-CN/runbooks/manual-acceptance.md`, add the Chinese counterpart after the HDC section:

```markdown
### F2. ADB Device-Lab Loop

仅当本机 ADB 设备连接在 API 主机上，且所选节点已按目标模式审批后运行。默认模式为只读。

只读模式必需变量：

```text
DEBUG_DEVICE_GATEWAY_MODE=adb
ADB_DEVICE_LAB_AVAILABLE=true
ADB_SMOKE_PROJECT_ID=
ADB_SMOKE_DEVICE_ID=
ADB_SMOKE_TARGET_REF=
ADB_SMOKE_PARAMETER_ID=
ADB_SMOKE_NODE_PATH=
ADB_SMOKE_EXPECT_READ_PATTERN=
```

运行：

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

验收：

- [ ] ADB target detection 通过后端 gateway 成功。
- [ ] `/node-debugging` 在 API 模式下可以切换到 ADB。
- [ ] 节点读取通过 WiseEff API 成功。
- [ ] 可选写入模式要么明确跳过，要么记录写入、回读、回滚和最终恢复证据。
```

- [ ] **Step 5: Review security/frontend docs and record unchanged if covered**

Run:

```bash
rg -n "ADB|HDC|device gateway|node write|rollback|frontend" docs/SECURITY.md docs/zh-CN/SECURITY.md docs/FRONTEND.md
```

Expected: Existing language already requires backend gateway, no direct frontend writes, lease/snapshot/rollback/audit. If it is HDC-only, update the sentence to say ADB/HDC. If unchanged, record this in the final implementation summary.

- [ ] **Step 6: Run docs check**

Run:

```bash
npm run docs:check
```

Expected: PASS.

- [ ] **Step 7: Commit documentation updates**

```bash
git add docs/developer/verification-matrix.md docs/zh-CN/developer/verification-matrix.md docs/runbooks/manual-acceptance.md docs/zh-CN/runbooks/manual-acceptance.md docs/SECURITY.md docs/zh-CN/SECURITY.md docs/FRONTEND.md
git commit -m "docs: document adb device lab verification"
```

If `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, or `docs/FRONTEND.md` were unchanged, omit them from `git add`.

---

### Task 6: Final Verification And PR Update

**Files:**
- No new code expected unless prior verification finds a narrow issue.

- [ ] **Step 1: Run focused acceptance metadata checks**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: both PASS. `ADB-LAB-001` is known and conditional.

- [ ] **Step 2: Run ADB spec discovery**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --list
```

Expected: PASS and list the ADB device-lab test.

- [ ] **Step 3: Run ADB skip-mode smoke**

Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=simulator ADB_DEVICE_LAB_AVAILABLE=false npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

Expected: PASS with the test skipped. This verifies the spec is safe in environments without hardware.

- [ ] **Step 4: Run docs and whitespace checks**

Run:

```bash
npm run docs:check
git diff --check
```

Expected: both PASS.

- [ ] **Step 5: Optional real-device read-only run**

Run this only when local API/frontend/PostgreSQL are ready and the connected ADB target/binding variables are known:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
ADB_SMOKE_DEVICE_ID=device-aurora-adb \
ADB_SMOKE_TARGET_REF=emulator-5554 \
ADB_SMOKE_PARAMETER_ID=dbg-fast-charge-current \
ADB_SMOKE_NODE_PATH=/sys/class/power_supply/battery/current_now \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

Expected: PASS when the device and existing ADB binding are valid. If this is not runnable, record the exact blocker and keep the skip-mode smoke as the local safety verification.

- [ ] **Step 6: Optional real-device write-mode run**

Run this only after explicit hardware approval:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_ENABLE_WRITE=true \
ADB_SMOKE_PROJECT_ID=aurora \
ADB_SMOKE_DEVICE_ID=device-aurora-adb \
ADB_SMOKE_TARGET_REF=emulator-5554 \
ADB_SMOKE_PARAMETER_ID=dbg-fast-charge-current \
ADB_SMOKE_NODE_PATH=/sys/class/power_supply/battery/current_now \
ADB_SMOKE_WRITE_VALUE=3100 \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

Expected: PASS only on an approved safe node; evidence shows write, readback, rollback, and final restore.

- [ ] **Step 7: Commit any final fixes**

If verification changed generated docs or fixed a narrow issue:

```bash
git status --short
git add e2e/acceptance/adb-device-lab.acceptance.spec.ts e2e/acceptance/requirements.ts e2e/acceptance/operationMatrix.ts docs/developer/user-operation-coverage-matrix.md docs/runbooks/adb-device-lab.md docs/zh-CN/runbooks/adb-device-lab.md docs/runbooks/README.md docs/zh-CN/runbooks/README.md docs/developer/verification-matrix.md docs/zh-CN/developer/verification-matrix.md docs/runbooks/manual-acceptance.md docs/zh-CN/runbooks/manual-acceptance.md
git commit -m "test: finalize adb device lab acceptance"
```

- [ ] **Step 8: Push the branch and update PR 85**

Run:

```bash
git push
gh pr comment 85 --body "Added ADB real-device full-chain test design and implementation artifacts. Verification: npm run acceptance:coverage; npm run acceptance:operations; npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --list; DEBUG_DEVICE_GATEWAY_MODE=simulator ADB_DEVICE_LAB_AVAILABLE=false npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts; npm run docs:check; git diff --check."
```

Expected: branch pushes successfully and PR 85 receives an update comment.

---

## Self-Review

- Spec coverage: The plan covers local ADB real-device flow, read-only default, explicit write gate, existing binding assumption, backend-only device operations, evidence, and bilingual runbooks.
- Placeholder scan: The plan avoids task placeholders. TypeScript generic syntax appears inside code blocks and is intentional.
- Type consistency: The plan uses existing Playwright, `recordOperationEvidence`, `summarizeApiResponse`, `apiRoute`, `smokeHeaders`, and `withPgClient` patterns from the current acceptance suite.
- Risk note: The real-device run cannot be guaranteed without valid `ADB_SMOKE_*` variables and an existing ADB binding. Skip-mode and `--list` verification prove the test is safe to include without hardware.
