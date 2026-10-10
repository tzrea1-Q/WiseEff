import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { captureCurrentCatalogPin } from "../catalog-publication/runtime";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { createReviewQueueReader } from "../parameter-governance/review";
import { resolveReviewItem } from "../parameter-governance/resolveReviewItem";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { catalogDriverCompatibleDiscoveryResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";

const ORG = "org-c2-discovery", PROJECT = "project-c2-discovery", EMPTY = "project-c2-empty";
const FOREIGN = "org-c2-foreign";
const ADMIN = "c2-admin", MEMBER = "c2-member", FOREIGN_USER = "c2-foreign";
const source = `/dts-v1/;\n/ { charger { compatible = "vendor,device", "acme,power"; limit = <10>; }; peer { compatible = "vendor,device"; }; };\n`;

describe("#897 C2 production Driver compatible discovery HTTP", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let directory: string;
  let roleToken: string;
  let configSetId: string;
  let fileId: string;
  const auth = makeTestAuthContext({ organizationId: ORG, userId: ADMIN,
    roles: [{ roleId: "admin", projectId: null }] });
  const app = (objectStore = storage) => createWiseEffServer({ db: api, objectStore,
    auth: { mode: "production", verifier: { verify: async (authorization) => {
      const identity = authorization === "Bearer admin" ? { organizationId: ORG, userId: ADMIN }
        : authorization === "Bearer member" ? { organizationId: ORG, userId: MEMBER }
        : authorization === "Bearer foreign" ? { organizationId: FOREIGN, userId: FOREIGN_USER } : null;
      if (!identity) throw new Error("Invalid test token");
      return makeTestAuthContext({ ...identity, roles: [{ roleId: "software-user", projectId: EMPTY }] });
    } } } });
  const get = (path: string, actor = "admin", headers: Record<string,string> = {}) =>
    requestJson(app(), path, {headers: {authorization: `Bearer ${actor}`, ...headers}});
  const path = (query = "") => `/api/v2/organizations/${ORG}/driver-compatible-discovery${query}`;
  const snapshot = async () => ({
    source: await captureConfigurationSourceState(db,{organizationId:ORG,projectId:PROJECT}),
    rows: (await db.query(`select
      (select count(*) from parameter_catalog.parameter_observations where organization_id=$1) as observations,
      (select count(*) from parameter_catalog.parameter_review_evidence where organization_id=$1) as evidence,
      (select count(*) from parameter_catalog.parameter_review_items where organization_id=$1) as review_items,
      (select count(*) from audit_events where organization_id=$1) as audit`, [ORG])).rows[0],
    objects: await Promise.all((await readdir(join(directory, ORG))).sort().map(async (name) =>
      [name, createHash("sha256").update(await readFile(join(directory, ORG, name))).digest("hex")])),
  });

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("c2discovery");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-c2-discovery-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'C2 discovery'),($2,'C2 foreign')", [ORG,FOREIGN]);
    for (const [id,org,role,project] of [[ADMIN,ORG,"admin",null],[MEMBER,ORG,"software-user",EMPTY],
      [FOREIGN_USER,FOREIGN,"admin",null]] as const) {
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'User',true)",[id,org]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,$5)",
        [`binding-${id}`,id,org,project,role]);
    }
    for (const project of [PROJECT,EMPTY]) await db.query(
      "insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[project,ORG]);
    await installDriverSourceFixture(db,auth,{subjectId:"csub_acme_power",compatible:"acme,power",
      businessName:"C2 business",driverName:"C2 driver",idempotencyKey:"c2-driver",reason:"C2 read"});
    roleToken = `c2discovery${randomBytes(4).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(lane.url,{mode:"lab",runToken:roleToken});
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{superuser:boolean}>("select rolsuper as superuser from pg_roles where rolname=current_user"))
      .rows[0]?.superuser).toBe(false);
    const initial = await uploadProjectParameterFile(db,storage,auth,{projectId:PROJECT,
      fileName:"board.dts",bytes:Buffer.from(source)});
    const set = await createConfigSet(db,auth,{projectId:PROJECT,name:"C2 source"});
    fileId = initial.file.id;
    configSetId = set.id;
    await addConfigSetFile(db,auth,{configSetId:set.id,fileId:initial.file.id,role:"base",sortOrder:0});
  },120_000);

  afterAll(async () => {
    await api?.close();
    if (roleToken && lane) await dropLabRuntimeLogins(lane.url,roleToken);
    await db?.close(); await lane?.drop();
    if (directory) await rm(directory,{recursive:true,force:true});
  });

  it("reads producer evidence, exact nullable identities, pagination and hidden scope without writes", async () => {
    const upload = await requestJson(app(),`/api/v1/projects/${PROJECT}/parameter-files`,
      {method:"POST",headers:{authorization:"Bearer admin"},
        body:JSON.stringify({fileName:"board.dts",contentBase64:Buffer.from(source).toString("base64")})});
    expect(upload.status,upload.bodyText).toBe(201);
    const before = await snapshot();
    const first = await get(path(`?projectId=${PROJECT}&limit=1`));
    expect(first.status,first.bodyText).toBe(200);
    const firstPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(first.body);
    expect(firstPage.status).toBe("ready");
    if (firstPage.status !== "ready") throw new Error("Discovery unavailable");
    expect(first.headers.get("X-WiseEff-Catalog-Release")).toBe(firstPage.catalogRelease.id);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect((await get(path(`?projectId=${PROJECT}&cursor=${firstPage.nextCursor}`))).status).toBe(400);
    const second = await get(path(`?projectId=${PROJECT}&limit=1&cursor=${firstPage.nextCursor}`),
      "admin", {"X-WiseEff-Catalog-Release":firstPage.catalogRelease.id});
    const secondPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(second.body);
    expect(second.status).toBe(200);
    expect(secondPage.status).toBe("ready");
    if (secondPage.status !== "ready") throw new Error("Discovery unavailable");
    expect(secondPage.catalogRelease).toEqual(firstPage.catalogRelease);
    expect(secondPage.items[0]?.observationId).not.toBe(firstPage.items[0]?.observationId);
    const all = await get(path(`?projectId=${PROJECT}`));
    const allPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(all.body);
    expect(allPage.status).toBe("ready");
    if (allPage.status !== "ready") throw new Error("Discovery unavailable");
    expect(allPage.items).toHaveLength(2);
    expect(allPage.items.every((item) => item.source.status === "current")).toBe(true);
    expect(allPage.items.every((item) => item.projectId === PROJECT &&
      item.observationId.length > 0 && item.logicalNodeId.length > 0 &&
      item.configRevisionId.length > 0 && item.observedCatalogReleaseId.length > 0 &&
      item.observedMatcherRevision.length > 0)).toBe(true);
    expect(allPage.items.flatMap((item) => item.compatibles)).toEqual(expect.arrayContaining([
      expect.objectContaining({compatible:"vendor,device",candidate:expect.objectContaining({
        kind:"review-required",reason:"unknown",reviewItemIds:[expect.any(String)]})}),
      expect.objectContaining({compatible:"acme,power",candidate:expect.objectContaining({
        kind:"recognized",registrationId:expect.any(String)})}),
    ]));
    const empty = await get(path(`?projectId=${EMPTY}`));
    expect(empty.body).toMatchObject({status:"ready",items:[],nextCursor:null,
      emptyReason:"no-observations"});
    const member = await get(path(`?projectId=${EMPTY}`),"member");
    expect(member.body).toMatchObject({status:"ready",ignoredReviewItemCount:null});
    expect((await get(path(`?projectId=${PROJECT}`),"member")).status).toBe(404);
    expect((await get(`/api/v2/organizations/${FOREIGN}/driver-compatible-discovery?projectId=${PROJECT}`)).status).toBe(404);
    expect((await get(path(`?observationId=${allPage.items[0]!.observationId}`),"foreign")).status).toBe(404);
    expect((await get(path("?observationId=missing-observation"))).status).toBe(404);
    for (const bad of ["?limit=0","?limit=51","?limit=abc","?limit=1&limit=2","?cursor=%20","?projectId=%20","?observationId=%20","?matcherRevision=forged"]) {
      expect((await get(path(bad))).status,bad).toBe(400);
    }
    expect((await get(path(),"admin",{"X-WiseEff-Catalog-Release":"wrong-release"})).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  },120_000);

  it("keeps null association and registration distinct, then shows ignored, historical and unavailable sources", async () => {
    await db.query("update user_role_bindings set project_id=$2 where user_id=$1",[MEMBER,PROJECT]);
    const current = await get(path(`?projectId=${PROJECT}`));
    expect(current.status).toBe(200);
    const page = catalogDriverCompatibleDiscoveryResponseSchema.parse(current.body);
    if (page.status !== "ready") throw new Error("Discovery unavailable");
    const unknown = page.items.flatMap((item) => item.compatibles)
      .filter((entry) => entry.compatible === "vendor,device");
    const itemIds = unknown.flatMap((entry) => entry.candidate.kind === "review-required"
      ? entry.candidate.reviewItemIds ?? [] : []);
    expect(itemIds).toHaveLength(2);
    const member = await get(path(`?projectId=${PROJECT}`),"member");
    expect(member.body).toMatchObject({status:"ready",ignoredReviewItemCount:null});
    const memberPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(member.body);
    if (memberPage.status !== "ready") throw new Error("Member discovery unavailable");
    expect(memberPage.items.flatMap((item) => item.compatibles)
      .filter((entry) => entry.compatible === "vendor,device").map((entry) => entry.candidate))
      .toEqual([expect.objectContaining({reviewItemIds:null}),expect.objectContaining({reviewItemIds:null})]);

    await db.query(`update parameter_catalog.organization_subject_registrations
      set status='retired' where organization_id=$1 and subject_id='csub_acme_power'`,[ORG]);
    const withoutRegistration = await get(path(`?projectId=${PROJECT}`));
    expect(withoutRegistration.body).toMatchObject({status:"ready"});
    const unregisteredPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(withoutRegistration.body);
    if (unregisteredPage.status !== "ready") throw new Error("Discovery unavailable");
    expect(unregisteredPage.items.flatMap((item) => item.compatibles).find((entry) =>
      entry.compatible === "acme,power")?.candidate)
      .toEqual({kind:"recognized",subjectId:"csub_acme_power",registrationId:null});

    const pin = await captureCurrentCatalogPin(getRootPostgresPool(db)!);
    if (!pin) throw new Error("Catalog pin unavailable");
    const queue = await createReviewQueueReader(getRootPostgresPool(db)!).list({
      organizationId:ORG,capturedRelease:pin,
      context:{actorKind:"org-admin",principalId:ADMIN,organizationId:ORG}});
    if (!queue.ok) throw new Error("Review queue unavailable");
    const chosen = queue.value.items.find((item) => item.id === itemIds[0]);
    if (!chosen) throw new Error("Review item unavailable");
    const resolved = await resolveReviewItem(getRootPostgresPool(db)!,{
      resolution:"mark-out-of-scope",organizationId:ORG,reviewItemId:chosen.id,
      expectedRelease:pin,etag:chosen.etag,idempotencyKey:"c2-ignore-one",
      context:{actorKind:"org-admin",principalId:ADMIN,organizationId:ORG},
      reason:chosen.reason,outOfScopeReason:"Not relevant"});
    expect(resolved.ok).toBe(true);
    const afterIgnore = await get(path(`?projectId=${PROJECT}`));
    const ignoredPage = catalogDriverCompatibleDiscoveryResponseSchema.parse(afterIgnore.body);
    if (ignoredPage.status !== "ready") throw new Error("Discovery unavailable");
    expect(ignoredPage.ignoredReviewItemCount).toBe(1);
    expect(ignoredPage.items.flatMap((item) => item.compatibles)
      .filter((entry) => entry.compatible === "vendor,device")
      .some((entry) => entry.candidate.kind === "review-required" &&
        entry.candidate.reviewItemIds?.length === 0)).toBe(true);
    const remaining = ignoredPage.items.flatMap((item) => item.compatibles)
      .filter((entry) => entry.compatible === "vendor,device")
      .flatMap((entry) => entry.candidate.kind === "review-required" ? entry.candidate.reviewItemIds ?? [] : []);
    expect(remaining).toEqual([itemIds.find((id) => id !== chosen.id)]);

    const oldObservation = page.items[0]!.observationId;
    const brokenStorage = {...storage,getBounded:async () => { throw new Error("isolated read failure"); }};
    const unavailable = await requestJson(app(brokenStorage),path(`?observationId=${oldObservation}`),
      {headers:{authorization:"Bearer admin"}});
    expect(unavailable.body).toMatchObject({status:"ready",items:[{
      source:{status:"unavailable",reason:"source-proof-invalid"},compatibles:[]}]});

    // C1's source transition is a fixture here; C2 only reads its historical result.
    const newContent = source.replace("limit = <10>","limit = <11>");
    const object = await storage.put({organizationId:ORG,fileName:"board.dts",
      contentType:"text/plain",bytes:Buffer.from(newContent)});
    const oldVersion = (await db.query<{id:string;version_number:number}>(
      "select id,version_number from project_parameter_file_versions where file_id=$1 order by version_number desc limit 1",
      [fileId])).rows[0]!;
    const newVersionId = `${fileId}-history-${oldVersion.version_number + 1}`;
    await db.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,$3,$4,$5,$6,'{}'::jsonb,'upload',$7)`,
      [newVersionId,fileId,oldVersion.version_number+1,object.storageKey,
        object.checksumSha256,object.fileSizeBytes,ADMIN]);
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",[fileId,newVersionId]);
    const manifest: ConfigRevisionManifest = {organizationId:ORG,projectId:PROJECT,configSetId,
      entryFile:"board.dts",includeSearchPaths:[],overlayOrder:[],members:[
        {fileId,fileVersionId:newVersionId,fileName:"board.dts",sourceName:"board.dts",
          content:newContent,role:"base",sortOrder:0}]};
    const revision = await ingestConfigRevision(db,manifest,auth);
    expect(revision.status).toBe("resolved");
    const historical = await get(path(`?observationId=${oldObservation}`));
    expect(historical.body).toMatchObject({status:"ready",items:[{
      observationId:oldObservation,source:{status:"historical",currentConfigRevisionId:revision.id},
      compatibles:[]}]});
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1",[fileId,oldVersion.id]);
    const restored = await get(path(`?observationId=${oldObservation}`));
    expect(restored.body).toMatchObject({status:"ready",items:[{source:{status:"current"}}]});
    const firstBeforeAdvance = await get(path(`?projectId=${PROJECT}&limit=1`));
    const firstBeforePage = catalogDriverCompatibleDiscoveryResponseSchema.parse(firstBeforeAdvance.body);
    if (firstBeforePage.status !== "ready" || !firstBeforePage.nextCursor) {
      throw new Error("First page lacks a continuation cursor");
    }

    const beforeRelease = await captureCurrentCatalogPin(getRootPostgresPool(db)!);
    if (!beforeRelease) throw new Error("Catalog pin unavailable");
    const bundle = validCatalogReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    let moved = false;
    const advancingStore = {...storage,getBounded:async (key: string,maxBytes: number) => {
      if (!moved) {
        moved = true;
        const installed = await installPublishedRelease(getRootPostgresPool(db)!,{
          mode:"advance",source:jsonCatalogReleaseSource(bundle),expectedCurrent:beforeRelease,
          expectedTargetDigest:compiled.value.aggregateDigest});
        if (!installed.ok) throw new Error(JSON.stringify(installed.error));
      }
      return storage.getBounded!(key,maxBytes);
    }};
    const drifted = await requestJson(app(advancingStore),path(`?observationId=${oldObservation}`),
      {headers:{authorization:"Bearer admin"}});
    expect(moved).toBe(true);
    expect(drifted.status).toBe(200);
    expect(drifted.body).toEqual({status:"unavailable",reason:"release-drift"});
    expect(drifted.headers.get("X-WiseEff-Catalog-Release")).toBeNull();
    const staleContinuation = await get(path(`?projectId=${PROJECT}&limit=1&cursor=${firstBeforePage.nextCursor}`),
      "admin",{"X-WiseEff-Catalog-Release":firstBeforePage.catalogRelease.id});
    expect(staleContinuation.status,staleContinuation.bodyText).toBe(409);
    expect(staleContinuation.body).toMatchObject({error:{details:{reason:"release-drift"}}});
  },120_000);
});
