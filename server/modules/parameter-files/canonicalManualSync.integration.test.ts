import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createLocalObjectStore } from "../logs/objectStore";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { installConfigurationSourceFixture, captureConfigurationSourceState, seedMixedRevisionCohortProbe, seedDtsMixedRevisionCohortProbe } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { asValueClient, loadPublishedCatalog, listCatalogBindingRowsForProject, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { registerParameterFileRoutes } from "./routes";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import type { ConfigRevisionManifest } from "../parameter-topology/types";

const ORG = "org-906-workflow";
const JSON_PROJECT = "project-906-json";
const DTS_PROJECT = "project-906-dts";
const ADMIN = "user-906-admin";
const REVIEWER = "user-906-reviewer";
const OTHER = "user-906-other";
const SUBJECT = "csub_906_limits";
const MODEL = "wiseeff.906.limits";
const DEFINITION = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({
  userId: ADMIN, organizationId: ORG,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

describe("#906 canonical JSON candidate workflow", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let versionId: string;
  let configSetId: string;
  let bindings: Array<{ id: string; currentValueId: string }>;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-json-workflow");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-json-workflow-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 workflow')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$2,'other','User',true)", [ADMIN, ORG, REVIEWER, OTHER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON workflow','J906','initialized'),($3,$2,'DTS workflow','D906','initialized')", [JSON_PROJECT, ORG, DTS_PROJECT]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-admin',$1,$2,null,'admin'),('role-906-json-reviewer',$3,$2,$4,'software-committer'),('role-906-dts-reviewer',$3,$2,$5,'software-committer'),('role-906-other',$6,$2,$4,'software-user')", [ADMIN, ORG, REVIEWER, JSON_PROJECT, DTS_PROJECT, OTHER]);

    await installConfigurationSourceFixture(db, admin, { subjectId: SUBJECT, schemaId: MODEL });
    const set = await createConfigSet(db, admin, { projectId: JSON_PROJECT, name: "JSON workflow" });
    configSetId = set.id;
    const uploaded = await uploadProjectParameterFile(db, storage, admin, {
      projectId: JSON_PROJECT,
      fileName: "settings.json",
      bytes: Buffer.from('{ "settings": { "limit": 36.5, "keep": true }, "other": { "limit": 48 } }\n')
    });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId, fileId, role: "base", sortOrder: 0 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const first = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: versionId,
      configurationSchemaId: MODEL,
      rootPointer: "",
      mappings: [{ definitionId: DEFINITION, pointer: "/settings/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-register-settings",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const second = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId: JSON_PROJECT,
      configSetId,
      fileId,
      fileVersionId: versionId,
      configurationSchemaId: MODEL,
      rootPointer: "/other",
      mappings: [{ definitionId: DEFINITION, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin),
      requestId: "906-json-register-other",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    bindings = [
      { id: first.bindings[0]!.id, currentValueId: first.bindings[0]!.currentValueId },
      { id: second.bindings[0]!.id, currentValueId: second.bindings[0]!.currentValueId }
    ];
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("rejects a mixed-revision canonical JSON cohort through manual sync without writes", async () => {
    expect(bindings).toHaveLength(2);
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: JSON_PROJECT });
    const beforeObjects = await readdir(join(storageDirectory, ORG));
    const activeVersionId = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [fileId]
    )).rows[0]!.current_version_id;
    const activeBindings = await listCatalogBindingRowsForProject(db, admin, { projectId: JSON_PROJECT });
    const healthyRouter = createRouter();
    registerParameterFileRoutes(healthyRouter, { db, objectStore: storage, getCurrentAuthContext: () => admin });
    const healthy = await requestJson(createHttpServer(healthyRouter), `/api/v1/projects/${JSON_PROJECT}/parameter-files/${fileId}/sync`, {
      method: "POST", body: JSON.stringify({ versionId: activeVersionId })
    });
    expect(healthy).toMatchObject({ status: 200, body: { item: { unchanged: 2, draftsCreated: 0, sourceWorkflow: "canonical" } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: JSON_PROJECT })).toEqual(before);
    const rollback = new Error("rollback mixed-revision sync probe");
    await expect(db.transaction(async (tx) => {
      await seedMixedRevisionCohortProbe(tx, {
        organizationId: ORG, projectId: JSON_PROJECT,
        bindingId: activeBindings[1]!.id, projectValueId: activeBindings[1]!.currentValueId
      });
      const mixed = await captureConfigurationSourceState(tx, { organizationId: ORG, projectId: JSON_PROJECT });
      const router = createRouter();
      registerParameterFileRoutes(router, { db: tx, objectStore: storage, getCurrentAuthContext: () => admin });
      const response = await requestJson(createHttpServer(router), `/api/v1/projects/${JSON_PROJECT}/parameter-files/${fileId}/sync`, {
        method: "POST", body: JSON.stringify({ versionId: activeVersionId })
      });
      if (response.status === 200) expect(response.body).toMatchObject({ item: { unchanged: 2 } });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: "CONFLICT", details: { reason: "mixed-source-revisions" } } });
      expect(await captureConfigurationSourceState(tx, { organizationId: ORG, projectId: JSON_PROJECT })).toEqual(mixed);
      expect(await readdir(join(storageDirectory, ORG))).toEqual(beforeObjects);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: JSON_PROJECT })).toEqual(before);
    expect(await readdir(join(storageDirectory, ORG))).toEqual(beforeObjects);
  });

});

describe("#906 canonical DTS candidate workflow", () => {
  const source = `/dts-v1/;\n/ {\n  charger: device@0 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n  backup: device@1 {\n    compatible = "acme,power";\n    iin_max = <36>;\n  };\n};\n`;
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let storageDirectory: string;
  let fileId: string;
  let versionId: string;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-dts-workflow");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-dts-workflow-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 DTS')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [ADMIN, ORG, REVIEWER]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'DTS workflow','D906','initialized')", [DTS_PROJECT, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-dts-admin',$1,$2,null,'admin'),('role-906-dts-reviewer',$3,$2,$4,'software-committer')", [ADMIN, ORG, REVIEWER, DTS_PROJECT]);
    await installDriverSourceFixture(db, admin, {
      subjectId: "csub_acme_power",
      compatible: "acme,power",
      businessName: "#906 DTS",
      driverName: "Acme power",
      idempotencyKey: "906-dts-registration",
      reason: "Issue 906 DTS workflow"
    });
    const set = await createConfigSet(db, admin, { projectId: DTS_PROJECT, name: "DTS workflow" });
    const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: DTS_PROJECT, fileName: "board.dts", bytes: Buffer.from(source) });
    fileId = uploaded.file.id;
    versionId = uploaded.version.id;
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId, role: "base", sortOrder: 0 });
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG,
      projectId: DTS_PROJECT,
      configSetId: set.id,
      entryFile: "board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [{ fileId, fileVersionId: versionId, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }]
    };
    const revision = await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, {
      organizationId: ORG,
      projectId: DTS_PROJECT,
      configSetId: set.id,
      configRevisionId: revision.id
    }));
    const rows = await listCatalogBindingRowsForProject(db, admin, { projectId: DTS_PROJECT });
    expect(rows).toHaveLength(2);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("rejects a mixed-revision canonical DTS cohort through manual sync without writes", async () => {
    const before = await captureConfigurationSourceState(db, { organizationId: ORG, projectId: DTS_PROJECT });
    const beforeObjects = await readdir(join(storageDirectory, ORG));
    const original = await listCatalogBindingRowsForProject(db, admin, { projectId: DTS_PROJECT });
    const healthyRouter = createRouter();
    registerParameterFileRoutes(healthyRouter, { db, objectStore: storage, getCurrentAuthContext: () => admin });
    const healthy = await requestJson(createHttpServer(healthyRouter), `/api/v1/projects/${DTS_PROJECT}/parameter-files/${fileId}/sync`, {
      method: "POST", body: JSON.stringify({ versionId })
    });
    expect(healthy).toMatchObject({ status: 200, body: { item: { unchanged: 2, draftsCreated: 0, sourceWorkflow: "canonical" } } });
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: DTS_PROJECT })).toEqual(before);
    const rollback = new Error("rollback mixed-revision DTS sync probe");
    await expect(db.transaction(async (tx) => {
      const configSetId = (await tx.query<{ config_set_id: string }>("select config_set_id from project_parameter_files where id=$1", [fileId])).rows[0]!.config_set_id;
      const oldPin = await loadOwnedProjectValueSourcePin(tx, {
        organizationId: ORG, projectId: DTS_PROJECT,
        bindingId: original[0]!.id, projectValueId: original[0]!.currentValueId
      });
      if (!oldPin || oldPin.locator.kind !== "dts-property") throw new Error("DTS probe requires a pinned property");
      const revision = await ingestConfigRevision(tx, {
        organizationId: ORG, projectId: DTS_PROJECT, configSetId,
        entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
        members: [{ fileId, fileVersionId: versionId, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: source }]
      }, admin, { legacyProjection: "skip", sourceCommit: { baseConfigRevisionId: oldPin.configRevisionId } });
      const occurrence = (await tx.query<{ property_id: string; node_id: string }>(`select effect.property_occurrence_id as property_id,effect.node_occurrence_id as node_id
        from dts_occurrence_effects effect
        join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
        join dts_property_occurrences property on property.id=effect.property_occurrence_id
        where effect.config_revision_id=$1 and logical.logical_node_id=$2
          and property.property_name=$3 and effect.effect_kind in ('set','override')`,
      [revision.id, oldPin.logicalNodeId, oldPin.locator.propertyName])).rows[0];
      if (!occurrence) throw new Error("DTS probe requires the exact new occurrence");
      const locator = { ...oldPin.locator, nodeOccurrenceId: occurrence.node_id, propertyOccurrenceId: occurrence.property_id };
      await seedDtsMixedRevisionCohortProbe(tx, {
        organizationId: ORG, projectId: DTS_PROJECT,
        bindingId: original[0]!.id, projectValueId: original[0]!.currentValueId,
        previousPinId: oldPin.sourcePinId, configRevisionId: revision.id,
        propertyOccurrenceId: occurrence.property_id, locator
      });
      const mixed = await captureConfigurationSourceState(tx, { organizationId: ORG, projectId: DTS_PROJECT });
      const router = createRouter();
      registerParameterFileRoutes(router, { db: tx, objectStore: storage, getCurrentAuthContext: () => admin });
      const response = await requestJson(createHttpServer(router), `/api/v1/projects/${DTS_PROJECT}/parameter-files/${fileId}/sync`, {
        method: "POST", body: JSON.stringify({ versionId })
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: "CONFLICT", details: { reason: "mixed-source-revisions" } } });
      expect(await captureConfigurationSourceState(tx, { organizationId: ORG, projectId: DTS_PROJECT })).toEqual(mixed);
      expect(await readdir(join(storageDirectory, ORG))).toEqual(beforeObjects);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await captureConfigurationSourceState(db, { organizationId: ORG, projectId: DTS_PROJECT })).toEqual(before);
    expect(await readdir(join(storageDirectory, ORG))).toEqual(beforeObjects);
  });

});
