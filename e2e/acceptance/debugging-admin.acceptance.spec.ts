import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import type { Client } from "pg";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { recordOperationEvidence, summarizeApiResponse } from "./helpers/operationEvidence";
import { apiRoute, smokeHeaders } from "./helpers/runtime";

useBrowserDiagnostics(test);

const acceptanceNodeNamePrefix = "Acceptance debug node";

type AdminNodeDto = {
  id: string;
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
  const nodes = await client.query<{ id: string }>(
    "select id from debug_nodes where organization_id = 'org-chargelab' and name like $1",
    [`${acceptanceNodeNamePrefix}%`]
  );
  const nodeIds = nodes.rows.map((row) => row.id);

  if (nodeIds.length === 0) {
    return;
  }

  await client.query("delete from audit_events where target_id = any($1::text[]) or target_id like any($2::text[])", [
    nodeIds,
    nodeIds.map((id) => `${id}:%`)
  ]);
  await client.query("delete from debug_node_bindings where node_id = any($1::text[])", [nodeIds]);
  await client.query("delete from debug_nodes where id = any($1::text[])", [nodeIds]);
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

async function debuggingAdminDbSummary(nodeName: string) {
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
        n.id,
        n.enabled,
        n.archived_at,
        array_remove(array_agg(b.protocol order by b.protocol), null) as protocols,
        array_remove(array_agg(b.protocol order by b.protocol) filter (where b.enabled = true), null) as enabled_protocols,
        array_remove(array_agg(b.protocol order by b.protocol) filter (where b.enabled = false), null) as disabled_protocols,
        count(b.id)::text as binding_count
      from debug_nodes n
      left join debug_node_bindings b on b.node_id = n.id
      where n.organization_id = 'org-chargelab'
        and n.name = $1
      group by n.id, n.enabled, n.archived_at
      `,
      [nodeName]
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
      table: "debug_nodes/debug_node_bindings",
      predicate: `name=${nodeName}`,
      observed: row
        ? `enabled=${row.enabled}; archived=${Boolean(row.archived_at)}; bindingCount=${row.binding_count}; enabledProtocols=${row.enabled_protocols.join(",")}; disabledProtocols=${row.disabled_protocols.join(",")}`
        : "missing",
      rowCount: result.rowCount ?? result.rows.length
    };
  });
}

function auditSummaryFor(items: AuditEventDto[], kind: string, targetId: string, requestId?: string) {
  const item = items.find(
    (candidate) => candidate.kind === kind && candidate.targetId === targetId && (!requestId || candidate.traceId === requestId)
  );
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

function catalogAuditSummaryFor(
  items: AuditEventDto[],
  kind: "debug-node-catalog-export" | "debug-node-catalog-import",
  requestId: string | undefined,
  expectedMetadata: Record<string, unknown>,
  rawNodePaths: string[]
) {
  const item = items.find(
    (candidate) => candidate.kind === kind && candidate.targetId === "org-chargelab" && candidate.traceId === requestId
  );

  expect(item, `${kind} audit with request id ${requestId}`).toBeTruthy();
  expect(item!.metadata).toEqual(expectedMetadata);

  const serializedMetadata = JSON.stringify(item!.metadata);
  expect(serializedMetadata.toLowerCase()).not.toContain("nodepath");
  for (const rawNodePath of rawNodePaths) {
    expect(serializedMetadata).not.toContain(rawNodePath);
  }

  return auditSummaryFor(items, kind, "org-chargelab", requestId);
}

function nodeRow(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}

function savedIndicator(page: Page) {
  return page.getByRole("toolbar", { name: "调试管理后台页面操作" }).getByText("已保存");
}

async function configureProtocolBindings(page: Page, nodeName: string, suffix: string) {
  await nodeRow(page, nodeName).getByRole("button", { name: "路径绑定" }).click();
  // ModalDialog names the bindings dialog by its visible <h2>, which is the node name.
  const bindingsDialog = page.getByRole("dialog", { name: nodeName });

  const hdcPanel = bindingsDialog.locator(".debug-admin-binding-panel").filter({ hasText: "HDC" });
  await hdcPanel.getByLabel("HDC 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/hdc`);
  await hdcPanel.getByRole("checkbox").check();
  await bindingsDialog.getByRole("button", { name: "保存 HDC binding" }).click();
  await expect(savedIndicator(page)).toBeVisible({ timeout: 30_000 });

  const adbPanel = bindingsDialog.locator(".debug-admin-binding-panel").filter({ hasText: "ADB" });
  await adbPanel.getByLabel("ADB 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/adb`);
  await adbPanel.getByRole("checkbox").check();
  await bindingsDialog.getByRole("button", { name: "保存 ADB binding" }).click();
  await expect(savedIndicator(page)).toBeVisible({ timeout: 30_000 });

  await bindingsDialog.getByRole("button", { name: "取消" }).click();
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

  test("debugging admin manages an API-backed HDC/ADB catalog node", async ({ page }, testInfo) => {
    // @acceptance DEBUG-ADMIN-001
    // @operation DEBUG-ADMIN-001
    const suffix = Date.now().toString(36);
    const nodeName = `${acceptanceNodeNamePrefix} ${suffix}`;
    const editedName = `${acceptanceNodeNamePrefix} edited ${suffix}`;

    await page.goto("/debugging-admin/nodes");
    await expect(page.getByRole("table", { name: "可调节点目录" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "新增节点" })).toBeEnabled();

    await page.getByRole("button", { name: "新增节点" }).click();
    const createDialog = page.getByRole("dialog", { name: "创建节点" });
    await createDialog.getByLabel("名称").fill(nodeName);
    await createDialog.getByLabel("简述").fill("Acceptance debug node");
    await createDialog.getByRole("button", { name: "保存" }).click();
    await expect(savedIndicator(page)).toBeVisible({ timeout: 30_000 });

    await configureProtocolBindings(page, nodeName, suffix);
    await expect(nodeRow(page, nodeName)).toBeVisible();

    await nodeRow(page, nodeName).getByRole("button", { name: "编辑" }).click();
    const definitionDialog = page.getByRole("dialog", { name: "编辑节点" });
    await definitionDialog.getByLabel("名称").fill(editedName);
    await definitionDialog.getByLabel("详细描述").fill("Acceptance node detailed description");
    await definitionDialog.getByRole("button", { name: "保存" }).click();
    await expect(savedIndicator(page)).toBeVisible({ timeout: 30_000 });
    await expect(definitionDialog).not.toBeVisible({ timeout: 30_000 });
    await expect(nodeRow(page, editedName)).toBeVisible();

    const exportResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "GET" && response.url().includes("/api/v1/debugging/admin/catalog/export")
    );
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出目录" }).click();
    const [exportResponse, download] = await Promise.all([exportResponsePromise, downloadPromise]);
    expect(exportResponse.ok()).toBe(true);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exportedCatalog = JSON.parse(await readFile(downloadPath!, "utf8")) as {
      format: "wiseeff.debug-node-catalog.v1";
      modules: unknown[];
      nodes: Array<Record<string, unknown> & { id?: string; name: string; bindings: Array<{ nodePath: string }> }>;
    };
    const exportedNode = exportedCatalog.nodes.find((node) => node.name === editedName);
    expect(exportedNode).toBeTruthy();

    const importedDescription = `Imported acceptance node ${suffix}`;
    const importDocument = {
      format: exportedCatalog.format,
      modules: [],
      nodes: [{ ...exportedNode!, description: importedDescription }]
    };
    const importResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v1/debugging/admin/catalog/import")
    );
    await page.getByLabel("导入目录文件").setInputFiles({
      name: "debug-node-catalog.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(importDocument))
    });
    const importResponse = await importResponsePromise;
    expect(importResponse.ok()).toBe(true);
    const importBody = (await importResponse.json()) as {
      item: {
        modulesCreated: number;
        modulesUpdated: number;
        nodesCreated: number;
        nodesUpdated: number;
        bindingsUpserted: number;
      };
    };
    expect(importBody.item).toEqual({
      modulesCreated: 0,
      modulesUpdated: 0,
      nodesCreated: 0,
      nodesUpdated: 1,
      bindingsUpserted: 2
    });
    await expect(
      page.getByRole("toolbar", { name: "调试管理后台页面操作" }).getByText(/^已导入：/)
    ).toBeVisible({ timeout: 30_000 });

    const listResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(listResponse.ok()).toBe(true);
    const listBody = (await listResponse.json()) as { items: Array<AdminNodeDto & { description: string }> };
    const created = listBody.items.find((item) => item.name === editedName);
    expect(created).toBeTruthy();
    expect(created).toMatchObject({
      enabled: true,
      archivedAt: null,
      description: importedDescription
    });
    expect(created!.bindings.some((binding) => binding.protocol === "hdc" && binding.enabled)).toBe(true);
    expect(created!.bindings.some((binding) => binding.protocol === "adb" && binding.enabled)).toBe(true);

    const bindingResponse = await page.request.post(
      apiRoute(`/api/v1/debugging/admin/nodes/${encodeURIComponent(created!.id)}/bindings/adb/archive`),
      { headers: smokeHeaders(), data: {} }
    );
    expect(bindingResponse.ok()).toBe(true);
    const bindingBody = (await bindingResponse.json()) as { item: { protocol: string; enabled: boolean } };
    expect(bindingBody.item).toMatchObject({ protocol: "adb", enabled: false });

    await page.reload();
    await expect(page.getByText(editedName)).toBeVisible({ timeout: 30_000 });
    await nodeRow(page, editedName).getByRole("button", { name: "禁用" }).click();
    await page.getByRole("button", { name: /^禁用$/ }).click();
    await expect(page.getByRole("toolbar", { name: "调试管理后台页面操作" }).getByText("已禁用")).toBeVisible({ timeout: 30_000 });

    const restoreResponse = await page.request.patch(apiRoute(`/api/v1/debugging/admin/nodes/${encodeURIComponent(created!.id)}`), {
      headers: smokeHeaders(),
      data: { enabled: true }
    });
    expect(restoreResponse.ok()).toBe(true);

    const finalListResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(finalListResponse.ok()).toBe(true);
    const finalListBody = (await finalListResponse.json()) as { items: AdminNodeDto[] };
    const restored = finalListBody.items.find((item) => item.name === editedName);
    expect(restored).toBeTruthy();
    expect(restored).toMatchObject({ enabled: true, archivedAt: null });
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
    const exportedBindingPaths = exportedCatalog.nodes.flatMap((node) => node.bindings.map((binding) => binding.nodePath));
    const exportAuditMetadata = {
      moduleCount: exportedCatalog.modules.length,
      nodeCount: exportedCatalog.nodes.length,
      bindingCount: exportedBindingPaths.length,
      includeArchived: true
    };
    const importAuditMetadata = { ...importBody.item };
    const exportAuditSummary = catalogAuditSummaryFor(
      auditBody.items,
      "debug-node-catalog-export",
      exportResponse.headers()["x-request-id"],
      exportAuditMetadata,
      exportedBindingPaths
    );
    const importAuditSummary = catalogAuditSummaryFor(
      auditBody.items,
      "debug-node-catalog-import",
      importResponse.headers()["x-request-id"],
      importAuditMetadata,
      importDocument.nodes.flatMap((node) => node.bindings.map((binding) => binding.nodePath))
    );
    expect(auditBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "debug-node-admin-create", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-node-admin-update", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-node-binding-admin-upsert", targetId: `${created!.id}:hdc` }),
        expect.objectContaining({ kind: "debug-node-binding-admin-upsert", targetId: `${created!.id}:adb` }),
        expect.objectContaining({ kind: "debug-node-binding-admin-archive", targetId: `${created!.id}:adb` }),
        expect.objectContaining({
          kind: "debug-node-catalog-export",
          targetId: "org-chargelab",
          traceId: exportResponse.headers()["x-request-id"]
        }),
        expect.objectContaining({
          kind: "debug-node-catalog-import",
          targetId: "org-chargelab",
          traceId: importResponse.headers()["x-request-id"]
        })
      ])
    );

    await recordOperationEvidence({
      operationId: "DEBUG-ADMIN-001",
      title: "debugging admin catalog crud hdc adb governance",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(exportResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/catalog/export?includeArchived=true",
          responseSummary: `exported node catalog contains ${exportedCatalog.nodes.length} nodes`
        }),
        summarizeApiResponse(importResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: `node catalog import updated ${importBody.item.nodesUpdated} node and upserted ${importBody.item.bindingsUpserted} bindings`
        }),
        summarizeApiResponse(listResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/nodes?includeArchived=true",
          responseSummary: `created item found with bindings=${created!.bindings.length}`
        }),
        summarizeApiResponse(bindingResponse, {
          method: "POST",
          path: `/api/v1/debugging/admin/nodes/${created!.id}/bindings/adb/archive`,
          responseSummary: "ADB binding archived through admin API"
        }),
        summarizeApiResponse(restoreResponse, {
          method: "PATCH",
          path: `/api/v1/debugging/admin/nodes/${created!.id}`,
          responseSummary: "Node re-enabled through admin API after row disable"
        }),
        summarizeApiResponse(finalListResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/nodes?includeArchived=true",
          responseSummary: "restored item remained in admin catalog"
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events?app=debugging",
          responseSummary: `debugging admin audit events=${auditBody.items.length}`
        })
      ],
      db: [await debuggingAdminDbSummary(editedName)],
      audit: [
        auditSummaryFor(auditBody.items, "debug-node-admin-create", created!.id),
        auditSummaryFor(auditBody.items, "debug-node-admin-update", created!.id),
        auditSummaryFor(auditBody.items, "debug-node-binding-admin-archive", `${created!.id}:adb`),
        exportAuditSummary,
        importAuditSummary
      ],
      notes: "Admin UI created and edited a logical debug node, exported the real node catalog, imported a derived one-node document, verified exact count metadata and absence of raw node paths for both catalog audit events, configured HDC/ADB paths, archived the ADB binding, disabled the node, and re-enabled it through the node Admin API. No HDC device claim is made."
    });
  });
});
