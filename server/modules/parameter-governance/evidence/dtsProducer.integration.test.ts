import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installDriverSourceFixture } from "../../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { captureCurrentCatalogPin } from "../../catalog-publication/runtime";
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
const auth = makeTestAuthContext({ organizationId: ORG,userId: "c1-producer-admin",
  roles: [{ roleId: "admin",projectId: null }] });
const source = `/dts-v1/;\n/ { charger { compatible = "vendor,device", "vendor,device", "acme,power"; limit = <10>; }; peer { compatible = "vendor,device"; }; known { compatible = "acme,power"; }; };\n`;

describe("#897 production DTS observation and Review Item association", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;

  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("c1producer");
    db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(),"wiseeff-c1-producer-"));
    storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'C1 producer')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'C1 producer','Admin',true)",
      [auth.user.id,ORG]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1P','initialized')",
      [PROJECT,ORG]);
    await installDriverSourceFixture(db,auth,{subjectId:"csub_acme_power",compatible:"acme,power",
      businessName:"C1 producer business",driverName:"C1 producer driver",idempotencyKey:"c1-producer-driver",
      reason:"C1 production association"});
  },120_000);

  afterAll(async () => { await db?.close();await lane?.drop();if(directory) await rm(directory,{recursive:true,force:true}); });

  it("creates source-bound observation and current Review Item through file activation", async () => {
    const uploaded = await uploadProjectParameterFile(db,storage,auth,{projectId:PROJECT,
      fileName:"board.dts",bytes:Buffer.from(source)});
    const configSet = await createConfigSet(db,auth,{projectId:PROJECT,name:"C1 source"});
    await addConfigSetFile(db,auth,{configSetId:configSet.id,fileId:uploaded.file.id,role:"base",sortOrder:0});
    await uploadProjectParameterFile(db,storage,auth,{projectId:PROJECT,
      fileName:"board.dts",bytes:Buffer.from(source)},{},undefined,db);

    const page = await listDriverCompatibleDiscovery({db,objectStore:storage,auth,projectId:PROJECT});
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
    await expect(uploadProjectParameterFile(db,brokenStorage,auth,{projectId:nextProject,
      fileName:"failed.dts",bytes:Buffer.from(source)},{},undefined,db)).rejects.toThrow("DTS evidence source is unavailable");
    const failedWrites = (await db.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.parameter_observations where project_id=$1`,
      [nextProject])).rows[0]!.count;
    expect(failedWrites).toBe("0");
    expect((await db.query(`select current_version_id from project_parameter_files where id=$1`,
      [initial.file.id])).rows[0]?.current_version_id).toBe(initial.version.id);
  });

  it("fails a semantic source activation before any Catalog release without partial database writes", async () => {
    const emptyLane = await createEphemeralTestDatabase("c1producerempty");
    const emptyDb = createPostgresDatabase(emptyLane.url);
    try {
      await emptyDb.query("insert into organizations(id,name) values ($1,'C1 empty')",[ORG]);
      await emptyDb.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'C1 empty','Admin',true)",
        [auth.user.id,ORG]);
      await emptyDb.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,'C1E','initialized')",
        [PROJECT,ORG]);
      const initial = await uploadProjectParameterFile(emptyDb,storage,auth,{projectId:PROJECT,
        fileName:"empty.dts",bytes:Buffer.from(source)});
      const set = await createConfigSet(emptyDb,auth,{projectId:PROJECT,name:"Before Catalog"});
      await addConfigSetFile(emptyDb,auth,{configSetId:set.id,fileId:initial.file.id,role:"base",sortOrder:0});
      await expect(uploadProjectParameterFile(emptyDb,storage,auth,{projectId:PROJECT,
        fileName:"empty.dts",bytes:Buffer.from(source)},{},undefined,emptyDb))
        .rejects.toThrow("Current Catalog release is unavailable");
      expect((await emptyDb.query<{ current_version_id: string }>(
        `select current_version_id from project_parameter_files where id=$1`,[initial.file.id])).rows[0]?.current_version_id)
        .toBe(initial.version.id);
      expect((await emptyDb.query(`select id from parameter_catalog.parameter_observations`)).rows).toHaveLength(0);
    } finally {
      await emptyDb.close();
      await emptyLane.drop();
    }
  });
});
