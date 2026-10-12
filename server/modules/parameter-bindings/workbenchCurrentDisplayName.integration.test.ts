import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ProjectParameterBinding } from "../../../src/domain/parameter-topology/types";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { connect, persistPredecessorArtifact } from "../catalog-kernel/install/publicationTestHarness";
import { enablePublicationPolicy } from "../catalog-publication/authorization/testHarness";
import { firstAcmePredecessor } from "../catalog-publication/builder/predecessorHarness";
import { runPublicationManagerOnce } from "../catalog-publication/jobs/manager";
import { CATALOG_RELEASE_HEADER } from "../contracts/dtoSchemas/parameterCatalog";
import { createLocalObjectStore } from "../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";

it("workbench API reads the current Definition head name after an admin publication without changing the Binding pin or value", async () => {
  const database = await createEphemeralTestDatabase("t1137head");
  const db = createPostgresDatabase(database.url);
  const pool = getRootPostgresPool(db)!;
  const client = await connect(database.url);
  const root = await mkdtemp(join(tmpdir(), "t1137-head-"));
  const auth = makeTestAuthContext({
    userId: "t1137-admin", organizationId: "t1137-org", roleId: "admin",
    permissions: ["parameter:view", "parameter:edit", "admin:access", "catalog:author", "catalog:publish"],
  });
  try {
    await db.query("insert into organizations(id,name) values ('t1137-org','Workbench')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('t1137-admin','t1137-org','Editor','Admin',true)");
    await db.query("insert into projects(id,organization_id,name,code,status) values ('t1137-project','t1137-org','Workbench','T1137','initialized')");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('t1137-role','t1137-admin','t1137-org','admin')");
    const fixture = await installDriverSourceFixture(db, auth, {
      subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Power", driverName: "Acme",
      idempotencyKey: "t1137-registration", reason: "Workbench current name fixture",
    });
    await persistPredecessorArtifact(client, firstAcmePredecessor());
    await enablePublicationPolicy(client, { publicationEnabled: true, lowRiskSingleActorPublish: true });
    const config = await createConfigSet(db, auth, { projectId: "t1137-project", name: "default" });
    const server = createWiseEffServer({ db, objectStore: createLocalObjectStore(root), auth: { mode: "development" } });
    const headers = { "x-wiseeff-user": auth.user.id };
    const source = '/dts-v1/;\n/ { device@0 { compatible = "acme,power"; iin_max = <10>; }; };\n';
    const upload = () => requestJson<{ item: { id: string } }>(server,
      "/api/v1/projects/t1137-project/parameter-files", {
        method: "POST", headers,
        body: JSON.stringify({ fileName: "workbench.dts", contentBase64: Buffer.from(source).toString("base64") }),
      });
    const uploaded = await upload();
    expect(uploaded.status, uploaded.bodyText).toBe(201);
    await addConfigSetFile(db, auth, { configSetId: config.id, fileId: uploaded.body.item.id, role: "base", sortOrder: 0 });
    const initialized = await upload();
    expect(initialized.status, initialized.bodyText).toBe(201);
    const list = () => requestJson<{ items: Array<ProjectParameterBinding & { currentDisplayName?: string | null }> }>(server,
      "/api/v2/projects/t1137-project/parameter-bindings", { headers });
    const before = await list();
    expect(before.status, before.bodyText).toBe(200);
    expect(before.body.items).toHaveLength(1);
    const binding = before.body.items[0]!;
    expect(binding).toMatchObject({
      definitionId: "pdef_acme_power_iin_max", displayName: "Input current limit",
      effectiveRevisionId: "drev_acme_power_iin_max_1", currentValueId: expect.any(String), rawValue: "<10>",
    });

    const renamedDisplayName = "Maximum input current (renamed by admin)";
    const publicationHeaders = { ...headers, [CATALOG_RELEASE_HEADER]: fixture.release.id };
    const candidate = await requestJson<{ item: { id: string; riskClass: string } }>(server,
      "/api/v2/catalog/publication-candidates", {
        method: "POST", headers: publicationHeaders,
        body: JSON.stringify({ changeSet: [{
          op: "revise-definition", definitionId: binding.definitionId, class: "documentation",
          content: {
            displayName: renamedDisplayName, documentation: "Maximum accepted input current.",
            unit: "mA", valueSchema: { type: "integer", minimum: 0 },
          },
        }] }),
      });
    expect(candidate.status, candidate.bodyText).toBe(201);
    expect(candidate.body.item.riskClass).toBe("low");
    const published = await requestJson<{ item: { id: string } }>(server,
      `/api/v2/catalog/publication-candidates/${candidate.body.item.id}/publish`, {
        method: "POST", headers: publicationHeaders,
        body: JSON.stringify({ idempotencyKey: "t1137-admin-rename" }),
      });
    expect(published.status, published.bodyText).toBe(201);
    expect(await runPublicationManagerOnce({
      db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => createUserInvocation(auth), ownerId: "t1137-publication-manager",
    })).toBe("claimed");
    const job = await requestJson<{ item: { status: string } }>(server,
      `/api/v2/catalog/publications/${published.body.item.id}`, { headers });
    expect(job.status, job.bodyText).toBe(200);
    expect(job.body.item.status).toBe("active");

    const after = await list();
    expect(after.status, after.bodyText).toBe(200);
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0]).toMatchObject({
      id: binding.id, effectiveRevisionId: binding.effectiveRevisionId, currentValueId: binding.currentValueId,
      displayName: binding.displayName, rawValue: binding.rawValue,
    });
    expect(after.body.items[0]?.currentDisplayName).toBe(renamedDisplayName);
  } finally {
    await client.end();
    await db.close();
    await database.drop();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
