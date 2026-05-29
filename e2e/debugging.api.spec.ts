import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { expect, test, type Locator, type Page } from "playwright/test";

const apiBaseUrl = process.env.VITE_WISEEFF_API_BASE_URL ?? "http://127.0.0.1:8787";
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
};

type NodeOperationDto = {
  status: string;
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
  const response = await page.request.get(`${apiBaseUrl}/api/v1/audit-events`);
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
  const response = await page.request.post(`${apiBaseUrl}/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`, {
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
  const response = await page.request.post(`${apiBaseUrl}${path}`, {
    data,
    headers: { "x-wiseeff-user": userId }
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string; code?: string } } | null;

  expect(response.ok(), `${path} failed with status ${response.status()}: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
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

  await expect(page.getByText("在线 · Aurora Simulator 1", { exact: true })).toBeVisible({ timeout: 30_000 });

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

  await page.goto("/debugging");
  const rollbackButton = page.locator(".session-summary-snapshot .button").filter({ hasText: /回滚|鍥炴粴|rollback/i }).first();
  if ((await rollbackButton.count()) > 0 && await rollbackButton.isEnabled()) {
    await rollbackButton.click();
    const dialog = page.getByRole("dialog").filter({ hasText: fastChargeSnapshotId }).first();
    await expect(dialog).toBeVisible();
    await dialog.locator(".button.danger").click();
    await expect(dialog).not.toBeVisible();
  } else {
    test.info().annotations.push({
      type: "m3-gap",
      description: "The API write snapshot is not yet surfaced as DebuggingPage.lastDebugSnapshot after node-debugging writes; rollback was verified through the rollback API."
    });
    await rollbackSnapshotViaApi(page, fastChargeSnapshotId);
  }

  await page.goto(`/node-debugging?project=${projectId}`);
  await expect(page.getByText("在线 · Aurora Simulator 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(parameterRow(page, "Fast charge current")).toContainText("3000", { timeout: 30_000 });

  await page.goto("/parameter-admin?audit=open");
  await expect(page.getByRole("complementary", { name: "审计抽屉" })).toBeVisible();
  const auditResponse = await page.request.get(`${apiBaseUrl}/api/v1/audit-events`);
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
