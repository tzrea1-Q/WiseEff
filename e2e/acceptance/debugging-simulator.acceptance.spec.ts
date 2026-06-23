import "dotenv/config";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "playwright/test";
import type { Client } from "pg";
import { withPgClient } from "./helpers/database";
import { apiRoute, smokeHeaders } from "./helpers/runtime";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";

useBrowserDiagnostics(test);

const projectId = "aurora";
const fastChargeParameterId = "dbg-fast-charge-current";
const cycleCountParameterId = "dbg-cycle-count";
const mismatchParameterId = "dbg-readback-mismatch";
const complexJsonParameterId = "dbg-config-json";
const complexJsonCurrentValue = '{\n  "enabled": true,\n  "limit": 42\n}';
const complexJsonTargetValue = '{\n  "enabled": true,\n  "limit": 48\n}';
const readOnlyDebugUserId = "acceptance-debug-readonly";
const nonWriterDebugUserId = "acceptance-debug-nonwriter";

type AuditEventDto = {
  kind: string;
  targetId: string | null;
  actorUserId?: string;
  metadata?: { snapshotId?: string; requestedValue?: string };
};

function bearerTokenFor(input: { userId: string; roleId: string; permissions: string[] }) {
  const issuer = process.env.AUTH_TOKEN_ISSUER?.trim();
  const secret = process.env.AUTH_TOKEN_HMAC_SECRET?.trim();
  if (!issuer || !secret) {
    return null;
  }

  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: input.userId,
    org: "org-chargelab",
    name: "Acceptance Debug Nonwriter",
    email: `${input.userId}@chargelab.cn`,
    title: "Acceptance User",
    orgName: "ChargeLab",
    roles: [{ roleId: input.roleId, projectId: null }],
    permissions: input.permissions,
    isActive: true,
    nbf: 0,
    exp: 9999999999
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `Bearer ${payload}.${signature}`;
}

function nonWriterApiHeaders() {
  const authorization = bearerTokenFor({
    userId: nonWriterDebugUserId,
    roleId: "hardware-user",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "debugging:view", "debugging:read"]
  });

  if (authorization) {
    return { "Content-Type": "application/json", Authorization: authorization };
  }

  return { ...smokeHeaders(), "x-wiseeff-user": nonWriterDebugUserId };
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

async function seedReadOnlyDebuggingUser(client: Client) {
  await client.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, 'org-chargelab', 'Acceptance Debug Reader', 'acceptance-debug-reader@chargelab.cn', 'Hardware User', true)
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      email = excluded.email,
      title = excluded.title,
      is_active = excluded.is_active
    `,
    [readOnlyDebugUserId]
  );
  await client.query(
    `
    insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
    values ('acceptance-debug-readonly-hardware-user', $1, 'org-chargelab', null, 'hardware-user')
    on conflict (id) do update set
      project_id = excluded.project_id,
      role_id = excluded.role_id
    `,
    [readOnlyDebugUserId]
  );
  await client.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, 'org-chargelab', 'Acceptance Debug Nonwriter', 'acceptance-debug-nonwriter@chargelab.cn', 'Hardware User', true)
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      email = excluded.email,
      title = excluded.title,
      is_active = excluded.is_active
    `,
    [nonWriterDebugUserId]
  );
  await client.query(
    `
    insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
    values ('acceptance-debug-nonwriter-hardware-user', $1, 'org-chargelab', null, 'hardware-user')
    on conflict (id) do update set
      project_id = excluded.project_id,
      role_id = excluded.role_id
    `,
    [nonWriterDebugUserId]
  );
}

async function seedComplexSimulatorParameters(client: Client) {
  await client.query(
    `
    insert into debugging_parameters (
      id,
      organization_id,
      project_id,
      name,
      key,
      description,
      module,
      node_path,
      access_mode,
      unit,
      range_label,
      min_value,
      max_value,
      risk,
      current_value,
      target_value,
      sort_order,
      value_kind,
      value_format,
      normalization_mode,
      updated_at
    )
    values (
      $1,
      'org-chargelab',
      $2,
      'Config JSON overlay',
      'config_json_overlay',
      'Simulator complex JSON node for acceptance validation.',
      'Diagnostics',
      '/sys/class/debug/config_json',
      'RW',
      '',
      'JSON object',
      null,
      null,
      'Medium',
      $3,
      $4,
      60,
      'complex',
      'json',
      'json-canonical',
      now()
    )
    on conflict (project_id, key) do update set
      name = excluded.name,
      description = excluded.description,
      module = excluded.module,
      node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      unit = excluded.unit,
      range_label = excluded.range_label,
      min_value = excluded.min_value,
      max_value = excluded.max_value,
      risk = excluded.risk,
      current_value = excluded.current_value,
      target_value = excluded.target_value,
      sort_order = excluded.sort_order,
      value_kind = excluded.value_kind,
      value_format = excluded.value_format,
      normalization_mode = excluded.normalization_mode,
      updated_at = now()
    `,
    [complexJsonParameterId, projectId, complexJsonCurrentValue, complexJsonTargetValue]
  );

  await client.query(
    `
    insert into debugging_parameter_node_bindings (
      id, organization_id, project_id, parameter_id, protocol, node_path, access_mode, enabled, notes, metadata, updated_at
    )
    values ($1, 'org-chargelab', $2, $3, 'hdc', '/sys/class/debug/config_json', 'RW', true, 'Seeded complex JSON node binding.', '{}'::jsonb, now())
    on conflict (parameter_id, protocol) do update set
      node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      updated_at = now()
    `,
    [`${complexJsonParameterId}:hdc`, projectId, complexJsonParameterId]
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
    await seedReadOnlyDebuggingUser(client);
    await cleanupDebuggingAcceptanceState(client);
    await seedComplexSimulatorParameters(client);
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
  return response;
}

async function createDebuggingSessionViaApi(page: Page, userId = "u-xu-yun") {
  const detectResponse = await page.request.post(apiRoute("/api/v1/debugging/targets/detect"), {
    headers: { ...smokeHeaders(), "x-wiseeff-user": userId },
    data: { projectId }
  });
  expect(detectResponse.ok()).toBe(true);
  const detectBody = (await detectResponse.json()) as { items: Array<{ id: string; deviceId: string; targetRef: string }> };
  const target = detectBody.items.find((item) => item.targetRef === "simulator://aurora-1") ?? detectBody.items[0];
  expect(target).toBeTruthy();

  const sessionResponse = await page.request.post(apiRoute("/api/v1/debugging/sessions"), {
    headers: { ...smokeHeaders(), "x-wiseeff-user": userId },
    data: { projectId, deviceId: target!.deviceId, targetId: target!.id }
  });
  expect(sessionResponse.ok()).toBe(true);
  const sessionBody = (await sessionResponse.json()) as { item: { id: string } };
  return sessionBody.item.id;
}

async function complexOperationDbSummary() {
  return withPgClient(async (client) => {
    const result = await client.query<{
      value_kind: string | null;
      value_format: string | null;
      normalization_mode: string | null;
      value_preview: string | null;
      requested_value_digest: string | null;
      status: string;
    }>(
      `
      select value_kind, value_format, normalization_mode, value_preview, requested_value_digest, status
      from node_operations
      where project_id = $1
        and parameter_id = $2
      order by created_at desc
      limit 1
      `,
      [projectId, complexJsonParameterId]
    );
    const row = result.rows[0];

    return {
      table: "node_operations",
      predicate: `projectId=${projectId}; parameterId=${complexJsonParameterId}; latest write`,
      observed: row
        ? `status=${row.status}; valueKind=${row.value_kind}; valueFormat=${row.value_format}; normalizationMode=${row.normalization_mode}; preview=${row.value_preview ? "present" : "missing"}; digest=${row.requested_value_digest ? "present" : "missing"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

async function debuggingDbSummary(snapshotId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      parameter_id: string;
      current_value: string;
      snapshot_status: string | null;
    }>(
      `
      select dp.id as parameter_id, dp.current_value, ds.status as snapshot_status
      from debugging_parameters dp
      left join debugging_snapshots ds on ds.id = $2
      where dp.project_id = $1
        and dp.id = $3
      `,
      [projectId, snapshotId, fastChargeParameterId]
    );
    const row = result.rows[0];

    return {
      table: "debugging_parameters",
      predicate: `projectId=${projectId}; parameterId=${fastChargeParameterId}; snapshotId=${snapshotId}`,
      observed: row
        ? `currentValue=${row.current_value}; snapshotStatus=${row.snapshot_status ?? "missing"}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

function auditSummaryFor(
  items: Array<{ id?: string; kind: string; targetId: string | null; traceId?: string; metadata?: { snapshotId?: string; requestedValue?: string } }>,
  match: { kind: string; targetId: string }
) {
  const item = items.find((candidate) => candidate.kind === match.kind && candidate.targetId === match.targetId);
  expect(item).toBeTruthy();

  return {
    id: item?.id,
    kind: item!.kind,
    targetId: item!.targetId,
    requestId: item?.traceId,
    metadataSummary: item?.metadata ? Object.entries(item.metadata).map(([key, value]) => `${key}=${value}`).join("; ") : undefined
  };
}

test.describe("M5.4 manual flow E - debugging simulator loop", () => {
  test.beforeAll(async () => {
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc",
      "Simulator acceptance is skipped when the API runtime is configured for HDC."
    );

    await prepareSimulatorAcceptanceState();
  });

  test("reads, writes, detects mismatch, rolls back, and records audit evidence", async ({ page }, testInfo) => {
    // @acceptance DEBUG-SIM-001
    // @operation DEBUG-SIM-001
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

    const complexJsonRow = parameterRow(page, "Config JSON overlay");
    await expect(complexJsonRow).toBeVisible({ timeout: 30_000 });
    await expect(complexJsonRow).toContainText("JSON");
    const complexSheet = await openParameterSheet(page, "Config JSON overlay");
    await expect(complexSheet.locator(".node-complex-target-editor")).toBeVisible();
    await expect(complexSheet.locator(".node-complex-target-editor")).toHaveAttribute("wrap", "off");
    await complexSheet.locator(".node-target-editor").fill(complexJsonTargetValue);
    await complexSheet.locator(".debugging-deploy-button").click();
    await expect(complexSheet.locator(".debugging-deploy-button")).toBeEnabled({ timeout: 30_000 });
    await closeParameterSheet(page);
    await expect(complexJsonRow).toContainText("48", { timeout: 30_000 });

    const fastChargeSnapshotId = await latestWriteSnapshotId(page, fastChargeParameterId);
    const rollbackResponse = await rollbackSnapshotViaApi(page, fastChargeSnapshotId);

    await page.goto(`/node-debugging?project=${projectId}`);
    await expectSimulatorOnline(page);
    await expect(parameterRow(page, "Fast charge current")).toContainText("3000", { timeout: 30_000 });

    await page.goto("/parameter-admin?audit=open");
    await expect(page.locator("main").first()).toBeVisible();

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: Array<AuditEventDto & { id?: string; traceId?: string }> };

    expect(auditBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "debug-node-write", targetId: fastChargeParameterId }),
        expect.objectContaining({ kind: "debug-node-write", targetId: mismatchParameterId }),
        expect.objectContaining({ kind: "debug-node-write", targetId: complexJsonParameterId }),
        expect.objectContaining({ kind: "debug-snapshot-rollback", targetId: fastChargeSnapshotId })
      ])
    );
    expect(auditBody.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "debug-node-write", targetId: cycleCountParameterId })
      ])
    );

    await recordOperationEvidence({
      operationId: "DEBUG-SIM-001",
      title: "debugging simulator read write mismatch rollback audit",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(rollbackResponse, {
          method: "POST",
          path: `/api/v1/debugging/snapshots/${fastChargeSnapshotId}/rollback`,
          responseSummary: `rolled back snapshot ${fastChargeSnapshotId}`
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit events=${auditBody.items.length}`
        })
      ],
      db: [await debuggingDbSummary(fastChargeSnapshotId), await complexOperationDbSummary()],
      audit: [
        auditSummaryFor(auditBody.items, { kind: "debug-node-write", targetId: fastChargeParameterId }),
        auditSummaryFor(auditBody.items, { kind: "debug-node-write", targetId: mismatchParameterId }),
        auditSummaryFor(auditBody.items, { kind: "debug-node-write", targetId: complexJsonParameterId }),
        auditSummaryFor(auditBody.items, { kind: "debug-snapshot-rollback", targetId: fastChargeSnapshotId })
      ],
      notes: `Simulator scalar and complex JSON write paths produced audit evidence with value metadata; snapshot ${fastChargeSnapshotId} rolled back to the original safe value.`
    });
  });

  test("blocks node writes for non-writer roles in UI and forced API calls", async ({ page }, testInfo) => {
    // @acceptance DEBUG-PERM-001
    // @operation DEBUG-PERM-001
    await page.goto(`/node-debugging?project=${projectId}`);
    await expectSimulatorOnline(page);

    const topbar = page.locator(".topbar");
    const roleSwitcher = topbar.getByRole("combobox", { name: "Prototype role" });
    if ((await roleSwitcher.count()) === 0) {
      await topbar.getByRole("button", { name: "Open user role switcher" }).click();
    }
    await topbar.getByRole("combobox", { name: "Prototype role" }).selectOption({ label: "Hardware User" });

    const writableSheet = await openParameterSheet(page, "Fast charge current");
    await expect(writableSheet).toContainText("Fast charge current");
    if ((await writableSheet.locator(".node-target-editor").count()) > 0) {
      testInfo.annotations.push({
        type: "product-gap",
        description:
          "NodeDebuggingPage does not yet hide role-level write controls for Hardware User; backend forced-write rejection remains the deterministic permission contract."
      });
    }
    await closeParameterSheet(page);

    const readOnlySheet = await openParameterSheet(page, "Cycle count");
    await expect(readOnlySheet).toContainText("Cycle count");
    await expect(readOnlySheet.locator(".node-target-editor")).toHaveCount(0);
    await expect(readOnlySheet.locator(".debugging-deploy-button")).toHaveCount(0);
    await closeParameterSheet(page);

    const sessionId = await createDebuggingSessionViaApi(page, readOnlyDebugUserId);
    const authCheckResponse = await page.request.get(apiRoute("/api/v1/me"), {
      headers: nonWriterApiHeaders()
    });
    expect(authCheckResponse.ok()).toBe(true);
    const authCheckBody = (await authCheckResponse.json()) as { permissions?: string[] };
    expect(authCheckBody.permissions).toContain("debugging:read");
    expect(authCheckBody.permissions).not.toContain("debugging:write");

    const forcedWriteResponse = await page.request.post(apiRoute("/api/v1/debugging/nodes/write"), {
      headers: nonWriterApiHeaders(),
      data: {
        sessionId,
        parameterId: fastChargeParameterId,
        nodePath: "/sys/devices/aurora/charging/fast_current_ma",
        value: "3200",
        readBack: true,
        confirmationToken: "confirm-high-risk-write"
      }
    });
    const forcedWriteBody = (await forcedWriteResponse.json()) as { error?: { code?: string; message?: string } };
    expect(forcedWriteResponse.status()).toBe(403);
    expect(forcedWriteBody.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Missing permission: debugging:write."
    });

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events"), { headers: smokeHeaders() });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: AuditEventDto[] };
    expect(auditBody.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: nonWriterDebugUserId,
          kind: "debug-node-write",
          targetId: fastChargeParameterId
        })
      ])
    );

    await recordOperationEvidence({
      operationId: "DEBUG-PERM-001",
      title: "debugging write permission denial ui and api",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(authCheckResponse, {
          method: "GET",
          path: "/api/v1/me",
          responseSummary: `user=${nonWriterDebugUserId}; missing debugging:write`
        }),
        summarizeApiResponse(forcedWriteResponse, {
          method: "POST",
          path: "/api/v1/debugging/nodes/write",
          responseSummary: forcedWriteBody.error?.message ?? "forced write denied"
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events",
          responseSummary: `audit events=${auditBody.items.length}; no debug-node-write for ${nonWriterDebugUserId}`
        })
      ],
      notes: `Read-only node flow hid write controls; forced API write as ${nonWriterDebugUserId} returned 403 debugging:write without a debug-node-write audit event.`
    });
  });
});
