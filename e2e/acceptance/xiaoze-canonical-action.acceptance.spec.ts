import "./helpers/loadAcceptanceEnvironment";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, test } from "playwright/test";
import { createWiseEffServer } from "../../server/app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../server/shared/database/client";
import type { PoolClient } from "pg";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../server/testing/testDatabase";
import { createLocalAuthService } from "../../server/modules/auth/localAuth";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "../../server/modules/parameter-kernel/parameterIdentityMode";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createDebugDeviceGatewayRegistry } from "../../server/modules/debugging/gatewayRegistry";
import { closeSharedPostgresCheckpointerSaversForTests, setupXiaozeCheckpointerTables } from "../../server/modules/agent/xiaoze/durableCheckpointer";
import { seedCanonicalParameterFixture } from "../../server/modules/agent/testing/canonicalParameterFixture";

// Only the external model is controlled. HTTP/auth, the frontend, ToolRegistry,
// durable approval/checkpoint, source/draft/request/review writers all stay real.
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

let database: EphemeralTestDatabase;
let db: RootDatabase;
let databaseLease: PoolClient;
let api: Server;
let provider: Server;
let vite: ViteDevServer;
let objectStore: ReturnType<typeof createLocalObjectStore>;
let storageRoot: string;
let apiUrl: string;
let frontendUrl: string;
let editorToken: string;
let reviewerToken: string;
let fixture: Awaited<ReturnType<typeof seedCanonicalParameterFixture>>;
let requestedTool: "search" | "submit" = "search";
const apiResponses: Array<{ method: string; path: string; status: number }> = [];
const browserErrors: string[] = [];
const modelCalls: Array<{ requestedTool: string; roles: string[]; hasResult: boolean }> = [];
const originalDeterministic = process.env.XIAOZE_DETERMINISTIC;

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server?: Server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function requestRows() {
  return (await db.query<{
    id: string; status: string; target_value: unknown; binding_id: string; definition_id: string;
    definition_revision_id: string; catalog_release_id: string; base_current_value_id: string;
    config_revision_id: string; source_ref: string; source_pin_id: string; candidate_id: string;
    draft_id: string; source_format: string; candidate_binding_manifest: unknown[];
  }>(
    `select request.id,request.status,request.target_value,request.binding_id,request.definition_id,
            request.definition_revision_id,request.catalog_release_id,request.base_current_value_id,
            request.config_revision_id,request.source_ref,request.source_pin_id,request.candidate_id,
            request.draft_id,pin.format as source_format,request.candidate_binding_manifest
       from project_parameter_value_change_requests request
       join parameter_catalog.project_value_source_pins pin on pin.id=request.source_pin_id
      where request.organization_id=$1 and request.project_id=$2 order by request.created_at`,
    [fixture.organizationId, fixture.projectId]
  )).rows;
}

async function draftRows() {
  return (await db.query(`select draft.id,draft.binding_id,draft.definition_id,draft.definition_revision_id,draft.catalog_release_id,
       draft.base_current_value_id,draft.config_revision_id,draft.source_ref,draft.source_pin_id,draft.candidate_id,pin.format as source_format,
       draft.target_value,draft.candidate_binding_manifest
       from project_parameter_value_drafts draft
       join parameter_catalog.project_value_source_pins pin on pin.id=draft.source_pin_id
      where draft.organization_id=$1 and draft.project_id=$2 order by draft.created_at`,
    [fixture.organizationId, fixture.projectId])).rows;
}

async function currentValueId() {
  return (await db.query<{ current_value_id: string }>(
    "select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId]
  )).rows[0]!.current_value_id;
}

async function currentSourceState() {
  return (await db.query<{ current_value_id: string; source_pin_id: string; format: string; config_revision_id: string; file_id: string; file_version_id: string }>(
    `select binding.current_value_id,pin.id as source_pin_id,pin.format,pin.config_revision_id,pin.file_id,pin.file_version_id
       from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id
         and pin.project_value_id=binding.current_value_id and pin.value_state='present'
      where binding.id=$1`, [fixture.bindingId]
  )).rows[0];
}

async function legacySemanticCounts() {
  return (await db.query<{ parameter_drafts: number; parameter_submission_rounds: number; parameter_submission_items: number;
    parameter_change_requests: number; parameter_specs: number; dts_property_specs: number }>(
    `select
       (select count(*)::int from parameter_drafts where organization_id=$1) as parameter_drafts,
       (select count(*)::int from parameter_submission_rounds where organization_id=$1) as parameter_submission_rounds,
       (select count(*)::int from parameter_submission_items where organization_id=$1) as parameter_submission_items,
       (select count(*)::int from parameter_change_requests where organization_id=$1) as parameter_change_requests,
       (select count(*)::int from parameter_specs where organization_id=$1) as parameter_specs,
       (select count(*)::int from dts_property_specs) as dts_property_specs`, [fixture.organizationId]
  )).rows[0];
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).port !== "55438") {
    throw new Error("Issue 905 browser acceptance requires the dedicated Catalog PostgreSQL lane on port 55438.");
  }
  setParameterIdentityMode(null);
  process.env.XIAOZE_DETERMINISTIC = "false";
  database = await createEphemeralTestDatabase("905ui");
  db = createPostgresDatabase(database.url);
  // Keep this browser-owned database live while a person/model is idle, so a
  // concurrent native test run cannot classify it as a connection-free orphan.
  databaseLease = await getRootPostgresPool(db)!.connect();
  await setupXiaozeCheckpointerTables({ mode: "postgres", connectionString: database.url });
  storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-905-browser-"));
  objectStore = createLocalObjectStore(storageRoot);
  fixture = await seedCanonicalParameterFixture(db, objectStore, { sourceFormat: "json" });
  await db.query(`insert into parameter_identity_migration_runs (
      id, mode, status, report, db_snapshot_id, object_snapshot_id, write_lock_confirmed, completed_at
    ) values ('migration-905-browser-post-cutover', 'apply', 'completed', '{}'::jsonb,
      'issue-905-browser-fixture', 'issue-905-browser-fixture', true, now())`);
  await db.query(`insert into parameter_identity_cutovers (id, migration_run_id)
    values ('cutover-905-browser-post-cutover', 'migration-905-browser-post-cutover')`);
  expect(await resolveParameterIdentityMode(db)).toBe("semantic");
  provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { stream?: boolean; messages: Array<{ role: string }> };
    const lastUser = body.messages.findLastIndex((message) => message.role === "user");
    const hasResult = body.messages.slice(lastUser + 1).some((message) => message.role === "tool");
    modelCalls.push({ requestedTool, roles: body.messages.map((message) => message.role), hasResult });
    const tool = requestedTool === "search"
      ? { name: "perception.searchParameters", arguments: JSON.stringify({ projectId: fixture.projectId, query: "iin_max" }) }
      : { name: "action.submitParameterChange", arguments: JSON.stringify({ projectId: fixture.projectId,
          parameterId: fixture.bindingId, targetValue: "8.75", reason: "Browser canonical JSON approval" }) };
    const message = hasResult
      ? { role: "assistant", content: requestedTool === "search" ? "已查询到 canonical 参数 iin_max。" : "参数变更已提交，等待产品审核。" }
      : { role: "assistant", content: null, tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: "function", function: tool }] };
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finishReason] of [[message, null], [{}, hasResult ? "stop" : "tool_calls"]] as const) {
        response.write(`data: ${JSON.stringify({ id: "issue905-model", object: "chat.completion.chunk", created: 1,
          model: "issue905-controlled-model", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "issue905-model", object: "chat.completion", created: 1,
        model: "issue905-controlled-model", choices: [{ index: 0, message, finish_reason: hasResult ? "stop" : "tool_calls" }] }));
    }
  });
  const providerUrl = await listen(provider);
  api = createWiseEffServer({ db, objectStore, auth: { mode: "production" }, localAuthService: createLocalAuthService(db),
    debugGatewayRegistry: createDebugDeviceGatewayRegistry({}),
    env: { DATABASE_URL: database.url, XIAOZE_CHECKPOINTER: "postgres", XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
      XIAOZE_LLM_CONFIG: { source: "canonical", config: { model: "issue905-controlled-model",
        apiBaseUrl: `${providerUrl}/v1`, apiKey: "local-controlled-provider" }, diagnostics: [] } } });
  apiUrl = await listen(api);
  async function login(username: string) {
    const response = await fetch(`${apiUrl}/api/v1/auth/login`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: fixture.password }) });
    expect(response.status).toBe(200);
    return (await response.json() as { token: string }).token;
  }
  editorToken = await login(fixture.editorUsername);
  reviewerToken = await login(fixture.reviewerUsername);
  vite = await createViteServer({ cacheDir: join(storageRoot, "vite-cache"),
    server: { host: "127.0.0.1", port: 5191, strictPort: false, hmr: false, watch: null,
      proxy: { "/api": { target: apiUrl, changeOrigin: true }, "/downloads": { target: apiUrl, changeOrigin: true } } },
    define: { "import.meta.env.VITE_WISEEFF_RUNTIME_MODE": JSON.stringify("api"),
      "import.meta.env.VITE_WISEEFF_API_BASE_URL": JSON.stringify(apiUrl) } });
  await vite.listen();
  const port = (vite.httpServer!.address() as AddressInfo).port;
  if (port > 5199) throw new Error("No independent frontend port in the allowed local range.");
  frontendUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  setParameterIdentityMode(null);
  await vite?.close();
  await close(api);
  await close(provider);
  await closeSharedPostgresCheckpointerSaversForTests();
  databaseLease?.release();
  await db?.close();
  await database?.drop();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  if (originalDeterministic === undefined) delete process.env.XIAOZE_DETERMINISTIC;
  else process.env.XIAOZE_DETERMINISTIC = originalDeterministic;
});

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach("real-api-responses", {
    body: JSON.stringify(apiResponses, null, 2), contentType: "application/json"
  });
  await testInfo.attach("browser-errors", { body: JSON.stringify(browserErrors), contentType: "application/json" });
  await testInfo.attach("controlled-model-calls", { body: JSON.stringify(modelCalls), contentType: "application/json" });
  if (db && fixture) {
    const tools = await db.query("select id,name,status,error_message,payload,result,audit_event_id from agent_tool_calls where organization_id=$1 order by created_at", [fixture.organizationId]);
    const approvals = await db.query(`select approval.id,approval.tool_call_id,approval.status,approval.decided_by_user_id
      from agent_approvals approval join agent_tool_calls tool on tool.id=approval.tool_call_id
      where approval.organization_id=$1 order by approval.requested_at`, [fixture.organizationId]);
    const audits = await db.query(`select id,kind,action,actor_type,actor_user_id,target_id,trace_id,metadata
      from audit_events where organization_id=$1 and kind='agent-tool' order by created_at`, [fixture.organizationId]);
    await testInfo.attach("canonical-db-results", { body: JSON.stringify({ tools: tools.rows, approvals: approvals.rows, audits: audits.rows,
      drafts: await draftRows(), requests: await requestRows(), currentSource: await currentSourceState(),
      currentValueId: await currentValueId(), legacySemanticCounts: await legacySemanticCounts() }, null, 2), contentType: "application/json" });
  }
});

test("canonical JSON Agent search, edited approval, refresh, product review and cancellation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      apiResponses.push({
        method: response.request().method(), path: url.pathname, status: response.status()
      });
    }
  });
  await page.goto(`${frontendUrl}/favicon.svg`);
  await page.evaluate((token) => localStorage.setItem("wiseeff.localAuthToken", token), editorToken);
  const threadsLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze/threads" && response.status() === 200);
  await page.goto(`${frontendUrl}/parameters?project=${fixture.projectId}`);
  await threadsLoaded;
  expect(fixture.sourceFormat).toBe("json");
  const jsonTab = page.getByRole("tab", { name: /JSON 参数/ });
  await jsonTab.click();
  const jsonTable = page.getByRole("table", { name: "JSON 参数列表" });
  await expect(jsonTable.getByRole("cell", { name: "iin_max", exact: true })).toBeVisible();
  await expect(jsonTable.getByRole("cell", { name: "5", exact: true })).toBeVisible();
  const hint = page.getByRole("button", { name: "不再提示" });
  if (await hint.isVisible()) await hint.click();
  await page.getByRole("button", { name: "打开小泽" }).click();
  const popup = page.getByTestId("xiaoze-popup-layer");
  const composer = popup.locator("textarea").first();
  await composer.fill("搜索 iin_max");
  const searchResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze" && response.request().method() === "POST");
  await composer.press("Enter");
  await (await searchResponse).finished();
  await expect.poll(async () => (await db.query<{ result: { data: { parameters: Array<{ id: string }> } } }>(
    "select result from agent_tool_calls where organization_id=$1 and name='perception.searchParameters' and status='succeeded' order by created_at desc limit 1",
    [fixture.organizationId]
  )).rows[0]?.result.data.parameters[0]?.id, { timeout: 60_000 }).toBe(fixture.bindingId);
  await expect(popup.getByTestId("copilot-scroll-content").getByText("已查询到 canonical 参数 iin_max。", { exact: true })).toBeVisible();
  const before = await currentValueId();
  expect(before).toBe(fixture.currentValueId);
  expect(await currentSourceState()).toMatchObject({ current_value_id: before, source_pin_id: fixture.sourcePinId, format: "json",
    config_revision_id: fixture.configRevisionId, file_id: fixture.sourceFileId, file_version_id: fixture.sourceFileVersionId });
  requestedTool = "submit";
  await composer.fill("请将该参数改为 8.75");
  await composer.press("Enter");
  const card = page.getByTestId("xiaoze-approval-card");
  await expect(card).toBeVisible({ timeout: 60_000 });
  expect(await requestRows()).toHaveLength(0);
  const pendingTool = await db.query<{ id: string; status: string; payload: { approvedParameter?: Record<string, unknown> } }>(
    `select id,status,payload from agent_tool_calls where organization_id=$1 and project_id=$2
       and name='action.submitParameterChange' order by created_at desc limit 1`, [fixture.organizationId, fixture.projectId]);
  expect(pendingTool.rows[0]).toMatchObject({ status: "pending_approval", payload: { approvedParameter: {
    projectId: fixture.projectId, bindingId: fixture.bindingId, expectedValueId: before,
    definitionId: fixture.definitionId, definitionRevisionId: fixture.definitionRevisionId,
    catalogReleaseId: fixture.catalogReleaseId, configRevisionId: fixture.configRevisionId,
    sourceRef: fixture.sourceRef, sourcePinId: fixture.sourcePinId, sourceFormat: "json",
    target: { format: "json", sourceText: "8.75" },
  } } });
  const pendingApproval = await db.query<{ status: string; decided_by_user_id: string | null }>(
    "select status,decided_by_user_id from agent_approvals where tool_call_id=$1", [pendingTool.rows[0]!.id]);
  expect(pendingApproval.rows).toEqual([{ status: "pending", decided_by_user_id: null }]);
  await card.getByLabel("目标值", { exact: true }).fill("10.25");
  expect(await card.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("canonical-approval-1440x900.png"), fullPage: true });
  await testInfo.attach("canonical-approval", { path: testInfo.outputPath("canonical-approval-1440x900.png"), contentType: "image/png" });
  const approvalResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze" && response.request().method() === "POST");
  await card.getByRole("button", { name: "批准", exact: true }).click();
  await (await approvalResponse).finished();
  await expect(card).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await requestRows()).length, { timeout: 60_000 }).toBe(1);
  const pending = (await requestRows())[0]!;
  expect(pending).toMatchObject({ status: "pending", binding_id: fixture.bindingId, definition_id: fixture.definitionId,
    definition_revision_id: fixture.definitionRevisionId, catalog_release_id: fixture.catalogReleaseId,
    base_current_value_id: before, config_revision_id: fixture.configRevisionId, source_ref: fixture.sourceRef,
    source_pin_id: fixture.sourcePinId, candidate_id: expect.any(String), draft_id: expect.any(String), source_format: "json",
    target_value: { kind: "json-source", value: 10.25 } });
  expect(pending.candidate_binding_manifest).toEqual(expect.arrayContaining([
    expect.objectContaining({ bindingId: fixture.bindingId, oldValueId: before, sourcePinId: fixture.sourcePinId })
  ]));
  const drafts = await draftRows();
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ binding_id: fixture.bindingId, definition_id: fixture.definitionId,
    definition_revision_id: fixture.definitionRevisionId, catalog_release_id: fixture.catalogReleaseId,
    base_current_value_id: before, config_revision_id: fixture.configRevisionId, source_ref: fixture.sourceRef,
    source_pin_id: fixture.sourcePinId, candidate_id: pending.candidate_id, source_format: "json",
    target_value: { kind: "json-source", value: 10.25 } });
  expect(await currentValueId()).toBe(before);
  expect(await currentSourceState()).toMatchObject({ current_value_id: before, source_pin_id: fixture.sourcePinId,
    format: "json", file_version_id: fixture.sourceFileVersionId });
  const approvedAgentState = await db.query<{ tool_status: string; approval_status: string; decided_by_user_id: string }>(
    `select tool.status as tool_status,approval.status as approval_status,approval.decided_by_user_id
       from agent_tool_calls tool join agent_approvals approval on approval.tool_call_id=tool.id where tool.id=$1`, [pendingTool.rows[0]!.id]);
  expect(approvedAgentState.rows).toEqual([{ tool_status: "succeeded", approval_status: "approved", decided_by_user_id: fixture.editorAuth.user.id }]);
  const refreshedBindings = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v2/projects/${fixture.projectId}/parameter-bindings` && response.status() === 200);
  await page.reload();
  await refreshedBindings;
  await jsonTab.click();
  await expect(jsonTable.getByRole("cell", { name: "5", exact: true })).toBeVisible();
  expect((await requestRows()).length).toBe(1);
  expect(await currentValueId()).toBe(before);
  expect(await currentSourceState()).toMatchObject({ current_value_id: before, source_pin_id: fixture.sourcePinId,
    format: "json", file_version_id: fixture.sourceFileVersionId });
  const reviewed = await fetch(`${apiUrl}/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${pending.id}/review`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${reviewerToken}` },
    body: JSON.stringify({ decision: "approve", note: "Issue 905 independent product review" }) });
  const reviewedBody = await reviewed.text();
  apiResponses.push({ method: "POST", path: `/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${pending.id}/review`, status: reviewed.status });
  expect(reviewed.status, reviewedBody).toBe(200);
  expect(await currentValueId()).not.toBe(before);
  expect((await requestRows())[0]!.status).toBe("approved");
  const appliedSource = await currentSourceState();
  expect(appliedSource).toMatchObject({ format: "json", file_id: fixture.sourceFileId });
  expect(appliedSource!.source_pin_id).not.toBe(fixture.sourcePinId);
  const currentFile = await db.query<{ storage_key: string; current_version_id: string }>(
    `select version.storage_key,file.current_version_id from project_parameter_files file
       join project_parameter_file_versions version on version.id=file.current_version_id
      where file.id=$1`, [fixture.sourceFileId]);
  expect(currentFile.rows[0]!.current_version_id).not.toBe(fixture.sourceFileVersionId);
  expect((await objectStore.get(currentFile.rows[0]!.storage_key)).toString("utf8")).toBe('{ "limit": 10.25, "untouched": true }\n');
  expect(await draftRows()).toHaveLength(0);
  expect(await legacySemanticCounts()).toEqual({ parameter_drafts: 0, parameter_submission_rounds: 0,
    parameter_submission_items: 0, parameter_change_requests: 0, parameter_specs: 0, dts_property_specs: 0 });
  await page.reload();
  await jsonTab.click();
  await expect(jsonTable.getByRole("cell", { name: "10.25", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开小泽" }).click();
  await expect(popup).toBeVisible();
  await composer.fill("再次建议修改该参数");
  await composer.press("Enter");
  await expect(card).toBeVisible({ timeout: 60_000 });
  const rejectionResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze" && response.request().method() === "POST");
  await card.getByRole("button", { name: "拒绝", exact: true }).click();
  await (await rejectionResponse).finished();
  await expect(card).toHaveCount(0, { timeout: 60_000 });
  expect(await requestRows()).toHaveLength(1);
  expect((await db.query("select id from project_parameter_bindings where organization_id=$1", [fixture.organizationId])).rows).toEqual([]);
  expect(await legacySemanticCounts()).toEqual({ parameter_drafts: 0, parameter_submission_rounds: 0,
    parameter_submission_items: 0, parameter_change_requests: 0, parameter_specs: 0, dts_property_specs: 0 });
  await page.screenshot({ path: testInfo.outputPath("canonical-completed-1440x900.png"), fullPage: true });
  await testInfo.attach("canonical-completed", { path: testInfo.outputPath("canonical-completed-1440x900.png"), contentType: "image/png" });
  expect(browserErrors).toEqual([]);
});
