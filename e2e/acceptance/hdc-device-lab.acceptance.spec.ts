import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "playwright/test";
import type { Client } from "pg";
import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

type DebugTargetDto = {
  id: string;
  deviceId: string;
  targetRef: string;
  status: string;
};

type DebugSessionDto = {
  id: string;
};

type NodeOperationDto = {
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

type HdcSmokeConfig = {
  projectId: string;
  deviceId: string;
  targetRef: string;
  parameterId: string;
  nodePath: string;
  readValuePattern?: RegExp;
  writeValue: string;
  userId: string;
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

async function prepareHdcAcceptanceState(projectId: string) {
  runSeedScript("db:migrate");
  runSeedScript("db:seed:m0");
  runSeedScript("db:seed:m1");
  runSeedScript("db:seed:m3");

  await withPgClient(async (client) => {
    await seedM3DebuggingPermissions(client);
    await cleanupDebuggingAcceptanceState(client, projectId);
  });
}

function requireHdcSmokeConfig(): HdcSmokeConfig {
  const required = [
    "HDC_SMOKE_PROJECT_ID",
    "HDC_SMOKE_DEVICE_ID",
    "HDC_SMOKE_TARGET_REF",
    "HDC_SMOKE_PARAMETER_ID",
    "HDC_SMOKE_NODE_PATH",
    "HDC_SMOKE_WRITE_VALUE"
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      [
        `HDC device-lab acceptance requires ${missing.join(", ")} when DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true.`,
        "Set the project, device, target, parameter, node path, and approved safe write value before running against real hardware."
      ].join(" ")
    );
  }

  return {
    projectId: process.env.HDC_SMOKE_PROJECT_ID!.trim(),
    deviceId: process.env.HDC_SMOKE_DEVICE_ID!.trim(),
    targetRef: process.env.HDC_SMOKE_TARGET_REF!.trim(),
    parameterId: process.env.HDC_SMOKE_PARAMETER_ID!.trim(),
    nodePath: process.env.HDC_SMOKE_NODE_PATH!.trim(),
    readValuePattern: process.env.HDC_SMOKE_EXPECT_READ_PATTERN?.trim()
      ? new RegExp(process.env.HDC_SMOKE_EXPECT_READ_PATTERN.trim())
      : undefined,
    writeValue: process.env.HDC_SMOKE_WRITE_VALUE!.trim(),
    userId: process.env.HDC_SMOKE_USER_ID?.trim() || "u-xu-yun"
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
  return body as T;
}

test.describe("M5.4 manual flow F - HDC device-lab loop", () => {
  test("detects, reads, writes with readback, and restores the hardware node via snapshot rollback", async ({ request }) => {
    // @acceptance HDC-LAB-001
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE !== "hdc",
      "HDC device-lab acceptance only runs when DEBUG_DEVICE_GATEWAY_MODE=hdc."
    );
    test.skip(
      process.env.HDC_DEVICE_LAB_AVAILABLE !== "true",
      "HDC device-lab acceptance is skipped unless real hardware is available and approved for writes."
    );

    const config = requireHdcSmokeConfig();
    await prepareHdcAcceptanceState(config.projectId);

    const detected = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId: config.projectId, deviceId: config.deviceId },
      config.userId
    );
    const target = detected.items.find((item) => item.targetRef === config.targetRef);
    expect(
      target,
      `HDC target ${config.targetRef} was not detected. Detected targets: ${detected.items.map((item) => item.targetRef).join(", ") || "(none)"}`
    ).toBeTruthy();
    expect(target!.status).toBe("detected");

    const sessionResponse = await postJson<{ item: DebugSessionDto }>(
      request,
      "/api/v1/debugging/sessions",
      { projectId: config.projectId, deviceId: config.deviceId, targetId: target!.id },
      config.userId
    );

    const readResponse = await postJson<{ operation: NodeOperationDto }>(
      request,
      "/api/v1/debugging/nodes/read",
      {
        sessionId: sessionResponse.item.id,
        parameterId: config.parameterId,
        nodePath: config.nodePath
      },
      config.userId
    );
    expect(readResponse.operation.status, `HDC read failed: ${readResponse.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
    expect(readResponse.operation.readValue, "HDC read did not return a value.").toEqual(expect.any(String));
    if (config.readValuePattern) {
      expect(readResponse.operation.readValue ?? "").toMatch(config.readValuePattern);
    }
    const originalReadValue = readResponse.operation.readValue!;

    let snapshotId: string | null = null;
    let rollbackResponse: { operations: NodeOperationDto[]; snapshot: DebugSnapshotDto } | null = null;

    try {
      const writeResponse = await postJson<{ operation: NodeOperationDto }>(
        request,
        "/api/v1/debugging/nodes/write",
        {
          sessionId: sessionResponse.item.id,
          parameterId: config.parameterId,
          nodePath: config.nodePath,
          value: config.writeValue,
          readBack: true,
          confirmationToken: "confirm-high-risk-write"
        },
        config.userId
      );
      snapshotId = writeResponse.operation.snapshotId;

      expect(writeResponse.operation.status, `HDC write failed: ${writeResponse.operation.failureReason ?? "no failure reason"}`).toBe("succeeded");
      expect(
        snapshotId,
        "HDC write succeeded without operation.snapshotId, so the test cannot safely restore hardware through snapshot rollback."
      ).toEqual(expect.any(String));
      expect(writeResponse.operation.verified).toBe(true);
      expect(writeResponse.operation.readbackValue).toBe(config.writeValue);
    } finally {
      if (snapshotId) {
        rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
          request,
          `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
          { confirmationToken: "confirm-rollback" },
          config.userId
        );
      }
    }

    expect(rollbackResponse, "Snapshot rollback cleanup did not run.").not.toBeNull();
    expect(rollbackResponse!.operations, "Snapshot rollback did not return rollback operations.").toHaveLength(1);
    expect(
      rollbackResponse!.operations[0].status,
      `HDC snapshot rollback failed: ${rollbackResponse!.operations[0].failureReason ?? "no failure reason"}`
    ).toBe("succeeded");
    expect(rollbackResponse!.operations[0].verified).toBe(true);
    expect(rollbackResponse!.operations[0].requestedValue).toBe(originalReadValue);
    expect(rollbackResponse!.operations[0].readbackValue).toBe(originalReadValue);
    expect(rollbackResponse!.snapshot.status).toBe("consumed");

    const restoredReadResponse = await postJson<{ operation: NodeOperationDto }>(
      request,
      "/api/v1/debugging/nodes/read",
      {
        sessionId: sessionResponse.item.id,
        parameterId: config.parameterId,
        nodePath: config.nodePath
      },
      config.userId
    );
    expect(restoredReadResponse.operation.status).toBe("succeeded");
    expect(restoredReadResponse.operation.readValue).toBe(originalReadValue);
  });
});
