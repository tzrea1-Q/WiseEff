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
  return (await db.query<{ id: string; status: string; target_value: unknown }>(
    `select id,status,target_value from project_parameter_value_change_requests
     where organization_id=$1 and project_id=$2 order by created_at`,
    [fixture.organizationId, fixture.projectId]
  )).rows;
}

async function currentValueId() {
  return (await db.query<{ current_value_id: string }>(
    "select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId]
  )).rows[0]!.current_value_id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).port !== "55438") {
    throw new Error("Issue 905 browser acceptance requires the dedicated Catalog PostgreSQL lane on port 55438.");
  }
  process.env.XIAOZE_DETERMINISTIC = "false";
  database = await createEphemeralTestDatabase("905ui");
  db = createPostgresDatabase(database.url);
  // Keep this browser-owned database live while a person/model is idle, so a
  // concurrent native test run cannot classify it as a connection-free orphan.
  databaseLease = await getRootPostgresPool(db)!.connect();
  await setupXiaozeCheckpointerTables({ mode: "postgres", connectionString: database.url });
  storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-905-browser-"));
  const objectStore = createLocalObjectStore(storageRoot);
  fixture = await seedCanonicalParameterFixture(db, objectStore);
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
          parameterId: fixture.bindingId, targetValue: "<2000>", reason: "Browser canonical approval" }) };
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
    const tools = await db.query("select name,status,error_message from agent_tool_calls where organization_id=$1 order by created_at", [fixture.organizationId]);
    await testInfo.attach("canonical-db-results", { body: JSON.stringify({ tools: tools.rows,
      requests: await requestRows(), currentValueId: await currentValueId() }, null, 2), contentType: "application/json" });
  }
});

test("canonical-only search, edited approval, refresh, product review and cancellation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) {
      apiResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  });
  await page.goto(`${frontendUrl}/favicon.svg`);
  await page.evaluate((token) => localStorage.setItem("wiseeff.localAuthToken", token), editorToken);
  const threadsLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze/threads" && response.status() === 200);
  await page.goto(`${frontendUrl}/parameters?project=${fixture.projectId}`);
  await threadsLoaded;
  await expect(page.getByRole("cell", { name: "iin_max", exact: true })).toBeVisible();
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
    "select result from agent_tool_calls where name='perception.searchParameters' and status='succeeded'"
  )).rows[0]?.result.data.parameters[0]?.id, { timeout: 60_000 }).toBe(fixture.bindingId);
  await expect(popup.getByTestId("copilot-scroll-content").getByText("已查询到 canonical 参数 iin_max。", { exact: true })).toBeVisible();
  const before = await currentValueId();
  requestedTool = "submit";
  await composer.fill("请将该参数改为 2000");
  await composer.press("Enter");
  const card = page.getByTestId("xiaoze-approval-card");
  await expect(card).toBeVisible({ timeout: 60_000 });
  expect(await requestRows()).toHaveLength(0);
  await card.getByLabel("目标值", { exact: true }).fill("<2100>");
  expect(await card.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("canonical-approval-1440x900.png"), fullPage: true });
  await testInfo.attach("canonical-approval", { path: testInfo.outputPath("canonical-approval-1440x900.png"), contentType: "image/png" });
  const approvalResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/agent/xiaoze" && response.request().method() === "POST");
  await card.getByRole("button", { name: "批准", exact: true }).click();
  await (await approvalResponse).finished();
  await expect(card).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await requestRows()).length, { timeout: 60_000 }).toBe(1);
  const pending = (await requestRows())[0]!;
  expect(pending.status).toBe("pending");
  expect(JSON.stringify(pending.target_value)).toContain("2100");
  expect(await currentValueId()).toBe(before);
  const refreshedBindings = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v2/projects/${fixture.projectId}/parameter-bindings` && response.status() === 200);
  await page.reload();
  await refreshedBindings;
  await expect(page.getByRole("cell", { name: "<5>", exact: true })).toBeVisible();
  expect((await requestRows()).length).toBe(1);
  expect(await currentValueId()).toBe(before);
  const reviewed = await fetch(`${apiUrl}/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${pending.id}/review`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${reviewerToken}` },
    body: JSON.stringify({ decision: "approve", note: "Issue 905 independent product review" }) });
  expect(reviewed.status, await reviewed.text()).toBe(200);
  expect(await currentValueId()).not.toBe(before);
  expect((await requestRows())[0]!.status).toBe("approved");
  await page.reload();
  await expect(page.getByRole("cell", { name: "<2100>", exact: true })).toBeVisible();
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
  expect((await db.query("select id from parameter_change_requests where organization_id=$1", [fixture.organizationId])).rows).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("canonical-completed-1440x900.png"), fullPage: true });
  await testInfo.attach("canonical-completed", { path: testInfo.outputPath("canonical-completed-1440x900.png"), contentType: "image/png" });
  expect(browserErrors).toEqual([]);
});
