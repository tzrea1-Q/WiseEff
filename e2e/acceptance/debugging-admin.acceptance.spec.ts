import "./helpers/loadAcceptanceEnvironment";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "playwright/test";
import type { Client } from "pg";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { withPgClient } from "./helpers/database";
import { authHeadersForUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { CATALOG_VIEWPORTS, assertNoPageOverflow, catalogScreenshot } from "./helpers/catalogBrowser";
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

type ExportCatalogDocument = {
  format: string;
  source: { organizationId?: string; organizationName?: string; exportedAt?: string };
  counts: { modules: number; nodes: number; bindings: number };
  modules: Array<{ name: string; parentNamePath: string[]; description?: string; scope?: string; sortOrder?: number }>;
  nodes: Array<{
    sourceId?: string;
    name: string;
    description?: string;
    detailedDescription?: string;
    moduleNamePath: string[];
    enabled?: boolean;
    archived?: boolean;
    bindings: Array<{
      protocol: string;
      nodePath: string;
      accessMode: string;
      enabled?: boolean;
      notes?: string | null;
    }>;
  }>;
};

type CatalogImportPreviewDto = {
  canSubmit: boolean;
  previewDigest: string | null;
  format: string;
  sourceOrganization: { organizationId?: string; organizationName?: string } | null;
  targetOrganizationId: string;
  fileCounts: { modules: number; nodes: number; bindings: number };
  declaredCounts: { modules: number; nodes: number; bindings: number } | null;
  modules: { created: number; updated: number; unchanged: number };
  nodes: { created: number; updated: number; unchanged: number };
  bindings: { created: number; updated: number; unchanged: number };
  details: Array<{ path: string; name: string; object: string; classification: string; fields: unknown[] }>;
  detailsTruncated: boolean;
  conflicts: Array<{ code: string; location: string; message: string }>;
  warnings: Array<{ code: string; location: string; message: string }>;
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
  const operations = await client.query<{ id: string; snapshot_id: string | null }>(
    "select id, snapshot_id from node_operations where node_id = any($1::text[])",
    [nodeIds]
  );
  const operationIds = operations.rows.map((operation) => operation.id);
  const snapshotIds = operations.rows.flatMap((operation) => operation.snapshot_id ? [operation.snapshot_id] : []);
  if (operationIds.length > 0) {
    await client.query("delete from debugging_events where operation_id = any($1::text[])", [operationIds]);
    await client.query("update node_operations set snapshot_id = null where id = any($1::text[])", [operationIds]);
    await client.query(
      `delete from debugging_snapshots s
       where (s.operation_id = any($1::text[]) or s.id = any($2::text[]))
         and not exists (select 1 from node_operations other where other.snapshot_id = s.id)`,
      [operationIds, snapshotIds]
    );
    await client.query("update debugging_snapshots set operation_id = null where operation_id = any($1::text[])", [operationIds]);
    await client.query("delete from node_operations where id = any($1::text[])", [operationIds]);
  }
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

  // In API mode the bindings dialog's footer action is 关闭 (the icon close button is
  // aria-labelled "关闭协议节点绑定", so match the exact footer label).
  await bindingsDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(bindingsDialog).not.toBeVisible({ timeout: 30_000 });
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
    await page.getByRole("button", { name: "导出全部节点" }).click();
    const [exportResponse, download] = await Promise.all([exportResponsePromise, downloadPromise]);
    expect(exportResponse.ok()).toBe(true);
    const exportBody = (await exportResponse.json()) as {
      item: {
        document: ExportCatalogDocument;
        counts: { modules: number; nodes: number; bindings: number };
        organizationId: string;
        fileBytes: number;
      };
    };
    expect(exportBody.item.organizationId).toBe("org-chargelab");
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exportedCatalog = JSON.parse(await readFile(downloadPath!, "utf8")) as ExportCatalogDocument;
    // The downloaded file is the same document the API returned, and its declared counts
    // match the objects it contains.
    expect(exportedCatalog.format).toBe("wiseeff.debug-node-catalog.v2");
    expect(exportedCatalog.counts).toEqual(exportBody.item.counts);
    expect(exportedCatalog.counts.modules).toBe(exportedCatalog.modules.length);
    expect(exportedCatalog.counts.nodes).toBe(exportedCatalog.nodes.length);
    expect(exportedCatalog.counts.bindings).toBe(
      exportedCatalog.nodes.reduce((total, node) => total + node.bindings.length, 0)
    );
    const exportedNode = exportedCatalog.nodes.find((node) => node.name === editedName);
    expect(exportedNode).toBeTruthy();
    expect(exportedNode!.moduleNamePath).toEqual(["Battery Charging"]);
    expect(exportedNode!.sourceId).toBeTruthy();
    expect(exportedNode!.bindings.map((binding) => binding.protocol).sort()).toEqual(["adb", "hdc"]);

    const importedDescription = `Imported acceptance node ${suffix}`;
    // Upload the file the admin actually downloaded, with one field changed, so the merge
    // classifies five unchanged nodes plus the edited one against the real target.
    const importDocument: ExportCatalogDocument = {
      ...exportedCatalog,
      nodes: exportedCatalog.nodes.map((node) =>
        node.sourceId === exportedNode!.sourceId ? { ...node, description: importedDescription } : node
      )
    };
    const previewResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/api/v1/debugging/admin/catalog/import-preview")
    );
    await page.getByLabel("导入节点文件").setInputFiles({
      name: "debug-node-catalog.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(importDocument))
    });
    const previewResponse = await previewResponsePromise;
    expect(previewResponse.ok()).toBe(true);
    const previewBody = (await previewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(previewBody.item.canSubmit).toBe(true);
    expect(previewBody.item.previewDigest).toBeTruthy();
    expect(previewBody.item.nodes).toEqual({ created: 0, updated: 1, unchanged: exportedCatalog.counts.nodes - 1 });
    expect(previewBody.item.modules).toEqual({ created: 0, updated: 0, unchanged: exportedCatalog.counts.modules });
    expect(previewBody.item.sourceOrganization?.organizationId).toBe("org-chargelab");

    const importDialog = page.getByRole("dialog", { name: "导入预览" });
    await expect(importDialog).toBeVisible({ timeout: 30_000 });
    await expect(importDialog.getByText("org-chargelab")).toBeVisible();
    await expect(importDialog.getByText(/节点：.*更新 1/)).toBeVisible();

    const importResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().includes("/api/v1/debugging/admin/catalog/import")
    );
    await importDialog.getByRole("button", { name: "确认导入" }).click();
    const importResponse = await importResponsePromise;
    expect(importResponse.ok()).toBe(true);
    const importBody = (await importResponse.json()) as {
      item: {
        modulesCreated: number;
        modulesUpdated: number;
        modulesUnchanged: number;
        nodesCreated: number;
        nodesUpdated: number;
        nodesUnchanged: number;
        bindingsCreated: number;
        bindingsUpdated: number;
        bindingsUnchanged: number;
      };
    };
    // The merge matches every node by source id: one node is updated, the rest are
    // unchanged, and no binding changes because the file carries the exported bindings.
    expect(importBody.item).toEqual({
      modulesCreated: 0,
      modulesUpdated: 0,
      modulesUnchanged: exportedCatalog.counts.modules,
      nodesCreated: 0,
      nodesUpdated: 1,
      nodesUnchanged: exportedCatalog.counts.nodes - 1,
      bindingsCreated: 0,
      bindingsUpdated: 0,
      bindingsUnchanged: exportedCatalog.counts.bindings
    });
    await expect(importDialog).not.toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("toolbar", { name: "调试管理后台页面操作" }).getByText(/^已导入：/)
    ).toBeVisible({ timeout: 30_000 });

    // Re-read the persisted state and re-export: the file now round-trips as unchanged.
    const reExportResponse = await page.request.get(
      apiRoute("/api/v1/debugging/admin/catalog/export?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    expect(reExportResponse.ok()).toBe(true);
    const reExportBody = (await reExportResponse.json()) as { item: { document: ExportCatalogDocument } };
    expect(reExportBody.item.document.nodes.find((node) => node.name === editedName)?.description).toBe(
      importedDescription
    );
    const rePreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: reExportBody.item.document }
    );
    expect(rePreviewResponse.ok()).toBe(true);
    const rePreviewBody = (await rePreviewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(rePreviewBody.item.canSubmit).toBe(true);
    expect(rePreviewBody.item.nodes.updated).toBe(0);
    expect(rePreviewBody.item.nodes.created).toBe(0);

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

    const restoredDbSummary = await debuggingAdminDbSummary(editedName);
    const protectedNodeName = `${acceptanceNodeNamePrefix} protected ${suffix}`;
    const protectedCreateResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/nodes"), {
      headers: smokeHeaders(),
      data: { name: protectedNodeName, module: "Battery", enabled: true }
    });
    expect(protectedCreateResponse.status()).toBe(201);
    const protectedCreateBody = (await protectedCreateResponse.json()) as { item: AdminNodeDto };
    const protectedNode = protectedCreateBody.item;

    const operationId = `acceptance-delete-history-${suffix}`;
    const snapshotId = `acceptance-delete-snapshot-${suffix}`;
    const eventId = `acceptance-delete-event-${suffix}`;
    await withPgClient(async (client) => {
      await client.query(
        `insert into debug_node_bindings (
           id, organization_id, node_id, protocol, node_path, access_mode, enabled
         ) values ($1, 'org-chargelab', $2, 'hdc', '/sys/acceptance/delete-protection', 'RO', true)`,
        [`${protectedNode.id}:hdc`, protectedNode.id]
      );
      // A fresh acceptance database has no debugging session, so this fixture owns one:
      // device and actor are resolved from the seeded rows the session FKs require.
      const actor = await client.query<{ id: string }>(
        "select id from users where organization_id = 'org-chargelab' order by id limit 1"
      );
      expect(actor.rowCount).toBe(1);
      const device = await client.query<{ id: string }>(
        "select id from debugging_devices where organization_id = 'org-chargelab' order by id limit 1"
      );
      if (device.rowCount === 0) {
        await client.query(
          `insert into debugging_devices (id, organization_id, name, transport, status, firmware)
           values ($1, 'org-chargelab', 'Acceptance delete device', 'simulator', 'online', 'test')
           on conflict (id) do nothing`,
          [`acceptance-delete-device-${suffix}`]
        );
      }
      const deviceId =
        device.rows[0]?.id ?? `acceptance-delete-device-${suffix}`;
      await client.query(
        `insert into debugging_targets (id, organization_id, device_id, target_ref, label, status)
         values ($1, 'org-chargelab', $2, $3, 'Acceptance delete target', 'detected')
         on conflict (id) do nothing`,
        [`acceptance-delete-target-${suffix}`, deviceId, `simulator://acceptance-delete/${suffix}`]
      );
      const session = await client.query<{ id: string; actor_user_id: string }>(
        `insert into debugging_sessions (id, organization_id, device_id, target_id, actor_user_id, status)
         values ($1, 'org-chargelab', $2, $3, $4, 'active')
         on conflict (id) do update set status = 'active'
         returning id, actor_user_id`,
        [
          `acceptance-delete-session-${suffix}`,
          deviceId,
          `acceptance-delete-target-${suffix}`,
          actor.rows[0]!.id
        ]
      );
      expect(session.rowCount).toBe(1);
      await client.query(
        `insert into node_operations (
           id, organization_id, session_id, node_id, protocol, node_path, operation_type, status, actor_user_id
         ) values ($1, 'org-chargelab', $2, $3, 'hdc', '/sys/acceptance/delete-protection', 'read', 'failed', $4)`,
        [operationId, session.rows[0].id, protectedNode.id, session.rows[0].actor_user_id]
      );
      await client.query(
        `insert into debugging_snapshots (
           id, organization_id, session_id, operation_id, status, risk, entries, created_by_user_id
         ) values ($1, 'org-chargelab', $2, $3, 'valid', 'Medium', '[]'::jsonb, $4)`,
        [snapshotId, session.rows[0].id, operationId, session.rows[0].actor_user_id]
      );
      await client.query("update node_operations set snapshot_id = $1 where id = $2", [snapshotId, operationId]);
      await client.query(
        `insert into debugging_events (
           id, organization_id, session_id, operation_id, kind, severity, message, metadata
         ) values ($1, 'org-chargelab', $2, $3, 'node-delete-history', 'Info', 'acceptance history', '{}'::jsonb)`,
        [eventId, session.rows[0].id, operationId]
      );
    });

    const protectedDeleteResponse = await page.request.delete(
      apiRoute(`/api/v1/debugging/admin/nodes/${encodeURIComponent(protectedNode.id)}`),
      { headers: smokeHeaders() }
    );
    expect(protectedDeleteResponse.status()).toBe(204);

    const protectedNodeDbSummary = await withPgClient(async (client) => {
      const result = await client.query<{
        node_count: string;
        binding_count: string;
        operation_count: string;
        snapshot_count: string;
        event_count: string;
        delete_audit_count: string;
      }>(
        `
        select
          (select count(*)::text from debug_nodes where id = $1) as node_count,
          (select count(*)::text from debug_node_bindings where node_id = $1) as binding_count,
          (select count(*)::text from node_operations where id = $2) as operation_count,
          (select count(*)::text from debugging_snapshots where id = $3) as snapshot_count,
          (select count(*)::text from debugging_events where id = $4) as event_count,
          (select count(*)::text from audit_events where target_id = $1 and kind = 'debug-node-admin-delete') as delete_audit_count
        `,
        [protectedNode.id, operationId, snapshotId, eventId]
      );
      expect(result.rows[0]).toEqual({
        node_count: "0",
        binding_count: "0",
        operation_count: "0",
        snapshot_count: "0",
        event_count: "0",
        delete_audit_count: "1"
      });
      return {
        table: "debug_nodes/debug_node_bindings/node_operations/debugging_snapshots/debugging_events/audit_events",
        predicate: `node_id=${protectedNode.id}`,
        observed: "historical node, binding, operation, snapshot, and event were removed; one delete audit was written",
        rowCount: result.rowCount ?? result.rows.length
      };
    });

    const deleteResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "DELETE" && response.url().includes(`/api/v1/debugging/admin/nodes/${encodeURIComponent(created!.id)}`)
    );
    await page.reload();
    await expect(nodeRow(page, editedName)).toBeVisible({ timeout: 30_000 });
    const nodeKpi = page.locator(".kpi-item").filter({ hasText: "可调节点" });
    const nodeCountBeforeDelete = Number(await nodeKpi.locator(".kpi-value").innerText());
    await nodeRow(page, editedName).getByRole("button", { name: `删除 ${editedName}` }).click();
    const deleteDialog = page.getByRole("dialog", { name: /永久删除节点/ });
    await expect(deleteDialog.getByText(/不可恢复/)).toBeVisible();
    await deleteDialog.getByRole("button", { name: "删除节点" }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(204);
    await expect(nodeRow(page, editedName)).toHaveCount(0);
    await expect(nodeKpi.locator(".kpi-value")).toHaveText(String(nodeCountBeforeDelete - 1));

    const postDeleteListResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(postDeleteListResponse.ok()).toBe(true);
    const postDeleteListBody = (await postDeleteListResponse.json()) as { items: AdminNodeDto[] };
    expect(postDeleteListBody.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created!.id, name: editedName })])
    );

    const postDeleteRuntimeResponse = await page.request.get(apiRoute("/api/v1/debugging/nodes?protocol=hdc"), {
      headers: smokeHeaders()
    });
    expect(postDeleteRuntimeResponse.ok()).toBe(true);
    const postDeleteRuntimeBody = (await postDeleteRuntimeResponse.json()) as { items: Array<{ id: string }> };
    expect(postDeleteRuntimeBody.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created!.id })]));

    const postDeleteExportResponse = await page.request.get(apiRoute("/api/v1/debugging/admin/catalog/export?includeArchived=true"), {
      headers: smokeHeaders()
    });
    expect(postDeleteExportResponse.ok()).toBe(true);
    const postDeleteExportBody = (await postDeleteExportResponse.json()) as {
      item: { nodes: Array<{ id?: string; name: string }> };
    };
    expect(postDeleteExportBody.item.nodes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created!.id, name: editedName })])
    );

    const deletedNodeDbSummary = await withPgClient(async (client) => {
      const result = await client.query<{ binding_count: string }>(
        "select count(*)::text as binding_count from debug_node_bindings where node_id = $1",
        [created!.id]
      );
      expect(result.rows[0]?.binding_count).toBe("0");
      return {
        table: "debug_node_bindings",
        predicate: `node_id=${created!.id}`,
        observed: `bindingCount=${result.rows[0]?.binding_count ?? "unknown"}`,
        rowCount: result.rowCount ?? result.rows.length
      };
    });

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events?app=debugging&limit=100"), {
      headers: smokeHeaders()
    });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: AuditEventDto[] };
    const deleteRequestId = deleteResponse.headers()["x-request-id"];
    const deleteAuditEvents = auditBody.items.filter(
      (item) => item.kind === "debug-node-admin-delete" && item.targetId === created!.id
    );
    expect(deleteAuditEvents).toHaveLength(1);
    expect(deleteAuditEvents[0]).toMatchObject({
      traceId: deleteRequestId,
      metadata: { nodeId: created!.id, name: editedName, bindingCount: 2, operationCount: 0 }
    });
    const historicalDeleteRequestId = protectedDeleteResponse.headers()["x-request-id"];
    const historicalDeleteAuditEvents = auditBody.items.filter(
      (item) => item.kind === "debug-node-admin-delete" && item.targetId === protectedNode.id
    );
    expect(historicalDeleteAuditEvents).toHaveLength(1);
    expect(historicalDeleteAuditEvents[0]).toMatchObject({
      traceId: historicalDeleteRequestId,
      metadata: {
        nodeId: protectedNode.id,
        name: protectedNodeName,
        bindingCount: 1,
        operationCount: 1
      }
    });
    const serializedDeleteMetadata = JSON.stringify(deleteAuditEvents[0]?.metadata ?? {});
    expect(serializedDeleteMetadata).not.toContain(`/tmp/wiseeff/acceptance/${suffix}/hdc`);
    expect(serializedDeleteMetadata).not.toContain(`/tmp/wiseeff/acceptance/${suffix}/adb`);
    expect(JSON.stringify(historicalDeleteAuditEvents[0]?.metadata ?? {})).not.toContain("/sys/acceptance/delete-protection");
    const exportedBindingPaths = exportedCatalog.nodes.flatMap((node) => node.bindings.map((binding) => binding.nodePath));
    const exportAuditMetadata = {
      format: "wiseeff.debug-node-catalog.v2",
      moduleCount: exportedCatalog.modules.length,
      nodeCount: exportedCatalog.nodes.length,
      bindingCount: exportedBindingPaths.length,
      fileBytes: exportBody.item.fileBytes
    };
    const importAuditMetadata = {
      format: "wiseeff.debug-node-catalog.v2",
      fileBytes: expect.any(Number),
      modulesCreated: importBody.item.modulesCreated,
      modulesUpdated: importBody.item.modulesUpdated,
      modulesUnchanged: importBody.item.modulesUnchanged,
      nodesCreated: importBody.item.nodesCreated,
      nodesUpdated: importBody.item.nodesUpdated,
      nodesUnchanged: importBody.item.nodesUnchanged,
      bindingsCreated: importBody.item.bindingsCreated,
      bindingsUpdated: importBody.item.bindingsUpdated,
      bindingsUnchanged: importBody.item.bindingsUnchanged,
      previewDigest: expect.any(String)
    };
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
        expect.objectContaining({ kind: "debug-node-admin-delete", targetId: created!.id }),
        expect.objectContaining({ kind: "debug-node-admin-delete", targetId: protectedNode.id }),
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
          responseSummary: `exported full node catalog with ${exportedCatalog.counts.nodes} nodes, ${exportedCatalog.counts.modules} modules and ${exportedCatalog.counts.bindings} bindings`
        }),
        summarizeApiResponse(previewResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: `preview classified ${JSON.stringify(previewBody.item.nodes)} nodes with canSubmit=${previewBody.item.canSubmit}`
        }),
        summarizeApiResponse(importResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: `node catalog import created ${importBody.item.nodesCreated}, updated ${importBody.item.nodesUpdated}, left ${importBody.item.nodesUnchanged} nodes unchanged`
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
        summarizeApiResponse(deleteResponse, {
          method: "DELETE",
          path: `/api/v1/debugging/admin/nodes/${created!.id}`,
          responseSummary: "unreferenced node was permanently deleted with HTTP 204"
        }),
        summarizeApiResponse(postDeleteListResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/nodes?includeArchived=true",
          responseSummary: "deleted node is absent from the subsequent admin catalog"
        }),
        summarizeApiResponse(postDeleteRuntimeResponse, {
          method: "GET",
          path: "/api/v1/debugging/nodes?protocol=hdc",
          responseSummary: "deleted node is absent from the runtime HDC list"
        }),
        summarizeApiResponse(postDeleteExportResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/catalog/export?includeArchived=true",
          responseSummary: "deleted node is absent from a future catalog export"
        }),
        summarizeApiResponse(protectedDeleteResponse, {
          method: "DELETE",
          path: `/api/v1/debugging/admin/nodes/${protectedNode.id}`,
          responseSummary: "node, binding, and one operation-history row were deleted with HTTP 204"
        }),
        summarizeApiResponse(auditResponse, {
          method: "GET",
          path: "/api/v1/audit-events?app=debugging",
          responseSummary: `debugging admin audit events=${auditBody.items.length}`
        })
      ],
      db: [restoredDbSummary, protectedNodeDbSummary, deletedNodeDbSummary],
      audit: [
        auditSummaryFor(auditBody.items, "debug-node-admin-create", created!.id),
        auditSummaryFor(auditBody.items, "debug-node-admin-update", created!.id),
        auditSummaryFor(auditBody.items, "debug-node-admin-delete", created!.id, deleteRequestId),
        auditSummaryFor(auditBody.items, "debug-node-admin-delete", protectedNode.id, historicalDeleteRequestId),
        auditSummaryFor(auditBody.items, "debug-node-binding-admin-archive", `${created!.id}:adb`),
        exportAuditSummary,
        importAuditSummary
      ],
      notes: "Admin UI created and edited a logical debug node, downloaded the complete v2 node catalog, uploaded the downloaded file, previewed the classified merge in the dialog, confirmed the merge, re-read the persisted node through the API and re-exported the catalog to prove the file round-trips as unchanged. Verified exact count metadata and absence of raw node paths for catalog and node-delete audit events, configured HDC/ADB paths, archived the ADB binding, disabled and re-enabled the node, and permanently deleted both unreferenced and historical nodes with binding/operation cascades. No HDC device claim is made."
    });
  });
});

/**
 * Issue #846: complete node-catalog transfer at the file/API/database boundary.
 *
 * These cases exercise the same public HTTP API the UI calls, against real PostgreSQL, and
 * re-read persisted rows afterwards. They cover the capacity the former 500-module /
 * 2,000-node import caps rejected, the preview digest guard, permissions, and rollback.
 */
const catalogTransferPrefix = "Acceptance catalog transfer";

async function cleanupCatalogTransferRows(client: Client) {
  const modules = await client.query<{ id: string }>(
    "select id from debug_node_modules where organization_id = 'org-chargelab' and name like $1",
    [`${catalogTransferPrefix}%`]
  );
  const moduleIds = modules.rows.map((row) => row.id);
  const nodes = await client.query<{ id: string }>(
    "select id from debug_nodes where organization_id = 'org-chargelab' and name like $1",
    [`${catalogTransferPrefix}%`]
  );
  const nodeIds = nodes.rows.map((row) => row.id);

  if (nodeIds.length > 0) {
    await client.query("delete from debug_node_bindings where node_id = any($1::text[])", [nodeIds]);
    await client.query("delete from debug_nodes where id = any($1::text[])", [nodeIds]);
  }
  if (moduleIds.length > 0) {
    await client.query(
      "update debug_nodes set debug_node_module_id = null where debug_node_module_id = any($1::text[])",
      [moduleIds]
    );
    await client.query("delete from debug_node_modules where id = any($1::text[]) and parent_id is null", [moduleIds]);
    await client.query("delete from debug_node_modules where id = any($1::text[])", [moduleIds]);
  }
}

/**
 * Writes the target state directly through SQL so the capacity case can create 501 modules
 * and 2,001 nodes without 2,502 round trips. Export, preview and import still run through
 * the real HTTP API on top of these rows.
 */
async function seedCatalogTransferCapacityRows() {
  return withPgClient(async (client) => {
    await cleanupCatalogTransferRows(client);
    const moduleIds: string[] = [];
    for (let index = 0; index < 501; index += 1) {
      const id = `acceptance-transfer-module-${index}`;
      moduleIds.push(id);
      await client.query(
        `insert into debug_node_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
         values ($1, 'org-chargelab', null, $2, $1, 1, $3, $4, 'transfer')`,
        [id, `${catalogTransferPrefix} module ${String(index).padStart(3, "0")}`, index, "capacity"]
      );
    }

    const nodeIds: string[] = [];
    for (let index = 0; index < 2001; index += 1) {
      const id = `acceptance-transfer-node-${index}`;
      const moduleId = moduleIds[index % moduleIds.length];
      nodeIds.push(id);
      await client.query(
        `insert into debug_nodes (
           id, organization_id, name, description, detailed_description,
           write_format_example, write_format_hint, module, debug_node_module_id,
           value_kind, value_format, normalization_mode, max_value_bytes, enabled, archived_at, archive_reason
         ) values ($1, 'org-chargelab', $2, $3, '', '', '', $4, $5, 'scalar', 'raw', 'trim', null, $6, $7, $8)`,
        [
          id,
          `${catalogTransferPrefix} node ${String(index).padStart(4, "0")}`,
          `capacity node ${index}`,
          `${catalogTransferPrefix} module ${String(index % moduleIds.length).padStart(3, "0")}`,
          moduleId,
          index % 3 !== 0,
          index % 100 === 0 ? new Date().toISOString() : null,
          index % 100 === 0 ? "capacity fixture" : null
        ]
      );
      if (index % 4 !== 0) {
        const protocol = index % 2 === 0 ? "hdc" : "adb";
        await client.query(
          `insert into debug_node_bindings (id, organization_id, node_id, protocol, node_path, access_mode, enabled, notes)
           values ($1, 'org-chargelab', $2, $3, $4, $5, $6, null)`,
          [
            `${id}:${protocol}`,
            id,
            protocol,
            `/sys/acceptance/transfer/${index}`,
            index % 8 === 0 ? "RO" : "RW",
            index % 5 !== 0
          ]
        );
      }
    }
    return { moduleIds, nodeIds };
  });
}

test.describe("DEBUG-ADMIN-846 full catalog transfer", () => {
  test.beforeAll(async () => {
    await prepareDebuggingAdminAcceptanceState();
    await withPgClient(async (client) => {
      await cleanupCatalogTransferRows(client);
    });
  });

  test.afterAll(async () => {
    await withPgClient(async (client) => {
      await cleanupCatalogTransferRows(client);
    });
  });

  test("transfers 2,001 nodes and 501 modules through export, preview and atomic import", async ({ page }, testInfo) => {
    // @acceptance DEBUG-ADMIN-846-CAPACITY
    // @operation DEBUG-ADMIN-846-CAPACITY
    test.setTimeout(240_000);
    const seeded = await seedCatalogTransferCapacityRows();
    const isCapacityNode = (name: string) => name.startsWith(`${catalogTransferPrefix} node `);
    const isCapacityModule = (path: string[]) =>
      path.length === 1 && path[0].startsWith(`${catalogTransferPrefix} module `);

    // 1. Export the complete catalog through the real API.
    const exportResponse = await page.request.get(
      apiRoute("/api/v1/debugging/admin/catalog/export?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    expect(exportResponse.ok()).toBe(true);
    const exported = (await exportResponse.json()) as {
      item: { document: ExportCatalogDocument; counts: { modules: number; nodes: number; bindings: number } };
    };
    const document = exported.item.document;
    const capacityNodes = document.nodes.filter((node) => isCapacityNode(node.name));
    const capacityModules = document.modules.filter((module) => isCapacityModule([module.name]));

    expect(document.format).toBe("wiseeff.debug-node-catalog.v2");
    expect(capacityNodes).toHaveLength(2001);
    expect(capacityModules).toHaveLength(501);
    expect(new Set(capacityNodes.map((node) => node.sourceId)).size).toBe(2001);
    expect(capacityNodes.every((node) => node.moduleNamePath.length === 1 && isCapacityModule(node.moduleNamePath))).toBe(true);
    expect(capacityNodes.some((node) => node.bindings.length === 0)).toBe(true);
    expect(capacityNodes.some((node) => node.bindings.some((binding) => binding.protocol === "hdc"))).toBe(true);
    expect(capacityNodes.some((node) => node.bindings.some((binding) => binding.protocol === "adb"))).toBe(true);
    expect(capacityNodes.some((node) => node.bindings.some((binding) => binding.enabled === false))).toBe(true);
    expect(capacityNodes.some((node) => node.archived === true)).toBe(true);
    expect(capacityNodes.some((node) => node.enabled === false)).toBe(true);
    // Declared counts and the actual object set agree for the whole exported catalog.
    expect(document.counts.nodes).toBe(document.nodes.length);
    expect(document.counts.modules).toBe(document.modules.length);
    expect(document.counts.bindings).toBe(
      document.nodes.reduce((total, node) => total + node.bindings.length, 0)
    );

    // Scope the transfer to this fixture's objects so unrelated development rows in the
    // shared acceptance database cannot make the expected counts ambiguous.
    const capacityDocument: ExportCatalogDocument = {
      ...document,
      source: { organizationId: "org-chargelab", organizationName: "ChargeLab" },
      counts: {
        modules: capacityModules.length,
        nodes: capacityNodes.length,
        bindings: capacityNodes.reduce((total, node) => total + node.bindings.length, 0)
      },
      modules: capacityModules,
      nodes: capacityNodes
    };

    // 2. The exported file previews as unchanged: export and import capacities now agree.
    const unchangedPreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: capacityDocument }
    );
    expect(unchangedPreviewResponse.status()).toBe(200);
    const unchangedPreview = (await unchangedPreviewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(unchangedPreview.item.conflicts).toEqual([]);
    expect(unchangedPreview.item.canSubmit).toBe(true);
    expect(unchangedPreview.item.fileCounts).toEqual(capacityDocument.counts);

    // 3. Clear the target rows and import the same file to prove creation at that capacity.
    await withPgClient(async (client) => {
      await client.query("delete from debug_node_bindings where node_id = any($1::text[])", [seeded.nodeIds]);
      await client.query("delete from debug_nodes where id = any($1::text[]) and organization_id = 'org-chargelab'", [seeded.nodeIds]);
      await client.query("delete from debug_node_modules where id = any($1::text[]) and organization_id = 'org-chargelab'", [seeded.moduleIds]);
    });

    const importPreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: capacityDocument }
    );
    expect(importPreviewResponse.status()).toBe(200);
    const importPreview = (await importPreviewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(importPreview.item.conflicts).toEqual([]);
    expect(importPreview.item.nodes).toMatchObject({ created: 2001, updated: 0 });
    expect(importPreview.item.modules).toMatchObject({ created: 501, updated: 0 });

    const importResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import"),
      {
        headers: smokeHeaders(),
        data: { document: capacityDocument, previewDigest: importPreview.item.previewDigest }
      }
    );
    expect(importResponse.ok()).toBe(true);
    const importBody = (await importResponse.json()) as {
      item: { modulesCreated: number; nodesCreated: number; bindingsCreated: number };
    };
    expect(importBody.item).toMatchObject({ modulesCreated: 501, nodesCreated: 2001 });

    // 4. Re-read persisted rows and re-export: the file round-trips as unchanged.
    const persisted = await withPgClient(async (client) => {
      const result = await client.query<{
        nodes: string;
        archived: string;
        untouched: string;
      }>(
        `select
           count(*)::text as nodes,
           count(*) filter (where archived_at is not null)::text as archived,
           count(*) filter (where debug_node_module_id is null)::text as untouched
         from debug_nodes
         where organization_id = 'org-chargelab' and name like $1`,
        [`${catalogTransferPrefix} node %`]
      );
      return result.rows[0]!;
    });
    expect(persisted.nodes).toBe("2001");
    expect(persisted.untouched).toBe("0");
    expect(Number(persisted.archived)).toBe(capacityNodes.filter((node) => node.archived).length);

    const reExportResponse = await page.request.get(
      apiRoute("/api/v1/debugging/admin/catalog/export?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    expect(reExportResponse.ok()).toBe(true);
    const reExported = (await reExportResponse.json()) as { item: { document: ExportCatalogDocument } };
    const reExportedTransferNodes = reExported.item.document.nodes.filter((node) => isCapacityNode(node.name));
    expect(reExportedTransferNodes).toHaveLength(2001);

    const semanticProjection = (nodes: ExportCatalogDocument["nodes"]) =>
      nodes
        .map((node) => ({
          name: node.name,
          moduleNamePath: node.moduleNamePath,
          enabled: node.enabled,
          archived: node.archived,
          bindings: [...node.bindings]
            .map((binding) => ({
              protocol: binding.protocol,
              nodePath: binding.nodePath,
              accessMode: binding.accessMode,
              enabled: binding.enabled
            }))
            .sort((left, right) => (left.protocol < right.protocol ? -1 : 1))
        }))
        .sort((left, right) => (left.name < right.name ? -1 : 1));
    expect(semanticProjection(reExportedTransferNodes)).toEqual(semanticProjection(capacityNodes));

    const stablePreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: capacityDocument }
    );
    expect(stablePreviewResponse.ok()).toBe(true);
    const stablePreview = (await stablePreviewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(stablePreview.item.nodes.updated).toBe(0);
    expect(stablePreview.item.nodes.created).toBe(0);

    const auditResponse = await page.request.get(apiRoute("/api/v1/audit-events?app=debugging&limit=50"), {
      headers: smokeHeaders()
    });
    expect(auditResponse.ok()).toBe(true);
    const auditBody = (await auditResponse.json()) as { items: AuditEventDto[] };
    const importAudit = auditBody.items.find(
      (item) => item.kind === "debug-node-catalog-import" && item.traceId === importResponse.headers()["x-request-id"]
    );
    expect(importAudit).toBeTruthy();
    expect(JSON.stringify(importAudit?.metadata ?? {})).not.toContain("/sys/acceptance/transfer/0");
    expect(JSON.stringify(importAudit?.metadata ?? {})).not.toContain(`${catalogTransferPrefix} node`);

    await recordOperationEvidence({
      operationId: "DEBUG-ADMIN-846-CAPACITY",
      title: "full catalog transfer at 2001 nodes / 501 modules",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(exportResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/catalog/export?includeArchived=true",
          responseSummary: `exported ${document.counts.nodes} nodes, ${document.counts.modules} modules, ${document.counts.bindings} bindings (${capacityNodes.length} capacity nodes)`
        }),
        summarizeApiResponse(importPreviewResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: `preview classified ${JSON.stringify(importPreview.item.nodes)} nodes / ${JSON.stringify(importPreview.item.modules)} modules`
        }),
        summarizeApiResponse(importResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: `created ${importBody.item.nodesCreated} nodes, ${importBody.item.modulesCreated} modules, ${importBody.item.bindingsCreated} bindings in one transaction`
        }),
        summarizeApiResponse(reExportResponse, {
          method: "GET",
          path: "/api/v1/debugging/admin/catalog/export?includeArchived=true",
          responseSummary: `re-export kept ${reExportedTransferNodes.length} capacity nodes with semantic parity`
        }),
        summarizeApiResponse(stablePreviewResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: `re-import preview created=${stablePreview.item.nodes.created} updated=${stablePreview.item.nodes.updated}`
        })
      ],
      db: [
        {
          table: "debug_nodes",
          predicate: `name like '${catalogTransferPrefix} node %'`,
          observed: `nodes=${persisted.nodes}; archived=${persisted.archived}; unassignedModules=${persisted.untouched}`,
          rowCount: Number(persisted.nodes)
        }
      ],
      audit: importAudit ? [auditSummaryFor(auditBody.items, "debug-node-catalog-import", "org-chargelab", importResponse.headers()["x-request-id"])] : [],
      notes:
        "Seeded 501 modules and 2,001 nodes (enabled, disabled, archived, unbound, HDC-only, ADB-only and disabled bindings) directly in PostgreSQL, exported them through the real API, verified declared counts match the object set, previewed the same file as unchanged, cleared the target rows, previewed and imported the same file through one transaction, then re-read the rows and re-exported. This proves export/import capacity symmetry past the former 500-module / 2,000-node caps. No device connection or device write is claimed."
    });
  });

  test("keeps the import preview usable at desktop, tablet and mobile widths", async ({ page }, testInfo) => {
    // @acceptance DEBUG-ADMIN-846-VIEWPORTS
    // @operation DEBUG-ADMIN-846-VIEWPORTS
    test.setTimeout(120_000);
    const suffix = Date.now().toString(36);
    const nodeName = `${catalogTransferPrefix} viewport node ${suffix}`;
    const moduleName = `${catalogTransferPrefix} viewport module ${suffix}`;

    await withPgClient(async (client) => {
      await cleanupCatalogTransferRows(client);
      const module = await client.query<{ id: string }>(
        `insert into debug_node_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
         values ($1, 'org-chargelab', null, $2, $1, 1, 0, '', '')
         returning id`,
        [`${catalogTransferPrefix}-viewport-${suffix}`, moduleName]
      );
      await client.query(
        `insert into debug_nodes (id, organization_id, name, description, module, debug_node_module_id)
         values ($1, 'org-chargelab', $2, 'viewport fixture', $3, $4)`,
        [`${catalogTransferPrefix}-viewport-node-${suffix}`, nodeName, moduleName, module.rows[0]!.id]
      );
      await client.query(
        `insert into debug_node_bindings (id, organization_id, node_id, protocol, node_path, access_mode, enabled)
         values ($1, 'org-chargelab', $2, 'hdc', $3, 'RW', true)`,
        [`${catalogTransferPrefix}-viewport-node-${suffix}:hdc`, `${catalogTransferPrefix}-viewport-node-${suffix}`, `/sys/acceptance/viewport/${suffix}`]
      );
    });

    const file = {
      format: "wiseeff.debug-node-catalog.v2",
      source: { organizationId: "org-source", organizationName: "Source Org" },
      counts: { modules: 1, nodes: 2, bindings: 2 },
      modules: [{ name: moduleName, parentNamePath: [] }],
      nodes: [
        {
          sourceId: `${catalogTransferPrefix}-viewport-node-${suffix}`,
          name: nodeName,
          moduleNamePath: [moduleName],
          description: "from file",
          bindings: [{ protocol: "hdc", nodePath: `/sys/acceptance/viewport/${suffix}`, accessMode: "RO", enabled: false }]
        },
        {
          name: `${catalogTransferPrefix} viewport new node ${suffix}`,
          moduleNamePath: [moduleName],
          bindings: [{ protocol: "adb", nodePath: `/sys/acceptance/viewport-adb/${suffix}`, accessMode: "RW", enabled: true }]
        }
      ]
    };

    for (const viewport of CATALOG_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/debugging-admin/nodes");
      await expect(page.getByRole("table", { name: "可调节点目录" })).toBeVisible({ timeout: 30_000 });
      await assertNoPageOverflow(page);

      await page.getByLabel("导入节点文件").setInputFiles({
        name: "debug-node-catalog.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(file))
      });
      const dialog = page.getByRole("dialog", { name: "导入预览" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      // The dialog card must settle before measuring: it enters with a fade animation.
      await page.waitForFunction(() => {
        const card = document.querySelector('[role="dialog"]');
        return Boolean(card) && getComputedStyle(card as Element).opacity === "1";
      });
      await assertNoPageOverflow(page);

      const geometry = await dialog.evaluate((card) => {
        const rect = card.getBoundingClientRect();
        const confirm = Array.from(card.querySelectorAll("button")).find((button) =>
          (button.textContent ?? "").includes("确认导入")
        );
        const confirmRect = confirm?.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          viewport: document.documentElement.clientWidth,
          confirmVisible: confirmRect ? confirmRect.width > 0 && confirmRect.height > 0 : false,
          confirmDisabled: confirm instanceof HTMLButtonElement ? confirm.disabled : true
        };
      });
      expect(geometry.left, `${viewport.name} dialog left edge`).toBeGreaterThanOrEqual(0);
      expect(geometry.right, `${viewport.name} dialog right edge`).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.confirmVisible, `${viewport.name} confirm action`).toBe(true);
      expect(geometry.confirmDisabled, `${viewport.name} confirm blocked for a stale binding`).toBe(false);

      const dialogText = await dialog.innerText();
      expect(dialogText, `${viewport.name} classification counts`).toContain("差异明细");
      if (!dialogText.includes("访问模式") || !dialogText.includes("启用状态")) {
        throw new Error(`${viewport.name}: binding access-mode/enabled differences are not surfaced`);
      }

      await catalogScreenshot(page, testInfo, `debug-846-import-preview-${viewport.name}`);
      await dialog.getByRole("button", { name: "取消" }).click();
      await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await recordOperationEvidence({
      operationId: "DEBUG-ADMIN-846-VIEWPORTS",
      title: "catalog import preview at three viewport sizes",
      status: "passed",
      page,
      testInfo,
      api: [],
      db: [],
      audit: [],
      notes:
        "Opened the real import preview dialog at 1440x900, 768x1024 and 390x844 against real PostgreSQL data. At each width the dialog stayed inside the viewport, the confirm action remained visible and enabled, the classification counts and the protocol-path/access-mode/enabled differences rendered, no page-level horizontal overflow appeared, cancelling closed the dialog, and the browser diagnostics recorder observed no console or page error. Screenshots are attached per viewport."
    });
  });

  test("guards preview digests, permissions and mid-import rollback", async ({ page }, testInfo) => {
    // @acceptance DEBUG-ADMIN-846-GUARD
    // @operation DEBUG-ADMIN-846-GUARD
    test.setTimeout(120_000);
    const suffix = Date.now().toString(36);
    const nodeName = `${catalogTransferPrefix} guard node ${suffix}`;
    const moduleName = `${catalogTransferPrefix} guard module ${suffix}`;

    await withPgClient(async (client) => {
      await cleanupCatalogTransferRows(client);
      const module = await client.query<{ id: string }>(
        `insert into debug_node_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
         values ($1, 'org-chargelab', null, $2, $1, 1, 0, '', '')
         returning id`,
        [`${catalogTransferPrefix}-guard-${suffix}`, moduleName]
      );
      await client.query(
        `insert into debug_nodes (id, organization_id, name, description, module, debug_node_module_id)
         values ($1, 'org-chargelab', $2, 'guard fixture', $3, $4)`,
        [`${catalogTransferPrefix}-guard-node-${suffix}`, nodeName, moduleName, module.rows[0]!.id]
      );
    });

    const file = {
      format: "wiseeff.debug-node-catalog.v2",
      source: { organizationId: "org-source", organizationName: "Source Org" },
      counts: { modules: 1, nodes: 2, bindings: 1 },
      modules: [{ name: moduleName, parentNamePath: [] }],
      nodes: [
        { sourceId: `${catalogTransferPrefix}-guard-node-${suffix}`, name: nodeName, moduleNamePath: [moduleName], description: "from file" },
        {
          name: `${catalogTransferPrefix} guard new node ${suffix}`,
          moduleNamePath: [moduleName],
          bindings: [{ protocol: "hdc", nodePath: `/sys/acceptance/guard/${suffix}`, accessMode: "RW", enabled: true }]
        }
      ]
    };

    const previewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: file }
    );
    expect(previewResponse.ok()).toBe(true);
    const preview = (await previewResponse.json()) as { item: CatalogImportPreviewDto };
    expect(preview.item.canSubmit).toBe(true);
    expect(preview.item.nodes).toEqual({ created: 1, updated: 1, unchanged: 0 });

    // A stale digest after the approved target changed must be rejected as CONFLICT/409.
    await withPgClient(async (client) => {
      await client.query("update debug_nodes set description = 'edited after preview' where id = $1", [
        `${catalogTransferPrefix}-guard-node-${suffix}`
      ]);
    });
    const staleResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import"), {
      headers: smokeHeaders(),
      data: { document: file, previewDigest: preview.item.previewDigest }
    });
    expect(staleResponse.status()).toBe(409);
    const staleBody = (await staleResponse.json()) as { error: { code: string; details: { reason?: string } } };
    expect(staleBody.error.code).toBe("CONFLICT");
    expect(staleBody.error.details.reason).toBe("stale-preview");

    // A raw document without a preview digest cannot bypass the preview requirement.
    const rawResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import"), {
      headers: smokeHeaders(),
      data: file
    });
    expect(rawResponse.status()).toBe(400);
    expect(((await rawResponse.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");

    // A read-only acceptance user cannot export, preview or import.
    // The local development resolver loads permissions from the users/roles tables, so the
    // read-only actor has to exist before its headers can prove a 403 (rather than 401).
    const guest = acceptanceCast.acceptanceGuest;
    await withPgClient(async (client) => {
      // The auth context joins user_role_bindings, so a bare user row authenticates as nobody.
      await client.query(
        `insert into users (id, organization_id, name, email, title, is_active)
         values ($1, 'org-chargelab', $2, $3, $4, true)
         on conflict (id) do update set is_active = true`,
        [guest.userId, guest.name, guest.email, guest.title]
      );
      await client.query(
        `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
         values ($1, $2, 'org-chargelab', null, 'guest')
         on conflict (id) do nothing`,
        [`acceptance-guest-binding-${suffix}`, guest.userId]
      );
    });
    const readOnlyHeaders = {
      ...authHeadersForUser(guest.userId, guest.email, guest.name),
      Accept: "application/json"
    } as Record<string, string>;
    const forbiddenExport = await page.request.get(
      apiRoute("/api/v1/debugging/admin/catalog/export?includeArchived=true"),
      { headers: readOnlyHeaders }
    );
    expect(forbiddenExport.status()).toBe(403);
    const forbiddenPreview = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import-preview"), {
      headers: readOnlyHeaders,
      data: file
    });
    expect(forbiddenPreview.status()).toBe(403);
    const forbiddenImport = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import"), {
      headers: readOnlyHeaders,
      data: { document: file, previewDigest: preview.item.previewDigest }
    });
    expect(forbiddenImport.status()).toBe(403);

    // A file above the 20 MiB contract is rejected with 413 and writes nothing.
    const oversized = {
      format: "wiseeff.debug-node-catalog.v2",
      source: {},
      counts: { modules: 0, nodes: 1, bindings: 0 },
      modules: [],
      nodes: [
        {
          name: `${catalogTransferPrefix} oversized node`,
          moduleNamePath: [],
          description: "电".repeat(Math.ceil((20 * 1024 * 1024) / 3) + 4096)
        }
      ]
    };
    const beforeOversized = await page.request.get(
      apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    const oversizedResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import-preview"), {
      headers: smokeHeaders(),
      data: oversized
    });
    expect(oversizedResponse.status()).toBe(413);
    const afterOversized = await page.request.get(
      apiRoute("/api/v1/debugging/admin/nodes?includeArchived=true"),
      { headers: smokeHeaders() }
    );
    const beforeBody = (await beforeOversized.json()) as { items: Array<{ id: string }> };
    const afterBody = (await afterOversized.json()) as { items: Array<{ id: string }> };
    expect(afterBody.items.map((item) => item.id)).toEqual(beforeBody.items.map((item) => item.id));

    // Mid-import failure: a transaction-visible trigger fails the second node's binding
    // write, and the earlier module/node inserts must roll back with it.
    const rollbackFile = {
      format: "wiseeff.debug-node-catalog.v2",
      source: {},
      counts: { modules: 1, nodes: 2, bindings: 1 },
      modules: [{ name: `${catalogTransferPrefix} rollback module ${suffix}`, parentNamePath: [] }],
      nodes: [
        { name: `${catalogTransferPrefix} rollback first ${suffix}`, moduleNamePath: [`${catalogTransferPrefix} rollback module ${suffix}`] },
        {
          name: `${catalogTransferPrefix} rollback second ${suffix}`,
          moduleNamePath: [`${catalogTransferPrefix} rollback module ${suffix}`],
          bindings: [
            {
              protocol: "hdc",
              nodePath: `/sys/acceptance/rollback/${suffix}`,
              accessMode: "RW",
              enabled: true
            }
          ]
        }
      ]
    };
    const rollbackPreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: rollbackFile }
    );
    expect(rollbackPreviewResponse.ok()).toBe(true);
    const rollbackPreview = (await rollbackPreviewResponse.json()) as { item: CatalogImportPreviewDto };

    await withPgClient(async (client) => {
      await client.query(
        `create or replace function wiseeff_acceptance_fail_binding() returns trigger as $$
         begin
           if new.node_path = '/sys/acceptance/rollback/${suffix}' then
             raise exception 'acceptance injected binding failure';
           end if;
           return new;
         end;
         $$ language plpgsql`
      );
      await client.query(
        "create trigger wiseeff_acceptance_fail_binding before insert on debug_node_bindings for each row execute function wiseeff_acceptance_fail_binding()"
      );
    });

    const rollbackImportResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import"), {
      headers: smokeHeaders(),
      data: { document: rollbackFile, previewDigest: rollbackPreview.item.previewDigest }
    });
    expect(rollbackImportResponse.status()).toBeGreaterThanOrEqual(500);

    await withPgClient(async (client) => {
      await client.query("drop trigger if exists wiseeff_acceptance_fail_binding on debug_node_bindings");
      await client.query("drop function if exists wiseeff_acceptance_fail_binding()");
    });

    const rollbackState = await withPgClient(async (client) => {
      const result = await client.query<{ modules: string; nodes: string; bindings: string; audits: string }>(
        `select
           (select count(*)::text from debug_node_modules where organization_id = 'org-chargelab' and name = $1) as modules,
           (select count(*)::text from debug_nodes where organization_id = 'org-chargelab' and name like $2) as nodes,
           (select count(*)::text from debug_node_bindings where organization_id = 'org-chargelab' and node_path = $3) as bindings,
           (select count(*)::text from audit_events where organization_id = 'org-chargelab' and kind = 'debug-node-catalog-import' and trace_id = $4) as audits`,
        [
          `${catalogTransferPrefix} rollback module ${suffix}`,
          `${catalogTransferPrefix} rollback %`,
          `/sys/acceptance/rollback/${suffix}`,
          rollbackImportResponse.headers()["x-request-id"]
        ]
      );
      return result.rows[0]!;
    });
    expect(rollbackState).toEqual({ modules: "0", nodes: "0", bindings: "0", audits: "0" });

    // The approved, unchanged import still applies after the failed attempt.
    const finalPreviewResponse = await page.request.post(
      apiRoute("/api/v1/debugging/admin/catalog/import-preview"),
      { headers: smokeHeaders(), data: rollbackFile }
    );
    expect(finalPreviewResponse.ok()).toBe(true);
    const finalPreview = (await finalPreviewResponse.json()) as { item: CatalogImportPreviewDto };
    const finalImportResponse = await page.request.post(apiRoute("/api/v1/debugging/admin/catalog/import"), {
      headers: smokeHeaders(),
      data: { document: rollbackFile, previewDigest: finalPreview.item.previewDigest }
    });
    expect(finalImportResponse.ok()).toBe(true);
    const finalImportBody = (await finalImportResponse.json()) as {
      item: { modulesCreated: number; nodesCreated: number; bindingsCreated: number };
    };
    expect(finalImportBody.item).toMatchObject({ modulesCreated: 1, nodesCreated: 2, bindingsCreated: 1 });

    const finalState = await withPgClient(async (client) => {
      const result = await client.query<{ nodes: string; bindings: string }>(
        `select
           (select count(*)::text from debug_nodes where organization_id = 'org-chargelab' and name like $1) as nodes,
           (select count(*)::text from debug_node_bindings where organization_id = 'org-chargelab' and node_path = $2) as bindings`,
        [`${catalogTransferPrefix} rollback %`, `/sys/acceptance/rollback/${suffix}`]
      );
      return result.rows[0]!;
    });
    expect(finalState).toEqual({ nodes: "2", bindings: "1" });

    await recordOperationEvidence({
      operationId: "DEBUG-ADMIN-846-GUARD",
      title: "catalog transfer preview digest, permissions, capacity limit and rollback guards",
      status: "passed",
      page,
      testInfo,
      api: [
        summarizeApiResponse(previewResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: `classified ${JSON.stringify(preview.item.nodes)} with digest accepted`
        }),
        summarizeApiResponse(staleResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: "stale digest rejected with HTTP 409 CONFLICT/stale-preview"
        }),
        summarizeApiResponse(rawResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: "raw document without preview digest rejected with HTTP 400"
        }),
        summarizeApiResponse(forbiddenPreview, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: "non-admin denied with HTTP 403"
        }),
        summarizeApiResponse(oversizedResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import-preview",
          responseSummary: "document above 20 MiB rejected with HTTP 413 and no writes"
        }),
        summarizeApiResponse(rollbackImportResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: "mid-import binding failure surfaced as HTTP 500"
        }),
        summarizeApiResponse(finalImportResponse, {
          method: "POST",
          path: "/api/v1/debugging/admin/catalog/import",
          responseSummary: `retry created ${finalImportBody.item.nodesCreated} nodes, ${finalImportBody.item.modulesCreated} modules`
        })
      ],
      db: [
        {
          table: "debug_node_modules/debug_nodes/debug_node_bindings/audit_events",
          predicate: `name like '${catalogTransferPrefix} rollback %'`,
          observed: `modules=${rollbackState.modules}; nodes=${rollbackState.nodes}; bindings=${rollbackState.bindings}; importAudits=${rollbackState.audits}`,
          rowCount: Number(rollbackState.nodes)
        },
        {
          table: "debug_nodes/debug_node_bindings",
          predicate: `name like '${catalogTransferPrefix} rollback %'`,
          observed: `nodes=${finalState.nodes}; bindings=${finalState.bindings}`,
          rowCount: Number(finalState.nodes)
        }
      ],
      audit: [],
      notes:
        "Verified the preview digest guard rejects both a changed file and a changed target with 409, that a raw document without a digest cannot bypass the preview requirement, that a read-only user is denied all three catalog transfer routes with 403, that a document above the 20 MiB contract is rejected with 413 without touching the catalog, and that an injected mid-import binding failure rolls back every module, node, binding and audit write before a clean retry succeeds."
    });
  });
});
