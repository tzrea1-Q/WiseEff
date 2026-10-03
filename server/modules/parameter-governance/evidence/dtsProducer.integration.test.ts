import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { requestJson } from "../../../test/testClient";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { getAuthContextForExternalIdentity } from "../../auth/repository";
import { installDriverSourceFixture } from "../../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { captureCurrentCatalogPin } from "../../catalog-publication/runtime";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { createReviewQueueReader } from "../review";
import { resolveReviewItem } from "../resolveReviewItem";
import { subjectMatcherRevision } from "../../catalog-kernel/runtime/subjectMatch";
import { produceDtsCompatibleEvidenceInTransaction } from "./dtsProducer";
import { ingestSourceBoundEvidenceInTransaction } from "./ingest";
import { fingerprintCanonical, observationFingerprintModel } from "./fingerprint";
import { CatalogReleaseId, type ContractJsonValue } from "../../parameter-catalog-contract";
import { listDriverCompatibleDiscovery } from "../queries";

const ORG = "org-c1-producer";
const PROJECT = "project-c1-producer";
const OTHER_PROJECT = "project-c1-producer-other";
const FOREIGN_ORG = "org-c1-producer-foreign";
const FOREIGN_USER = "c1-producer-foreign-admin";
const LIMITED_USER = "c1-producer-limited";
const auth = makeTestAuthContext({ organizationId: ORG,userId: "c1-producer-admin",
  roles: [{ roleId: "admin",projectId: null }] });
const source = `/dts-v1/;\n/ { charger { compatible = "vendor,device", "vendor,device", "acme,power"; limit = <10>; }; peer { compatible = "vendor,device"; }; known { compatible = "acme,power"; }; };\n`;

describe("#897 production DTS observation and Review Item association", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  let roleToken: string;
  let apiRole: string;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  const app = (objectStore: typeof storage) => createWiseEffServer({db:api,objectStore,
    auth:{mode:"production",verifier:{verify:async (authorization) => {
      const identity = authorization === "Bearer admin" ? {organizationId:ORG,userId:auth.user.id}
        : authorization === "Bearer limited" ? {organizationId:ORG,userId:LIMITED_USER}
        : authorization === "Bearer foreign" ? {organizationId:FOREIGN_ORG,userId:FOREIGN_USER}
        : null;
      if (!identity) throw new Error("Invalid test token");
      return makeTestAuthContext({...identity,roles:[{roleId:"admin",projectId:null}]});
    }}}});
  const objects = async () => Promise.all((await readdir(join(directory,ORG))).sort().map(async (name) => ({
    key:`${ORG}/${name}`,sha256:createHash("sha256").update(await readFile(join(directory,ORG,name))).digest("hex"),
  })));
  const databaseState = async (projectId: string) => ({
    source:await captureConfigurationSourceState(db,{organizationId:ORG,projectId}),
    occurrences:(await db.query(`select id from parameter_catalog.project_parameter_source_occurrences where project_id=$1 order by id`,[projectId])).rows,
    observations:(await db.query(`select id from parameter_catalog.parameter_observations where project_id=$1 order by id`,[projectId])).rows,
    evidence:(await db.query(`select id,observation_id from parameter_catalog.parameter_review_evidence where organization_id=$1 order by id`,[ORG])).rows,
    reviewItems:(await db.query(`select id,status from parameter_catalog.parameter_review_items where organization_id=$1 order by id`,[ORG])).rows,
  });

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("c1producer");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-c1-producer-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'C1 producer')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'C1 producer','Admin',true)",
      [auth.user.id,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c1-producer-admin',$1,$2,null,'admin')",
      [auth.user.id,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1P','initialized')",
      [PROJECT,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1O','initialized')",
      [OTHER_PROJECT,ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'Limited',true)",
      [LIMITED_USER,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c1-producer-limited',$1,$2,$3,'software-user')",
      [LIMITED_USER,ORG,OTHER_PROJECT]);
    await db.query("insert into organizations(id,name) values ($1,'C1 foreign')",[FOREIGN_ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'Foreign',true)",
      [FOREIGN_USER,FOREIGN_ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c1-producer-foreign',$1,$2,null,'admin')",
      [FOREIGN_USER,FOREIGN_ORG]);
    await installDriverSourceFixture(db,auth,{subjectId:"csub_acme_power",compatible:"acme,power",
      businessName:"C1 producer business",driverName:"C1 producer driver",idempotencyKey:"c1-producer-driver",
      reason:"C1 production association"});
    roleToken = `c1producer${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(lane.url,{mode:"lab",runToken:roleToken});
    api = createPostgresDatabase(runtime.apiUrl);
    apiRole = runtime.apiRole;
    expect((await api.query<{sessionUser:string;currentUser:string;superuser:boolean}>(
      `select session_user as "sessionUser",current_user as "currentUser",rolsuper as superuser
       from pg_roles where rolname=current_user`)).rows[0])
      .toEqual({sessionUser:apiRole,currentUser:apiRole,superuser:false});
    expect((await api.query<{canInsert:boolean;canUpdate:boolean;canDelete:boolean}>(
      `select has_table_privilege(current_user,'parameter_catalog.project_parameter_source_occurrences','INSERT') as "canInsert",
        has_table_privilege(current_user,'parameter_catalog.project_parameter_source_occurrences','UPDATE') as "canUpdate",
        has_table_privilege(current_user,'parameter_catalog.project_parameter_source_occurrences','DELETE') as "canDelete"`)).rows[0])
      .toEqual({canInsert:false,canUpdate:false,canDelete:false});
    await expect(api.query(`insert into parameter_catalog.project_parameter_source_occurrences
      select * from parameter_catalog.project_parameter_source_occurrences where false`))
      .rejects.toMatchObject({code:"42501"});
  },120_000);

  afterAll(async () => { await api?.close();if(roleToken && lane) await dropLabRuntimeLogins(lane.url,roleToken);
    await db?.close();await lane?.drop();if(directory) await rm(directory,{recursive:true,force:true}); });

  it("creates source-bound observation and current Review Item through file activation", async () => {
    const uploaded = await uploadProjectParameterFile(db,storage,auth,{projectId:PROJECT,
      fileName:"board.dts",bytes:Buffer.from(source)});
    const configSet = await createConfigSet(db,auth,{projectId:PROJECT,name:"C1 source"});
    await addConfigSetFile(db,auth,{configSetId:configSet.id,fileId:uploaded.file.id,role:"base",sortOrder:0});
    const appAuth = await getAuthContextForExternalIdentity(api,{organizationId:ORG,subject:auth.user.id});
    expect(appAuth.roles).toContainEqual({roleId:"admin",projectId:null});
    const uploadedThroughApp = await requestJson(app(storage),
      `/api/v1/projects/${PROJECT}/parameter-files`, {method:"POST",headers:{authorization:"Bearer admin"},
        body:JSON.stringify({fileName:"board.dts",contentBase64:Buffer.from(source).toString("base64")})});
    expect(uploadedThroughApp.status,uploadedThroughApp.bodyText).toBe(201);

    const beforeRead = await databaseState(PROJECT);
    const beforeReadObjects = await objects();
    const page = await listDriverCompatibleDiscovery({db:api,objectStore:storage,auth:appAuth,projectId:PROJECT});
    expect(await databaseState(PROJECT)).toEqual(beforeRead);
    expect(await objects()).toEqual(beforeReadObjects);
    expect(page.status).toBe("ready");
    if (page.status !== "ready") return;
    expect(page.items).toHaveLength(3);
    expect(page.items.every((item) => item.source.status === "current")).toBe(true);
    const charger = page.items.find((item) => item.compatibles.some((entry) => entry.compatible === "acme,power")
      && item.compatibles.some((entry) => entry.compatible === "vendor,device"))!;
    const peer = page.items.find((item) => item.observationId !== charger.observationId
      && item.compatibles.some((entry) => entry.compatible === "vendor,device"))!;
    const known = page.items.find((item) => item.compatibles.length === 1
      && item.compatibles[0]?.compatible === "acme,power")!;
    expect(charger.compatibles).toHaveLength(2);
    const unknown = charger.compatibles.find((entry) => entry.compatible === "vendor,device");
    expect(unknown?.candidate).toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
    expect(charger.compatibles.find((entry) => entry.compatible === "acme,power")?.candidate)
      .toMatchObject({kind:"recognized",subjectId:"csub_acme_power"});
    expect(peer.compatibles[0]?.candidate).toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
    expect(known.compatibles[0]?.candidate).toMatchObject({kind:"recognized",subjectId:"csub_acme_power"});
    const limitedAuth = await getAuthContextForExternalIdentity(api,{organizationId:ORG,subject:LIMITED_USER});
    expect(limitedAuth.roles).toEqual([{roleId:"software-user",projectId:OTHER_PROJECT}]);
    await expect(listDriverCompatibleDiscovery({db:api,objectStore:storage,auth:limitedAuth,
      projectId:PROJECT})).rejects.toMatchObject({code:"NOT_FOUND"});
    const limitedUpload = await requestJson(app(storage),`/api/v1/projects/${PROJECT}/parameter-files`,
      {method:"POST",headers:{authorization:"Bearer limited"},
        body:JSON.stringify({fileName:"denied.dts",contentBase64:Buffer.from(source).toString("base64")})});
    expect(limitedUpload.status).toBe(403);
    const foreignAuth = await getAuthContextForExternalIdentity(api,{organizationId:FOREIGN_ORG,subject:FOREIGN_USER});
    expect(await listDriverCompatibleDiscovery({db:api,objectStore:storage,auth:foreignAuth,
      projectId:PROJECT})).toMatchObject({status:"ready",items:[],emptyReason:"no-observations"});
    expect(await databaseState(PROJECT)).toEqual(beforeRead);
    expect(await objects()).toEqual(beforeReadObjects);
    const knownObservation = (await db.query<{source_identity:string;source_locator:Record<string,string>;
      source_occurrence_id:string;evidence_fingerprint:string}>(
      `select source_identity,source_locator,source_occurrence_id,evidence_fingerprint
       from parameter_catalog.parameter_observations where id=$1`,[known.observationId],
    )).rows[0]!;
    const expectedKnown = observationFingerprintModel({organizationId:ORG,
      sourceIdentity:knownObservation.source_identity,catalogReleaseId:page.catalogRelease.id,
      matcherRevision:subjectMatcherRevision,matcherOutput:{status:"matched"}},
      {projectId:PROJECT,logicalNodeId:known.logicalNodeId,configRevisionId:known.configRevisionId,
        sourceOccurrenceId:knownObservation.source_occurrence_id,sourceLocator:knownObservation.source_locator});
    expect(knownObservation.evidence_fingerprint).toBe(fingerprintCanonical(expectedKnown as unknown as ContractJsonValue));
    const evidence = (await db.query<{ observation_id: string | null; compatible: string }>(
      `select observation_id,evidence->'payload'->>'compatible' as compatible
       from parameter_catalog.parameter_review_evidence where organization_id=$1 order by observation_id`,[ORG],
    )).rows;
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({observation_id:charger.observationId,compatible:"vendor,device"}),
      expect.objectContaining({observation_id:peer.observationId,compatible:"vendor,device"}),
    ]));
    expect(evidence).toHaveLength(2);
    const pool = getRootPostgresPool(db)!;
    const pin = await captureCurrentCatalogPin(pool);
    if (!pin) throw new Error("Catalog pin unavailable");
    const queue = await createReviewQueueReader(pool).list({organizationId:ORG,capturedRelease:pin,
      context:{actorKind:"org-admin",principalId:auth.user.id,organizationId:ORG}});
    expect(queue.ok).toBe(true);
    if (queue.ok && unknown?.candidate.kind === "review-required") {
      expect(queue.value.items.map((item) => item.id)).toContain(unknown.candidate.reviewItemIds?.[0]);
    }
    if (!queue.ok || unknown?.candidate.kind !== "review-required") throw new Error("Current Review Item is absent");
    const context = {actorKind:"org-admin" as const,principalId:auth.user.id,organizationId:ORG};
    const firstItem = queue.value.items.find((item) => item.id === unknown.candidate.reviewItemIds?.[0])!;
    expect(firstItem).toBeTruthy();
    const reviewCount = evidence.length;
    await db.transaction(async (tx) => {
      await produceDtsCompatibleEvidenceInTransaction(tx,db,storage,auth,charger.configRevisionId);
      await produceDtsCompatibleEvidenceInTransaction(tx,db,storage,auth,charger.configRevisionId);
    });
    expect((await db.query(`select id from parameter_catalog.parameter_review_evidence where organization_id=$1`,[ORG])).rows)
      .toHaveLength(reviewCount);
    await expect(db.transaction(async (tx) => ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:ORG,sourceIdentity:`dts-compatible:${charger.observationId}:vendor,device`,
      catalogReleaseId:pin.id,matcherRevision:subjectMatcherRevision,matcherOutput:{status:"unknown"},
      evidence:{compatible:"other,device"},
    },{kind:"review",observationId:charger.observationId,projectId:PROJECT,
      configRevisionId:charger.configRevisionId}))).rejects.toThrow("Trusted DTS evidence ingest failed");
    await expect(db.transaction(async (tx) => ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:ORG,sourceIdentity:"bad-observation-pair",catalogReleaseId:pin.id,
      matcherRevision:subjectMatcherRevision,matcherOutput:{status:"unknown"},evidence:{compatible:"bad"},
    },{kind:"review",observationId:charger.observationId,projectId:"wrong-project",
      configRevisionId:charger.configRevisionId}))).rejects.toThrow("does not match persisted source");
    expect((await db.query(`select id from parameter_catalog.parameter_review_evidence where organization_id=$1`,[ORG])).rows)
      .toHaveLength(reviewCount);
    const resolved = await resolveReviewItem(pool,{resolution:"mark-out-of-scope",organizationId:ORG,
      reviewItemId:firstItem.id,expectedRelease:pin,etag:firstItem.etag,
      idempotencyKey:"c1-producer-ignore",context,reason:firstItem.reason,outOfScopeReason:"Not relevant"});
    expect(resolved.ok).toBe(true);
    const after = await listDriverCompatibleDiscovery({db,objectStore:storage,auth,projectId:PROJECT});
    expect(after.status).toBe("ready");
    if (after.status !== "ready") return;
    expect(after.ignoredReviewItemCount).toBe(1);
    expect(after.items.find((item) => item.observationId === charger.observationId)?.compatibles
      .find((entry) => entry.compatible === "vendor,device")?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:[]});
    expect(after.items.find((item) => item.observationId === peer.observationId)?.compatibles[0]?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
    const viewer = makeTestAuthContext({organizationId:ORG,userId:"c1-producer-viewer",
      roles:[{roleId:"software-user",projectId:PROJECT}]});
    const limited = await listDriverCompatibleDiscovery({db,objectStore:storage,auth:viewer,projectId:PROJECT});
    expect(limited.status === "ready" && limited.ignoredReviewItemCount).toBeNull();
    if (limited.status === "ready") expect(limited.items.find((item) => item.observationId === peer.observationId)
      ?.compatibles.find((entry) => entry.compatible === "vendor,device")?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:null});
    await expect(db.transaction(async (tx) => produceDtsCompatibleEvidenceInTransaction(tx,db,storage,
      makeTestAuthContext({organizationId:"foreign-org",userId:"foreign-admin",
        roles:[{roleId:"admin",projectId:null}]}),charger.configRevisionId)))
      .rejects.toThrow("outside the authorized organization or project");
    await expect(db.transaction(async (tx) => ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:ORG,sourceIdentity:"stale-pin",catalogReleaseId:pin.id,
      matcherRevision:"untrusted-old-revision",matcherOutput:{status:"unknown"},evidence:{compatible:"vendor,device"},
    },{kind:"review",observationId:charger.observationId,projectId:PROJECT,
      configRevisionId:charger.configRevisionId}))).rejects.toThrow("does not match persisted source and pin");
    await expect(db.transaction(async (tx) => ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:ORG,sourceIdentity:"stale-release",catalogReleaseId:CatalogReleaseId("stale-release"),
      matcherRevision:subjectMatcherRevision,matcherOutput:{status:"unknown"},evidence:{compatible:"vendor,device"},
    },{kind:"review",observationId:charger.observationId,projectId:PROJECT,
      configRevisionId:charger.configRevisionId}))).rejects.toThrow("does not match persisted source and pin");
    await expect(db.transaction(async (tx) => ingestSourceBoundEvidenceInTransaction(tx,{
      organizationId:ORG,sourceIdentity:"missing-observation",catalogReleaseId:pin.id,
      matcherRevision:subjectMatcherRevision,matcherOutput:{status:"unknown"},evidence:{compatible:"vendor,device"},
    },{kind:"review",observationId:"absent-observation",projectId:PROJECT,
      configRevisionId:charger.configRevisionId}))).rejects.toThrow("does not match persisted source and pin");
    await db.transaction(async (tx) => produceDtsCompatibleEvidenceInTransaction(tx,db,storage,auth,charger.configRevisionId));
    expect((await createReviewQueueReader(pool).list({organizationId:ORG,capturedRelease:pin,context})).ok).toBe(true);
    const nextProject = "project-c1-producer-failed";
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1F','initialized')",
      [nextProject,ORG]);
    const initial = await uploadProjectParameterFile(db,storage,auth,{projectId:nextProject,
      fileName:"failed.dts",bytes:Buffer.from(source)});
    const nextSet = await createConfigSet(db,auth,{projectId:nextProject,name:"Failed source"});
    await addConfigSetFile(db,auth,{configSetId:nextSet.id,fileId:initial.file.id,role:"base",sortOrder:0});
    const brokenStorage = { ...storage,getBounded:async () => Buffer.from("corrupt") };
    const newBytes = Buffer.from(source.replace("limit = <10>","limit = <11>"));
    const newHash = createHash("sha256").update(newBytes).digest("hex");
    const beforeDb = await databaseState(nextProject);
    const beforeObjects = await objects();
    const failedUpload = await requestJson(app(brokenStorage),
      `/api/v1/projects/${nextProject}/parameter-files`,{method:"POST",headers:{authorization:"Bearer admin"},
        body:JSON.stringify({fileName:"failed.dts",contentBase64:newBytes.toString("base64")})});
    expect(failedUpload.status).toBe(500);
    const afterDb = await databaseState(nextProject);
    const afterObjects = await objects();
    expect(afterDb).toEqual(beforeDb);
    expect((await db.query(`select current_version_id from project_parameter_files where id=$1`,
      [initial.file.id])).rows[0]?.current_version_id).toBe(initial.version.id);
    expect(beforeObjects.some((item) => item.sha256 === newHash)).toBe(false);
    expect(afterObjects).toEqual(beforeObjects);
    const recovered = await requestJson(app(storage),
      `/api/v1/projects/${nextProject}/parameter-files`,{method:"POST",headers:{authorization:"Bearer admin"},
        body:JSON.stringify({fileName:"failed.dts",contentBase64:newBytes.toString("base64")})});
    expect(recovered.status,recovered.bodyText).toBe(201);
    const recoveredObjects = await objects();
    expect(recoveredObjects).toHaveLength(beforeObjects.length+1);
    expect(recoveredObjects.filter((item) => item.sha256 === newHash)).toHaveLength(1);
    const recoveredPage = await listDriverCompatibleDiscovery({db:api,objectStore:storage,auth,
      projectId:nextProject});
    expect(recoveredPage.status).toBe("ready");
    if (recoveredPage.status === "ready") expect(recoveredPage.items.find((item) =>
      item.compatibles.some((entry) => entry.compatible === "vendor,device"))
      ?.compatibles.find((entry) => entry.compatible === "vendor,device")?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
  });

  it("cleans only a new upload object after a post-producer audit failure", async () => {
    const projectId = "project-c1-producer-late";
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1L','initialized')",
      [projectId,ORG]);
    const first = await uploadProjectParameterFile(db,storage,auth,{projectId,
      fileName:"late.dts",bytes:Buffer.from(source)});
    const set = await createConfigSet(db,auth,{projectId,name:"Late source"});
    await addConfigSetFile(db,auth,{configSetId:set.id,fileId:first.file.id,role:"base",sortOrder:0});
    await db.query(`create function public.fail_c1_late_upload() returns trigger language plpgsql as $$
      begin
        if new.kind='parameter-file-upload' and new.project_id='project-c1-producer-late'
          and exists (select 1 from parameter_catalog.parameter_observations
            where project_id=new.project_id) then
          raise exception 'injected post-producer audit failure';
        end if;
        return new;
      end; $$`);
    await db.query(`create trigger fail_c1_late_upload before insert on audit_events
      for each row execute function public.fail_c1_late_upload()`);
    const bytes = Buffer.from(source.replace("limit = <10>","limit = <15>"));
    const beforeDb = await databaseState(projectId);
    const beforeObjects = await objects();
    const upload = () => requestJson(app(storage),`/api/v1/projects/${projectId}/parameter-files`,
      {method:"POST",headers:{authorization:"Bearer admin"},body:JSON.stringify({
        fileName:"late.dts",contentBase64:bytes.toString("base64")})});
    try {
      const failed = await upload();
      expect(failed.status).toBe(500);
      expect(await databaseState(projectId)).toEqual(beforeDb);
      expect(await objects()).toEqual(beforeObjects);
    } finally {
      await db.query("drop trigger fail_c1_late_upload on audit_events");
      await db.query("drop function public.fail_c1_late_upload()");
    }
    const recovered = await upload();
    expect(recovered.status,recovered.bodyText).toBe(201);
    expect((await objects()).length).toBe(beforeObjects.length+1);
    const page = await listDriverCompatibleDiscovery({db:api,objectStore:storage,auth,projectId});
    expect(page.status).toBe("ready");
    if (page.status === "ready") expect(page.items.find((item) =>
      item.compatibles.some((entry) => entry.compatible === "vendor,device"))
      ?.compatibles.find((entry) => entry.compatible === "vendor,device")?.candidate)
      .toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
  });

  it("keeps an existing candidate object when producer proof fails, then activates it", async () => {
    const projectId = "project-c1-producer-candidate";
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1C','initialized')",
      [projectId,ORG]);
    const set = await createConfigSet(db,auth,{projectId,name:"Candidate source"});
    const candidateBytes = Buffer.from(source.replace("limit = <10>","limit = <13>"));
    const candidate = await requestJson<{item:{id:string;status:string;storageKey?:string}}>(app(storage),
      `/api/v1/projects/${projectId}/parameter-file-candidates`,{method:"POST",
        headers:{authorization:"Bearer admin"},body:JSON.stringify({fileName:"candidate.dts",
          contentBase64:candidateBytes.toString("base64")})});
    expect(candidate.status,candidate.bodyText).toBe(201);
    expect(candidate.body.item.status).toBe("ready");
    const candidateId = candidate.body.item.id;
    const beforeDb = await databaseState(projectId);
    const beforeObjects = await objects();
    const brokenStorage = {...storage,getBounded:async () => Buffer.from("corrupt")};
    const activate = (objectStore: typeof storage) => requestJson(app(objectStore),
      `/api/v1/projects/${projectId}/parameter-file-candidates/${candidateId}/activate`,
      {method:"POST",headers:{authorization:"Bearer admin"},body:JSON.stringify({
        expectedCurrentVersionId:null,configSetId:set.id,role:"base"})});
    const failed = await activate(brokenStorage);
    expect(failed.status).toBe(500);
    expect(await databaseState(projectId)).toEqual(beforeDb);
    expect(await objects()).toEqual(beforeObjects);
    const persistedCandidate = (await db.query<{status:string;storage_key:string}>(
      `select status,storage_key from project_parameter_file_candidates where id=$1`,[candidateId])).rows[0]!;
    expect(persistedCandidate.status).toBe("ready");
    expect(await storage.get(persistedCandidate.storage_key)).toEqual(candidateBytes);
    const succeeded = await activate(storage);
    expect(succeeded.status,succeeded.bodyText).toBe(200);
    expect(await objects()).toEqual(beforeObjects);
    const page = await listDriverCompatibleDiscovery({db:api,objectStore:storage,auth,projectId});
    expect(page.status).toBe("ready");
    if (page.status === "ready") {
      const candidates = page.items.flatMap((item) => item.compatibles)
        .filter((entry) => entry.compatible === "vendor,device").map((entry) => entry.candidate);
      expect(candidates).toHaveLength(2);
      for (const candidate of candidates) {
        expect(candidate).toMatchObject({kind:"review-required",reviewItemIds:[expect.any(String)]});
      }
    }
  });

  it("fails a semantic source activation before any Catalog release without partial database writes", async () => {
    const emptyLane = await createEphemeralTestDatabase("c1producerempty");
    const emptyDb = createPostgresDatabase(emptyLane.url);
    const emptyDirectory = await mkdtemp(join(tmpdir(),"wiseeff-c1-producer-empty-"));
    const emptyStorage = createLocalObjectStore(emptyDirectory);
    const emptyToken = `c1empty${randomBytes(5).toString("hex")}`;
    let emptyApi: ReturnType<typeof createPostgresDatabase> | undefined;
    try {
      await emptyDb.query("insert into organizations(id,name) values ($1,'C1 empty')",[ORG]);
      await emptyDb.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'C1 empty','Admin',true)",
        [auth.user.id,ORG]);
      await emptyDb.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('c1-empty-admin',$1,$2,null,'admin')",
        [auth.user.id,ORG]);
      await emptyDb.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1E','initialized')",
        [PROJECT,ORG]);
      const initial = await uploadProjectParameterFile(emptyDb,emptyStorage,auth,{projectId:PROJECT,
        fileName:"empty.dts",bytes:Buffer.from(source)});
      const set = await createConfigSet(emptyDb,auth,{projectId:PROJECT,name:"Before Catalog"});
      await addConfigSetFile(emptyDb,auth,{configSetId:set.id,fileId:initial.file.id,role:"base",sortOrder:0});
      const runtime = await provisionPublicationRuntimeLogins(emptyLane.url,{mode:"lab",runToken:emptyToken});
      emptyApi = createPostgresDatabase(runtime.apiUrl);
      const beforeDb = await captureConfigurationSourceState(emptyDb,{organizationId:ORG,projectId:PROJECT});
      const beforeObjects = await readdir(join(emptyDirectory,ORG));
      const newBytes = Buffer.from(source.replace("limit = <10>","limit = <14>"));
      const server = createWiseEffServer({db:emptyApi,objectStore:emptyStorage,
        auth:{mode:"production",verifier:{verify:async () => auth}}});
      const failed = await requestJson(server,`/api/v1/projects/${PROJECT}/parameter-files`,
        {method:"POST",headers:{authorization:"Bearer admin"},body:JSON.stringify({
          fileName:"empty.dts",contentBase64:newBytes.toString("base64")})});
      expect(failed.status).toBe(500);
      expect(await captureConfigurationSourceState(emptyDb,{organizationId:ORG,projectId:PROJECT})).toEqual(beforeDb);
      expect(await readdir(join(emptyDirectory,ORG))).toEqual(beforeObjects);
      expect((await emptyDb.query<{ current_version_id: string }>(
        `select current_version_id from project_parameter_files where id=$1`,[initial.file.id])).rows[0]?.current_version_id)
        .toBe(initial.version.id);
      expect((await emptyDb.query(`select id from parameter_catalog.parameter_observations`)).rows).toHaveLength(0);
      expect((await emptyDb.query(`select id from parameter_catalog.parameter_review_evidence`)).rows).toHaveLength(0);
      expect((await emptyDb.query(`select id from parameter_catalog.parameter_review_items`)).rows).toHaveLength(0);
    } finally {
      await emptyApi?.close();
      await dropLabRuntimeLogins(emptyLane.url,emptyToken);
      await emptyDb.close();
      await emptyLane.drop();
      await rm(emptyDirectory,{recursive:true,force:true});
    }
  });
});
