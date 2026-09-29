import "./helpers/loadAcceptanceEnvironment";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, test } from "playwright/test";

import { createWiseEffServer } from "../../server/app";
import { createTokenVerifier } from "../../server/modules/auth/tokenVerifier";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  installKnowledgeDefinitionReferencesCatalogFixture
} from "../../server/testing/parameterCatalog";

// Run with a dedicated TEST_DATABASE_URL, WISEEFF_ACCEPTANCE_OWNED_RUNTIME=true,
// WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true and Playwright --no-deps.
test.use({ viewport: { width: 1440, height: 900 } });

test("selects Definition 56 through real Catalog HTTP and finds published Knowledge on its detail", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL before running the Knowledge browser regression.");
  }

  const database = await createDisposableParameterCatalogDatabase("kb903ui");
  const db = createPostgresDatabase(database.url);
  const storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-903-knowledge-browser-"));
  let api: Server | undefined;
  let vite: ViteDevServer | undefined;
  try {
    const pool = getRootPostgresPool(db)!;
    const fixture = await installKnowledgeDefinitionReferencesCatalogFixture(pool);
    const organizationId = "org-kb-903-browser";
    const userId = "user-kb-903-browser";
    await pool.query("insert into organizations(id,name) values($1,'Knowledge Browser')", [organizationId]);
    await pool.query(
      "insert into users(id,organization_id,name,email,title,is_active) values($1,$2,'Knowledge Editor','kb903@example.invalid','Admin',true)",
      [userId, organizationId]
    );
    await pool.query(
      "insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values($1,$2,$3,null,'admin')",
      ["role-kb-903-browser", userId, organizationId]
    );

    const issuer = "knowledge-903-browser";
    const secret = randomUUID();
    const payload = Buffer.from(JSON.stringify({
      iss: issuer, sub: userId, org: organizationId, nbf: 0, exp: 9_999_999_999
    })).toString("base64url");
    const token = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
    api = createWiseEffServer({
      db,
      objectStore: createLocalObjectStore(storageRoot),
      auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) }
    });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBeGreaterThanOrEqual(200);
      expect(response.status, JSON.stringify(result)).toBeLessThan(300);
      return result;
    };
    const created = await request("POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "KB-903 canonical browser entry", tags: ["canonical"],
      contentMarkdown: "Exact Catalog Definition reference from the Knowledge page."
    }) as { item: { id: string } };
    const entryId = created.item.id;
    const first = await request("GET", `/api/v2/catalog/definitions?search=${fixture.searchTerm}&limit=50`) as {
      items: Array<{ id: string }>; nextCursor: string; catalogReleaseId: string
    };
    const second = await request("GET", `/api/v2/catalog/definitions?search=${fixture.searchTerm}&limit=50&cursor=${encodeURIComponent(first.nextCursor)}&catalogReleaseId=${encodeURIComponent(first.catalogReleaseId)}`) as {
      items: Array<{ id: string }>; catalogReleaseId: string
    };
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(10);
    expect(second.catalogReleaseId).toBe(first.catalogReleaseId);
    const definitionId = second.items[5]!.id;
    expect((await pool.query("select 1 from parameter_specs where id=$1", [definitionId])).rowCount).toBe(0);

    vite = await createViteServer({
      cacheDir: join(storageRoot, "vite-cache"),
      server: {
        host: "127.0.0.1", port: 5203, strictPort: false, hmr: false, watch: null,
        proxy: { "/api": { target: apiUrl, changeOrigin: true } }
      },
      define: {
        "import.meta.env.VITE_WISEEFF_RUNTIME_MODE": JSON.stringify("api"),
        "import.meta.env.VITE_WISEEFF_API_BASE_URL": JSON.stringify("")
      }
    });
    await vite.listen();
    const frontendUrl = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
    await page.goto(`${frontendUrl}/favicon.svg`);
    await page.evaluate((value) => localStorage.setItem("wiseeff.localAuthToken", value), token);
    await page.goto(`${frontendUrl}/knowledge?entryId=${entryId}`);
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("KB-903 canonical browser entry")).toBeVisible();
    await detail.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog").last();
    await editor.getByRole("searchbox", { name: "检索参数定义" }).fill(fixture.searchTerm);
    await editor.getByRole("button", { name: "检索定义" }).click();
    const results = editor.getByRole("list", { name: "参数定义检索结果" });
    await expect(results.locator("li")).toHaveCount(50);
    await editor.getByRole("button", { name: "加载更多定义" }).click();
    await expect(results.locator("li")).toHaveCount(60);
    const added = page.waitForResponse((response) => response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith(`/definition-references/${definitionId}`));
    await results.locator("li").nth(55).getByRole("button", { name: "关联", exact: true }).click();
    expect((await added).status()).toBe(200);
    await editor.getByRole("button", { name: "取消" }).click();
    await page.reload();
    const chip = page.locator(`[data-definition-id="${definitionId}"]`);
    await expect(chip).toBeVisible();
    const published = page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/knowledge/entries/${entryId}/publish`);
    await page.getByRole("dialog").getByRole("button", { name: "发布", exact: true }).click();
    expect((await published).status()).toBe(200);
    await page.screenshot({ path: testInfo.outputPath("knowledge-definition-56-1440x900.png") });
    const related = page.waitForResponse((response) => new URL(response.url()).pathname ===
      "/api/v1/knowledge/related-to-definition");
    await chip.getByRole("button").click();
    await expect(page).toHaveURL(new RegExp(`/parameter-admin/specs\\?definitionId=${definitionId}`));
    expect((await related).status()).toBe(200);
    await expect(page.getByTestId("spec-related-knowledge").getByText("KB-903 canonical browser entry", { exact: true })).toBeVisible();
  } finally {
    await vite?.close();
    if (api?.listening) {
      api.closeAllConnections();
      await new Promise<void>((resolve, reject) => api!.close((error) => error ? reject(error) : resolve()));
    }
    await db.close();
    await database.close();
    await rm(storageRoot, { recursive: true, force: true });
  }
});
