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
  id: string;
  status: string;
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

const knownAdbStates = new Set<AdbDeviceState>(["device", "unauthorized", "offline", "unknown"]);

function normalizeAdbDeviceState(state: string): AdbDeviceState {
  return knownAdbStates.has(state as AdbDeviceState) ? (state as AdbDeviceState) : "unknown";
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
      return { serial, state: normalizeAdbDeviceState(state) };
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
  userId: string,
  responseSummary: (body: T) => string
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

  return {
    body: body as T,
    summary: summarizeApiResponse(response, {
      method: "POST",
      path,
      responseSummary: body ? responseSummary(body as T) : "body=absent"
    })
  };
}

function operationSummary(operation: NodeOperationDto) {
  return [
    `operation=${operation.id}`,
    `status=${operation.status}`,
    `verified=${operation.verified}`,
    `snapshot=${operation.snapshotId ? "present" : "absent"}`,
    `failure=${operation.failureReason ? "present" : "absent"}`
  ].join("; ");
}

function operationsSummary(operations: NodeOperationDto[]) {
  return `operations=${operations.length}; ${operations.map(operationSummary).join("; ")}`;
}

function compactAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return undefined;
  }

  return JSON.stringify({
    protocol: metadata.protocol,
    operationId: typeof metadata.operationId === "string" ? metadata.operationId : undefined,
    sessionId: typeof metadata.sessionId === "string" ? metadata.sessionId : undefined,
    snapshotId: typeof metadata.snapshotId === "string" ? metadata.snapshotId : undefined,
    targetCount: typeof metadata.targetCount === "number" ? metadata.targetCount : undefined,
    operationCount: typeof metadata.operationCount === "number" ? metadata.operationCount : undefined,
    verified: typeof metadata.verified === "boolean" ? metadata.verified : undefined,
    failed: typeof metadata.failed === "boolean" ? metadata.failed : undefined,
    failureReason: metadata.failureReason ? "present" : undefined
  });
}

async function getAuditEvents(request: APIRequestContext, userId: string) {
  const response = await request.get(apiRoute("/api/v1/audit-events?app=debugging&limit=100"), {
    headers: {
      ...smokeHeaders(),
      "x-wiseeff-user": userId
    }
  });
  const body = (await response.json().catch(() => null)) as { items?: AuditEventDto[] } | { error?: { message?: string; code?: string } } | null;

  expect(response.ok(), `audit events failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);

  return {
    events: ((body as { items?: AuditEventDto[] })?.items ?? []),
    summary: summarizeApiResponse(response, {
      method: "GET",
      path: "/api/v1/audit-events?app=debugging&limit=100",
      responseSummary: `audit events=${(body as { items?: AuditEventDto[] } | null)?.items?.length ?? 0}`
    })
  };
}

function summarizeAudit(events: AuditEventDto[], kind: string, targetId: string | null) {
  const event = events.find((item) => item.kind === kind && item.targetId === targetId);
  expect(event, `Missing audit event kind=${kind} targetId=${targetId ?? "(null)"}.`).toBeTruthy();

  return {
    id: event!.id,
    kind: event!.kind,
    action: event!.action,
    targetId: event!.targetId,
    requestId: event!.traceId,
    metadataSummary: compactAuditMetadata(event!.metadata)
  };
}

async function selectAdbProtocol(page: Page) {
  const adbButton = page.getByRole("button", { name: "ADB" });
  await expect(adbButton).toBeVisible({ timeout: 30_000 });
  await adbButton.click();
  await expect(adbButton).toHaveAttribute("aria-pressed", "true");
}

async function expectAdbUiReady(page: Page, config: AdbSmokeConfig) {
  await page.goto(`/node-debugging?project=${encodeURIComponent(config.projectId)}`);
  await selectAdbProtocol(page);
  await expect(page.locator("body")).toContainText(/ADB/);
}

test.describe("ADB device-lab full-chain loop", () => {
  test.setTimeout(180_000);

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

    const apiSummaries: ReturnType<typeof summarizeApiResponse>[] = [];

    const detected = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId: config.projectId, deviceId: config.deviceId, protocol: "adb" },
      config.userId,
      (body) => `targets=${body.items.length}; detectedIds=${body.items.map((item) => item.id).join(",")}`
    );
    apiSummaries.push(detected.summary);
    const target = detected.body.items.find((item) => item.targetRef === config.targetRef);
    expect(
      target,
      `ADB target ${config.targetRef} was not detected. Detected targets: ${detected.body.items.map((item) => item.targetRef).join(", ") || "(none)"}`
    ).toBeTruthy();
    expect(target!.status).toBe("detected");
    if (target!.protocol) {
      expect(target!.protocol).toBe("adb");
    }

    const sessionResponse = await postJson<{ item: DebugSessionDto }>(
      request,
      "/api/v1/debugging/sessions",
      { projectId: config.projectId, deviceId: config.deviceId, targetId: target!.id, protocol: "adb" },
      config.userId,
      (body) => `session=${body.item.id}; protocol=${body.item.protocol ?? "unset"}`
    );
    apiSummaries.push(sessionResponse.summary);
    if (sessionResponse.body.item.protocol) {
      expect(sessionResponse.body.item.protocol).toBe("adb");
    }

    const readResponse = await postJson<{ operation: NodeOperationDto }>(
      request,
      "/api/v1/debugging/nodes/read",
      {
        sessionId: sessionResponse.body.item.id,
        parameterId: config.parameterId,
        nodePath: config.nodePath
      },
      config.userId,
      (body) => operationSummary(body.operation)
    );
    apiSummaries.push(readResponse.summary);
    expect(readResponse.body.operation.status, `ADB read failed: ${readResponse.body.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
    expect(readResponse.body.operation.readValue, "ADB read did not return a value.").toEqual(expect.any(String));
    if (config.readValuePattern) {
      expect(readResponse.body.operation.readValue ?? "").toMatch(config.readValuePattern);
    }
    const originalReadValue = readResponse.body.operation.readValue!;

    let snapshotId: string | null = null;
    let rollbackResponse: { body: { operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }; summary: ReturnType<typeof summarizeApiResponse> } | null = null;
    let finalReadResponse: { body: { operation: NodeOperationDto }; summary: ReturnType<typeof summarizeApiResponse> } | null = null;
    let writeNotes = "Write/readback/rollback skipped because ADB_SMOKE_ENABLE_WRITE is not true or ADB_SMOKE_WRITE_VALUE is not set.";

    if (config.writeEnabled) {
      try {
        const writeResponse = await postJson<{ operation: NodeOperationDto }>(
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
          config.userId,
          (body) => operationSummary(body.operation)
        );
        apiSummaries.push(writeResponse.summary);
        snapshotId = writeResponse.body.operation.snapshotId;

        expect(writeResponse.body.operation.status, `ADB write failed: ${writeResponse.body.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
        expect(
          snapshotId,
          "ADB write succeeded without operation.snapshotId, so the test cannot safely restore hardware through snapshot rollback."
        ).toEqual(expect.any(String));
        expect(writeResponse.body.operation.verified).toBe(true);
        expect(writeResponse.body.operation.readbackValue).toBe(config.writeValue);
      } finally {
        if (snapshotId) {
          rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
            request,
            `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
            { confirmationToken: config.confirmRollback },
            config.userId,
            (body) => `${operationsSummary(body.operations)}; snapshot=${body.snapshot.id}; snapshotStatus=${body.snapshot.status}`
          );
          apiSummaries.push(rollbackResponse.summary);
        }
      }

      expect(rollbackResponse, "Snapshot rollback cleanup did not run.").not.toBeNull();
      expect(rollbackResponse!.body.operations, "Snapshot rollback did not return rollback operations.").toHaveLength(1);
      expect(
        rollbackResponse!.body.operations[0].status,
        `ADB snapshot rollback failed: ${rollbackResponse!.body.operations[0].failureReason ?? "no failure reason"}`
      ).toBe("succeeded");
      expect(rollbackResponse!.body.operations[0].verified).toBe(true);
      expect(rollbackResponse!.body.operations[0].requestedValue).toBe(originalReadValue);
      expect(rollbackResponse!.body.operations[0].readbackValue).toBe(originalReadValue);
      expect(rollbackResponse!.body.snapshot.status).toBe("consumed");

      finalReadResponse = await postJson<{ operation: NodeOperationDto }>(
        request,
        "/api/v1/debugging/nodes/read",
        {
          sessionId: sessionResponse.body.item.id,
          parameterId: config.parameterId,
          nodePath: config.nodePath
        },
        config.userId,
        (body) => operationSummary(body.operation)
      );
      apiSummaries.push(finalReadResponse.summary);
      expect(finalReadResponse.body.operation.status).toBe("succeeded");
      expect(finalReadResponse.body.operation.readValue).toBe(originalReadValue);
      writeNotes = `Write/readback/rollback enabled; snapshot ${snapshotId} restored original ADB node value.`;
    }

    const audit = await getAuditEvents(request, config.userId);
    apiSummaries.push(audit.summary);
    const auditSummaries = [
      summarizeAudit(audit.events, "debug-target-detect", config.deviceId),
      summarizeAudit(audit.events, "debug-session-create", sessionResponse.body.item.id),
      summarizeAudit(audit.events, "debug-node-read", config.parameterId)
    ];
    if (config.writeEnabled) {
      auditSummaries.push(summarizeAudit(audit.events, "debug-node-write", config.parameterId));
      auditSummaries.push(summarizeAudit(audit.events, "debug-snapshot-rollback", snapshotId));
    }

    await recordOperationEvidence({
      operationId: "ADB-LAB-001",
      title: "adb device lab detect read optional write rollback",
      status: "passed",
      page,
      testInfo,
      route: "/node-debugging",
      api: apiSummaries,
      audit: auditSummaries,
      runtime: {
        mode: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "api",
        apiBaseUrl:
          process.env.VITE_WISEEFF_API_BASE_URL?.trim() ||
          process.env.WISEEFF_API_BASE_URL?.trim() ||
          "http://127.0.0.1:8787",
        envSummary: {
          DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE?.trim() || "unset",
          ADB_DEVICE_LAB_AVAILABLE: process.env.ADB_DEVICE_LAB_AVAILABLE?.trim() || "unset",
          ADB_SMOKE_ENABLE_WRITE: config.writeEnabled ? "true" : "false",
          ADB_SMOKE_WRITE_VALUE: config.writeValue ? "set" : "unset",
          ADB_SMOKE_PROJECT_ID: config.projectId,
          ADB_SMOKE_DEVICE_ID: config.deviceId,
          ADB_SMOKE_TARGET_REF: config.targetRef,
          ADB_SMOKE_PARAMETER_ID: config.parameterId,
          ADB_SMOKE_NODE_PATH: "set"
        }
      },
      reproduction: {
        steps: [
          "Set DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true.",
          "Set ADB_SMOKE_PROJECT_ID, ADB_SMOKE_DEVICE_ID, ADB_SMOKE_TARGET_REF, ADB_SMOKE_PARAMETER_ID, and ADB_SMOKE_NODE_PATH.",
          "Optionally set ADB_SMOKE_ENABLE_WRITE=true and ADB_SMOKE_WRITE_VALUE for write/readback/rollback.",
          "Run npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts."
        ]
      },
      notes: [
        `Frontend selected ADB protocol for project ${config.projectId}; real detect/session/read used backend API with explicit deviceId ${config.deviceId}.`,
        `Read operation returned a string for parameter ${config.parameterId}.`,
        writeNotes,
        finalReadResponse ? "Final read confirmed the original value after rollback." : "No final write-mode read was required."
      ].join(" ")
    });
  });
});
