import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installDriverSourceFixture } from "../../../testing/parameterCatalog/driverSource";
import { insertDtsObservationSourceFixture } from "../../../testing/parameterCatalog/dtsObservationSource";
import { createLocalObjectStore } from "../../logs/objectStore";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { createReviewQueueReader } from "../review";
import { createEvidenceIngest } from "../evidence";
import { resolveReviewItem } from "../resolveReviewItem";
import { captureCurrentCatalogPin } from "../../catalog-publication/runtime";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { createCatalogKernel, DriverCompatible, NormalizedNodeTypeName,
  jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { subjectMatcherRevision } from "../../catalog-kernel/runtime/subjectMatch";
import { listDriverCompatibleDiscovery } from "./driverCompatibleDiscovery";

const ORG = "org-c1-read", PROJECT = "project-c1-read", OTHER_PROJECT = "project-c1-other";
const admin = makeTestAuthContext({ organizationId: ORG,userId: "c1-admin",
  roles: [{ roleId: "admin",projectId: null }] });
const viewer = makeTestAuthContext({ organizationId: ORG,userId: "c1-viewer",
  roles: [{ roleId: "software-user",projectId: PROJECT }] });
const foreign = makeTestAuthContext({ organizationId: "org-c1-foreign",userId: "c1-foreign",
  roles: [{ roleId: "admin",projectId: null }] });

describe("#897 C1 authenticated current DTS discovery", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let releaseId: string;
  let first: Awaited<ReturnType<typeof createSource>>;
  let second: Awaited<ReturnType<typeof createSource>>;
  let hidden: Awaited<ReturnType<typeof createSource>>;

  async function createSource(label: string, projectId = PROJECT,
    compatible = '"vendor,device", "other,device", "acme,power"') {
    const configSetId = `set-c1-${label}`, fileId = `file-c1-${label}`;
    const fileName = `board-${label}.dts`;
    const content = `/dts-v1/;\n/ { charger { compatible = ${compatible}; limit = <10>; }; };\n`;
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,$4)",
      [configSetId,ORG,projectId,label]);
    await db.query(`insert into project_parameter_files
      (id,organization_id,project_id,file_name,format,config_set_id,config_set_role,config_set_sort_order)
      values ($1,$2,$3,$4,'dts',$5,'base',0)`, [fileId,ORG,projectId,fileName,configSetId]);
    const object = await storage.put({ organizationId: ORG,fileName,contentType: "text/plain",bytes: Buffer.from(content) });
    const fileVersionId = `${fileId}-v1`;
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
      [fileVersionId,fileId,object.storageKey,object.checksumSha256,object.fileSizeBytes,admin.user.id]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",[fileId,fileVersionId]);
    const manifest: ConfigRevisionManifest = { organizationId: ORG,projectId,configSetId,
      entryFile: fileName,includeSearchPaths: [],overlayOrder: [],members: [
        { fileId,fileVersionId,fileName,sourceName:fileName,content,role:"base",sortOrder:0 },
      ] };
    const revision = await ingestConfigRevision(db,manifest,admin,{ legacyProjection: "skip" });
    expect(revision.status).toBe("resolved");
    const row = (await db.query<{ logicalNodeId: string; nodeOccurrenceId: string;
      propertyOccurrenceId: string }>(
      `select logical.logical_node_id as "logicalNodeId",effect.node_occurrence_id as "nodeOccurrenceId",
        effect.property_occurrence_id as "propertyOccurrenceId"
       from dts_occurrence_effects effect
       join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       where effect.config_revision_id=$1 and logical.node_locator='/charger' and effect.property_name='limit'
       order by effect.source_order desc limit 1`,[revision.id])).rows[0]!;
    expect(row).toBeTruthy();
    const observationId = `obs-c1-${label}`;
    await insertDtsObservationSourceFixture(db,{ organizationId: ORG,projectId,configSetId,fileId,
      logicalNodeId: row.logicalNodeId,configRevisionId: revision.id,occurrenceId: `occ-c1-${label}`,
      observationId,catalogReleaseId:releaseId,
      locator: { kind:"dts-property",fileVersionId,nodeOccurrenceId:row.nodeOccurrenceId,
        propertyOccurrenceId:row.propertyOccurrenceId,propertyName:"limit" } });
    return { observationId,configSetId,fileId,fileVersionId,manifest,revision,
      logicalNodeId:row.logicalNodeId,nodeOccurrenceId:row.nodeOccurrenceId,
      propertyOccurrenceId:row.propertyOccurrenceId };
  }

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("c1discovery");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-c1-discovery-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'C1 read')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'C1 admin','Admin',true)",
      [admin.user.id,ORG]);
    for (const projectId of [PROJECT,OTHER_PROJECT]) await db.query(
      "insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$3,'initialized')",
      [projectId,ORG,projectId]);
    releaseId = (await installDriverSourceFixture(db,admin,{ subjectId:"csub_acme_power",compatible:"acme,power",
      businessName:"C1 business",driverName:"C1 driver",idempotencyKey:"c1-driver",reason:"C1 read" })).release.id;
    first = await createSource("first");
    second = await createSource("second");
    hidden = await createSource("hidden",OTHER_PROJECT);
  },120_000);

  afterAll(async () => { await db?.close();await lane?.drop();if(directory) await rm(directory,{recursive:true,force:true}); });

  it("binds persisted observation provenance, paginates, and matches complete selectors only", async () => {
    const query = { db,objectStore: storage,auth: viewer };
    const state = async () => (await db.query<{ observations:string; evidence:string; items:string; audits:string }>(
      `select (select count(*)::text from parameter_catalog.parameter_observations) as observations,
        (select count(*)::text from parameter_catalog.parameter_review_evidence) as evidence,
        (select count(*)::text from parameter_catalog.parameter_review_items) as items,
        (select count(*)::text from public.audit_events) as audits`)).rows[0]!;
    const before = await state();
    const firstPage = await listDriverCompatibleDiscovery({ ...query,limit:1 });
    expect(firstPage.status).toBe("ready");
    if (firstPage.status !== "ready") return;
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBe(first.observationId);
    expect(firstPage.ignoredReviewItemCount).toBeNull();
    expect(firstPage.matcherRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(firstPage.matcherRevision).toBe(subjectMatcherRevision);
    expect(firstPage.items[0]).toMatchObject({ observationId:first.observationId,
      observedCatalogReleaseId:releaseId,observedMatcherRevision:"matcher-d897",
      source:{ status:"current",configSetId:first.configSetId },
      compatibles:[{ compatible:"vendor,device",candidate:{ kind:"review-required",reason:"unknown",
        reviewItemIds:null } },
        { compatible:"other,device",candidate:{ kind:"review-required",reason:"unknown" } },
        { compatible:"acme,power",candidate:{ kind:"recognized",subjectId:"csub_acme_power" } }] });
    expect(firstPage.items[0]?.compatibles).toHaveLength(3);
    const next = await listDriverCompatibleDiscovery({ ...query,limit:1,cursor:firstPage.nextCursor! });
    expect(next.status === "ready" && next.items.map((item) => item.observationId)).toEqual([second.observationId]);
    expect(next.status === "ready" && next.nextCursor).toBeNull();
    await expect(listDriverCompatibleDiscovery({ ...query,observationId:hidden.observationId }))
      .rejects.toMatchObject({ code:"NOT_FOUND" });
    await expect(listDriverCompatibleDiscovery({ ...query,projectId:OTHER_PROJECT }))
      .rejects.toMatchObject({ code:"NOT_FOUND" });
    const foreignPage = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:foreign });
    expect(foreignPage).toMatchObject({ status:"ready",items:[],ignoredReviewItemCount:0,
      emptyReason:"no-observations" });
    const forged = await listDriverCompatibleDiscovery({ ...query,observationId:first.observationId,
      configRevisionId:"forged",locator:{kind:"dts-property",propertyName:"compatible"} } as Parameters<typeof listDriverCompatibleDiscovery>[0]);
    expect(forged.status === "ready" && forged.items[0]?.source.status).toBe("current");
    expect((await db.query("select id from parameter_catalog.current_project_parameter_bindings where project_id=$1",
      [PROJECT])).rows).toEqual([]);
    const roleUrl = new URL(lane.url);
    roleUrl.searchParams.set("options","-c role=catalog_migration_owner");
    const roleDb = createPostgresDatabase(roleUrl.toString());
    try {
      expect((await roleDb.query<{ name:string; superuser:boolean }>(
        "select current_user as name,rolsuper as superuser from pg_roles where rolname=current_user"
      )).rows[0]).toEqual({name:"catalog_migration_owner",superuser:false});
      const rolePage = await listDriverCompatibleDiscovery({db:roleDb,objectStore:storage,
        auth:viewer,observationId:first.observationId});
      // #979 takes FOR UPDATE proof locks; this real non-superuser Catalog role lacks UPDATE on DTS files.
      expect(rolePage).toMatchObject({status:"ready",items:[{source:{
        status:"unavailable",reason:"source-permission-denied"}}]});
    } finally { await roleDb.close(); }
    expect(await state()).toEqual(before);
  });

  it("separates persisted source failures and historical revisions from true zero", async () => {
    const badId = "obs-c1-bad-locator";
    await expect(insertDtsObservationSourceFixture(db,{ organizationId:ORG,projectId:PROJECT,
      configSetId:second.configSetId,fileId:second.fileId,logicalNodeId:second.logicalNodeId,
      configRevisionId:second.revision.id,occurrenceId:"occ-c1-second",observationId:badId,
      catalogReleaseId:releaseId,locator:{kind:"dts-property",fileVersionId:second.fileVersionId,
        nodeOccurrenceId:second.nodeOccurrenceId,propertyOccurrenceId:"wrong-property",propertyName:"limit"} }))
      .rejects.toThrow(/provenance does not prove/);
    await expect(insertDtsObservationSourceFixture(db,{ organizationId:ORG,projectId:PROJECT,
      configSetId:second.configSetId,fileId:second.fileId,logicalNodeId:second.logicalNodeId,
      configRevisionId:first.revision.id,occurrenceId:"occ-c1-second",observationId:"obs-c1-mixed",
      catalogReleaseId:releaseId,locator:{kind:"dts-property",fileVersionId:second.fileVersionId,
        nodeOccurrenceId:second.nodeOccurrenceId,propertyOccurrenceId:second.propertyOccurrenceId,
        propertyName:"limit"} })).rejects.toThrow(/provenance does not prove/);
    const unavailable = await listDriverCompatibleDiscovery({ db,auth:viewer,
      objectStore:{ ...storage,getBounded: async () => { throw new Error("object store down"); } },
      observationId:second.observationId });
    expect(unavailable.status === "ready" && unavailable.items[0]).toMatchObject({
      source:{status:"unavailable",reason:"source-proof-invalid"},compatibles:[] });
    const newContent = '/dts-v1/;\n/ { charger { compatible = "vendor,device"; limit = <20>; }; };\n';
    const object = await storage.put({ organizationId:ORG,fileName:"board-first.dts",
      contentType:"text/plain",bytes:Buffer.from(newContent) });
    const newVersionId = `${first.fileId}-v2`;
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,2,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
      [newVersionId,first.fileId,object.storageKey,object.checksumSha256,object.fileSizeBytes,admin.user.id]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",[first.fileId,newVersionId]);
    const nextManifest = structuredClone(first.manifest);
    nextManifest.members[0] = { ...nextManifest.members[0]!,fileVersionId:newVersionId,content:newContent };
    const nextRevision = await ingestConfigRevision(db,nextManifest,admin,{legacyProjection:"skip"});
    expect(nextRevision.status).toBe("resolved");
    const historical = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:viewer,
      observationId:first.observationId });
    expect(historical.status === "ready" && historical.items[0]).toMatchObject({
      source:{ status:"historical",currentConfigRevisionId:nextRevision.id,
        historicalCompatibles:["vendor,device","other,device","acme,power"] },compatibles:[] });
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",
      [first.fileId,first.fileVersionId]);
    expect((await db.query<{ id:string }>(
      "select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",
      [first.configSetId])).rows[0]?.id).toBe(nextRevision.id);
    const restored = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:viewer,
      observationId:first.observationId });
    expect(restored.status === "ready" && restored.items[0]?.source.status).toBe("current");
  });

  it("counts closed review IDs once and returns only persisted open sibling IDs", async () => {
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Catalog pin unavailable");
    const ingest = createEvidenceIngest(pool);
    const writtenIds: string[] = [];
    for (const [key,index,compatible] of [["closed-c1",1,"vendor,device"],
      ["closed-c1",2,"vendor,device"],["sibling-c1",3,"vendor,device"],
      ["other-c1",4,"other,device"]] as const) {
      const written = await ingest.ingest({ organizationId:ORG,sourceIdentity:`c1-review-${index}`,
        catalogReleaseId:pin.id,matcherRevision:subjectMatcherRevision,
        matcherOutput:{status:"unknown"},provenance:null,evidence:{propertyKey:key,compatible} });
      expect(written.ok).toBe(true);
      if (!written.ok || written.value.kind !== "review-evidence") throw new Error("review evidence missing");
      writtenIds.push(written.value.id);
    }
    const unlinked = await listDriverCompatibleDiscovery({db,objectStore:storage,auth:admin,
      observationId:first.observationId});
    expect(unlinked.status === "ready" && unlinked.items[0]?.compatibles[0]?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:null});
    for (const [index,writtenId] of writtenIds.entries()) {
      // Append-only fixture copy links the real ingest body's identity to the proven observation.
      // Production ingest currently creates unlinked review evidence; C1 does not invent a writer.
      await db.query(`insert into parameter_catalog.parameter_review_evidence
        (id,organization_id,observation_id,reason,candidate_safe_digest,r_class,source_graph_ref,evidence)
        select $1,organization_id,$2,reason,candidate_safe_digest,r_class,source_graph_ref,evidence
          from parameter_catalog.parameter_review_evidence where id=$3`,
        [`prev-c1-linked-${index}`,first.observationId,writtenId]);
    }
    const reader = createReviewQueueReader(pool);
    const context = { actorKind:"org-admin" as const,principalId:admin.user.id,organizationId:ORG };
    const before = await reader.list({ organizationId:ORG,capturedRelease:pin,context });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const closed = before.value.items.find((item) => item.identityKey === "property:closed-c1")!;
    const sibling = before.value.items.find((item) => item.identityKey === "property:sibling-c1")!;
    const other = before.value.items.find((item) => item.identityKey === "property:other-c1")!;
    expect(closed).toBeTruthy();expect(sibling).toBeTruthy();expect(other).toBeTruthy();
    const resolved = await resolveReviewItem(pool,{ resolution:"mark-out-of-scope",organizationId:ORG,
      reviewItemId:closed.id,expectedRelease:pin,etag:closed.etag,idempotencyKey:"c1-ignore-closed",
      context,reason:closed.reason,outOfScopeReason:"Not relevant" });
    expect(resolved.ok).toBe(true);
    const result = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:admin,
      observationId:first.observationId });
    expect(result.status === "ready" && result.ignoredReviewItemCount).toBe(1);
    if (result.status !== "ready") return;
    const unknown = result.items[0]!.compatibles.find((entry) => entry.compatible === "vendor,device");
    expect(unknown?.candidate).toMatchObject({kind:"review-required",reviewItemIds:[sibling.id]});
    const otherCandidate = result.items[0]!.compatibles.find((entry) => entry.compatible === "other,device");
    expect(otherCandidate?.candidate).toMatchObject({kind:"review-required",reviewItemIds:[other.id]});
    expect(JSON.stringify(result)).not.toContain(closed.id);
    expect((await reader.list({organizationId:ORG,capturedRelease:pin,context})).ok).toBe(true);
    const repeated = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:admin,
      observationId:first.observationId });
    expect(repeated.status === "ready" && repeated.ignoredReviewItemCount).toBe(1);
    const scoped = await listDriverCompatibleDiscovery({ db,objectStore:storage,auth:viewer,
      observationId:first.observationId });
    expect(scoped.status === "ready" && scoped.ignoredReviewItemCount).toBeNull();
    if (scoped.status === "ready") expect(scoped.items[0]?.compatibles.find((entry) =>
      entry.compatible === "vendor,device")?.candidate).toMatchObject({reviewItemIds:null});
  });

  it("fails closed when publication moves during the proven object read", async () => {
    const pool = getRootPostgresPool(db)!;
    const before = await captureCurrentCatalogPin(pool);
    if (!before) throw new Error("Catalog pin unavailable");
    const bundle = validCatalogReleaseBundle();
    const target = bundle.releases[1] as Parameters<typeof refreshAuthoritativeSource>[0];
    const driver = target.documents.find((document) => document.kind === "subject");
    if (!driver || driver.kind !== "subject") throw new Error("Catalog driver fixture missing");
    const nodeType = structuredClone(driver);
    nodeType.content = { ...nodeType.content,id:"csub_charger",kind:"node-type",
      canonicalKey:"node-type:charger",selector:{kind:"node-type-name",value:"charger",
        provenance:structuredClone(driver.content.selector.provenance)},subtype:{} };
    target.documents.push(nodeType);
    refreshAuthoritativeSource(target);
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    let moved = false;
    const result = await listDriverCompatibleDiscovery({ db,auth:viewer,
      observationId:first.observationId,
      objectStore:{ ...storage,getBounded: async (key,maxBytes) => {
        if (!moved) {
          moved = true;
          const installed = await installPublishedRelease(pool,{ mode:"advance",
            source:jsonCatalogReleaseSource(bundle),expectedCurrent:before,
            expectedTargetDigest:compiled.value.aggregateDigest });
          if (!installed.ok) throw new Error(JSON.stringify(installed.error));
        }
        return storage.getBounded!(key,maxBytes);
      } },
    });
    expect(moved).toBe(true);
    expect(result).toEqual({status:"unavailable",reason:"release-drift"});
    const stored = (await db.query<{catalogReleaseId:string;matcherRevision:string}>(
      `select catalog_release_id as "catalogReleaseId",matcher_revision as "matcherRevision"
       from parameter_catalog.parameter_observations where id=$1`,[first.observationId])).rows[0]!;
    expect(stored).toEqual({ catalogReleaseId:releaseId,matcherRevision:"matcher-d897" });
    const nodeTypeSource = await createSource("known-node-type",PROJECT,'"charger"');
    const currentPin = await captureCurrentCatalogPin(pool);
    if (!currentPin) throw new Error("Advanced Catalog pin unavailable");
    const current = await createCatalogKernel(pool).loadCurrentCatalog(currentPin);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.value.resolveSubject({ driverCompatibles:[DriverCompatible("charger")],
      nodeTypeFallback:{kind:"present",name:NormalizedNodeTypeName("charger")} }))
      .toMatchObject({status:"matched",subject:{kind:"node-type",id:"csub_charger"}});
    const discovery = await listDriverCompatibleDiscovery({db,objectStore:storage,auth:viewer,
      observationId:nodeTypeSource.observationId});
    expect(discovery.status === "ready" && discovery.items[0]?.compatibles[0]?.candidate)
      .toMatchObject({kind:"review-required",reason:"unknown"});
  });
});
