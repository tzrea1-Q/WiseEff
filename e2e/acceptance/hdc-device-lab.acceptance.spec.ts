import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import type { Client } from "pg";
import { withPgClient } from "./helpers/database";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence, summarizeApiResponse, type OperationEvidenceApiSummary } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

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
  confirmWrite: string;
  confirmRollback: string;
  originalValue: string;
};

type AuditEventDto = {
  id?: string;
  kind: string;
  action?: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

type ApiErrorBody = { error?: { message?: string; code?: string } } | null;

type HdcSmokeEnv = Partial<Record<
  | "HDC_SMOKE_DEVICE_ID"
  | "HDC_SMOKE_TARGET_REF"
  | "HDC_SMOKE_PARAMETER_ID"
  | "HDC_SMOKE_NODE_PATH"
  | "HDC_SMOKE_WRITE_VALUE"
  | "HDC_SMOKE_CONFIRM_WRITE"
  | "HDC_SMOKE_CONFIRM_ROLLBACK"
  | "HDC_SMOKE_ORIGINAL_VALUE"
  | "HDC_SMOKE_EXPECT_READ_PATTERN"
  | "HDC_SMOKE_USER_ID",
  string
>>;

type MinimalHdcSmokeConfig = Pick<HdcSmokeConfig, "projectId" | "deviceId" | "targetRef" | "parameterId" | "nodePath">;
type HdcSmokeQueryClient = Pick<Client, "query">;

const acceptanceOrganizationId = "org-chargelab";
const defaultHdcSmokeDeviceId = "hdc-device-lab-aurora";
const defaultHdcSmokeParameterId = "hdc-smoke-temp-node";
const defaultHdcSmokeNodePath = "/data/local/tmp/wiseeff_hdc_smoke_node";
const defaultHdcSmokeOriginalValue = "wiseeff-hdc-original";
const defaultHdcSmokeWriteValue = "wiseeff-hdc-updated";

test.describe("HDC device-lab preflight validation", () => {
  test("discovers the only connected HDC target without requiring target override", () => {
    const targetRef = discoverSingleReadyHdcTarget("target-one\n");

    expect(targetRef).toBe("target-one");
  });

  test("rejects multiple HDC targets before automatic configuration", () => {
    expect(() => discoverSingleReadyHdcTarget("target-one\ntarget-two\n")).toThrow(/exactly one HDC target.*target=set:length=10/s);
  });

  test("auto-prepares a lab-only HDC inventory row and safe temporary smoke binding", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    } as unknown as Client;

    await expect(
      prepareHdcSmokeCatalogConfig(client, {
        projectId: "aurora",
        targetRef: "target-one",
        nodePath: "/data/local/tmp/wiseeff_hdc_smoke_node"
      })
    ).resolves.toMatchObject({
      projectId: "aurora",
      deviceId: "hdc-device-lab-aurora",
      parameterId: "hdc-smoke-temp-node",
      nodePath: "/data/local/tmp/wiseeff_hdc_smoke_node"
    });
    expect(calls.some((call) => call.text.includes("insert into debugging_devices"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into debugging_parameters"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into debugging_parameter_node_bindings"))).toBe(true);
  });

  test("disables non-lab HDC bindings before frontend auto-read can touch real hardware", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    } as unknown as Client;

    await prepareHdcSmokeCatalogConfig(client, {
      projectId: "aurora",
      targetRef: "target-one",
      nodePath: "/data/local/tmp/wiseeff_hdc_smoke_node"
    });

    const safetyUpdate = calls.find((call) => call.text.includes("update debugging_parameter_node_bindings"));
    expect(safetyUpdate?.text).toContain("protocol = 'hdc'");
    expect(safetyUpdate?.text).toContain("parameter_id <> $3");
    expect(safetyUpdate?.values).toEqual([acceptanceOrganizationId, "aurora", defaultHdcSmokeParameterId]);
  });

  test("requires explicit write and rollback confirmations before writing HDC hardware", () => {
    expect(() =>
      finalizeHdcSmokeConfig(
        {
          projectId: "aurora",
          deviceId: "hdc-device-lab-aurora",
          targetRef: "target-one",
          parameterId: "hdc-smoke-temp-node",
          nodePath: "/data/local/tmp/wiseeff_hdc_smoke_node"
        },
        {
          HDC_SMOKE_WRITE_VALUE: "wiseeff-hdc-updated"
        }
      )
    ).toThrow(/HDC_SMOKE_CONFIRM_WRITE.*HDC_SMOKE_CONFIRM_ROLLBACK/s);
  });
});

function identifierShape(value: string | null | undefined) {
  return value ? `set:length=${value.length}` : "unset";
}

function stringValueShape(value: string | null | undefined) {
  return typeof value === "string" ? `string:length=${value.length}` : "absent";
}

function parseHdcTargets(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function observedHdcTargets(targets: string[]) {
  return targets.map((target) => `target=${identifierShape(target)}`).join(", ") || "(none)";
}

function discoverSingleReadyHdcTarget(stdout: string) {
  const targets = parseHdcTargets(stdout);
  if (targets.length !== 1) {
    throw new Error(`HDC device-lab acceptance requires exactly one HDC target. Observed: ${observedHdcTargets(targets)}`);
  }
  return targets[0];
}

function hdcCommandAvailable() {
  const result = spawnSync("hdc", ["-v"], { encoding: "utf8", env: process.env });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error
  };
}

function requireSingleReadyHdcTarget() {
  const available = hdcCommandAvailable();
  if (!available.ok) {
    throw new Error(
      [
        "HDC device-lab acceptance requires hdc on PATH.",
        available.stderr || available.stdout,
        available.error ? available.error.message : ""
      ].filter(Boolean).join("\n")
    );
  }

  const result = spawnSync("hdc", ["list", "targets"], { encoding: "utf8", env: process.env });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`hdc list targets failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout.trim()}`);
  }

  return discoverSingleReadyHdcTarget(stdout);
}

function hdcShell(targetRef: string, script: string) {
  const result = spawnSync("hdc", ["-t", targetRef, "shell", "sh", "-c", script], {
    encoding: "utf8",
    env: process.env
  });
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`hdc shell failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout}`);
  }
  return stdout;
}

function prepareHdcSmokeNode(targetRef: string, config: Pick<HdcSmokeConfig, "nodePath" | "originalValue">) {
  const encodedValue = Buffer.from(config.originalValue, "utf8").toString("base64");
  hdcShell(
    targetRef,
    [
      `mkdir -p ${JSON.stringify(config.nodePath.slice(0, config.nodePath.lastIndexOf("/")) || "/data/local/tmp")}`,
      `printf '%s' ${JSON.stringify(encodedValue)} | base64 -d > ${JSON.stringify(config.nodePath)}`,
      `cat ${JSON.stringify(config.nodePath)} >/dev/null`
    ].join(" && ")
  );
}

function validateOverride(name: keyof HdcSmokeEnv, discovered: string, override: string | undefined) {
  const trimmed = override?.trim();
  if (trimmed && trimmed !== discovered) {
    throw new Error(`${name} does not match auto-discovered HDC smoke config: discovered=${identifierShape(discovered)} override=${identifierShape(trimmed)}.`);
  }
}

function validateHdcSmokeOverrides(config: MinimalHdcSmokeConfig, env: HdcSmokeEnv = process.env) {
  validateOverride("HDC_SMOKE_DEVICE_ID", config.deviceId, env.HDC_SMOKE_DEVICE_ID);
  validateOverride("HDC_SMOKE_TARGET_REF", config.targetRef, env.HDC_SMOKE_TARGET_REF);
  validateOverride("HDC_SMOKE_PARAMETER_ID", config.parameterId, env.HDC_SMOKE_PARAMETER_ID);
  validateOverride("HDC_SMOKE_NODE_PATH", config.nodePath, env.HDC_SMOKE_NODE_PATH);
}

function finalizeHdcSmokeConfig(config: MinimalHdcSmokeConfig, env: HdcSmokeEnv = process.env): HdcSmokeConfig {
  validateHdcSmokeOverrides(config, env);
  const writeValue = env.HDC_SMOKE_WRITE_VALUE?.trim() || defaultHdcSmokeWriteValue;
  const confirmWrite = env.HDC_SMOKE_CONFIRM_WRITE?.trim();
  const confirmRollback = env.HDC_SMOKE_CONFIRM_ROLLBACK?.trim();
  const missingWriteInputs = [
    ["HDC_SMOKE_CONFIRM_WRITE", confirmWrite],
    ["HDC_SMOKE_CONFIRM_ROLLBACK", confirmRollback]
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missingWriteInputs.length > 0) {
    throw new Error(`${missingWriteInputs.join(", ")} required before HDC device-lab writes real hardware.`);
  }
  if (confirmWrite !== "confirm-high-risk-write") {
    throw new Error("HDC_SMOKE_CONFIRM_WRITE must be confirm-high-risk-write for the governed HDC write path.");
  }
  if (confirmRollback !== "confirm-rollback") {
    throw new Error("HDC_SMOKE_CONFIRM_ROLLBACK must be confirm-rollback for snapshot restoration.");
  }

  return {
    ...config,
    readValuePattern: env.HDC_SMOKE_EXPECT_READ_PATTERN?.trim() ? new RegExp(env.HDC_SMOKE_EXPECT_READ_PATTERN.trim()) : undefined,
    writeValue,
    userId: env.HDC_SMOKE_USER_ID?.trim() || "u-xu-yun",
    confirmWrite: confirmWrite!,
    confirmRollback: confirmRollback!,
    originalValue: env.HDC_SMOKE_ORIGINAL_VALUE?.trim() || defaultHdcSmokeOriginalValue
  };
}

async function prepareHdcSmokeCatalogConfig(
  client: HdcSmokeQueryClient,
  input: { projectId: string; targetRef: string; nodePath: string }
): Promise<MinimalHdcSmokeConfig> {
  await client.query(
    `
    update debugging_parameter_node_bindings
    set enabled = false,
      notes = 'Disabled by HDC device-lab safety setup; only the lab temporary node remains enabled for real hardware evidence.',
      updated_at = now()
    where organization_id = $1
      and project_id = $2
      and parameter_id <> $3
      and protocol = 'hdc'
    `,
    [acceptanceOrganizationId, input.projectId, defaultHdcSmokeParameterId]
  );

  await client.query(
    `
    insert into debugging_devices (
      id,
      organization_id,
      project_id,
      name,
      transport,
      status,
      firmware,
      last_seen_at,
      metadata,
      updated_at
    )
    values ($1, $2, $3, $4, 'hdc', 'online', $5, now(), $6::jsonb, now())
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      project_id = excluded.project_id,
      name = excluded.name,
      transport = excluded.transport,
      status = excluded.status,
      firmware = excluded.firmware,
      last_seen_at = excluded.last_seen_at,
      metadata = excluded.metadata,
      updated_at = now()
    `,
    [
      defaultHdcSmokeDeviceId,
      acceptanceOrganizationId,
      input.projectId,
      "HDC Device Lab Target",
      "hdc-lab",
      JSON.stringify({ labOnly: true, targetRefShape: identifierShape(input.targetRef) })
    ]
  );

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
      updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, 'RW', '', 'lab string', null, null, 'High', $9, $9, 5, now())
    on conflict (project_id, key) do update set
      organization_id = excluded.organization_id,
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
      updated_at = now()
    `,
    [
      defaultHdcSmokeParameterId,
      acceptanceOrganizationId,
      input.projectId,
      "HDC smoke temporary node",
      "hdc_smoke_temp_node",
      "Lab-only temporary file node used for HDC full-chain acceptance.",
      "Device Lab",
      input.nodePath,
      defaultHdcSmokeOriginalValue
    ]
  );

  await client.query(
    `
    insert into debugging_parameter_node_bindings (
      id,
      organization_id,
      project_id,
      parameter_id,
      protocol,
      node_path,
      access_mode,
      enabled,
      notes,
      metadata,
      updated_at
    )
    values ($1, $2, $3, $4, 'hdc', $5, 'RW', true, $6, $7::jsonb, now())
    on conflict (parameter_id, protocol) do update set
      project_id = excluded.project_id,
      node_path = excluded.node_path,
      access_mode = excluded.access_mode,
      enabled = excluded.enabled,
      notes = excluded.notes,
      metadata = excluded.metadata,
      updated_at = now()
    `,
    [
      `${defaultHdcSmokeParameterId}:hdc`,
      acceptanceOrganizationId,
      input.projectId,
      defaultHdcSmokeParameterId,
      input.nodePath,
      "Lab-only HDC smoke binding. Do not point this at customer or production device nodes.",
      JSON.stringify({ labOnly: true })
    ]
  );

  return {
    projectId: input.projectId,
    deviceId: defaultHdcSmokeDeviceId,
    targetRef: input.targetRef,
    parameterId: defaultHdcSmokeParameterId,
    nodePath: input.nodePath
  };
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

function requireHdcSmokeProjectId(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.HDC_SMOKE_PROJECT_ID?.trim() || "aurora";
  if (!projectId) {
    throw new Error("HDC device-lab acceptance requires HDC_SMOKE_PROJECT_ID as the operation project context.");
  }
  return projectId;
}

async function resolveHdcSmokeConfig(input: { projectId: string; targetRef: string }): Promise<HdcSmokeConfig> {
  return withPgClient(async (client) => {
    const minimalConfig = await prepareHdcSmokeCatalogConfig(client, {
      projectId: input.projectId,
      targetRef: input.targetRef,
      nodePath: process.env.HDC_SMOKE_NODE_PATH?.trim() || defaultHdcSmokeNodePath
    });
    return finalizeHdcSmokeConfig(minimalConfig);
  });
}

function summarizeSafeApiResponse(
  response: { status(): number; headers(): Record<string, string> },
  input: { method: string; path: string; responseSummary?: string }
): OperationEvidenceApiSummary {
  const summary = summarizeApiResponse(response, {
    ...input,
    path: apiEvidencePath(input.path)
  });

  return {
    ...summary,
    requestId: identifierShape(summary.requestId)
  };
}

function apiEvidencePath(path: string) {
  const [pathname, queryString] = path.split("?", 2);
  const safePathname = pathname.replace(
    /\/api\/v1\/debugging\/snapshots\/[^/]+\/rollback$/,
    "/api/v1/debugging/snapshots/:snapshotId/rollback"
  );
  if (!queryString) {
    return safePathname;
  }

  const params = new URLSearchParams(queryString);
  const safeParams = Array.from(params.entries()).map(([key, value]) => {
    const safeValue = /id$/i.test(key) ? identifierShape(value) : value;
    return `${key}=${safeValue}`;
  });
  return `${safePathname}?${safeParams.join("&")}`;
}

function apiBodySummary(body: ApiErrorBody | unknown) {
  if (!body || typeof body !== "object") {
    return "body=absent";
  }

  const error = (body as ApiErrorBody)?.error;
  if (error) {
    return [
      `errorCode=${typeof error.code === "string" ? error.code : "absent"}`,
      `errorMessage=${stringValueShape(error.message)}`
    ].join("; ");
  }

  return "body=present";
}

function apiFailureDiagnostic(method: string, path: string, status: number, body: ApiErrorBody | unknown) {
  return `${method} ${apiEvidencePath(path)} failed with status ${status}: ${apiBodySummary(body)}`;
}

function operationSummary(operation: NodeOperationDto) {
  return [
    `operation=${identifierShape(operation.id)}`,
    `status=${operation.status}`,
    `verified=${operation.verified}`,
    `snapshot=${operation.snapshotId ? "present" : "absent"}`,
    `failure=${operation.failureReason ? "present" : "absent"}`
  ].join("; ");
}

function operationsSummary(operations: NodeOperationDto[]) {
  return `operations=${operations.length}; ${operations.map(operationSummary).join("; ")}`;
}

function operationFailureDiagnostic(operation: Pick<NodeOperationDto, "failureReason">) {
  return `failureReason=${operation.failureReason ? "present" : "absent"}`;
}

function readValueEvidence(value: string | null | undefined, pattern: RegExp | undefined) {
  const patternMatched = typeof value === "string" && pattern ? new RegExp(pattern.source, pattern.flags).test(value) : false;

  return [
    `readValue=${stringValueShape(value)}`,
    pattern
      ? `readPattern=configured; readPatternMatched=${patternMatched ? "true" : "false"}`
      : "readPattern=not-configured"
  ].join("; ");
}

function writeEvidence(input: {
  writeValue: string;
  writeOperation?: NodeOperationDto;
  rollbackOperation?: NodeOperationDto;
  finalReadOperation?: NodeOperationDto;
}) {
  return [
    `writeValue=${stringValueShape(input.writeValue)}`,
    `writeStatus=${input.writeOperation?.status ?? "not-run"}`,
    `writeVerified=${input.writeOperation?.verified ?? "not-run"}`,
    `writeReadback=${stringValueShape(input.writeOperation?.readbackValue)}`,
    `rollbackStatus=${input.rollbackOperation?.status ?? "not-run"}`,
    `rollbackVerified=${input.rollbackOperation?.verified ?? "not-run"}`,
    `finalReadStatus=${input.finalReadOperation?.status ?? "not-run"}`,
    `finalReadValue=${stringValueShape(input.finalReadOperation?.readValue)}`,
    `finalRestoration=${input.finalReadOperation ? "confirmed-by-shape-and-equality" : "not-run"}`
  ].join("; ");
}

function compactAuditMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return undefined;
  }

  return JSON.stringify({
    protocol: metadata.protocol,
    operationId: typeof metadata.operationId === "string" ? identifierShape(metadata.operationId) : undefined,
    sessionId: typeof metadata.sessionId === "string" ? identifierShape(metadata.sessionId) : undefined,
    snapshotId: typeof metadata.snapshotId === "string" ? identifierShape(metadata.snapshotId) : undefined,
    targetCount: typeof metadata.targetCount === "number" ? metadata.targetCount : undefined,
    operationCount: typeof metadata.operationCount === "number" ? metadata.operationCount : undefined,
    verified: typeof metadata.verified === "boolean" ? metadata.verified : undefined,
    failed: typeof metadata.failed === "boolean" ? metadata.failed : undefined,
    failureReason: metadata.failureReason ? "present" : undefined
  });
}

function summarizeAudit(events: AuditEventDto[], kind: string, targetId: string | null) {
  const event = events.find((item) => item.kind === kind && item.targetId === targetId);
  expect(event, `Missing audit event kind=${kind} targetId=${targetId ? identifierShape(targetId) : "(null)"}.`).toBeTruthy();

  return {
    id: identifierShape(event!.id),
    kind: event!.kind,
    action: event!.action,
    targetId: event!.targetId ? identifierShape(event!.targetId) : event!.targetId,
    requestId: identifierShape(event!.traceId),
    metadataSummary: compactAuditMetadata(event!.metadata)
  };
}

async function getAuditEvents(request: APIRequestContext, userId: string, projectId: string) {
  const auditPath = `/api/v1/audit-events?app=debugging&projectId=${encodeURIComponent(projectId)}&limit=100`;
  const response = await request.get(apiRoute(auditPath), {
    headers: {
      ...smokeHeaders(),
      "x-wiseeff-user": userId
    }
  });
  const body = (await response.json().catch(() => null)) as { items?: AuditEventDto[] } | { error?: { message?: string; code?: string } } | null;

  expect(response.ok(), apiFailureDiagnostic("GET", auditPath, response.status(), body as ApiErrorBody)).toBe(true);

  return {
    events: ((body as { items?: AuditEventDto[] })?.items ?? []),
    summary: summarizeSafeApiResponse(response, {
      method: "GET",
      path: auditPath,
      responseSummary: `audit events=${(body as { items?: AuditEventDto[] } | null)?.items?.length ?? 0}`
    })
  };
}

async function expectHdcUiReady(page: Page, config: HdcSmokeConfig) {
  await page.goto(`/node-debugging?project=${encodeURIComponent(config.projectId)}`);
  const hdcButton = page.getByRole("button", { name: "HDC", exact: true });
  await expect(hdcButton).toBeVisible({ timeout: 30_000 });
  await expect(hdcButton).toHaveAttribute("aria-pressed", "true");
  const devicePill = page.locator(".topbar .device-pill").first();
  await expect(devicePill).toBeVisible({ timeout: 30_000 });
  await expect(devicePill).toContainText("已连接", { timeout: 30_000 });
  await expect(devicePill.locator(".live-dot")).toHaveCount(1, { timeout: 30_000 });
}

function parameterRow(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name }).first();
}

async function openHdcSmokeSheet(page: Page) {
  const row = parameterRow(page, "HDC smoke temporary node");
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator("button.parameter-row-edit").click();
  const sheet = page.locator(".workbench-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("HDC smoke temporary node");
  return sheet;
}

async function writeHdcSmokeValueFromUi(page: Page, value: string) {
  const sheet = await openHdcSmokeSheet(page);
  await sheet.locator(".node-target-editor").fill(value);
  await sheet.locator(".debugging-deploy-button").click();
  await expect(sheet.locator(".debugging-deploy-button")).toBeEnabled({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".workbench-sheet")).not.toBeVisible();
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

  expect(response.ok(), apiFailureDiagnostic("POST", path, response.status(), body as ApiErrorBody)).toBe(true);

  return {
    body: body as T,
    summary: summarizeSafeApiResponse(response, {
      method: "POST",
      path,
      responseSummary: body ? responseSummary(body as T) : "body=absent"
    })
  };
}

async function latestWriteOperationFromAudit(request: APIRequestContext, config: HdcSmokeConfig) {
  const audit = await getAuditEvents(request, config.userId, config.projectId);
  const event = audit.events.find((item) =>
    item.kind === "debug-node-write" &&
    item.targetId === config.parameterId &&
    item.metadata?.snapshotId
  );
  expect(event, "Missing HDC UI write audit event with snapshot metadata.").toBeTruthy();
  return {
    audit,
    snapshotId: String(event!.metadata!.snapshotId),
    sessionId: typeof event!.metadata!.sessionId === "string" ? event!.metadata!.sessionId : undefined,
    operationId: typeof event!.metadata!.operationId === "string" ? event!.metadata!.operationId : undefined,
    writeOperation: {
      id: typeof event!.metadata!.operationId === "string" ? event!.metadata!.operationId : undefined,
      status: event!.metadata!.failureReason ? "failed" : "succeeded",
      nodePath: config.nodePath,
      readValue: typeof event!.metadata!.previousValue === "string" ? event!.metadata!.previousValue : null,
      readbackValue: typeof event!.metadata!.readbackValue === "string" ? event!.metadata!.readbackValue : null,
      requestedValue: typeof event!.metadata!.requestedValue === "string" ? event!.metadata!.requestedValue : null,
      previousValue: typeof event!.metadata!.previousValue === "string" ? event!.metadata!.previousValue : null,
      verified: event!.metadata!.verified === true,
      failureReason: event!.metadata!.failureReason ? "present" : null,
      snapshotId: String(event!.metadata!.snapshotId)
    } satisfies NodeOperationDto
  };
}

test.describe("M5.4 manual flow F - HDC device-lab loop", () => {
  test.setTimeout(180_000);

  test("drives /node-debugging through HDC read, write/readback, audit, and snapshot rollback", async ({ page, request }, testInfo) => {
    // @acceptance HDC-LAB-001
    // @operation HDC-LAB-001
    test.skip(
      process.env.DEBUG_DEVICE_GATEWAY_MODE !== "hdc",
      "HDC device-lab acceptance only runs when DEBUG_DEVICE_GATEWAY_MODE=hdc."
    );
    test.skip(
      process.env.HDC_DEVICE_LAB_AVAILABLE !== "true",
      "HDC device-lab acceptance is skipped unless real hardware is available and approved for writes."
    );

    const projectId = requireHdcSmokeProjectId();
    const targetRef = requireSingleReadyHdcTarget();
    await prepareHdcAcceptanceState(projectId);
    const config = await resolveHdcSmokeConfig({ projectId, targetRef });
    prepareHdcSmokeNode(config.targetRef, config);

    const apiSummaries: OperationEvidenceApiSummary[] = [];

    await expectHdcUiReady(page, config);
    const viewport = page.viewportSize();
    const initialRow = parameterRow(page, "HDC smoke temporary node");
    await expect(initialRow).toContainText(config.originalValue, { timeout: 30_000 });

    await writeHdcSmokeValueFromUi(page, config.writeValue);
    await expect(initialRow).toContainText(config.writeValue, { timeout: 30_000 });

    const uiWriteAudit = await latestWriteOperationFromAudit(request, config);
    apiSummaries.push(uiWriteAudit.audit.summary);
    const snapshotId = uiWriteAudit.snapshotId;

    const detected = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId: config.projectId, deviceId: config.deviceId, protocol: "hdc" },
      config.userId,
      (body) => `targets=${body.items.length}; detectedTargetRef=${identifierShape(body.items[0]?.targetRef)}`
    );
    apiSummaries.push(detected.summary);
    const target = detected.body.items.find((item) => item.targetRef === config.targetRef);
    expect(
      target,
      `HDC target ${identifierShape(config.targetRef)} was not detected. Detected targets: ${detected.body.items.map((item) => identifierShape(item.targetRef)).join(", ") || "(none)"}`
    ).toBeTruthy();
    expect(target!.status).toBe("detected");

    const sessionResponse = await postJson<{ item: DebugSessionDto }>(
      request,
      "/api/v1/debugging/sessions",
      { projectId: config.projectId, deviceId: config.deviceId, targetId: target!.id, protocol: "hdc" },
      config.userId,
      (body) => `session=${identifierShape(body.item.id)}; protocol=${body.item.protocol ?? "unset"}`
    );
    apiSummaries.push(sessionResponse.summary);

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
    expect(readResponse.body.operation.status, `HDC read failed: ${operationFailureDiagnostic(readResponse.body.operation)}`).toBe("succeeded");
    expect(readResponse.body.operation.readValue, "HDC read did not return a value.").toEqual(expect.any(String));
    if (config.readValuePattern) {
      expect(
        new RegExp(config.readValuePattern.source, config.readValuePattern.flags).test(readResponse.body.operation.readValue ?? ""),
        `HDC read value did not match configured regex; observed ${stringValueShape(readResponse.body.operation.readValue)}.`
      ).toBe(true);
    }
    const observedWrittenValue = readResponse.body.operation.readValue!;
    expect(observedWrittenValue).toBe(config.writeValue);
    const readEvidence = readValueEvidence(observedWrittenValue, config.readValuePattern);

    const rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
      request,
      `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
      { confirmationToken: config.confirmRollback },
      config.userId,
      (body) => `${operationsSummary(body.operations)}; snapshot=${identifierShape(body.snapshot.id)}; snapshotStatus=${body.snapshot.status}`
    );
    apiSummaries.push(rollbackResponse.summary);

    expect(rollbackResponse.body.operations, "Snapshot rollback did not return rollback operations.").toHaveLength(1);
    expect(
      rollbackResponse.body.operations[0].status,
      `HDC snapshot rollback failed: ${operationFailureDiagnostic(rollbackResponse.body.operations[0])}`
    ).toBe("succeeded");
    expect(rollbackResponse.body.operations[0].verified).toBe(true);
    expect(
      rollbackResponse.body.operations[0].requestedValue === config.originalValue,
      `HDC rollback requested value mismatch; original ${stringValueShape(config.originalValue)} and requested ${stringValueShape(rollbackResponse.body.operations[0].requestedValue)}.`
    ).toBe(true);
    expect(
      rollbackResponse.body.operations[0].readbackValue === config.originalValue,
      `HDC rollback readback mismatch; original ${stringValueShape(config.originalValue)} and readback ${stringValueShape(rollbackResponse.body.operations[0].readbackValue)}.`
    ).toBe(true);
    expect(rollbackResponse.body.snapshot.status).toBe("consumed");

    const restoredReadResponse = await postJson<{ operation: NodeOperationDto }>(
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
    apiSummaries.push(restoredReadResponse.summary);
    expect(restoredReadResponse.body.operation.status).toBe("succeeded");
    expect(
      restoredReadResponse.body.operation.readValue === config.originalValue,
      `HDC final read mismatch; original ${stringValueShape(config.originalValue)} and final ${stringValueShape(restoredReadResponse.body.operation.readValue)}.`
    ).toBe(true);

    const finalAudit = await getAuditEvents(request, config.userId, config.projectId);
    apiSummaries.push(finalAudit.summary);
    const auditSummaries = [
      summarizeAudit(finalAudit.events, "debug-target-detect", config.deviceId),
      summarizeAudit(finalAudit.events, "debug-session-create", uiWriteAudit.sessionId ?? null),
      summarizeAudit(finalAudit.events, "debug-node-read", config.parameterId),
      summarizeAudit(finalAudit.events, "debug-node-write", config.parameterId),
      summarizeAudit(finalAudit.events, "debug-snapshot-rollback", snapshotId)
    ];

    await recordOperationEvidence({
      operationId: "HDC-LAB-001",
      title: "hdc frontend device lab read write readback rollback",
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
          HDC_DEVICE_LAB_AVAILABLE: process.env.HDC_DEVICE_LAB_AVAILABLE?.trim() || "unset",
          HDC_SMOKE_PROJECT_ID: process.env.HDC_SMOKE_PROJECT_ID?.trim() ? identifierShape(config.projectId) : "default",
          HDC_SMOKE_DEVICE_ID: process.env.HDC_SMOKE_DEVICE_ID?.trim() ? "override-validated" : "auto-lab",
          HDC_SMOKE_TARGET_REF: process.env.HDC_SMOKE_TARGET_REF?.trim() ? "override-validated" : "auto",
          HDC_SMOKE_PARAMETER_ID: process.env.HDC_SMOKE_PARAMETER_ID?.trim() ? "override-validated" : "auto-lab",
          HDC_SMOKE_NODE_PATH: process.env.HDC_SMOKE_NODE_PATH?.trim() ? "override-validated" : "default-temp-file",
          HDC_SMOKE_WRITE_VALUE: process.env.HDC_SMOKE_WRITE_VALUE?.trim() ? "set" : "default-temp-value",
          HDC_SMOKE_CONFIRM_WRITE: "validated",
          HDC_SMOKE_CONFIRM_ROLLBACK: "validated",
          HDC_SMOKE_AUTO_CONFIG: "true"
        }
      },
      reproduction: {
        steps: [
          "Connect exactly one HDC target to the machine running the WiseEff API.",
          "Set DEBUG_DEVICE_GATEWAY_MODE=hdc, HDC_DEVICE_LAB_AVAILABLE=true, HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write, and HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback.",
          "Optionally set HDC_SMOKE_PROJECT_ID, HDC_SMOKE_NODE_PATH, HDC_SMOKE_WRITE_VALUE, and validation overrides.",
          "Run npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts."
        ]
      },
      notes: [
        `Browser route=/node-debugging?project=${identifierShape(config.projectId)}; viewport=${viewport ? `${viewport.width}x${viewport.height}` : "unknown"}.`,
        `Frontend selected the default HDC protocol, detected ${identifierShape(config.targetRef)}, read the lab-only temporary node, wrote an approved value through the UI, and verified readback.`,
        `Read evidence for configured parameter ${identifierShape(config.parameterId)}: ${readEvidence}.`,
        `Write evidence for configured parameter ${identifierShape(config.parameterId)}: ${writeEvidence({
          writeValue: config.writeValue,
          writeOperation: uiWriteAudit.writeOperation,
          rollbackOperation: rollbackResponse.body.operations[0],
          finalReadOperation: restoredReadResponse.body.operation
        })}.`,
        "Final restoration was confirmed by equality with the original lab value without recording raw device identifiers or raw node values."
      ].join(" ")
    });
  });
});
