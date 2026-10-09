import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { countLegacyProjectBindings, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { createProject } from "../projects/repository";
import { createParameterRuntimeActions } from "@/application/parameters/parameterRuntime";
import { createHttpParameterRepository } from "@/infrastructure/http/parameterClient";
import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";
import { createApiClient } from "@/infrastructure/http/apiClient";

const organizationId = "org-shell-1075";
const projectId = "project-shell-1075";
const userId = "user-shell-1075";
const auth = makeTestAuthContext({ userId, organizationId });

describe("#1075 canonical shell source on the assembled API server", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let server: ReturnType<typeof createWiseEffServer>;
  let baseUrl: string;
  let bindingId: string;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("shell1075");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-shell-1075-"));
    const storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Shell organization')", [organizationId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Shell user','Admin',true)", [userId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shell-1075-admin',$1,$2,null,'admin')", [userId, organizationId]);
    await createProject(db, { organizationId, id: projectId, name: "Canonical-only shell project", code: "SHELL1075" });
    await installConfigurationSourceFixture(db, auth, { subjectId: "csub_shell1075", schemaId: "wiseeff.shell1075" });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Shell Catalog fixture unavailable");
    const configSet = await createConfigSet(db, auth, { projectId, name: "default" });
    const uploaded = await uploadProjectParameterFile(db, storage, auth, {
      projectId, fileName: "settings.json", bytes: Buffer.from('{"limit":36.5}')
    });
    await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
      configurationSchemaId: "wiseeff.shell1075", rootPointer: "",
      mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(auth), requestId: "shell-1075-source",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    expect(registered.bindings).toHaveLength(1);
    bindingId = registered.bindings[0].id;
    server = createWiseEffServer({ db, objectStore: storage });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Shell test server unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db?.close();
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("hydrates the canonical-only Binding while historical parameter reads fail", async () => {
    expect(await countLegacyProjectBindings(db, { organizationId, projectIds: [projectId] })).toBe(0);
    const options = {
      baseUrl,
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v1/parameters") return new Response('{"error":{"code":"INTERNAL_ERROR","message":"Historical reader unavailable"}}', { status: 500 });
        return fetch(input, { ...init, headers: { ...init?.headers, "X-WiseEff-User": userId } });
      }
    };
    const response = await options.fetchImpl(`${baseUrl}/api/v2/projects/${projectId}/parameter-bindings`);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ items: [{ id: bindingId, definitionId: "pdef_acme_power_iin_max" }] });
    const dispatch = vi.fn();
    const runtime = createParameterRuntimeActions({
      runtimeMode: "api", dispatch,
      repository: createHttpParameterRepository(createApiClient(options)),
      canonicalRepository: createParameterCatalogClient(options)
    });
    expect(await runtime.refresh()).toMatchObject({
      projects: [{ id: projectId }],
      parameters: [{ id: bindingId, projectId, name: "iin_max", currentValue: "36.5\n" }],
      parameterDrafts: []
    });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_PARAMETER_RUNTIME" }));
  });
});
