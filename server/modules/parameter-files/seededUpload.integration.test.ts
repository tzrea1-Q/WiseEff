import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

import { request as playwrightRequest, type APIRequestContext } from "playwright/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { preparePostCutoverDatabase } from "../../../e2e/acceptance/helpers/disposablePostCutoverRuntime";
import { authHeadersForRole } from "../../../e2e/acceptance/helpers/bearerAuth";
import { apiRoute } from "../../../e2e/acceptance/helpers/runtime";
import { lookupParameterFileVersion, numericCellDts, seedIsolatedBinding, seedIsolatedHexChipBindings } from "../../../e2e/acceptance/helpers/semanticBindingFixture";
import { createWiseEffServer } from "../../app";

import { parsePowerManagementConfig, seedM1Parameters, seedM1BindingRevisionHistory, seedM1DtsFiles, seedM1SemanticTopology } from "../../../scripts/seed-m1-parameters";
import { seedM0Foundation } from "../../../scripts/seed-m0";
import { loadCommittedDtsSeedFiles } from "../../../scripts/compile-dts-seed";
import { seedPublishedCatalog } from "../../testing/parameterCatalog/seedPublishedCatalog";
import { VENDOR_LOCALIZED_RELEASE_ID } from "../../../scripts/compile-vendor-catalog-release";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { SEMANTIC_BINDING_FIXTURE_RELEASE_ID, seedSemanticBindingCatalog } from "../../testing/parameterCatalog/semanticBinding";
import { readCurrentCatalogPointer } from "../catalog-kernel/install/currentPointer";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { registerParameterCatalogApi } from "../parameter-catalog-api/productionWire";
import { catalogDriverCompatibleDiscoveryResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { createLocalObjectStore } from "../logs/objectStore";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { ensureCanonicalCatalogAfterLegacySeed } from "../parameter-bindings/seedInitialization/seedCanonicalAfterLegacy";
import { registerParameterFileRoutes } from "./routes";

const organizationId = "org-chargelab";
const auth = makeTestAuthContext({
  organizationId,
  userId: "u-xu-yun",
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["parameter:view", "parameter:edit", "admin:access"]
});

describe("disposable acceptance post-cutover DTS upload", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let storageDirectory: string;
  let server: ReturnType<typeof createWiseEffServer>;
  let request: APIRequestContext;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("disposableupload");
    await withTestClusterRoleCatalogLock(() => preparePostCutoverDatabase(database.url, "seeded-upload"));
    db = createPostgresDatabase(database.url);
    expect(await resolveParameterIdentityMode(db)).toBe("semantic");
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-disposable-upload-"));
    server = createWiseEffServer({ db, objectStore: createLocalObjectStore(storageDirectory), auth: { mode: "development" } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP test server address is unavailable");
    vi.stubEnv("DATABASE_URL", database.url);
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", `http://127.0.0.1:${address.port}`);
    request = await playwrightRequest.newContext();
  }, 120_000);

  beforeEach(async () => {
    expect(await resolveParameterIdentityMode(db)).toBe("semantic");
  });

  afterAll(async () => {
    await request?.dispose();
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("advances the localized seed to the acceptance Catalog and resolves the isolated helper's Binding identity", async () => {
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    expect(pin?.id).toBe(VENDOR_LOCALIZED_RELEASE_ID);
    expect(await readCurrentCatalogPointer(pool)).toMatchObject({
      kind: "installed", current: { id: VENDOR_LOCALIZED_RELEASE_ID, version: "1.2.1" },
    });
    expect(await seedPublishedCatalog(pool)).toMatchObject(pin!);
    const binding = await seedIsolatedBinding(request, {
      propertyKey: "iin_max", dts: numericCellDts("iin_max", 80), timeoutMs: 5_000
    });
    const acceptance = await readCurrentCatalogPointer(pool);
    expect(acceptance).toMatchObject({
      kind: "installed", current: { id: SEMANTIC_BINDING_FIXTURE_RELEASE_ID, version: "1.3.0" },
      predecessorReleaseId: VENDOR_LOCALIZED_RELEASE_ID,
    });
    await seedSemanticBindingCatalog(pool);
    expect(await readCurrentCatalogPointer(pool)).toEqual(acceptance);
    expect(binding.rawValue).toBe("<80>");
    expect(binding.nodeLocator).toBe("/td079_cell");
    expect(binding.bindingId).toBeTruthy();
    const identities = await request.get(apiRoute(`/api/v2/projects/${binding.projectId}/parameter-bindings`), {
      headers: authHeadersForRole("admin")
    });
    expect(identities.status(), await identities.text()).toBe(200);
    expect((await identities.json()).items).toContainEqual(expect.objectContaining({
      id: binding.bindingId, definitionId: "pdef_acceptance_td079_iin_max", propertyKey: "iin_max"
    }));
    const version = await lookupParameterFileVersion({ fileName: binding.fileName });
    expect(version.versionNumber).toBe(2);
    const subjects = await request.get(apiRoute("/api/v2/catalog/subjects"), { headers: authHeadersForRole("admin") });
    expect(subjects.status(), await subjects.text()).toBe(200);
    const response = await request.get(apiRoute(
      `/api/v2/organizations/${organizationId}/driver-compatible-discovery?projectId=${binding.projectId}`
    ), { headers: authHeadersForRole("admin") });
    expect(response.status(), await response.text()).toBe(200);
    const discovery = catalogDriverCompatibleDiscoveryResponseSchema.parse(await response.json());
    expect(discovery.status).toBe("ready");
    if (discovery.status !== "ready") throw new Error("Disposable Catalog discovery is unavailable");
    expect(discovery.items.find((item) => item.source.status === "current"
      && item.source.fileVersionId === version.versionId)).toMatchObject({
      observedCatalogReleaseId: SEMANTIC_BINDING_FIXTURE_RELEASE_ID,
      compatibles: [{ compatible: "wiseeff,td079-cell", candidate: {
        kind: "recognized", subjectId: "csub_acceptance_td079"
      } }]
    });
  });

  it("lets an explicit Catalog fixture publish its own first release", async () => {
    const fixtureLane = await createEphemeralTestDatabase("fixtureownedupload");
    let fixtureDb: RootDatabase | undefined;
    try {
      await withTestClusterRoleCatalogLock(() => preparePostCutoverDatabase(
        fixtureLane.url, "fixture-owned-upload", "fixture-owned"
      ));
      fixtureDb = createPostgresDatabase(fixtureLane.url);
      const pool = getRootPostgresPool(fixtureDb)!;
      expect(await captureCurrentCatalogPin(pool)).toBeNull();
      await installConfigurationSourceFixture(fixtureDb, auth, {
        subjectId: "csub_fixture_owned_upload", schemaId: "wiseeff.fixture-owned.upload"
      });
      expect(await captureCurrentCatalogPin(pool)).toMatchObject({ id: "crel_acme_1" });
    } finally {
      await fixtureDb?.close();
      await fixtureLane.drop();
    }
  });

  it("materializes consecutive hex fixtures with independent exact source pins", async () => {
    const first = (await seedIsolatedHexChipBindings(request, { rawHex: "0x6e" })).reg;
    const second = (await seedIsolatedHexChipBindings(request, { rawHex: "0x6f" })).reg;
    expect(first.bindingId).not.toBe(second.bindingId);
    expect(first.configSetId).not.toBe(second.configSetId);
    expect(first.rawValue).toBe("<0x6e>");
    expect(second.rawValue).toBe("<0x6f>");
    for (const [binding, rawValue] of [[first, "<110>"], [second, "<111>"]] as const) {
      const pinned = await request.get(apiRoute(`/api/v2/projects/aurora/parameter-bindings?revisionId=${binding.revisionId}`), {
        headers: authHeadersForRole("admin")
      });
      expect(pinned.status(), await pinned.text()).toBe(200);
      expect((await pinned.json()).items).toEqual([expect.objectContaining({
        id: binding.bindingId, definitionId: "pdef_acceptance_chip123_vendor-id",
        sourceFileId: binding.fileId, rawValue
      })]);
    }
  });
});

const isolatedDts = `/dts-v1/;
/ {
\ttd079_cell: td079_cell {
\t\tcompatible = "wiseeff,td079-cell";
\t\tiin_max = <80>;
\t};
};
`;

describe("seeded post-cutover DTS upload with a published Catalog", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedupload");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-seeded-upload-"));
    objectStore = createLocalObjectStore(storageDirectory);
    await seedM0Foundation(db);
    const configPath = join(process.cwd(), "src/config/power-management.json");
    await seedM1Parameters(db, parsePowerManagementConfig(configPath, readFileSync(configPath, "utf8")));
    await seedPublishedCatalog(getRootPostgresPool(db)!);
    const projectFiles = (await loadCommittedDtsSeedFiles(process.cwd()))
      .filter((file) => file.projectId === "aurora" || file.projectId === "nebula");
    await seedM1DtsFiles(db, objectStore, projectFiles);
    await seedM1SemanticTopology(db, projectFiles);
    await ensureCanonicalCatalogAfterLegacySeed(db, auth, {
      organizationId, seedDigest: "seeded-upload-canonical"
    });
    await seedM1BindingRevisionHistory(db, objectStore, projectFiles);
  }, 120_000);

  beforeEach(async () => {
    expect(await captureCurrentCatalogPin(getRootPostgresPool(db)!)).toMatchObject({ id: VENDOR_LOCALIZED_RELEASE_ID });
  });

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  function makeServer() {
    const router = createRouter();
    const options = { db, objectStore, getCurrentAuthContext: () => auth };
    registerCatalogProjectValueConsumerRoutes(router, options);
    registerParameterFileRoutes(router, options);
    registerParameterCatalogApi(router, { db, objectStore, resolveAuth: () => auth });
    const errors: unknown[] = [];
    const server = createHttpServer({
      async handle(request) {
        try {
          return await router.handle(request);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      }
    });
    return { server, errors };
  }

  async function post(projectId: string, path: string, body: unknown) {
    const { server, errors } = makeServer();
    const response = await requestJson<{
      item: { id: string; currentVersionId?: string };
      version: { id: string; versionNumber: number; parsedIndex: Record<string, { value: string }> };
    }>(server, `/api/v1/projects/${projectId}/${path}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    expect(response.status, `${response.bodyText}\n${inspect(errors, { depth: 8 })}`).toBe(201);
    expect(errors).toEqual([]);
    return response.body;
  }

  const upload = (projectId: string, fileName: string, source: string) => post(
    projectId,
    "parameter-files",
    { fileName, contentBase64: Buffer.from(source).toString("base64") }
  );

  async function discover(projectId: string) {
    const { server, errors } = makeServer();
    const response = await requestJson(server,
      `/api/v2/organizations/${organizationId}/driver-compatible-discovery?projectId=${projectId}`);
    expect(response.status, response.bodyText).toBe(200);
    expect(errors).toEqual([]);
    const page = catalogDriverCompatibleDiscoveryResponseSchema.parse(response.body);
    expect(page.status).toBe("ready");
    if (page.status !== "ready") throw new Error("Seed Catalog discovery is unavailable");
    return page;
  }

  it("keeps the compiled seed release idempotent and exposes Catalog subjects", async () => {
    const pool = getRootPostgresPool(db)!;
    const before = await captureCurrentCatalogPin(pool);
    expect(before?.id).toBe(VENDOR_LOCALIZED_RELEASE_ID);
    expect(await seedPublishedCatalog(pool)).toMatchObject(before!);
    expect(await captureCurrentCatalogPin(pool)).toEqual(before);
    const { server, errors } = makeServer();
    const response = await requestJson<{ items: unknown[] }>(server, "/api/v2/catalog/subjects");
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it("uploads the isolated helper's second version and produces source-bound Review Item evidence", async () => {
    const fileName = `td079-iin_max-${randomUUID()}.dts`;
    const configSet = await post("aurora", "config-sets", { name: `td079-${randomUUID()}` });
    const first = await upload("aurora", fileName, isolatedDts);
    expect(first.version.parsedIndex["td079_cell/iin_max"].value).toBe("<80>");
    await post("aurora", `config-sets/${configSet.item.id}/files`, {
      fileId: first.item.id, role: "base", sortOrder: 0
    });
    const second = await upload("aurora", fileName, isolatedDts);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.currentVersionId).toBe(second.version.id);
    expect(second.version.versionNumber).toBe(2);
    const discovery = await discover("aurora");
    const observed = discovery.items.find((item) => item.source.status === "current"
      && item.source.fileVersionId === second.version.id);
    expect(observed).toMatchObject({
      observedCatalogReleaseId: VENDOR_LOCALIZED_RELEASE_ID,
      compatibles: [{ compatible: "wiseeff,td079-cell", candidate: {
        kind: "review-required", reason: "unknown", reviewItemIds: [expect.any(String)]
      } }]
    });
  });

  it.each(["aurora", "nebula"])("uploads a copy of the seeded %s board while refusing an unreviewed canonical source overwrite", async (projectId) => {
    const fileName = `${projectId}-board.dts`;
    const source = readFileSync(join(process.cwd(), "src/config/dts-seed", fileName), "utf8");
    const snapshot = async () => (await db.query<{ current_version_id: string; versions: number }>(`select file.current_version_id,
      (select count(*)::int from project_parameter_file_versions version where version.file_id = file.id) as versions
      from project_parameter_files file where file.project_id = $1 and file.file_name = $2`, [projectId, fileName])).rows[0]!;
    const before = await snapshot();
    const { server } = makeServer();
    const response = await requestJson<{ error: { details: { reason: string } } }>(server,
      `/api/v1/projects/${projectId}/parameter-files`, {
        method: "POST", body: JSON.stringify({ fileName, contentBase64: Buffer.from(source).toString("base64") })
      });
    expect(response.status, response.bodyText).toBe(409);
    expect(response.body.error.details.reason).toBe("canonical-source-transaction-required");
    expect(await snapshot()).toEqual(before);
    const configSet = await post(projectId, "config-sets", { name: `t1088-copy-${randomUUID()}` });
    const copyName = `t1088-copy-${randomUUID()}.dts`;
    const first = await upload(projectId, copyName, source);
    await post(projectId, `config-sets/${configSet.item.id}/files`, {
      fileId: first.item.id, role: "base", sortOrder: 0
    });
    const second = await upload(projectId, copyName, source);
    const discovery = await discover(projectId);
    const observations = discovery.items.filter((item) => item.source.status === "current"
      && item.source.fileVersionId === second.version.id);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((item) => item.observedCatalogReleaseId === VENDOR_LOCALIZED_RELEASE_ID)).toBe(true);
    expect(observations.some((item) => item.compatibles.some((entry) => entry.candidate.kind === "recognized"))).toBe(true);
  }, 120_000);
});
