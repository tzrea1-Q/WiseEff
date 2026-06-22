import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Page, type Route } from "playwright/test";
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

type ApiErrorBody = { error?: { message?: string; code?: string } } | null;

type ParsedAdbDevice = {
  serial: string;
  state: AdbDeviceState;
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

type MinimalAdbSmokeConfig = Pick<AdbSmokeConfig, "projectId" | "deviceId" | "targetRef" | "parameterId" | "nodePath">;
type AdbSmokeEnv = Partial<Record<"ADB_SMOKE_DEVICE_ID" | "ADB_SMOKE_TARGET_REF" | "ADB_SMOKE_PARAMETER_ID" | "ADB_SMOKE_NODE_PATH" | "ADB_SMOKE_ENABLE_WRITE" | "ADB_SMOKE_WRITE_VALUE" | "ADB_SMOKE_CONFIRM_WRITE" | "ADB_SMOKE_CONFIRM_ROLLBACK" | "ADB_SMOKE_EXPECT_READ_PATTERN" | "ADB_SMOKE_USER_ID", string>>;
type AdbSmokeQueryClient = Pick<Client, "query">;

type AdbSmokeDeviceRow = {
  id: string;
  transport: string;
  status: string;
};

type AdbSmokeBindingRow = {
  parameter_id: string;
  node_path: string;
  access_mode: string;
  enabled: boolean;
  is_smoke_default: boolean;
  binding_project_id: string | null;
  parameter_project_id: string | null;
};

const acceptanceOrganizationId = "org-chargelab";
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

function observedAdbDevices(devices: ParsedAdbDevice[]) {
  return devices.map((item) => `serial=${identifierShape(item.serial)}:${item.state}`).join(", ") || "(none)";
}

function identifierShape(value: string | null | undefined) {
  return value ? `set:length=${value.length}` : "unset";
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

function discoverSingleReadyAdbTarget(devices: ParsedAdbDevice[]) {
  const observed = observedAdbDevices(devices);
  const readyDevices = devices.filter((item) => item.state === "device");
  if (readyDevices.length !== 1) {
    throw new Error(`ADB device-lab acceptance requires exactly one ready ADB device. Observed: ${observed}`);
  }
  return readyDevices[0].serial;
}

test.describe("ADB device-lab preflight validation", () => {
  test("discovers the only ready ADB target without requiring a target override", () => {
    const targetRef = discoverSingleReadyAdbTarget([
      { serial: "adb-target-1", state: "device" },
      { serial: "adb-target-2", state: "offline" }
    ]);

    expect(targetRef).toBe("adb-target-1");
  });

  test("rejects multiple ready ADB targets before configuration", () => {
    expect(() =>
      discoverSingleReadyAdbTarget([
        { serial: "adb-target-1", state: "device" },
        { serial: "adb-target-2", state: "device" }
      ])
    ).toThrow(/exactly one ready ADB device.*serial=set:length=12:device/s);
  });

  test("validates optional smoke overrides against discovered configuration", () => {
    expect(() =>
      validateAdbSmokeOverrides(
        {
          projectId: "aurora",
          deviceId: "device-1",
          targetRef: "target-1",
          parameterId: "param-1",
          nodePath: "/safe/node"
        },
        {
          ADB_SMOKE_TARGET_REF: "other-target"
        }
      )
    ).toThrow(/ADB_SMOKE_TARGET_REF.*discovered=set:length=8.*override=set:length=12/s);
  });

  test("resolves write confirmation requirements after auto configuration", () => {
    expect(() =>
      finalizeAdbSmokeConfig(
        {
          projectId: "aurora",
          deviceId: "device-1",
          targetRef: "target-1",
          parameterId: "param-1",
          nodePath: "/safe/node"
        },
        {
          ADB_SMOKE_ENABLE_WRITE: "true",
          ADB_SMOKE_WRITE_VALUE: "new-value"
        }
      )
    ).toThrow(/ADB_SMOKE_CONFIRM_WRITE.*ADB_SMOKE_CONFIRM_ROLLBACK/s);
  });

  test("resolves one ADB inventory row and one shared default smoke binding from the database", async () => {
    const client = createAdbSmokeConfigClient([
      [{ id: "device-1", transport: "adb", status: "online" }],
      [
        {
          parameter_id: "param-1",
          node_path: "/safe/node",
          access_mode: "RO",
          enabled: true,
          is_smoke_default: true,
          binding_project_id: null,
          parameter_project_id: null
        }
      ]
    ]);

    await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).resolves.toMatchObject({
      projectId: "aurora",
      deviceId: "device-1",
      targetRef: "target-1",
      parameterId: "param-1",
      nodePath: "/safe/node"
    });
  });

  test("rejects missing ADB inventory rows with redacted diagnostics", async () => {
    const client = createAdbSmokeConfigClient([[], []]);

    await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).rejects.toThrow(
      /exactly one ADB debugging device inventory row.*count=0/
    );
  });

  test("rejects non-readable default smoke bindings", async () => {
    const client = createAdbSmokeConfigClient([
      [{ id: "device-1", transport: "adb", status: "online" }],
      [
        {
          parameter_id: "param-1",
          node_path: "/safe/node",
          access_mode: "WO",
          enabled: true,
          is_smoke_default: true,
          binding_project_id: null,
          parameter_project_id: null
        }
      ]
    ]);

    await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).rejects.toThrow(
      /default ADB smoke binding must be readable.*accessMode=WO/
    );
  });

  test("rejects additional ready ADB devices before a hardware run", () => {
    expect(() =>
      discoverSingleReadyAdbTarget([
        { serial: "adb-target-1", state: "device" },
        { serial: "adb-target-2", state: "device" },
        { serial: "adb-target-3", state: "offline" }
      ])
    ).toThrow(/exactly one ready ADB device.*serial=set:length=12:device.*serial=set:length=12:offline/s);
    expect(() =>
      discoverSingleReadyAdbTarget([
        { serial: "adb-target-1", state: "device" },
        { serial: "adb-target-2", state: "device" }
      ])
    ).not.toThrow(/adb-target-[12]/);
  });

  test("preserves debugging sessions that still own device leases during cleanup", async () => {
    const queries: string[] = [];
    const client = {
      query: async (text: string) => {
        queries.push(text);
      }
    } as unknown as Client;

    await cleanupDebuggingAcceptanceState(client, "aurora");

    const sessionDelete = queries.find((query) => query.includes("delete from debugging_sessions"));
    expect(sessionDelete).toContain("debug_device_leases");
    expect(sessionDelete).toContain("not exists");
    const operationDelete = queries.find((query) => query.includes("delete from node_operations"));
    const snapshotDelete = queries.find((query) => query.includes("delete from debugging_snapshots"));
    expect(operationDelete).toContain("debug_device_leases");
    expect(operationDelete).toContain("not exists");
    expect(snapshotDelete).toContain("debug_device_leases");
    expect(snapshotDelete).toContain("not exists");
    expect(queries.some((query) => /delete\s+from\s+debug_device_leases/i.test(query))).toBe(false);
  });

  test("requires explicit write and rollback confirmations when write mode is enabled", () => {
    const previousEnv = { ...process.env };
    try {
      process.env.ADB_SMOKE_PROJECT_ID = "project-1";
      process.env.ADB_SMOKE_DEVICE_ID = "device-1";
      process.env.ADB_SMOKE_TARGET_REF = "target-1";
      process.env.ADB_SMOKE_PARAMETER_ID = "param-1";
      process.env.ADB_SMOKE_NODE_PATH = "/safe/node";
      process.env.ADB_SMOKE_ENABLE_WRITE = "true";
      process.env.ADB_SMOKE_WRITE_VALUE = "new-value";
      delete process.env.ADB_SMOKE_CONFIRM_WRITE;
      delete process.env.ADB_SMOKE_CONFIRM_ROLLBACK;

      expect(() =>
        finalizeAdbSmokeConfig({
          projectId: "project-1",
          deviceId: "device-1",
          targetRef: "target-1",
          parameterId: "param-1",
          nodePath: "/safe/node"
        })
      ).toThrow(/ADB_SMOKE_CONFIRM_WRITE.*ADB_SMOKE_CONFIRM_ROLLBACK/s);
    } finally {
      process.env = previousEnv;
    }
  });
});

test.describe("ADB device-lab evidence redaction", () => {
  test("shape-summarizes operation and audit identifiers", () => {
    const operation = operationSummary({
      id: "raw-operation-id",
      status: "succeeded",
      nodePath: "/redacted/by/caller",
      readValue: null,
      readbackValue: null,
      requestedValue: null,
      previousValue: null,
      verified: true,
      failureReason: null,
      snapshotId: "raw-snapshot-id"
    });
    const metadata = compactAuditMetadata({
      protocol: "adb",
      operationId: "raw-operation-id",
      sessionId: "raw-session-id",
      snapshotId: "raw-snapshot-id"
    });
    const audit = summarizeAudit(
      [{
        id: "raw-audit-id",
        kind: "debug-node-read",
        action: "read",
        targetId: "raw-target-id",
        traceId: "raw-trace-id",
        metadata: { operationId: "raw-operation-id", sessionId: "raw-session-id", snapshotId: "raw-snapshot-id" }
      }],
      "debug-node-read",
      "raw-target-id"
    );

    const evidence = JSON.stringify({ operation, metadata, audit });

    expect(evidence).not.toContain("raw-operation-id");
    expect(evidence).not.toContain("raw-session-id");
    expect(evidence).not.toContain("raw-snapshot-id");
    expect(evidence).not.toContain("raw-audit-id");
    expect(evidence).not.toContain("raw-target-id");
    expect(evidence).not.toContain("raw-trace-id");
  });

  test("shape-summarizes identifier-bearing API evidence paths", () => {
    const rollbackPath = apiEvidencePath("/api/v1/debugging/snapshots/raw-snapshot-id/rollback");
    const auditPath = apiEvidencePath("/api/v1/audit-events?app=debugging&projectId=raw-project-id&limit=100");

    expect(rollbackPath).toBe("/api/v1/debugging/snapshots/:snapshotId/rollback");
    expect(auditPath).toContain("projectId=set:length=14");
    expect(auditPath).not.toContain("raw-project-id");
    expect(auditPath).not.toContain("raw-snapshot-id");
  });

  test("shape-summarizes target identifiers in failure diagnostics", () => {
    expect(() => summarizeAudit([], "debug-node-read", "raw-target-id")).toThrow(/targetId=set:length=13/);
    expect(() => summarizeAudit([], "debug-node-read", "raw-target-id")).not.toThrow(/raw-target-id/);

    expect(detectedTargetsSummary([{ targetRef: "raw-target-id" } as DebugTargetDto])).toBe("set:length=13");
  });

  test("shape-summarizes API error bodies and operation failure reasons", () => {
    const apiFailure = apiFailureDiagnostic("POST", "/api/v1/debugging/snapshots/raw-snapshot-id/rollback", 409, {
      error: {
        code: "ADB_WRITE_FAILED",
        message: "raw-target-id failed while reading /raw/node/path"
      }
    });
    const operationFailure = operationFailureDiagnostic({
      id: "raw-operation-id",
      status: "failed",
      nodePath: "/raw/node/path",
      readValue: null,
      readbackValue: null,
      requestedValue: null,
      previousValue: null,
      verified: false,
      failureReason: "raw-target-id failed while reading /raw/node/path",
      snapshotId: null
    });

    const diagnostics = `${apiFailure}\n${operationFailure}`;

    expect(diagnostics).toContain("/api/v1/debugging/snapshots/:snapshotId/rollback");
    expect(diagnostics).toContain("errorMessage=string:length=49");
    expect(diagnostics).toContain("failureReason=present");
    expect(diagnostics).not.toContain("raw-snapshot-id");
    expect(diagnostics).not.toContain("raw-target-id");
    expect(diagnostics).not.toContain("/raw/node/path");
  });
});

function requireSingleReadyAdbTarget() {
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
  return discoverSingleReadyAdbTarget(devices);
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
  await client.query(
    `
    update node_operations operations
    set snapshot_id = null
    where operations.project_id = $1
      and not exists (
        select 1
        from debug_device_leases leases
        where leases.session_id = operations.session_id
      )
    `,
    [projectId]
  );
  await client.query(
    `
    update debugging_snapshots snapshots
    set operation_id = null
    where snapshots.project_id = $1
      and not exists (
        select 1
        from debug_device_leases leases
        where leases.session_id = snapshots.session_id
      )
    `,
    [projectId]
  );
  await client.query(
    `
    delete from node_operations operations
    where operations.project_id = $1
      and not exists (
        select 1
        from debug_device_leases leases
        where leases.session_id = operations.session_id
      )
    `,
    [projectId]
  );
  await client.query(
    `
    delete from debugging_snapshots snapshots
    where snapshots.project_id = $1
      and not exists (
        select 1
        from debug_device_leases leases
        where leases.session_id = snapshots.session_id
      )
    `,
    [projectId]
  );
  await client.query(
    `
    delete from debugging_sessions sessions
    where sessions.project_id = $1
      and not exists (
        select 1
        from debug_device_leases leases
        where leases.session_id = sessions.id
      )
    `,
    [projectId]
  );
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

function requireAdbSmokeProjectId(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.ADB_SMOKE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("ADB device-lab acceptance requires ADB_SMOKE_PROJECT_ID as the operation project context.");
  }
  return projectId;
}

function validateOverride(name: keyof AdbSmokeEnv, discovered: string, override: string | undefined) {
  const trimmed = override?.trim();
  if (trimmed && trimmed !== discovered) {
    throw new Error(`${name} does not match auto-discovered ADB smoke config: discovered=${identifierShape(discovered)} override=${identifierShape(trimmed)}.`);
  }
}

function validateAdbSmokeOverrides(config: MinimalAdbSmokeConfig, env: AdbSmokeEnv = process.env) {
  validateOverride("ADB_SMOKE_DEVICE_ID", config.deviceId, env.ADB_SMOKE_DEVICE_ID);
  validateOverride("ADB_SMOKE_TARGET_REF", config.targetRef, env.ADB_SMOKE_TARGET_REF);
  validateOverride("ADB_SMOKE_PARAMETER_ID", config.parameterId, env.ADB_SMOKE_PARAMETER_ID);
  validateOverride("ADB_SMOKE_NODE_PATH", config.nodePath, env.ADB_SMOKE_NODE_PATH);
}

function finalizeAdbSmokeConfig(config: MinimalAdbSmokeConfig, env: AdbSmokeEnv = process.env): AdbSmokeConfig {
  validateAdbSmokeOverrides(config, env);
  const writeEnabled = env.ADB_SMOKE_ENABLE_WRITE === "true";
  const missingWriteInputs = [
    ["ADB_SMOKE_WRITE_VALUE", env.ADB_SMOKE_WRITE_VALUE],
    ["ADB_SMOKE_CONFIRM_WRITE", env.ADB_SMOKE_CONFIRM_WRITE],
    ["ADB_SMOKE_CONFIRM_ROLLBACK", env.ADB_SMOKE_CONFIRM_ROLLBACK]
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (writeEnabled && missingWriteInputs.length > 0) {
    throw new Error(`${missingWriteInputs.join(", ")} required when ADB_SMOKE_ENABLE_WRITE=true.`);
  }

  return {
    ...config,
    readValuePattern: env.ADB_SMOKE_EXPECT_READ_PATTERN?.trim() ? new RegExp(env.ADB_SMOKE_EXPECT_READ_PATTERN.trim()) : undefined,
    userId: env.ADB_SMOKE_USER_ID?.trim() || "u-xu-yun",
    writeEnabled,
    writeValue: env.ADB_SMOKE_WRITE_VALUE?.trim(),
    confirmWrite: env.ADB_SMOKE_CONFIRM_WRITE?.trim() ?? "",
    confirmRollback: env.ADB_SMOKE_CONFIRM_ROLLBACK?.trim() ?? ""
  };
}

function candidateShapes(rows: Array<{ id?: string; parameter_id?: string; status?: string; access_mode?: string; enabled?: boolean }>) {
  return rows
    .map((row) => {
      const id = row.id ?? row.parameter_id;
      return [
        `id=${identifierShape(id)}`,
        row.status ? `status=${row.status}` : null,
        row.access_mode ? `accessMode=${row.access_mode}` : null,
        typeof row.enabled === "boolean" ? `enabled=${row.enabled}` : null
      ].filter(Boolean).join(":");
    })
    .join(", ") || "(none)";
}

async function resolveAdbSmokeCatalogConfig(
  client: AdbSmokeQueryClient,
  input: { projectId: string; targetRef: string }
): Promise<MinimalAdbSmokeConfig> {
  const devices = await client.query<AdbSmokeDeviceRow>(
    `
    select id, transport, status
    from debugging_devices
    where organization_id = $1
      and transport = 'adb'
    order by id asc
    `,
    [acceptanceOrganizationId]
  );
  if (devices.rows.length !== 1) {
    throw new Error(
      `ADB device-lab acceptance requires exactly one ADB debugging device inventory row; count=${devices.rows.length}; candidates=${candidateShapes(devices.rows)}.`
    );
  }

  const bindings = await client.query<AdbSmokeBindingRow>(
    `
    select
      bindings.parameter_id,
      bindings.node_path,
      bindings.access_mode,
      bindings.enabled,
      bindings.is_smoke_default,
      bindings.project_id as binding_project_id,
      parameters.project_id as parameter_project_id
    from debugging_parameter_node_bindings bindings
    join debugging_parameters parameters
      on parameters.organization_id = bindings.organization_id
      and parameters.id = bindings.parameter_id
    where bindings.organization_id = $1
      and bindings.protocol = 'adb'
      and bindings.is_smoke_default = true
    order by bindings.id asc
    `,
    [acceptanceOrganizationId]
  );
  if (bindings.rows.length !== 1) {
    throw new Error(
      `ADB device-lab acceptance requires exactly one default ADB smoke binding; count=${bindings.rows.length}; candidates=${candidateShapes(bindings.rows)}.`
    );
  }

  const binding = bindings.rows[0];
  if (binding.binding_project_id !== null || binding.parameter_project_id !== null) {
    throw new Error("Default ADB smoke binding must be shared; bindingProject=present or parameterProject=present.");
  }
  if (!binding.enabled) {
    throw new Error("Default ADB smoke binding must be enabled; enabled=false.");
  }
  if (binding.access_mode !== "RO" && binding.access_mode !== "RW") {
    throw new Error(`default ADB smoke binding must be readable; accessMode=${binding.access_mode}.`);
  }

  return {
    projectId: input.projectId,
    deviceId: devices.rows[0].id,
    targetRef: input.targetRef,
    parameterId: binding.parameter_id,
    nodePath: binding.node_path
  };
}

function createAdbSmokeConfigClient(results: unknown[][]): AdbSmokeQueryClient {
  return {
    query: async () => {
      const rows = results.shift() ?? [];
      return { rows, rowCount: rows.length } as Awaited<ReturnType<Client["query"]>>;
    }
  };
}

async function resolveAdbSmokeConfig(input: { projectId: string; targetRef: string }): Promise<AdbSmokeConfig> {
  return withPgClient(async (client) => {
    const config = await resolveAdbSmokeCatalogConfig(client, input);
    return finalizeAdbSmokeConfig(config);
  });
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

function summarizeSafeApiResponse(
  response: { status(): number; headers(): Record<string, string> },
  input: { method: string; path: string; responseSummary?: string }
) {
  const summary = summarizeApiResponse(response, {
    ...input,
    path: apiEvidencePath(input.path)
  });

  return {
    ...summary,
    requestId: identifierShape(summary.requestId)
  };
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

function detectedTargetsSummary(targets: DebugTargetDto[]) {
  return targets.map((item) => identifierShape(item.targetRef)).join(", ") || "(none)";
}

function stringValueShape(value: string | null | undefined) {
  return typeof value === "string" ? `string:length=${value.length}` : "absent";
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

function writeModeEvidence(input: {
  enabled: boolean;
  writeValue?: string;
  writeOperation?: NodeOperationDto;
  rollbackOperation?: NodeOperationDto;
  finalReadOperation?: NodeOperationDto;
}) {
  if (!input.enabled) {
    return [
      "writeMode=disabled",
      `writeValue=${input.writeValue ? stringValueShape(input.writeValue) : "not-configured"}`,
      "readback=not-run",
      "rollback=not-run",
      "finalRestore=not-run"
    ].join("; ");
  }

  return [
    "writeMode=enabled",
    `writeValue=${stringValueShape(input.writeValue)}`,
    `writeStatus=${input.writeOperation?.status ?? "not-run"}`,
    `writeVerified=${input.writeOperation?.verified ?? "not-run"}`,
    `writeReadback=${stringValueShape(input.writeOperation?.readbackValue)}`,
    `rollbackStatus=${input.rollbackOperation?.status ?? "not-run"}`,
    `rollbackVerified=${input.rollbackOperation?.verified ?? "not-run"}`,
    `rollbackRequestedValue=${stringValueShape(input.rollbackOperation?.requestedValue)}`,
    `rollbackReadback=${stringValueShape(input.rollbackOperation?.readbackValue)}`,
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

async function installFrontendDebuggingApiGuard(page: Page) {
  const observed = {
    detectRequests: 0,
    blockedRequests: [] as string[]
  };

  await page.route("**/api/v1/debugging/targets/detect", async (route) => {
    observed.detectRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });

  const blockUnexpectedFrontendDeviceCall = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    observed.blockedRequests.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FRONTEND_DEVICE_CALL_BLOCKED",
          message: "ADB device-lab UI stage only proves protocol selection; request API owns the real device chain."
        }
      })
    });
  };

  await page.route("**/api/v1/debugging/sessions**", blockUnexpectedFrontendDeviceCall);
  await page.route("**/api/v1/debugging/nodes/**", blockUnexpectedFrontendDeviceCall);
  await page.route("**/api/v1/debugging/snapshots/**/rollback", blockUnexpectedFrontendDeviceCall);

  return observed;
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

    const projectId = requireAdbSmokeProjectId();
    const targetRef = requireSingleReadyAdbTarget();
    await prepareAdbAcceptanceState(projectId);
    const config = await resolveAdbSmokeConfig({ projectId, targetRef });
    const frontendGuard = await installFrontendDebuggingApiGuard(page);
    await expectAdbUiReady(page, config);
    expect(
      frontendGuard.blockedRequests,
      `Frontend UI stage attempted request-API device calls: ${frontendGuard.blockedRequests.join(", ")}`
    ).toEqual([]);
    const viewport = page.viewportSize();

    const apiSummaries: ReturnType<typeof summarizeApiResponse>[] = [];

    const detected = await postJson<{ items: DebugTargetDto[] }>(
      request,
      "/api/v1/debugging/targets/detect",
      { projectId: config.projectId, deviceId: config.deviceId, protocol: "adb" },
      config.userId,
      (body) => `targets=${body.items.length}; detectedTargetRef=${identifierShape(body.items[0]?.targetRef)}`
    );
    apiSummaries.push(detected.summary);
    const target = detected.body.items.find((item) => item.targetRef === config.targetRef);
    expect(
      target,
      `ADB target ${identifierShape(config.targetRef)} was not detected. Detected targets: ${detectedTargetsSummary(detected.body.items)}`
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
      (body) => `session=${identifierShape(body.item.id)}; protocol=${body.item.protocol ?? "unset"}`
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
    expect(readResponse.body.operation.status, `ADB read failed: ${operationFailureDiagnostic(readResponse.body.operation)}`).toBe("succeeded");
    expect(readResponse.body.operation.readValue, "ADB read did not return a value.").toEqual(expect.any(String));
    if (config.readValuePattern) {
      expect(
        new RegExp(config.readValuePattern.source, config.readValuePattern.flags).test(readResponse.body.operation.readValue ?? ""),
        `ADB read value did not match configured regex; observed ${stringValueShape(readResponse.body.operation.readValue)}.`
      ).toBe(true);
    }
    const originalReadValue = readResponse.body.operation.readValue!;
    const readEvidence = readValueEvidence(originalReadValue, config.readValuePattern);

    let snapshotId: string | null = null;
    let writeOperation: NodeOperationDto | undefined;
    let rollbackResponse: { body: { operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }; summary: ReturnType<typeof summarizeApiResponse> } | null = null;
    let finalReadResponse: { body: { operation: NodeOperationDto }; summary: ReturnType<typeof summarizeApiResponse> } | null = null;
    let writeEvidence = writeModeEvidence({ enabled: config.writeEnabled, writeValue: config.writeValue });

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
        writeOperation = writeResponse.body.operation;
        snapshotId = writeResponse.body.operation.snapshotId;

        expect(writeResponse.body.operation.status, `ADB write failed: ${operationFailureDiagnostic(writeResponse.body.operation)}`).toBe("succeeded");
        expect(
          snapshotId,
          "ADB write succeeded without operation.snapshotId, so the test cannot safely restore hardware through snapshot rollback."
        ).toEqual(expect.any(String));
        expect(writeResponse.body.operation.verified).toBe(true);
        expect(
          writeResponse.body.operation.readbackValue === config.writeValue,
          `ADB write readback mismatch; requested ${stringValueShape(config.writeValue)} and readback ${stringValueShape(writeResponse.body.operation.readbackValue)}.`
        ).toBe(true);
      } finally {
        if (snapshotId) {
          rollbackResponse = await postJson<{ operations: NodeOperationDto[]; snapshot: DebugSnapshotDto }>(
            request,
            `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`,
            { confirmationToken: config.confirmRollback },
            config.userId,
            (body) => `${operationsSummary(body.operations)}; snapshot=${identifierShape(body.snapshot.id)}; snapshotStatus=${body.snapshot.status}`
          );
          apiSummaries.push(rollbackResponse.summary);
        }
      }

      expect(rollbackResponse, "Snapshot rollback cleanup did not run.").not.toBeNull();
      expect(rollbackResponse!.body.operations, "Snapshot rollback did not return rollback operations.").toHaveLength(1);
      expect(
        rollbackResponse!.body.operations[0].status,
        `ADB snapshot rollback failed: ${operationFailureDiagnostic(rollbackResponse!.body.operations[0])}`
      ).toBe("succeeded");
      expect(rollbackResponse!.body.operations[0].verified).toBe(true);
      expect(
        rollbackResponse!.body.operations[0].requestedValue === originalReadValue,
        `ADB rollback requested value mismatch; original ${stringValueShape(originalReadValue)} and requested ${stringValueShape(rollbackResponse!.body.operations[0].requestedValue)}.`
      ).toBe(true);
      expect(
        rollbackResponse!.body.operations[0].readbackValue === originalReadValue,
        `ADB rollback readback mismatch; original ${stringValueShape(originalReadValue)} and readback ${stringValueShape(rollbackResponse!.body.operations[0].readbackValue)}.`
      ).toBe(true);
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
      expect(
        finalReadResponse.body.operation.readValue === originalReadValue,
        `ADB final read mismatch; original ${stringValueShape(originalReadValue)} and final ${stringValueShape(finalReadResponse.body.operation.readValue)}.`
      ).toBe(true);
      writeEvidence = writeModeEvidence({
        enabled: config.writeEnabled,
        writeValue: config.writeValue,
        writeOperation,
        rollbackOperation: rollbackResponse!.body.operations[0],
        finalReadOperation: finalReadResponse.body.operation
      });
    }

    const audit = await getAuditEvents(request, config.userId, config.projectId);
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
          ADB_SMOKE_PROJECT_ID: identifierShape(config.projectId),
          ADB_SMOKE_DEVICE_ID: process.env.ADB_SMOKE_DEVICE_ID?.trim() ? "override-validated" : "auto",
          ADB_SMOKE_TARGET_REF: process.env.ADB_SMOKE_TARGET_REF?.trim() ? "override-validated" : "auto",
          ADB_SMOKE_PARAMETER_ID: process.env.ADB_SMOKE_PARAMETER_ID?.trim() ? "override-validated" : "auto",
          ADB_SMOKE_NODE_PATH: process.env.ADB_SMOKE_NODE_PATH?.trim() ? "override-validated" : "auto",
          ADB_SMOKE_AUTO_CONFIG: "true"
        }
      },
      reproduction: {
        steps: [
          "Set DEBUG_DEVICE_GATEWAY_MODE=adb and ADB_DEVICE_LAB_AVAILABLE=true.",
          "Set ADB_SMOKE_PROJECT_ID as the operation project context; device, target, parameter, and node path are auto-discovered from one ready ADB device and the shared default ADB smoke binding.",
          "Optionally set ADB_SMOKE_ENABLE_WRITE=true plus ADB_SMOKE_WRITE_VALUE, ADB_SMOKE_CONFIRM_WRITE, and ADB_SMOKE_CONFIRM_ROLLBACK for write/readback/rollback.",
          "Run npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts."
        ]
      },
      notes: [
        `Browser route=/node-debugging?project=${identifierShape(config.projectId)}; viewport=${viewport ? `${viewport.width}x${viewport.height}` : "unknown"}.`,
        `Frontend debugging API guard fulfilled ${frontendGuard.detectRequests} auto-detect request(s) with an empty target list and blocked ${frontendGuard.blockedRequests.length} unexpected session/read/write/rollback request(s).`,
        "Console/network diagnostics: this spec relies on Playwright request API summaries, default retain-on-failure traces, operation evidence artifacts, and the frontend debugging API guard; no extra browser console collector is installed in this spec.",
        `Frontend selected the ADB protocol only; the current frontend detect path cannot pass deviceId, so real detect/session evidence uses Playwright request API calls with configured device ${identifierShape(config.deviceId)} and protocol=adb, while read/write/rollback evidence is scoped through that ADB session.`,
        `Read evidence for configured parameter ${identifierShape(config.parameterId)}: ${readEvidence}.`,
        `Write evidence for configured parameter ${identifierShape(config.parameterId)}: ${writeEvidence}.`,
        finalReadResponse ? "Final restoration was confirmed by equality with the original read value without recording the raw value." : "Read-only mode did not call write, rollback, or final restoration read."
      ].join(" ")
    });
  });
});
