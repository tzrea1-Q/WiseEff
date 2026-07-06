import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { expect, test, type Locator, type Page } from "playwright/test";
import { WebSocket } from "ws";
import { apiRoute, smokeHeaders } from "./acceptance/helpers/runtime";

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";

const fastChargeParameterId = "dbg-fast-charge-current";
const cycleCountParameterId = "dbg-cycle-count";
const mismatchParameterId = "dbg-readback-mismatch";

type DebugTargetDto = {
  id: string;
  deviceId: string;
  targetRef: string;
  status: string;
};

type DebugSessionDto = {
  id: string;
  executionMode?: "server" | "bridge";
  bridgeId?: string | null;
};

type NodeOperationDto = {
  status: string;
  operationType?: string;
  nodePath: string;
  readValue: string | null;
  readbackValue: string | null;
  requestedValue: string | null;
  verified: boolean;
  failureReason: string | null;
  snapshotId: string | null;
};

type DebugSnapshotDto = {
  id: string;
  status: string;
};

type DeviceBridgePairingCodeDto = {
  code: string;
  expiresAt: string;
};

type DeviceBridgePairingResultDto = {
  bridgeId: string;
  bridgeToken: string;
  tokenExpiresAt: string;
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

function runNpmScript(script: string) {
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

function runTsxScript(scriptPath: string) {
  const result = spawnSync("npx", ["tsx", scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(
      [`tsx ${scriptPath} failed with exit code ${result.status}.`, stdout, stderr].filter(Boolean).join("\n")
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

async function cleanupM3E2EState(client: Client) {
  await client.query("delete from audit_events where app = 'debugging' and project_id = $1", [projectId]);
  await client.query("delete from debugging_events where project_id = $1", [projectId]);
  await client.query("update node_operations set snapshot_id = null where project_id = $1", [projectId]);
  await client.query("update debugging_snapshots set operation_id = null where project_id = $1", [projectId]);
  await client.query("delete from node_operations where project_id = $1", [projectId]);
  await client.query("delete from debugging_snapshots where project_id = $1", [projectId]);
  await client.query("delete from debug_device_leases where project_id = $1", [projectId]);
  await client.query("delete from debugging_sessions where project_id = $1", [projectId]);
}


function parameterRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name }).first();
}

async function openParameterSheet(page: Page, name: string) {
  const row = parameterRow(page, name);
  await expect(row).toBeVisible();
  await row.locator("button.parameter-row-edit").click();
  const sheet = page.locator(".workbench-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(name);
  return sheet;
}

async function closeParameterSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".workbench-sheet")).not.toBeVisible();
}

async function setTargetAndWrite(page: Page, name: string, value: string) {
  const sheet = await openParameterSheet(page, name);
  await sheet.locator(".node-target-editor").fill(value);
  await sheet.locator(".debugging-deploy-button").click();
  await expect(sheet.locator(".debugging-deploy-button")).toBeEnabled({ timeout: 30_000 });
  await closeParameterSheet(page);
}

async function latestSnapshotId(page: Page, parameterId: string) {
  const response = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: Array<{
      kind: string;
      targetId: string | null;
      metadata?: { snapshotId?: string; requestedValue?: string };
    }>;
  };
  const event = body.items.find((item) =>
    item.kind === "debug-node-write" &&
    item.targetId === parameterId &&
    typeof item.metadata?.snapshotId === "string"
  );
  expect(event?.metadata?.snapshotId).toBeTruthy();
  return event!.metadata!.snapshotId!;
}

async function rollbackSnapshotViaApi(page: Page, snapshotId: string) {
  const response = await page.request.post(apiRoute(`/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`), {
    headers: smokeHeaders(),
    data: { confirmationToken: "confirm-rollback" }
  });
  expect(response.ok()).toBe(true);
}

async function prepareDebuggingApiSmokeState() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the debugging API E2E smoke.");
  }

  runNpmScript("db:migrate");
  runNpmScript("db:seed:m0");
  runNpmScript("db:seed:m1");
  runNpmScript("db:seed:m3");
  runTsxScript("scripts/migrate-debug-parameters-to-nodes.ts");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await seedM3DebuggingPermissions(client);
    await cleanupM3E2EState(client);
  } finally {
    await client.end();
  }
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
        `HDC device-lab smoke requires ${missing.join(", ")} when DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true.`,
        "Set HDC_SMOKE_PROJECT_ID, HDC_SMOKE_DEVICE_ID, HDC_SMOKE_TARGET_REF, HDC_SMOKE_PARAMETER_ID, HDC_SMOKE_NODE_PATH, and HDC_SMOKE_WRITE_VALUE to a real lab target/parameter before running this smoke. The smoke restores the node through the snapshot rollback API created by the write."
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

async function postJson<T>(page: Page, path: string, data: Record<string, unknown>, userId: string) {
  const response = await page.request.post(apiRoute(path), {
    data,
    headers: { ...smokeHeaders(), "x-wiseeff-user": userId }
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string; code?: string } } | null;

  expect(response.ok(), `${path} failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

function bridgeWebSocketUrl() {
  const apiBase = process.env.VITE_WISEEFF_API_BASE_URL ?? process.env.WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/v1/device-bridges/ws";
  url.search = "";
  return url.toString();
}

async function pairBridgeForUser(page: Page, userId: string) {
  const pairingCode = await postJson<DeviceBridgePairingCodeDto>(page, "/api/v1/device-bridges/pairing-codes", {}, userId);
  const paired = await page.request.post(apiRoute("/api/v1/device-bridges/pair"), {
    data: {
      code: pairingCode.code,
      machineLabel: "E2E-Fake-Bridge",
      platform: "windows",
      arch: "amd64",
      clientVersion: "0.1.0-test"
    },
    headers: smokeHeaders()
  });
  expect(paired.ok()).toBe(true);
  const body = (await paired.json()) as DeviceBridgePairingResultDto;
  return {
    bridgeId: body.bridgeId,
    bridgeToken: body.bridgeToken
  };
}

async function connectFakeBridgeClient(
  bridgeToken: string,
  handlers: {
    detectTargets: () => Array<{ targetRef: string; online: boolean; label: string }>;
    readNode: () => { value: string; stdout: string; durationMs: number };
    writeNode: (value: string) => { value: string; stdout: string; durationMs: number };
  }
) {
  const socket = new WebSocket(bridgeWebSocketUrl(), {
    headers: {
      Authorization: `Bridge ${bridgeToken}`
    }
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    socket.once("open", () => finish());
    socket.once("error", (error) => finish(error as Error));
    socket.once("close", (code, reason) => {
      finish(new Error(`Fake bridge websocket closed before ready: code=${code} reason=${reason.toString()}`));
    });
  });

  socket.on("message", (raw) => {
    const payload = typeof raw === "string" ? raw : raw.toString("utf8");
    let message: { type?: string; id?: string; method?: string; params?: Record<string, unknown> } | null = null;
    try {
      message = JSON.parse(payload) as { type?: string; id?: string; method?: string; params?: Record<string, unknown> };
    } catch {
      return;
    }
    if (!message || message.type !== "rpc.request" || typeof message.id !== "string") {
      return;
    }

    if (message.method === "debug.detectTargets") {
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            targets: handlers.detectTargets()
          }
        })
      );
      return;
    }

    if (message.method === "debug.readNode") {
      const readResult = handlers.readNode();
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            ok: true,
            ...readResult
          }
        })
      );
      return;
    }

    if (message.method === "debug.writeNode") {
      const requestedValue = typeof message.params?.value === "string" ? message.params.value : "";
      const writeResult = handlers.writeNode(requestedValue);
      socket.send(
        JSON.stringify({
          type: "rpc.response",
          id: message.id,
          ok: true,
          result: {
            ok: true,
            verified: true,
            value: writeResult.value,
            writeResult: {
              ok: true,
              value: writeResult.value,
              durationMs: writeResult.durationMs
            },
            readResult: {
              ok: true,
              value: writeResult.value,
              stdout: writeResult.stdout,
              durationMs: writeResult.durationMs
            }
          }
        })
      );
      return;
    }
  });

  return socket;
}

test.describe("simulator debugging API smoke", () => {
test.beforeAll(async () => {
  if (process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc") {
    return;
  }

  await prepareDebuggingApiSmokeState();
});

test("M3 simulator debugging read, write, mismatch, rollback, and audit loop", async ({ page }) => {
  test.skip(
    process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc",
    "The full UI smoke is simulator-backed by default. Run HDC device-lab acceptance separately with real hardware."
  );

  await page.goto(`/node-debugging?project=${projectId}`);

  const devicePill = page.locator(".topbar .device-pill");
  await expect(devicePill).toBeVisible({ timeout: 30_000 });
  const deviceStatus = ((await devicePill.textContent()) ?? "").trim();
  test.skip(
    /HDC|ADB/i.test(deviceStatus) && !/Aurora Simulator/i.test(deviceStatus),
    `Debugging smoke requires simulator gateway; current device pill: ${deviceStatus}`
  );
  await expect(devicePill).toContainText("Aurora Simulator 1", { timeout: 30_000 });
  await expect(devicePill).toContainText("已连接");

  const fastChargeRow = parameterRow(page, "Fast charge current");
  await expect(fastChargeRow).toContainText("3000", { timeout: 30_000 });

  await setTargetAndWrite(page, "Fast charge current", "3100");
  await expect(fastChargeRow).toContainText("3100", { timeout: 30_000 });

  const cycleCountSheet = await openParameterSheet(page, "Cycle count");
  await expect(cycleCountSheet).toContainText("RO");
  await expect(cycleCountSheet.locator(".debugging-deploy-button")).toHaveCount(0);
  await closeParameterSheet(page);

  await setTargetAndWrite(page, "Readback mismatch probe", "2");
  const mismatchRow = parameterRow(page, "Readback mismatch probe");
  await expect(mismatchRow).toContainText(/Readback mismatch|readback mismatch/i, { timeout: 30_000 });

  const fastChargeSnapshotId = await latestSnapshotId(page, fastChargeParameterId);

  await page.goto("/node-debugging");
  const rollbackButton = page.locator(".session-summary-snapshot .button").filter({ hasText: /回滚|rollback/i }).first();
  if ((await rollbackButton.count()) > 0 && await rollbackButton.isEnabled()) {
    await rollbackButton.click();
    const dialog = page.getByRole("dialog").filter({ hasText: fastChargeSnapshotId }).first();
    await expect(dialog).toBeVisible();
    await dialog.locator(".button.danger").click();
    await expect(dialog).not.toBeVisible();
  } else {
    test.info().annotations.push({
      type: "m3-gap",
      description: "Parameter debugging workspace is temporarily hidden; rollback was verified through the rollback API."
    });
    await rollbackSnapshotViaApi(page, fastChargeSnapshotId);
  }

  await page.goto(`/node-debugging?project=${projectId}`);
  const devicePillAfterRollback = page.locator(".topbar .device-pill");
  await expect(devicePillAfterRollback).toBeVisible({ timeout: 30_000 });
  const rollbackDeviceStatus = ((await devicePillAfterRollback.textContent()) ?? "").trim();
  test.skip(
    /HDC|ADB/i.test(rollbackDeviceStatus) && !/Aurora Simulator/i.test(rollbackDeviceStatus),
    `Debugging smoke requires simulator gateway; current device pill: ${rollbackDeviceStatus}`
  );
  await expect(devicePillAfterRollback).toContainText("Aurora Simulator 1", {
    timeout: 30_000
  });
  await expect(devicePillAfterRollback).toContainText("已连接");
  await expect(parameterRow(page, "Fast charge current")).toContainText("3000", { timeout: 30_000 });

  await page.goto("/parameter-admin?audit=open");
  await expect(page).toHaveURL(/\/audit/);
  await expect(page.getByLabel("搜索审计记录")).toBeVisible();
  const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
  expect(auditResponse.ok()).toBe(true);
  const auditBody = (await auditResponse.json()) as {
    items: Array<{ kind: string; targetId: string | null; metadata?: Record<string, unknown> }>;
  };
  expect(auditBody.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "debug-node-write", targetId: fastChargeParameterId }),
      expect.objectContaining({ kind: "debug-node-write", targetId: mismatchParameterId }),
      expect.objectContaining({ kind: "debug-snapshot-rollback", targetId: fastChargeSnapshotId })
    ])
  );
  expect(auditBody.items).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "debug-node-write", targetId: cycleCountParameterId })
    ])
  );
});
});

test("HDC device-lab smoke detects target, reads, writes, verifies read-back, and restores via snapshot rollback API", async ({ page }) => {
  test.skip(
    process.env.DEBUG_DEVICE_GATEWAY_MODE !== "hdc",
    "HDC mode requires an external device lab; simulator remains the local default smoke."
  );
  test.skip(
    process.env.HDC_DEVICE_LAB_AVAILABLE !== "true",
    "HDC device-lab acceptance must be executed against real connected hardware outside this local simulator smoke."
  );
  const config = requireHdcSmokeConfig();
  await prepareDebuggingApiSmokeState();

  const detected = await postJson<{ items: DebugTargetDto[] }>(
    page,
    "/api/v1/debugging/targets/detect",
    { projectId: config.projectId, deviceId: config.deviceId },
    config.userId
  );
  const target = detected.items.find((item) => item.targetRef === config.targetRef);
  expect(
    target,
    `HDC target ${config.targetRef} was not detected. Detected targets: ${detected.items.map((item) => item.targetRef).join(", ") || "(none)"}`
  ).toBeTruthy();

  const sessionResponse = await postJson<{ item: DebugSessionDto }>(
    page,
    "/api/v1/debugging/sessions",
    { projectId: config.projectId, deviceId: config.deviceId, targetId: target!.id },
    config.userId
  );

  const readResponse = await postJson<{ operation: NodeOperationDto }>(
    page,
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

  let snapshotId: string | null = null;
  let rollbackResponse: { operations: NodeOperationDto[]; snapshot: DebugSnapshotDto } | null = null;

  try {
    const writeResponse = await postJson<{ operation: NodeOperationDto }>(
      page,
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
      "HDC smoke write succeeded but did not return operation.snapshotId, so the test cannot safely restore hardware through snapshot rollback."
    ).toEqual(expect.any(String));
    expect(writeResponse.operation.verified).toBe(true);
    expect(writeResponse.operation.readbackValue).toBe(config.writeValue);
  } finally {
    if (snapshotId) {
      rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
        page,
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
  expect(rollbackResponse!.snapshot.status).toBe("consumed");
});

test("bridge-backed detect and session write enforce execution mode and governed confirmation", async ({ page }) => {
  test.skip(
    process.env.DEBUG_DEVICE_GATEWAY_MODE !== "simulator",
    "Bridge fake integration smoke runs in simulator mode to avoid external hardware dependencies."
  );
  test.skip(!databaseUrl, "DATABASE_URL is required to run bridge-backed debugging API smoke.");

  await prepareDebuggingApiSmokeState();

  const userId = "u-xu-yun";
  const fakeTargetRef = "bridge-sim-target-001";
  const bridgePair = await pairBridgeForUser(page, userId);

  const fakeBridge = await connectFakeBridgeClient(bridgePair.bridgeToken, {
    detectTargets: () => [{ targetRef: fakeTargetRef, online: true, label: "Bridge simulator target" }],
    readNode: () => ({ value: "3000", stdout: "3000", durationMs: 3 }),
    writeNode: (value) => ({ value, stdout: value, durationMs: 4 })
  });

  try {
    const detected = await postJson<{ items: DebugTargetDto[] }>(
      page,
      "/api/v1/debugging/targets/detect",
      { projectId, protocol: "hdc", bridgeId: bridgePair.bridgeId },
      userId
    );
    const bridgeTarget = detected.items.find((item) => item.id.startsWith("bridge:"));
    expect(bridgeTarget).toBeTruthy();
    expect(bridgeTarget?.id).toContain(bridgePair.bridgeId);
    expect(bridgeTarget?.targetRef).toBe(fakeTargetRef);

    const sessionResponse = await postJson<{ item: DebugSessionDto }>(
      page,
      "/api/v1/debugging/sessions",
      {
        projectId,
        deviceId: `bridge:${bridgePair.bridgeId}`,
        targetId: bridgeTarget!.id,
        bridgeId: bridgePair.bridgeId,
        protocol: "hdc"
      },
      userId
    );
    expect(sessionResponse.item.executionMode).toBe("bridge");
    expect(sessionResponse.item.bridgeId).toBe(bridgePair.bridgeId);

    const missingConfirmation = await page.request.post(apiRoute("/api/v1/debugging/nodes/write"), {
      headers: { ...smokeHeaders(), "x-wiseeff-user": userId },
      data: {
        sessionId: sessionResponse.item.id,
        parameterId: fastChargeParameterId,
        value: "3150",
        readBack: true
      }
    });
    expect(missingConfirmation.status()).toBe(400);
    const missingConfirmationBody = (await missingConfirmation.json()) as { error?: { code?: string; message?: string } };
    expect(missingConfirmationBody.error?.code).toBe("VALIDATION_FAILED");
    expect(missingConfirmationBody.error?.message).toContain("High-risk write requires confirmation or approval");

    const writeResponse = await postJson<{ operation: NodeOperationDto }>(
      page,
      "/api/v1/debugging/nodes/write",
      {
        sessionId: sessionResponse.item.id,
        nodeId: fastChargeParameterId,
        value: "3150",
        readBack: true,
        confirmationToken: "confirm-high-risk-write"
      },
      userId
    );
    expect(writeResponse.operation.status).toBe("succeeded");
    expect(writeResponse.operation.verified).toBe(true);
    expect(writeResponse.operation.snapshotId).toEqual(expect.any(String));
  } finally {
    await new Promise<void>((resolve) => {
      if (fakeBridge.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      fakeBridge.once("close", () => resolve());
      fakeBridge.close();
    });
  }
});
