import "dotenv/config";
import { spawnSync } from "node:child_process";
import { expect, test } from "playwright/test";
import type { Client } from "pg";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const acceptanceKeyPrefix = "debug.acceptance.";

type AdminParameterDto = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  archivedAt: string | null;
  bindings: Array<{ protocol: string; nodePath: string; enabled: boolean }>;
};

type AuditEventDto = {
  id?: string;
  kind: string;
  action: string;
  targetId: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
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

async function cleanupAcceptanceCatalogRows(client: Client) {
  const parameters = await client.query<{ id: string }>(
    "select id from debugging_parameters where organization_id = 'org-chargelab' and key like $1",
    [`${acceptanceKeyPrefix}%`]
  );
  const parameterIds = parameters.rows.map((row) => row.id);

  if (parameterIds.length === 0) {
    return;
  }

  await client.query("delete from audit_events where target_id = any($1::text[]) or target_id like any($2::text[])", [
    parameterIds,
    parameterIds.map((id) => `${id}:%`)
  ]);
  await client.query("delete from debugging_parameter_node_bindings where parameter_id = any($1::text[])", [parameterIds]);
  await client.query("delete from debugging_parameters where id = any($1::text[])", [parameterIds]);
}

async function prepareDebuggingAdminAcceptanceState() {
  runSeedScript("db:migrate");
  runSeedScript("db:seed:m0");
  runSeedScript("db:seed:m1");
  runSeedScript("db:seed:m3");

  await withPgClient(async (client) => {
    await cleanupAcceptanceCatalogRows(client);
  });
}

async function debuggingAdminDbSummary(parameterKey: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      id: string;
      enabled: boolean;
      archived_at: string | null;
      protocols: string[];
      enabled_protocols: string[];
      disabled_protocols: string[];
      binding_count: string;
    }>(
      `
      select
        p.id,
        p.enabled,
        p.archived_at,
        array_remove(array_agg(b.protocol order by b.protocol), null) as protocols,
        array_remove(array_agg(b.protocol order by b.protocol) filter (where b.enabled = true), null) as enabled_protocols,
        array_remove(array_agg(b.protocol order by b.protocol) filter (where b.enabled = false), null) as disabled_protocols,
        count(b.id)::text as binding_count
      from debugging_parameters p
      left join debugging_parameter_node_bindings b on b.parameter_id = p.id
      where p.organization_id = 'org-chargelab'
        and p.key = $1
      group by p.id, p.enabled, p.archived_at
      `,
      [parameterKey]
    );
    const row = result.rows[0];

    expect(result.rowCount).toBe(1);
    expect(row).toMatchObject({
      enabled: true,
      archived_at: null,
      protocols: ["adb", "hdc"],
      enabled_protocols: ["hdc"],
      disabled_protocols: ["adb"],
      binding_count: "2"
    });

    return {
      table: "debugging_parameters/debugging_parameter_node_bindings",
      predicate: `key=${parameterKey}`,
      observed: row
        ? `enabled=${row.enabled}; archived=${Boolean(row.archived_at)}; bindingCount=${row.binding_count}; enabledProtocols=${row.enabled_protocols.join(",")}; disabledProtocols=${row.disabled_protocols.join(",")}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

function auditSummaryFor(items: AuditEventDto[], kind: string, targetId: string) {
  const item = items.find((candidate) => candidate.kind === kind && candidate.targetId === targetId);
  expect(item).toBeTruthy();

  return {
    id: item?.id,
    kind: item!.kind,
    action: item!.action,
    targetId: item!.targetId,
    requestId: item?.traceId,
    metadataSummary: item?.metadata
      ? Object.entries(item.metadata)
          .filter(([key]) => !key.toLowerCase().includes("path"))
          .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`)
          .join("; ")
      : undefined
  };
}

test.describe("DEBUG-ADMIN-001 debugging admin catalog governance", () => {
  test.beforeAll(async () => {
    await prepareDebuggingAdminAcceptanceState();
  });

  test.afterAll(async () => {
    await withPgClient(async (client) => {
      await cleanupAcceptanceCatalogRows(client);
    });
  });

  test("debugging admin manages an API-backed HDC/ADB catalog parameter", async ({ page }, testInfo) => {
    // @acceptance DEBUG-ADMIN-001
    // @operation DEBUG-ADMIN-001
    const suffix = Date.now().toString(36);
    const parameterName = `Acceptance debug parameter ${suffix}`;
    const editedName = `Acceptance debug parameter edited ${suffix}`;
    const parameterKey = `${acceptanceKeyPrefix}${suffix}`;

    await page.goto("/debugging-admin");
    await expect(page.getByRole("listbox", { name: "可调参数目录" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /新增/ })).toBeEnabled();

    await page.getByRole("button", { name: /新增/ }).click();
    await page.getByLabel("参数名称").fill(parameterName);
    await page.getByLabel("参数 key").fill(parameterKey);
    await page.getByLabel("HDC 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/hdc`);
    await page.getByLabel("ADB 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/adb`);
    await page.getByRole("button", { name: "保存参数" }).click();
    await expect(page.getByText("已保存")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("双协议")).toBeVisible();

    await page.getByLabel("参数名称").fill(editedName);
    await page.getByRole("button", { name: "保存参数" }).click();
    await expect(page.getByText("已保存")).toBeVisible({ timeout: 30_000 });

    const listResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/parameters?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: AdminParameterDto[] };
    const created = listBody.items.find((item) => item.key === parameterKey);
    expect(created).toBeTruthy();
    expect(created).toMatchObject({ name: editedName, enabled: true, archivedAt: null });
    expect(created!.bindings.some((binding) => binding.protocol === "hdc" && binding.enabled)).toBe(true);
    expect(created!.bindings.some((binding) => binding.protocol === "adb" && binding.enabled)).toBe(true);

    const bindingResponse = await page.request.post(
      apiRoute(`/api/v1/debugging/admin/parameters/${encodeURIComponent(created!.id)}/bindings/adb/archive`),
      { headers: smokeHeaders(), data: {} }
    );
    expect(bindingResponse.ok()).toBe(true);
    const bindingBody = (await bindingResponse.json()) as { item: { protocol: string; enabled: boolean } };
    expect(bindingBody.item).toMatchObject({ protocol: "adb", enabled: false });

    await page.reload();
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("option").filter({ hasText: editedName }).click();
    await page.getByRole("button", { name: `归档 ${editedName}` }).click();
    await expect(page.getByText("已归档")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "恢复参数" }).click();
    await expect(page.getByText("已恢复")).toBeVisible({ timeout: 30_000 });

    const finalListResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/parameters?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(finalListResponse.ok()).toBe(true);
    const finalListBody = (await finalListResponse.json()) as { items: AdminParameterDto[] };
    const restored = finalListBody.items.find((item) => item.key === parameterKey);
    expect(restored).toBeTruthy();
    expect(restored).toMatchObject({ archivedAt: null });
    expect(restored!.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", enabled: true }),
        expect.objectContaining({ protocol: "adb", enabled: false })
      ])
    );

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events?app=debugging&limit=100"), {
      headers: smokeHeaders()
    });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: AuditEventDto[] };
    expect(auditBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "debug-parameter-admin-create", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-parameter-admin-update", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-parameter-admin-archive", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-parameter-admin-restore", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-parameter-binding-admin-archive", targetId: `${created!.id}:adb` })
      ])
    );

    await recordOperationEvidence({
      operationId: "DEBUG-ADMIN-001",
      title: "debugging admin catalog crud hdc adb governance",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/parameters?includeArchived=true",
          responseSummary: `created item found with bindings=${created!.bindings.length}`
        }),
        summarizeApiResponse(bindingResponse, {
          method: "POST",
          path: `/api/v1/debugging/admin/parameters/${created!.id}/bindings/adb/archive`,
          responseSummary: "ADB binding archived through admin API"
        }),
        summarizeApiResponse(finalListResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/parameters?includeArchived=true",
          responseSummary: "restored item remained in admin catalog"
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events?app=debugging",
          responseSummary: `debugging admin audit events=${auditBody.items.length}`
        })
      ],
      db: [await debuggingAdminDbSummary(parameterKey)],
      audit: [
        auditSummaryFor(auditBody.items, "debug-parameter-admin-create", created!.id),
        auditSummaryFor(auditBody.items, "debug-parameter-admin-update", created!.id),
        auditSummaryFor(auditBody.items, "debug-parameter-admin-archive", created!.id),
        auditSummaryFor(auditBody.items, "debug-parameter-admin-restore", created!.id),
        auditSummaryFor(auditBody.items, "debug-parameter-binding-admin-archive", `${created!.id}:adb`)
      ],
      notes: "Admin UI created, edited, archived, and restored a catalog parameter; API verified dual-protocol bindings and binding archive governance."
    });
  });
});
