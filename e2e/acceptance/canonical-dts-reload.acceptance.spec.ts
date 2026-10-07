import "./helpers/loadAcceptanceEnvironment";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, test } from "playwright/test";
import { createWiseEffServer } from "../../server/app";
import { createPostgresDatabase } from "../../server/shared/database/client";
import { withTempDatabase } from "../../server/testing/tempDatabase";
import { createLocalAuthService } from "../../server/modules/auth/localAuth";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createDebugDeviceGatewayRegistry } from "../../server/modules/debugging/gatewayRegistry";
import { seedCanonicalParameterFixture } from "../../server/modules/dts-reload/testing/canonicalReloadFixture";
import { createControlledReloadBridge } from "../../server/modules/dts-reload/testing/controlledReloadBridge";

// Only the physical device socket is controlled. The browser, HTTP/auth, real
// DTS compiler, source/draft/request/review writers and PostgreSQL stay real.
test.use({ viewport: { width: 1440, height: 900 } });

test("workbench handoff reaches canonical target, promotion survives re-entry and awaits product review", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).port !== "55438") {
    throw new Error("Issue 898 requires the dedicated Catalog PostgreSQL lane on port 55438.");
  }
  const responses: Array<{ method: string; path: string; status: number }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/")) responses.push({ method: response.request().method(), path, status: response.status() });
  });
  // A private prefix avoids the native test template's cross-fingerprint GC.
  await withTempDatabase({ prefix: "898ui" }, async ({ connectionString }) => {
    const db = createPostgresDatabase(connectionString);
    const storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-898-browser-"));
    let api: Server | undefined;
    let localBridge: Server | undefined;
    let vite: ViteDevServer | undefined;
    let bridge: Awaited<ReturnType<typeof createControlledReloadBridge>> | undefined;
    try {
      const objectStore = createLocalObjectStore(storageRoot);
      const fixture = await seedCanonicalParameterFixture(db, objectStore);
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('urb-898-browser-admin',$1,$2,null,'admin')`, [fixture.reviewerAuth.user.id, fixture.organizationId]);
      bridge = await createControlledReloadBridge(db, { organizationId: fixture.organizationId,
        userId: fixture.editorAuth.user.id, nodePath: "/sys/devices/issue898/iin_max" });
      // The adapter advertises a fixture artifact, never a real installer.
      const releaseDirectory = join(storageRoot, "0.0.1", "darwin", "arm64");
      await mkdir(releaseDirectory, { recursive: true });
      await writeFile(join(releaseDirectory, "controlled-fixture.txt"), "Controlled test adapter; not an installer.\n");
      await writeFile(join(storageRoot, "0.0.1", "manifest.json"), JSON.stringify({
        recommendedVersion: "0.0.1", minCompatibleVersion: "0.0.1",
        items: [{ platform: "darwin", arch: "arm64", version: "0.0.1", artifact: "controlled-fixture.txt" }]
      }));
      api = createWiseEffServer({ db, objectStore, auth: { mode: "production" }, localAuthService: createLocalAuthService(db),
        debugGatewayRegistry: createDebugDeviceGatewayRegistry({ hdc: {
          detectTargets: async () => ({ ok: true, targets: [] }),
          readNode: async () => { throw new Error("Controlled device reads must use the bridge RPC."); },
          writeNode: async () => { throw new Error("Controlled device writes must use the bridge RPC."); }
        } }),
        deviceBridge: { connectionPool: bridge.connectionPool, rpcClient: bridge.rpcClient, artifactRoot: storageRoot } });
      await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
      const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
      // Local health is also a controlled-device endpoint. It deliberately
      // reports disconnected, leaving deployment to the explicit HTTP step.
      localBridge = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, paired: true, connected: false,
          bridgeId: bridge!.bridgeId, serverUrl: apiUrl, updatedAt: new Date().toISOString() }));
      });
      await new Promise<void>((resolve) => localBridge!.listen(0, "127.0.0.1", resolve));
      const localBridgeUrl = `http://127.0.0.1:${(localBridge.address() as AddressInfo).port}`;
      async function json(method: string, path: string, body?: unknown, token?: string) {
        const response = await fetch(`${apiUrl}${path}`, { method,
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const payload = await response.json();
        expect(response.ok, JSON.stringify(payload)).toBeTruthy();
        return payload;
      }
      const { token } = await json("POST", "/api/v1/auth/login", { username: fixture.editorUsername, password: fixture.password });
      const { token: reviewerToken } = await json("POST", "/api/v1/auth/login", { username: fixture.reviewerUsername, password: fixture.password });
      vite = await createViteServer({ cacheDir: join(storageRoot, "vite-cache"),
        server: { host: "127.0.0.1", port: 5195, strictPort: false, hmr: false, watch: null,
          proxy: { "/api": { target: apiUrl, changeOrigin: true }, "/downloads": { target: apiUrl, changeOrigin: true },
            "/local-bridge": { target: localBridgeUrl, changeOrigin: true, rewrite: (path) => path.replace(/^\/local-bridge/, "") } } },
        define: { "import.meta.env.VITE_WISEEFF_RUNTIME_MODE": JSON.stringify("api"),
          "import.meta.env.VITE_WISEEFF_API_BASE_URL": JSON.stringify(apiUrl) } });
      await vite.listen();
      const port = (vite.httpServer!.address() as AddressInfo).port;
      if (port > 5199) throw new Error("No independent frontend port in the allowed range.");
      const frontendUrl = `http://127.0.0.1:${port}`;
      await page.goto(`${frontendUrl}/favicon.svg`);
      await page.evaluate((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
      await page.goto(`${frontendUrl}/parameters?project=${fixture.projectId}`);
      await expect(page.getByRole("cell", { name: "iin_max", exact: true })).toBeVisible();
      const hint = page.getByRole("button", { name: "不再提示" });
      if (await hint.isVisible()) await hint.click();
      const candidateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/dts-reload/projects/${fixture.projectId}/candidates`);
      await page.getByRole("button", { name: /^带入 DTS 调试 iin_max/ }).click();
      await expect(page).toHaveURL(new RegExp(`/dts-reload\\?project=${fixture.projectId}`));
      const candidatePayload = await (await candidateResponse).json();
      const target = candidatePayload.items.find((item: { bindingId: string }) => item.bindingId === fixture.bindingId);
      expect(target).toMatchObject({ bindingId: fixture.bindingId, propertyKey: "iin_max", debuggable: true });
      const targetName = target.displayName || target.propertyKey;
      // Assert the real target row, not merely the handoff toast or URL.
      const candidates = page.getByRole("table", { name: "可调试参数" });
      await expect(candidates.getByText(targetName, { exact: true })).toBeVisible();
      await candidates.getByRole("button", { name: `编辑 ${targetName}`, exact: true }).click();
      const editor = page.getByRole("dialog");
      await editor.getByRole("textbox", { name: `${targetName} 调试值`, exact: true }).fill("<6>");
      await editor.getByRole("button", { name: "加入本轮重载" }).click();
      await expect(page.getByRole("textbox", { name: `${targetName} 调试值` })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("canonical-handoff-1440x900.png") });
      const started = page.waitForResponse((response) => response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/dts-reload/projects/${fixture.projectId}/runs`);
      await page.getByRole("button", { name: "下发参数（1）", exact: true }).click();
      const startResponse = await started;
      expect(startResponse.status()).toBe(201);
      const { item: run } = await startResponse.json();
      expect(run.status).toBe("validated");
      expect(run.targets[0].bindingId).toBe(fixture.bindingId);
      // The controlled device uses the real deploy endpoint/RPC path; local
      // hardware pairing is outside this browser scenario's evidence.
      const deployed = await json("POST", `/api/v1/dts-reload/runs/${run.id}/deploy`, {
        deviceId: bridge.deviceId, bridgeId: bridge.bridgeId, targetRef: bridge.targetRef,
        protocol: "hdc", confirmationTokens: ["confirm-dts-reload"]
      }, token);
      expect(deployed.item.status).toBe("unverifiable");
      await page.goto(`${frontendUrl}/dts-reload?runId=${run.id}`);
      await page.reload();
      await page.getByRole("button", { name: "晋升为草稿", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "确认晋升不可验证的运行" });
      await expect(confirmation.getByRole("button", { name: "晋升为草稿" })).toBeDisabled();
      await confirmation.getByRole("checkbox").check();
      await page.screenshot({ path: testInfo.outputPath("canonical-promotion-confirmation-1440x900.png") });
      await confirmation.getByRole("button", { name: "晋升为草稿" }).click();
      await expect(page).toHaveURL(new RegExp(`/parameters\\?project=${fixture.projectId}`));
      await expect(page.getByRole("cell", { name: "iin_max 草稿", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: /^继续编辑 iin_max/ })).toBeVisible();
      const draft = (await db.query<{ id: string }>("select id from project_parameter_value_drafts where binding_id=$1", [fixture.bindingId])).rows;
      expect(draft).toHaveLength(1);
      async function currentValueId() {
        return (await db.query<{ current_value_id: string }>("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId])).rows[0]!.current_value_id;
      }
      expect(await currentValueId()).toBe(fixture.currentValueId);
      const submitted = await json("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-drafts/${draft[0]!.id}/submit`, {}, token);
      expect(submitted.item.status).toBe("pending");
      expect(await currentValueId()).toBe(fixture.currentValueId);
      await json("POST", `/api/v2/projects/${fixture.projectId}/parameter-value-change-requests/${submitted.item.id}/review`, {
        decision: "approve", note: "Issue 898 browser product review"
      }, reviewerToken);
      expect(await currentValueId()).not.toBe(fixture.currentValueId);
      await page.reload();
      const parameterRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "iin_max", exact: true }) });
      await expect(parameterRow.getByRole("cell", { name: "<6>", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("canonical-reviewed-1440x900.png") });
      const history = await json("GET", `/api/v1/dts-reload/runs/${run.id}`, undefined, token);
      expect(history.item.targets[0]).toMatchObject({ bindingId: fixture.bindingId, baselineValue: "<5>", debugValue: "<6>" });
      const linked = await json("POST", "/api/v1/debugging/admin/nodes", {
        name: "Canonical iin_max", module: "Issue 898",
        canonicalBinding: { projectId: fixture.projectId, bindingId: fixture.bindingId },
        bindings: [{ protocol: "hdc", nodePath: "/sys/devices/issue898/iin_max", accessMode: "RW", enabled: true }]
      }, reviewerToken);
      const standalone = await json("POST", "/api/v1/debugging/admin/nodes", {
        name: "Standalone device node", module: "Issue 898",
        bindings: [{ protocol: "hdc", nodePath: "/sys/devices/issue898/standalone", accessMode: "RW", enabled: true }]
      }, reviewerToken);
      await page.goto(`${frontendUrl}/node-debugging`);
      await expect(page.getByTestId(`node-canonical-reference-${linked.item.id}`)).toHaveText("参数关联：已关联");
      await expect(page.getByTestId(`node-canonical-reference-${standalone.item.id}`)).toHaveText("参数关联：未关联");
      await page.reload();
      await expect(page.getByTestId(`node-canonical-reference-${linked.item.id}`)).toHaveText("参数关联：已关联");
      await page.screenshot({ path: testInfo.outputPath("canonical-node-associations-1440x900.png") });
      expect(responses.filter((response) => response.status >= 400)).toEqual([]);
      expect(errors).toEqual([]);
      await testInfo.attach("controlled-device-calls", { body: JSON.stringify(bridge.calls, null, 2), contentType: "application/json" });
    } finally {
      await testInfo.attach("real-api-responses", { body: JSON.stringify(responses, null, 2), contentType: "application/json" });
      await testInfo.attach("browser-errors", { body: JSON.stringify(errors), contentType: "application/json" });
      await vite?.close();
      if (api?.listening) {
        api.closeAllConnections();
        await new Promise<void>((resolve, reject) => api!.close((error) => error ? reject(error) : resolve()));
      }
      bridge?.close();
      if (localBridge?.listening) {
        localBridge.closeAllConnections();
        await new Promise<void>((resolve, reject) => localBridge!.close((error) => error ? reject(error) : resolve()));
      }
      await db.close();
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
