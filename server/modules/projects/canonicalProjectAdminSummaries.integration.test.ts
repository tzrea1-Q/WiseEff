import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLocalObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { sourceBackedCommand } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { stabilizeCanonicalBinding } from "../parameter-bindings/binding/service";
import { appendProjectValue } from "../parameter-bindings/values/service";
import { ParameterDefinitionId, SubjectRegistrationId } from "../parameter-catalog-contract";
import { registerCanonicalJsonSource } from "../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createProject, getProjectAdminDetail, listProjectAdminSummaries } from "./repository";

const ORG = "org-canonical-project-count";
const USER = "user-canonical-project-count";
const PROJECTS = ["project-canonical-count-first", "project-canonical-count-second"];
const FOREIGN_ORG = "org-canonical-count-foreign";
const FOREIGN_PROJECT = "project-canonical-count-foreign";
const SUBJECT = "csub_canonical_project_count";
const SCHEMA = "wiseeff.project.count";
const DEFINITION = "pdef_acme_power_iin_max";

describe("canonical project admin summaries", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  const auth = makeTestAuthContext({ userId: USER, organizationId: ORG,
    permissions: ["parameter:view", "parameter:edit", "admin:access"] });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("canonicalprojectcounts");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-canonical-project-count-"));
    const storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'Project counts'),($2,'Foreign')", [ORG, FOREIGN_ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Count admin','Admin',true)", [USER, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('canonical-count-admin',$1,$2,null,'admin')", [USER, ORG]);
    for (const [index, projectId] of PROJECTS.entries()) {
      await createProject(db, { organizationId: ORG, id: projectId, name: `Project ${index}`, code: `COUNT${index}` });
    }
    await createProject(db, { organizationId: FOREIGN_ORG, id: FOREIGN_PROJECT, name: "Foreign", code: "FOREIGN" });
    await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT, schemaId: SCHEMA });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published project count fixture is unavailable");
    const identities: string[] = [];
    for (const [index, projectId] of PROJECTS.entries()) {
      const configSet = await createConfigSet(db, auth, { projectId, name: "Project count JSON" });
      const uploaded = await uploadProjectParameterFile(db, storage, auth, {
        projectId, fileName: "settings.json", bytes: Buffer.from(JSON.stringify({ limit: 36.5 + index }))
      });
      await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
        projectId, configSetId: configSet.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
        configurationSchemaId: SCHEMA, rootPointer: "", mappings: [{ definitionId: DEFINITION, pointer: "/limit" }],
        invocation: createUserInvocation(auth), requestId: `canonical-project-count-${index}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
      expect(registered.bindings).toHaveLength(1);
      expect(registered.bindings[0].definitionId).toBe(DEFINITION);
      identities.push(registered.bindings[0].id);
    }
    expect(new Set(identities).size).toBe(2);
  }, 60_000);

  afterAll(async () => {
    setParameterIdentityMode(null);
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("counts each project's distinct JSON Binding in list and detail without initializing modules", async () => {
    setParameterIdentityMode("semantic");
    const summaries = await listProjectAdminSummaries(db, { organizationId: ORG });
    expect(summaries.map((row) => row.id)).toEqual(PROJECTS);
    for (const projectId of PROJECTS) {
      const expected = { id: projectId, parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" };
      expect(summaries.find((row) => row.id === projectId)).toMatchObject(expected);
      expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId })).toMatchObject({ ...expected, modules: [] });
    }
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: FOREIGN_PROJECT })).toBeNull();
    expect(await listProjectAdminSummaries(db, { organizationId: FOREIGN_ORG })).toEqual([
      expect.objectContaining({ id: FOREIGN_PROJECT, parameterCount: 0, moduleCount: 0, initializationStatus: "not_initialized" })
    ]);
  });

  it("excludes the owner's transient placeholder and real value before its source pin exists", async () => {
    setParameterIdentityMode("semantic");
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published project count fixture is unavailable");
    const definition = snapshot.getDefinitionById(ParameterDefinitionId(DEFINITION));
    if (definition.status !== "found") throw new Error("Project count Definition is unavailable");
    const registration = await db.query<{ id: string }>(
      "select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2", [ORG, SUBJECT]);
    const client = await getRootPostgresPool(db)!.connect();
    try {
      await client.query("begin");
      const command = await sourceBackedCommand(client, {
        snapshot, organizationId: ORG, projectId: PROJECTS[0], logicalNodeId: "count-placeholder",
        registrationId: SubjectRegistrationId(registration.rows[0].id), definitionId: ParameterDefinitionId(DEFINITION),
        effectiveRevisionId: definition.definition.selectedRevision.id, expectedEffectiveRevisionId: null
      });
      const stabilized = await stabilizeCanonicalBinding(client, command);
      if (!stabilized.ok) throw new Error(JSON.stringify(stabilized.error));
      const binding = stabilized.value.binding;
      expect((await client.query("select source_ref from parameter_catalog.project_parameter_values where id=$1", [binding.currentValueId])).rows)
        .toEqual([{ source_ref: "canonical-binding-identity" }]);
      expect(await getProjectAdminDetail(client, { organizationId: ORG, projectId: PROJECTS[0] }))
        .toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
      const revision = await client.query<{ id: string }>("select id from dts_config_revisions where project_id=$1 and entry_file like 's6-%'", [PROJECTS[0]]);
      const appended = await appendProjectValue({ query: client.query.bind(client) }, {
        snapshot, binding, definitionRevisionId: binding.effectiveRevisionId,
        source: { sourceRef: "count-placeholder!/limit", configRevisionId: revision.rows[0].id },
        payload: { kind: "number", value: 5 }, expectedTip: binding.currentValueId
      });
      if (!appended.ok) throw new Error(JSON.stringify(appended.error));
      expect((await client.query("select id from parameter_catalog.project_value_source_pins where project_value_id=$1", [appended.value.currentTip])).rows).toEqual([]);
      expect(await getProjectAdminDetail(client, { organizationId: ORG, projectId: PROJECTS[0] }))
        .toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
      // This owner state is reachable inside its transaction only: the deferred
      // source constraint forbids committing the real current value without a pin.
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("retains pre-cutover legacy counts while excluding residual semantic topology rows", async () => {
    await db.query(`insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk)
      values ('count-legacy-definition',$1,'limit','d','e','ENV','Configuration','','mA','Low'),
             ('count-legacy-other',$1,'other','d','e','ENV','Configuration','','mA','Low')`, [ORG]);
    await db.query(`insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value,value_version,updated_by_user_id)
      values ('count-legacy-first',$1,$2,'count-legacy-definition','1','1',1,$4),
             ('count-legacy-second',$1,$2,'count-legacy-other','2','2',1,$4),
             ('count-legacy-sibling',$1,$3,'count-legacy-definition','3','3',1,$4)`, [ORG, PROJECTS[0], PROJECTS[1], USER]);
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key) values ('count-residual-spec',$1,'manual','count/limit'),('count-residual-other',$1,'manual','count/other')", [ORG]);
    const module = await db.query<{ id: string }>("select id from parameter_modules where organization_id=$1 and name='Configuration'", [ORG]);
    await db.query(`insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id)
      values ('count-residual-first',$1,$2,null,'count-residual-spec',$3),('count-residual-second',$1,$2,null,'count-residual-other',$3)`, [ORG, PROJECTS[0], module.rows[0].id]);
    setParameterIdentityMode("legacy");
    expect((await listProjectAdminSummaries(db, { organizationId: ORG })).map((row) => row.parameterCount)).toEqual([2, 1]);
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: PROJECTS[0] })).toMatchObject({ parameterCount: 2, moduleCount: 0, initializationStatus: "not_initialized" });
    setParameterIdentityMode("semantic");
    expect((await listProjectAdminSummaries(db, { organizationId: ORG })).map((row) => row.parameterCount)).toEqual([1, 1]);
    expect(await getProjectAdminDetail(db, { organizationId: ORG, projectId: PROJECTS[0] })).toMatchObject({ parameterCount: 1, moduleCount: 0, initializationStatus: "not_initialized" });
  });
});
