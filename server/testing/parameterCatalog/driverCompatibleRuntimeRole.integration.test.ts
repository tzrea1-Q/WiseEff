import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase } from "../../shared/database/client";
import { makeTestAuthContext } from "../authContext";
import { createEphemeralTestDatabase } from "../testDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../modules/catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../../modules/logs/objectStore";
import { listCatalogBindingRowsForProject } from "../../modules/parameter-bindings/catalogProjectValueSync";
import { listDriverCompatibleDiscovery } from "../../modules/parameter-governance/queries";
import { ingestConfigRevision } from "../../modules/parameter-topology/ingestService";
import { captureConfigurationSourceState } from "./configurationSource";
import { installDriverSourceFixture } from "./driverSource";
import { insertDtsObservationSourceFixture } from "./dtsObservationSource";

const ORG = "org-d897-runtime", PROJECT = "project-d897-runtime", USER = "user-d897-runtime";
const FILE = "file-d897-runtime", SET = "set-d897-runtime", VERSION = "version-d897-runtime";
const admin = makeTestAuthContext({ organizationId: ORG,userId: USER,
  roles: [{ roleId: "admin",projectId: null }] });
const viewer = makeTestAuthContext({ organizationId: ORG,userId: "viewer-d897-runtime",
  permissions: ["parameter:view"],roles: [{ roleId: "software-user",projectId: PROJECT }] });

describe("#897 discovery on the application SQL LOGIN", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let token: string;
  let observationId: string;
  let objectPath: string;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("d897api");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-d897-api-"));
    const store = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'D897 runtime')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'D897 runtime','Admin',true)",[USER,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'D897 runtime','D897R','initialized')",[PROJECT,ORG]);
    const release = await installDriverSourceFixture(db,admin,{ subjectId: "csub_acme_power",
      compatible: "acme,power",businessName: "D897 business",driverName: "D897 driver",
      idempotencyKey: "d897-api-release",reason: "D897 API role fixture" });
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,'D897')",
      [SET,ORG,PROJECT]);
    await db.query(`insert into project_parameter_files
      (id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
      values ($1,$2,$3,'board.dts','dts',$4,'base',0)`,[FILE,ORG,PROJECT,SET]);
    const content = '/dts-v1/;\n/ { device@0 { compatible = "vendor,device", "acme,power"; limit = <10>; }; };\n';
    const object = await store.put({ organizationId: ORG,fileName: "board.dts",
      contentType: "text/plain",bytes: Buffer.from(content) });
    objectPath = join(directory,object.storageKey);
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
      [VERSION,FILE,object.storageKey,object.checksumSha256,object.fileSizeBytes,USER]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",[FILE,VERSION]);
    const revision = await ingestConfigRevision(db,{ organizationId: ORG,projectId: PROJECT,
      configSetId: SET,entryFile: "board.dts",includeSearchPaths: [],overlayOrder: [],
      members: [{ fileId: FILE,fileVersionId: VERSION,fileName: "board.dts",sourceName: "board.dts",
        content,role: "base",sortOrder: 0 }] },admin);
    expect(revision.status).toBe("resolved");
    const effect = (await db.query<{ logicalNodeId: string; nodeOccurrenceId: string;
      propertyOccurrenceId: string }>(
      `select logical.logical_node_id as "logicalNodeId",effect.node_occurrence_id as "nodeOccurrenceId",
        effect.property_occurrence_id as "propertyOccurrenceId"
       from dts_occurrence_effects effect
       join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       where effect.config_revision_id=$1 and logical.node_locator='/device@0'
         and effect.property_name='compatible'`,[revision.id])).rows;
    expect(effect).toHaveLength(1);
    observationId = "observation-d897-runtime";
    await insertDtsObservationSourceFixture(db,{ organizationId: ORG,projectId: PROJECT,
      configSetId: SET,fileId: FILE,logicalNodeId: effect[0]!.logicalNodeId,
      configRevisionId: revision.id,occurrenceId: "occurrence-d897-runtime",observationId,
      catalogReleaseId: release.release.id,
      locator: { kind: "dts-property",fileVersionId: VERSION,
        nodeOccurrenceId: effect[0]!.nodeOccurrenceId,
        propertyOccurrenceId: effect[0]!.propertyOccurrenceId,propertyName: "compatible" } });
    token = `d897${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(lane.url,{ mode: "lab",runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ sessionUser: string; currentUser: string; superuser: boolean }>(
      `select session_user as "sessionUser",current_user as "currentUser",rolsuper as superuser
       from pg_roles where rolname=current_user`)).rows[0])
      .toEqual({ sessionUser: runtime.apiRole,currentUser: runtime.apiRole,superuser: false });
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    if (token && lane) expect((await dropLabRuntimeLogins(lane.url,token)).failed).toEqual([]);
    await db?.close(); await lane?.drop();
    if (directory) await rm(directory,{ recursive: true,force: true });
  });

  it("reads current compatible tokens through discovery without a Binding or writes", async () => {
    const store = createLocalObjectStore(directory);
    const before = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const bytes = await readFile(objectPath);
    expect(await listCatalogBindingRowsForProject(db,admin,{ projectId: PROJECT })).toEqual([]);
    const page = await listDriverCompatibleDiscovery({ db: api,objectStore: store,auth: viewer,observationId });
    expect(page).toMatchObject({ status: "ready",items: [{ source: { status: "current" },
      compatibles: [{ compatible: "vendor,device" },{ compatible: "acme,power" }] }] });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
    expect(await readFile(objectPath)).toEqual(bytes);
  });
});
