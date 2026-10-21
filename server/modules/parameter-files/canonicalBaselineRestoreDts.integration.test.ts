import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, exportCanonicalBindingSource, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction, verifyCanonicalSourceReimport } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { createUserInvocation } from "../auth/trustedInvocation";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createBaseline, type RestorePreviewResult } from "./baselineService";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { SourceRevisionPreview } from "./sourceRevisionService";

const ORG = "org-restore-dts", PROJECT = "project-restore-dts", USER = "user-restore-dts";
const auth = makeTestAuthContext({ organizationId: ORG,userId: USER,roles: [{ roleId: "admin",projectId: null }] });
const rootText = '/dts-v1/;\n/include/ "common.dtsi"\n/ { compatible = "test,board"; model = "snapshot restore"; };\n';
const includeText = '/ { charger: charger { compatible = "acme,power"; iin_max = <36>; }; };\n';
const overlayText = '/dts-v1/; /plugin/; &charger { iin_max = <48>; };\n';

describe("complete root/include/overlay snapshot restore",{ timeout: 120_000 },() => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let directory: string,storage: ReturnType<typeof createLocalObjectStore>,configSetId: string,baselineId: string,bindingId: string;
  let overlayFileId: string;
  const token = `restore_dts_${process.pid}`;
  const route = () => { const router = createRouter(); registerParameterFileRoutes(router,{ db: api,objectStore: storage,getCurrentAuthContext: () => auth,
    refusalAuditSink: createTrustedRefusalAuditSink(db) }); return createHttpServer(router); };
  const post = <T,>(path: string,body: unknown) => requestJson<T>(route(),path,{ method: "POST",body: JSON.stringify(body) });
  const baselinePath = (operation: string) => `/api/v1/projects/${PROJECT}/baselines/${baselineId}/${operation}`;
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("restore-dts"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-restore-dts-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Restore DTS')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Restore DTS','Admin',true)",[USER,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('restore-dts-admin',$1,$2,'admin')",[USER,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Restore DTS','RDTS','initialized')",[PROJECT,ORG]);
    await installDriverSourceFixture(db,auth,{ subjectId: "csub_acme_power",compatible: "acme,power",businessName: "Restore DTS",driverName: "Power",idempotencyKey: "restore-dts-register",reason: "Snapshot restore test" });
    configSetId = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Complete DTS" })).id;
    const definitions = [{ name: "board.dts",content: rootText,role: "base" as const },{ name: "common.dtsi",content: includeText,role: "include" as const },
      { name: "limits.dts",content: overlayText,role: "overlay" as const },{ name: "metadata.json",content: '{"unmapped":true}',role: "charging" as const }];
    const members = [];
    for (const [sortOrder,entry] of definitions.entries()) {
      const uploaded = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: entry.name,bytes: Buffer.from(entry.content) });
      await addConfigSetFile(db,auth,{ configSetId,fileId: uploaded.file.id,role: entry.role === "include" ? "misc" : entry.role,sortOrder });
      members.push({ fileId: uploaded.file.id,fileVersionId: uploaded.version.id,fileName: entry.name,sourceName: entry.name,
        format: uploaded.file.format,content: entry.content,role: entry.role,sortOrder });
      if (entry.role === "overlay") overlayFileId = uploaded.file.id;
    }
    const revision = await ingestConfigRevision(db,{ organizationId: ORG,projectId: PROJECT,configSetId,entryFile: "board.dts",includeSearchPaths: ["."],overlayOrder: ["limits.dts"],members },auth);
    expect(revision.status).toBe("resolved");
    const catalog = await loadPublishedCatalog(getRootPostgresPool(db)!);
    await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),catalog!,{ organizationId: ORG,projectId: PROJECT,configSetId,configRevisionId: revision.id }));
    const gate = await evaluateReleaseReadiness(db,auth,{ configSetId },{ objectStore: storage });
    expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    baselineId = (await createBaseline(db,auth,{ configSetId,name: "Complete source snapshot",gateToken: gate.gateToken,
      acknowledgedWarningIds: gate.warnings.filter((row) => row.acknowledgementRequired).map((row) => row.id) },{},{ objectStore: storage })).id;
    bindingId = (await listCatalogBindingRowsForProject(db,auth,{ projectId: PROJECT }))[0]!.id;
    const logins = await provisionPublicationRuntimeLogins(lane.url,{ mode: "lab",runToken: token }); api = createPostgresDatabase(logins.apiUrl);
  },120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url,token); await db?.close(); await lane?.drop();
    if (directory) await rm(directory,{ recursive: true,force: true }); });

  it("restores the actual include and overlay composition, preserving identity, historical read and export/reimport",async () => {
    const before = (await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT }))[0]!;
    expect(before.rawValue).toBe("<48>");
    const pin = await loadOwnedProjectValueSourcePin(api,{ organizationId: ORG,projectId: PROJECT,bindingId,projectValueId: before.currentValueId });
    const edit = await post<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/parameter-file-candidates`,{ fileId: overlayFileId,fileName: "limits.dts",
      intent: "source_revision",expectedCurrentVersionId: pin!.fileVersionId,expectedConfigRevisionId: pin!.configRevisionId,
      clientMutationId: "restore-dts-edit",contentBase64: Buffer.from(overlayText.replace("<48>","<55>")).toString("base64") });
    expect(edit.status,edit.bodyText).toBe(201);
    const sourcePreview = await requestJson<{ item: SourceRevisionPreview }>(route(),`/api/v1/projects/${PROJECT}/parameter-file-candidates/${edit.body.item.id}/source-preview`);
    expect(sourcePreview.status,sourcePreview.bodyText).toBe(200);
    const applied = await post(`/api/v1/projects/${PROJECT}/parameter-file-candidates/${edit.body.item.id}/source-apply`,{
      expectedCurrentVersionId: pin!.fileVersionId,expectedProofToken: sourcePreview.body.item.proofToken,reason: "Edit before snapshot restore",clientMutationId: "restore-dts-edit-apply" });
    expect(applied.status,applied.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT }))[0]!.rawValue).toBe("<55>");
    const preview = await requestJson<{ item: RestorePreviewResult }>(route(),baselinePath("restore-preview"));
    expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item.canonical).toMatchObject({ canRestore: true,entryFile: "board.dts",includeSearchPaths: ["."],overlayOrder: ["limits.dts"],impact: { parameterChanges: 1 } });
    const body = { proofToken: preview.body.item.canonical!.proofToken,sourceConfigRevisionId: preview.body.item.canonical!.sourceConfigRevisionId,
      reason: "Restore complete root include overlay composition",confirmCompositionChanges: false,clientMutationId: "restore-dts-apply" };
    const restored = await post(baselinePath("rollback"),body);
    expect(restored.status,restored.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,auth,{ projectId: PROJECT }))[0]).toMatchObject({ id: bindingId,rawValue: "<48>" });
    expect(await loadOwnedProjectValueSourcePin(api,{ organizationId: ORG,projectId: PROJECT,bindingId,projectValueId: before.currentValueId })).toMatchObject({ sourcePinId: pin!.sourcePinId });
    const exported = await exportCanonicalBindingSource(api,storage,auth,{ projectId: PROJECT,bindingId });
    expect(await verifyCanonicalSourceReimport(api,storage,auth,{ projectId: PROJECT,bindingId,source: exported! })).toEqual(exported);
    const config = await requestJson<{ files: Array<{ name: string; content: string }> }>(route(),`/api/v1/projects/${PROJECT}/config-sets/${configSetId}/export`);
    expect(config.status,config.bodyText).toBe(200); expect(config.body.files).toContainEqual(expect.objectContaining({ name: "limits.dts",content: overlayText }));
  });
  it("rejects stale source and Catalog plans without any partial source or value writes",async () => {
    const preview = await requestJson<{ item: RestorePreviewResult }>(route(),baselinePath("restore-preview"));
    expect(preview.status,preview.bodyText).toBe(200);
    const before = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const refused = await post(baselinePath("rollback"),{ proofToken: "0".repeat(64),sourceConfigRevisionId: preview.body.item.canonical!.sourceConfigRevisionId,
      reason: "Stale preview",confirmCompositionChanges: false,clientMutationId: "restore-dts-stale" });
    expect(refused.status,refused.bodyText).toBe(409);
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(before);
  });
});
