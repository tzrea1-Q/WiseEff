import "./helpers/loadAcceptanceEnvironment";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, test } from "playwright/test";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { recordOperationEvidence } from "./helpers/operationEvidence";

import { createWiseEffServer } from "../../server/app";
import { createTokenVerifier } from "../../server/modules/auth/tokenVerifier";
import { createSimulatorDebugDeviceGateway } from "../../server/modules/debugging/simulator";
import { createLocalObjectStore } from "../../server/modules/logs/objectStore";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { catalogDefinitionResponseSchema } from "../../server/modules/contracts/dtoSchemas/parameterCatalog";
import {
  dropLabRuntimeLogins,
  inspectLoginBoundary,
  provisionPublicationRuntimeLogins
} from "../../server/modules/catalog-publication/runtime/provisionRuntimeLogins";
import { withTestClusterRoleCatalogLock } from "../../server/testing/testDatabase";
import {
  createDisposableParameterCatalogDatabase,
  installKnowledgeDefinitionLifecycleFixture,
  installLegacyReferenceFixture
} from "../../server/testing/parameterCatalog";

// Run with a dedicated TEST_DATABASE_URL, WISEEFF_ACCEPTANCE_OWNED_RUNTIME=true,
// WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true and Playwright --no-deps.
test.use({ viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: [
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 404 },
  { method: "GET", path: "/api/v2/catalog/legacy-identifiers", status: 410 },
  { method: "GET", path: "/api/v2/catalog/subjects", status: 404 }
] });

test("manages exact Definition references, published-only reverse links and same-Definition deprecation without losing legacy history", async ({ page }, testInfo) => withTestClusterRoleCatalogLock(async () => {
  // @acceptance KB-XREF-001
  // @operation KB-XREF-001
  test.setTimeout(180_000);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL before running the Knowledge browser regression.");
  }

  const database = await createDisposableParameterCatalogDatabase("kb903ui");
  const db = createPostgresDatabase(database.url);
  let storageRoot: string | undefined;
  const runToken = `kb903${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let apiDb: ReturnType<typeof createPostgresDatabase> | undefined;
  let api: Server | undefined;
  let vite: ViteDevServer | undefined;
  const http: Array<{ method: string; path: string; status: number; catalogReleaseId: string | null; body: unknown }> = [];
  try {
    storageRoot = await mkdtemp(join(tmpdir(), "wiseeff-903-knowledge-browser-"));
    const pool = getRootPostgresPool(db)!;
    const fixture = await installKnowledgeDefinitionLifecycleFixture(pool);
    await testInfo.attach("fixture-producer-identity", {
      body: JSON.stringify((await db.query("select session_user,current_user,current_database()")).rows),
      contentType: "application/json"
    });
    const organizationId = "org-kb-903-browser";
    const userId = "user-kb-903-browser";
    const otherOrganizationId = "org-kb-903-other";
    await pool.query("insert into organizations(id,name) values($1,'Knowledge Browser'),($2,'Other Tenant')",
      [organizationId, otherOrganizationId]);
    // The shared application shell loads its default project and device gateway too.
    await pool.query("insert into projects(id,organization_id,name,code,status) values('aurora',$1,'Knowledge Browser Project','KB903','initialized')",
      [organizationId]);
    for (const [id, organization, role] of [
      [userId, organizationId, "hardware-user"],
      ["user-kb-903-manager", organizationId, "admin"],
      ["user-kb-903-viewer", organizationId, "guest"],
      ["user-kb-903-nonowner", organizationId, "hardware-user"],
      ["user-kb-903-other", otherOrganizationId, "admin"]
    ]) {
      await pool.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,$1,$3,true)",
        [id, organization, role]);
      await pool.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values($1,$2,$3,null,$4)`, [`role-${id}`, id, organization, role]);
    }

    const issuer = "knowledge-903-browser";
    const secret = randomUUID();
    const tokenFor = (user: string, organization = organizationId) => {
      const payload = Buffer.from(JSON.stringify({
        iss: issuer, sub: user, org: organization, nbf: 0, exp: 9_999_999_999
      })).toString("base64url");
      return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
    };
    const token = tokenFor(userId);
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken });
    apiDb = createPostgresDatabase(runtime.apiUrl);
    const identity = (await apiDb.query(`select session_user, current_user, current_database(),
      rolsuper, rolinherit from pg_roles where rolname=current_user`)).rows[0];
    expect(identity).toMatchObject({ session_user: runtime.apiRole, current_user: runtime.apiRole,
      rolsuper: false, rolinherit: false });
    await testInfo.attach("api-database-identity-and-acl", {
      body: JSON.stringify({ identity, boundary: await inspectLoginBoundary(runtime.apiUrl) }),
      contentType: "application/json"
    });
    api = createWiseEffServer({
      db: apiDb,
      objectStore: createLocalObjectStore(storageRoot),
      debugGateway: createSimulatorDebugDeviceGateway({ targets: [] }),
      auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) }
    });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const request = async (method: string, path: string, body?: unknown, expectedStatus = 200, actorToken = token) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method, headers: { ...headers, authorization: `Bearer ${actorToken}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const result = await response.json();
      http.push({ method, path, status: response.status,
        catalogReleaseId: response.headers.get("X-WiseEff-Catalog-Release"), body: result });
      expect(response.status, JSON.stringify(result)).toBe(expectedStatus);
      return result;
    };
    const created = await request("POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title: "KB-903 canonical browser entry", tags: ["canonical"],
      contentMarkdown: "Exact Catalog Definition reference from the Knowledge page."
    }, 201) as { item: { id: string } };
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
    const definitionId = fixture.activeDefinitionId;
    const pickerDefinitionId = second.items[5]!.id;
    expect(pickerDefinitionId).not.toBe(definitionId);
    for (const id of [definitionId, pickerDefinitionId]) {
      expect((await pool.query("select 1 from parameter_specs where id=$1", [id])).rowCount).toBe(0);
    }
    const referencePath = (id: string, definition = definitionId) =>
      `/api/v1/knowledge/entries/${id}/definition-references/${encodeURIComponent(definition)}`;
    const relatedPath = `/api/v1/knowledge/related-to-definition?definitionId=${encodeURIComponent(definitionId)}`;
    const snapshot = async () => (await pool.query(`select
      (select jsonb_agg(to_jsonb(e) order by id) from knowledge_entries e) as entries,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_revisions r) as revisions,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_definition_references r) as definitions,
      (select jsonb_agg(to_jsonb(r) order by id) from knowledge_parameter_references r) as legacy,
      (select jsonb_agg(to_jsonb(a) order by id) from audit_events a) as audits
    `)).rows;
    const createEntry = async (title: string) => (await request("POST", "/api/v1/knowledge/entries", {
      contentForm: "markdown", title, tags: [], contentMarkdown: "Preserve this exact Knowledge content."
    }, 201) as { item: { id: string } }).item.id;
    const draftId = await createEntry("KB-903 draft excluded from reverse lookup");
    const archivedId = await createEntry("KB-903 archived excluded from reverse lookup");
    for (const id of [entryId, draftId, archivedId]) await request("PUT", referencePath(id), {});
    const originalReference = (await pool.query(`select * from knowledge_definition_references
      where entry_id=$1 and definition_id=$2`, [entryId, definitionId])).rows[0];
    await request("POST", `/api/v1/knowledge/entries/${archivedId}/publish`, {});
    await request("POST", `/api/v1/knowledge/entries/${archivedId}/archive`, {});
    expect((await request("GET", relatedPath) as { items: unknown[] }).items).toEqual([]);

    // Existing legacy history is a separate identity; new legacy writes stay refused.
    const history = await installLegacyReferenceFixture(pool, join(storageRoot, "archive"), fixture.pin);
    const legacyId = await createEntry("KB-903 existing historical reference");
    await request("POST", `/api/v1/knowledge/entries/${legacyId}/publish`, {});
    await pool.query(`insert into knowledge_parameter_references
      (id,organization_id,entry_id,parameter_spec_id,created_by_user_id) values($1,$2,$3,$4,$5)`,
      [randomUUID(), organizationId, legacyId, history.specId, userId]);
    const legacyPath = `/api/v1/knowledge/entries/${legacyId}/parameter-references/${encodeURIComponent(history.specId)}`;
    const legacyRead = await request("GET", `/api/v1/knowledge/entries/${legacyId}`) as {
      item: { parameterReferences: unknown[] }
    };
    expect(legacyRead.item.parameterReferences).toContainEqual(expect.objectContaining({
      kind: "legacy-spec", specId: history.specId, mappingStatus: "unmapped"
    }));
    await history.archive(legacyId);
    expect((await request("GET", `/api/v1/knowledge/entries/${legacyId}`) as typeof legacyRead)
      .item.parameterReferences).toContainEqual(expect.objectContaining({
        kind: "legacy-spec", specId: history.specId, historicalOnly: true, mappingStatus: "archived"
      }));
    const beforeLegacyRefusal = { knowledge: await snapshot(), history: await history.snapshot() };
    const legacyRefused = await request("PUT",
      `/api/v1/knowledge/entries/${entryId}/parameter-references/${encodeURIComponent(history.specId)}`, {}, 409) as {
        error: { details: { reason: string } }
      };
    expect(legacyRefused.error.details.reason).toBe("legacy-reference-write-disabled");
    expect({ knowledge: await snapshot(), history: await history.snapshot() }).toEqual(beforeLegacyRefusal);
    await request("PUT", legacyPath, {});
    expect({ knowledge: await snapshot(), history: await history.snapshot() }).toEqual(beforeLegacyRefusal);
    await request("DELETE", legacyPath, undefined, 403, tokenFor("user-kb-903-nonowner"));

    const beforePermissionRefusals = await snapshot();
    await request("PUT", referencePath(legacyId), {}, 403, tokenFor("user-kb-903-viewer"));
    await request("PUT", referencePath(legacyId), {}, 403, tokenFor("user-kb-903-nonowner"));
    await request("GET", `/api/v1/knowledge/entries/${entryId}`, undefined, 404,
      tokenFor("user-kb-903-other", otherOrganizationId));
    await request("PUT", referencePath(entryId), {}, 404, tokenFor("user-kb-903-other", otherOrganizationId));
    await request("PUT", referencePath(archivedId), {}, 400);
    expect(await snapshot()).toEqual(beforePermissionRefusals);
    await request("PUT", referencePath(legacyId), {}, 200, tokenFor("user-kb-903-manager"));
    await request("DELETE", referencePath(legacyId), undefined, 200, tokenFor("user-kb-903-manager"));
    const definition = catalogDefinitionResponseSchema.parse(
      await request("GET", `/api/v2/catalog/definitions/${encodeURIComponent(definitionId)}`)
    ).item;
    expect(definition.id).toBe(definitionId);
    expect(definition.lifecycle).toBe("active");
    expect(definition.currentRevision.id).toBe(fixture.initialRevisionId);
    const pickerDefinition = (await request("GET", `/api/v2/catalog/definitions/${encodeURIComponent(pickerDefinitionId)}`) as {
      item: { currentRevision: { displayName: string } }
    }).item;

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
      new URL(response.url()).pathname === referencePath(entryId, pickerDefinitionId));
    await results.locator("li").nth(55).getByRole("button", { name: "关联", exact: true }).click();
    expect((await added).status()).toBe(200);
    await expect(editor.locator(`[data-definition-id="${pickerDefinitionId}"]`)).toBeVisible();
    const beforeAddReplay = await snapshot();
    await request("PUT", referencePath(entryId, pickerDefinitionId), {});
    expect(await snapshot()).toEqual(beforeAddReplay);
    const removed = page.waitForResponse((response) => response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === referencePath(entryId, pickerDefinitionId));
    await editor.getByRole("button", { name: `移除引用 ${pickerDefinition.currentRevision.displayName}` }).click();
    expect((await removed).status()).toBe(200);
    await expect(editor.locator(`[data-definition-id="${pickerDefinitionId}"]`)).toHaveCount(0);
    const beforeDeleteReplay = await snapshot();
    await request("DELETE", referencePath(entryId, pickerDefinitionId));
    expect(await snapshot()).toEqual(beforeDeleteReplay);
    expect((await pool.query(`select * from knowledge_definition_references
      where entry_id=$1 and definition_id=$2`, [entryId, definitionId])).rows).toEqual([originalReference]);
    await editor.getByRole("button", { name: "取消" }).click();
    await page.reload();
    const chip = page.locator(`[data-definition-id="${definitionId}"]`);
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(`${definition.currentRevision.displayName} · ${definition.subject.canonicalName}`);
    await expect(chip).toContainText("已启用");
    const published = page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/knowledge/entries/${entryId}/publish`);
    await page.getByRole("dialog").getByRole("button", { name: "发布", exact: true }).click();
    expect((await published).status()).toBe(200);
    await page.screenshot({ path: testInfo.outputPath("knowledge-active-reference-1440x900.png"), animations: "disabled" });

    // Authorized test producer before publication takeover; not an online activation or authoring API.
    const advanced = await fixture.advanceToDeprecated();
    expect(advanced).toMatchObject({ definitionId, previous: fixture.pin,
      previousRevisionId: fixture.initialRevisionId, successorDefinitionId: fixture.successorDefinitionId,
      publicationMode: "pre-regime", activationReceipt: null, activationAudit: null,
      installOutcome: { status: "installed", mode: "advance", previous: fixture.pin, current: advanced.current }
    });
    expect(advanced.current).not.toEqual(advanced.previous);
    const deprecated = catalogDefinitionResponseSchema.parse(
      await request("GET", `/api/v2/catalog/definitions/${encodeURIComponent(definitionId)}`)
    ).item;
    expect(http.at(-1)?.catalogReleaseId).toBe(advanced.current.id);
    expect(deprecated).toMatchObject({ id: definitionId, lifecycle: "deprecated",
      currentRevision: { id: advanced.revisionId, revisionNumber: definition.currentRevision.revisionNumber + 1 }
    });
    const historical = catalogDefinitionResponseSchema.parse(await request("GET",
      `/api/v2/catalog/definitions/${encodeURIComponent(definitionId)}?catalogReleaseId=${encodeURIComponent(fixture.pin.id)}`
    )).item;
    expect(http.at(-1)?.catalogReleaseId).toBe(fixture.pin.id);
    expect(historical).toEqual(definition);
    expect((await pool.query(`select * from knowledge_definition_references
      where entry_id=$1 and definition_id=$2`, [entryId, definitionId])).rows).toEqual([originalReference]);
    const refreshed = await request("GET", `/api/v1/knowledge/entries/${entryId}`) as {
      item: { parameterReferences: unknown[] }
    };
    expect(refreshed.item.parameterReferences).toEqual([expect.objectContaining({
      kind: "definition", definitionId, createdByUserId: userId,
      createdAt: originalReference.created_at.toISOString(), availability: "current", lifecycle: "deprecated"
    })]);
    await page.reload();
    await expect(chip).toContainText("已废弃");
    await expect(chip).toContainText(`${definition.currentRevision.displayName} · ${definition.subject.canonicalName}`);
    await page.screenshot({ path: testInfo.outputPath("knowledge-deprecated-reference-1440x900.png"), animations: "disabled" });
    await testInfo.attach("pre-regime-lifecycle-install", {
      body: JSON.stringify({ ...advanced, originalReference,
        boundary: "Dedicated test bootstrap/advance; no production deprecated authoring API, ActivationReceipt, activation audit or target runtime proof. The HTTP DTO does not expose the successor." }),
      contentType: "application/json"
    });
    expect((await request("GET", `/api/v1/knowledge/entries/${legacyId}`) as typeof legacyRead)
      .item.parameterReferences).toContainEqual(expect.objectContaining({
        kind: "legacy-spec", specId: history.specId, historicalOnly: true, mappingStatus: "archived"
      }));
    await request("DELETE", legacyPath);
    await request("DELETE", legacyPath, undefined, 404);
    expect(await history.snapshot()).toEqual(beforeLegacyRefusal.history);
    expect((await request("GET", `/api/v1/knowledge/entries/${legacyId}`) as typeof legacyRead)
      .item.parameterReferences).toEqual([]);
    // The existing parameter-admin surface requires Admin, as in the original KB-XREF scenario.
    await page.evaluate((value) => localStorage.setItem("wiseeff.localAuthToken", value), tokenFor("user-kb-903-manager"));
    await page.reload();
    await expect(page.locator(`[data-definition-id="${definitionId}"]`)).toBeVisible();
    await expect(page.locator(`[data-definition-id="${definitionId}"]`)).toContainText("已废弃");
    const related = page.waitForResponse((response) => new URL(response.url()).pathname ===
      "/api/v1/knowledge/related-to-definition");
    await chip.getByRole("button").click();
    await expect(page).toHaveURL(new RegExp(`/parameter-admin/specs\\?definitionId=${definitionId}`));
    expect((await related).status()).toBe(200);
    const relatedSection = page.getByTestId("spec-related-knowledge");
    const relatedEntry = relatedSection.getByRole("button", { name: /KB-903 canonical browser entry/ });
    await expect(relatedEntry).toBeVisible();
    await expect(relatedSection.getByText("KB-903 draft excluded from reverse lookup")).toHaveCount(0);
    await expect(relatedSection.getByText("KB-903 archived excluded from reverse lookup")).toHaveCount(0);
    for (const actor of [token, tokenFor("user-kb-903-manager"), tokenFor("user-kb-903-viewer")]) {
      expect((await request("GET", relatedPath, undefined, 200, actor) as { items: Array<{ entryId: string }> })
        .items.map((item) => item.entryId)).toEqual([entryId]);
    }
    await relatedEntry.click();
    await expect(page).toHaveURL(new RegExp(`/knowledge\\?entryId=${entryId}`));
    await expect(page.getByRole("dialog").getByText("KB-903 canonical browser entry")).toBeVisible();
    await expect(page.locator(`[data-definition-id="${definitionId}"]`)).toBeVisible();
    const refs = await pool.query(`select entry_id,definition_id,created_by_user_id
      from knowledge_definition_references where definition_id=$1 order by entry_id`, [definitionId]);
    expect(refs.rows).toEqual([entryId, draftId, archivedId].sort().map((id) => ({
      entry_id: id, definition_id: definitionId, created_by_user_id: userId
    })));
    const audits = (await pool.query(`select kind,target_id,
      coalesce(metadata->>'definitionId',metadata->>'specId') as reference_id,count(*)::int as count from audit_events
      where app='knowledge' and kind in
        ('knowledge-definition-reference-add','knowledge-definition-reference-remove','knowledge-parameter-reference-remove')
      group by kind,target_id,reference_id order by target_id,kind,reference_id`)).rows;
    expect(audits.filter((audit) => audit.target_id === entryId)).toEqual([
      ...[definitionId, pickerDefinitionId].sort().map((id) => ({
        kind: "knowledge-definition-reference-add", target_id: entryId, reference_id: id, count: 1
      })),
      { kind: "knowledge-definition-reference-remove", target_id: entryId, reference_id: pickerDefinitionId, count: 1 }
    ]);
    expect(audits).toContainEqual({ kind: "knowledge-parameter-reference-remove", target_id: legacyId,
      reference_id: history.specId, count: 1 });
    expect((await request("GET", `/api/v1/knowledge/entries/${entryId}`) as {
      item: { contentMarkdown: string; headRevisionNumber: number }
    }).item).toMatchObject({ contentMarkdown: "Exact Catalog Definition reference from the Knowledge page.", headRevisionNumber: 1 });
    await testInfo.attach("exact-references-and-audit", {
      body: JSON.stringify({ references: refs.rows, audits, snapshot: await snapshot() }), contentType: "application/json"
    });
    const previousApiUrl = process.env.WISEEFF_API_BASE_URL;
    try {
      // The existing evidence recorder reads the runtime URL from this environment variable.
      process.env.WISEEFF_API_BASE_URL = apiUrl;
      await recordOperationEvidence({ operationId: "KB-XREF-001", title: testInfo.title, status: "passed",
        testInfo, role: "Hardware User, Admin", route: "/knowledge", assertions: ["ui", "api", "db", "audit"],
        artifacts: [testInfo.outputPath("knowledge-active-reference-1440x900.png"),
          testInfo.outputPath("knowledge-deprecated-reference-1440x900.png")],
        api: http.map(({ method, path, status }) => ({ method, path, status })),
        db: [{ table: "knowledge_definition_references", predicate: `definition_id=${definitionId}`,
          rowCount: refs.rowCount ?? 0, observed: JSON.stringify(refs.rows) }],
        audit: audits.map((audit) => ({ kind: audit.kind, targetId: audit.target_id,
          metadataSummary: JSON.stringify({ referenceId: audit.reference_id, count: audit.count }) })),
        notes: "Dedicated PostgreSQL and objects; non-superuser NOINHERIT API LOGIN with production HMAC and persisted roles. Lifecycle advance is a pre-regime test producer, not deployed deprecated authoring, activation or successor navigation."
      });
    } finally {
      if (previousApiUrl === undefined) delete process.env.WISEEFF_API_BASE_URL;
      else process.env.WISEEFF_API_BASE_URL = previousApiUrl;
    }
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const cleanup of [
      () => testInfo.attach("knowledge-http", { body: JSON.stringify(http), contentType: "application/json" }),
      () => vite?.close(),
      async () => {
        if (api?.listening) {
          api.closeAllConnections();
          await new Promise<void>((resolve, reject) => api!.close((error) => error ? reject(error) : resolve()));
        }
      },
      () => apiDb?.close(),
      async () => {
        const result = await dropLabRuntimeLogins(database.url, runToken);
        await testInfo.attach("runtime-role-cleanup", { body: JSON.stringify(result), contentType: "application/json" });
        expect(result.failed).toEqual([]);
      },
      () => db.close(),
      () => database.close(),
      () => storageRoot && rm(storageRoot, { recursive: true, force: true })
    ]) {
      try { await cleanup(); }
      catch (error) { cleanupErrors.push(error); }
    }
    expect(cleanupErrors).toEqual([]);
  }
}));
