import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "playwright/test";
import type { Client } from "pg";
import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

const projectId = "aurora";
const fastChargeParameterId = "dbg-fast-charge-current";
const cycleCountParameterId = "dbg-cycle-count";
const mismatchParameterId = "dbg-readback-mismatch";

type AuditEventDto = {
  kind: string;
  targetId: string | null;
  metadata?: { snapshotId?: string; requestedValue?: string };
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

async function cleanupDebuggingAcceptanceState(client: Client) {
  await client.query("delete from audit_events where app = 'debugging' and project_id = $1", [projectId]);
  await client.query("delete from debugging_events where project_id = $1", [projectId]);
  await client.query("update node_operations set snapshot_id = null where project_id = $1", [projectId]);
  await client.query("update debugging_snapshots set operation_id = null where project_id = $1", [projectId]);
  await client.query("delete from node_operations where project_id = $1", [projectId]);
  await client.query("delete from debugging_snapshots where project_id = $1", [projectId]);
  await client.query("delete from debug_device_leases where project_id = $1", [projectId]);
  await client.query("delete from debugging_sessions where project_id = $1", [projectId]);
}

async function prepareSimulatorAcceptanceState() {
  runSeedScript("db:migrate");
  runSeedScript("db:seed:m0");
  runSeedScript("db:seed:m1");
  runSeedScript("db:seed:m3");

  await withPgClient(async (client) => {
    await seedM3DebuggingPermissions(client);
    await cleanupDebuggingAcceptanceState(client);
  });
}

function parameterRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name }).first();
}

async function expectSimulatorOnline(page: Page) {
  const summary = page.locator(".session-summary-card").first();
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.locator(".session-summary-primary")).toContainText("Aurora Simulator 1", { timeout: 30_000 });
  await expect(summary.locator(".session-summary-primary .live-dot")).toHaveCount(1);
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

async function latestWriteSnapshotId(page: Page, parameterId: string) {
  const response = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { items: AuditEventDto[] };
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

test.describe("M5.4 manual flow E - debugging simulator loop", () => {
  test.beforeAll(async () => {
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc",
      "Simulator acceptance is skipped when the API runtime is configured for HDC."
    );

    await prepareSimulatorAcceptanceState();
  });

  test("reads, writes, detects mismatch, rolls back, and records audit evidence", async ({ page }) => {
    await page.goto(`/node-debugging?project=${projectId}`);
    await expectSimulatorOnline(page);

    const fastChargeRow = parameterRow(page, "Fast charge current");
    await expect(fastChargeRow).toContainText("3000", { timeout: 30_000 });

    await setTargetAndWrite(page, "Fast charge current", "3100");
    await expect(fastChargeRow).toContainText("3100", { timeout: 30_000 });

    const cycleCountSheet = await openParameterSheet(page, "Cycle count");
    await expect(cycleCountSheet).toContainText("RO");
    await expect(cycleCountSheet.locator(".node-target-editor")).toHaveCount(0);
    await expect(cycleCountSheet.locator(".debugging-deploy-button")).toHaveCount(0);
    await closeParameterSheet(page);

    await setTargetAndWrite(page, "Readback mismatch probe", "2");
    await expect(parameterRow(page, "Readback mismatch probe")).toContainText(/readback mismatch/i, { timeout: 30_000 });

    const fastChargeSnapshotId = await latestWriteSnapshotId(page, fastChargeParameterId);
    await rollbackSnapshotViaApi(page, fastChargeSnapshotId);

    await page.goto(`/node-debugging?project=${projectId}`);
    await expectSimulatorOnline(page);
    await expect(parameterRow(page, "Fast charge current")).toContainText("3000", { timeout: 30_000 });

    await page.goto("/parameter-admin?audit=open");
    await expect(page.locator("main").first()).toBeVisible();

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: AuditEventDto[] };

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
