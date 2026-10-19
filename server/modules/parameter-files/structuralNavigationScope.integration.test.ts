import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { executeRegistration } from "../parameter-governance/registration/service";
import { SubjectRegistrationId } from "../parameter-catalog-contract";
import type { AuthContext } from "../auth/types";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { StructuralReadResponse } from "./schemas";

const org = "navigation-org";
const project = "navigation-project";
const admin = makeTestAuthContext({ userId: "navigation-admin", organizationId: org,
  permissions: ["parameter:view", "parameter:edit", "admin:access"], roles: [{ roleId: "admin", projectId: null }] });
const source = `/dts-v1/;
/ {
  soc {
    context_flag = <7>;
    bus@1 {
      device@0 { compatible = "acme,power-v1", "repro,unknown"; iin_max = <36>;
        unrelated-child { noise = <1>; };
      };
      device@1 { compatible = "acme,power"; status = "disabled"; };
      unrelated@2 { compatible = "repro,unknown"; noise = <2>; };
    };
  };
};`;

describe("organization-scoped structure with native PostgreSQL", () => {
  let lane: EphemeralTestDatabase;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let release: { id: string; digest: string };
  let fileId: string;
  let versionId: string;

  const server = (auth: AuthContext = admin) => {
    const router = createRouter();
    registerParameterFileRoutes(router, { db, getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  };
  const structurePath = (version = versionId) =>
    `/api/v1/projects/${project}/parameter-files/${fileId}/versions/${version}/structure`;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("nav-scope");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-navigation-"));
    await db.query("insert into organizations(id,name) values ($1,'Navigation'),('navigation-other-org','Other')", [org]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [admin.user.id, org]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Navigation','NAV','initialized')", [project, org]);
    ({ release } = await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "Power", driverName: "Power device", idempotencyKey: "navigation-driver", reason: "Navigation fixture" }));
    const upload = await uploadProjectParameterFile(db, createLocalObjectStore(directory), admin, {
      projectId: project, fileName: "navigation.dts", bytes: Buffer.from(source)
    });
    fileId = upload.file.id;
    versionId = upload.version.id;
  });

  afterAll(async () => {
    await db?.close();
    await lane?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps full version structure, filters navigation/search, and enforces file authorization", async () => {
    const full = await requestJson<StructuralReadResponse>(server(), structurePath());
    expect(full.status).toBe(200);
    expect(full.body.navigation).toBeUndefined();
    const scoped = await requestJson<StructuralReadResponse>(server(), `${structurePath()}?navigationScope=organization`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.nodes).toEqual(full.body.nodes);
    expect(scoped.body.navigation).toEqual({ status: "ready", catalogReleaseId: release.id,
      managedNodePaths: ["soc/bus@1/device@0", "soc/bus@1/device@1"] });
    expect(scoped.body.nodes.some((node) => node.nodePath === "soc/bus@1/unrelated@2")).toBe(true);
    expect(scoped.body.nodes.find((node) => node.nodePath === "soc/bus@1/device@1")?.status).toBe("disabled");

    const search = (query: string, auth = admin) => requestJson<{ hits: Array<{ nodePath: string; propertyName?: string }> }>(
      server(auth), `/api/v1/projects/${project}/dts-search?navigationScope=organization&${query}`);
    expect((await search("q=unrelated&by=path")).body.hits).toEqual([]);
    expect((await search("q=soc&by=path")).body.hits.map((hit) => hit.nodePath)).toEqual([
      "soc", "soc/bus@1", "soc/bus@1/device@0", "soc/bus@1/device@1"
    ]);
    expect((await search("q=context_flag")).body.hits).toEqual([]);
    expect((await search("q=iin_max")).body.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodePath: "soc/bus@1/device@0", propertyName: "iin_max" })
    ]));
    expect((await search("q=navigation.dts&by=file")).body.hits).toHaveLength(1);

    const foreign = makeTestAuthContext({ userId: "foreign", organizationId: "navigation-other-org",
      permissions: ["parameter:view", "admin:access"], roles: [{ roleId: "admin", projectId: null }] });
    expect((await requestJson(server(foreign), `${structurePath()}?navigationScope=organization`)).status).toBe(404);
    expect((await search("q=device&by=path", foreign)).body.hits).toEqual([]);
    const noView = { ...admin, permissions: [] };
    expect((await requestJson(server(noView), `${structurePath()}?navigationScope=organization`)).status).toBe(403);
    expect((await requestJson(server(), `${structurePath("missing-version")}?navigationScope=organization`)).status).toBe(404);
  });

  it("scopes the exact requested version and reads current registration state without losing source", async () => {
    const next = await uploadProjectParameterFile(db, createLocalObjectStore(directory), admin, {
      projectId: project, fileName: "navigation.dts", bytes: Buffer.from(source.replaceAll("bus@1", "bus@10"))
    });
    const historical = await requestJson<StructuralReadResponse>(server(), `${structurePath()}?navigationScope=organization`);
    const current = await requestJson<StructuralReadResponse>(server(), `${structurePath(next.version.id)}?navigationScope=organization`);
    expect(historical.body.navigation).toMatchObject({ managedNodePaths: ["soc/bus@1/device@0", "soc/bus@1/device@1"] });
    expect(current.body.navigation).toMatchObject({ managedNodePaths: ["soc/bus@10/device@0", "soc/bus@10/device@1"] });
    const registration = (await db.query<{ id: string }>(
      "select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id='csub_acme_power'", [org]
    )).rows[0]!;
    expect(await executeRegistration(getRootPostgresPool(db)!, {
      kind: "retire", organizationId: org, registrationId: SubjectRegistrationId(registration.id),
      expectedRelease: release as Parameters<typeof executeRegistration>[1]["expectedRelease"],
      idempotencyKey: "navigation-retire", context: { actorKind: "org-admin", principalId: admin.user.id },
      reason: "Verify current organization navigation"
    })).toMatchObject({ ok: true });
    const retired = await requestJson<StructuralReadResponse>(server(), `${structurePath()}?navigationScope=organization`);
    expect(retired.body.nodes).toEqual(historical.body.nodes);
    expect(retired.body.navigation).toEqual({ status: "ready", catalogReleaseId: release.id, managedNodePaths: [] });
  });
});
