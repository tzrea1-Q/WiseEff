import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog/database";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogReleaseDigest, DefinitionRevisionId, ParameterBindingId, ParameterDefinitionId, CatalogSubjectId, SubjectRegistrationId, ProjectValueId } from "../parameter-catalog-contract/index";
import { bindingImportDigest, importPreparedBindingHistory } from "../parameter-bindings/cutoverImport";
import { captureBindingImportIntent, readBindingTipProof } from "../parameter-bindings/cutoverImport/intent";
import { withLockedBindingSource } from "../parameter-bindings/cutoverImport/sourceBoundary";
import { readProjectValueHistory } from "../parameter-bindings/values";
import { createLocalArchiveObjectStore } from "./archive";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "./classifier";
import { appendMappingVersion } from "./mapping";
import { persistCheckpoint } from "./checkpoints";
import { captureConversionSourceInventory, conversionManifestDigest, type ConversionManifest } from "./conversionManifest";
import { assertBindingManagementLogin, captureBindingMappingPins, prepareBindingEvidenceArchives, produceBindingImportReceipt, readBindingDatabaseIdentity } from "./bindingImportProducer";
import { executeCutover, planCutover } from "./orchestrator";
import type { ExecuteCutoverInput } from "./interface";

/** Real P8 producer + P9 consumer slice. P2/P3, public verifier and root controller are not mocked or claimed. */
describe("S7 generated Binding receipt and same-transaction S6 import", () => {
  let database: ParameterCatalogDatabase;
  let admin: pg.Pool;
  let management: pg.Pool;
  let client: pg.PoolClient;
  let root: string;
  type Producer = Parameters<typeof prepareBindingEvidenceArchives>[0];
  let producer: Omit<Producer,"sourceClient">;
  const withSource = <T>(body:(input:Producer)=>Promise<T>) => withLockedBindingSource(admin,client,sourceClient => body({...producer,sourceClient}));
  const prepare = (overrides:Partial<Producer> = {}) => withSource(input => prepareBindingEvidenceArchives({...input,...overrides}));
  const role = `s7_binding_${randomUUID().replaceAll("-","")}`;
  const runId = `s7_binding_${randomUUID()}`;
  const fullBundle = validCatalogReleaseBundle();
  const bundle = {...fullBundle,targetReleaseId:fullBundle.releases[0].manifest.release.id,releases:[fullBundle.releases[0]]};
  const release = bundle.releases[0].manifest.release;
  const graph: FrozenP0Graph = {
    catalog:"parameter-catalog-p0-graph",
    identities:[
      ...["left","right"].flatMap(side => [
        {id:`id-${side}`,sourceSystem:"synthetic-s7",sourceKind:"parameter-spec" as const,ownerScopeKind:"platform" as const,ownerScopeId:"platform",sourceId:`spec-${side}`},
        {id:`id-${side}-revision`,sourceSystem:"synthetic-s7",sourceKind:"parameter-spec-version" as const,ownerScopeKind:"platform" as const,ownerScopeId:"platform",sourceId:`spec-${side}-revision`},
      ]),
      {id:"id-root",sourceSystem:"synthetic-s7",sourceKind:"parameter-spec",ownerScopeKind:"platform",ownerScopeId:"platform",sourceId:"spec-root"},
      ...[1,2,3].flatMap(index => [
        {id:`id-binding-${index}`,sourceSystem:"synthetic-s7",sourceKind:"project-parameter-binding" as const,ownerScopeKind:"project" as const,ownerScopeId:`project-${index}`,sourceId:`binding-${index}`},
        ...[1,2].map(revision => ({id:`id-value-${index}-${revision}`,sourceSystem:"synthetic-s7",sourceKind:"project-parameter-binding-revision" as const,ownerScopeKind:"project" as const,ownerScopeId:`project-${index}`,sourceId:`value-${index}-${revision}`})),
      ]),
    ],
    specs:["left","right","root"].map(side => ({id:`spec-${side}`,organizationId:null,sourceKind:"dts" as const,specificationKey:`source-${side}`,attributionSubjectId:"old-subject",definitionLifecycle:"deprecated" as const,propertyKey:null})),
    specVersions:["left","right"].map(side => ({id:`spec-${side}-revision`,parameterSpecId:`spec-${side}`,version:1,lifecycle:"deprecated" as const,versionStatus:"superseded" as const})),
    subjects:[{id:"old-subject",organizationId:null,subjectKind:"driver-registration"}],driverRegistrations:[{attributionSubjectId:"old-subject"}],
    nodeTypeDefinitions:[],driverSchemas:[{id:"old-schema",parameterSpecId:"spec-root",organizationId:null,attributionSubjectId:"old-subject"}],driverSchemaVersions:[],dtsPropertySpecs:[],
    modules:[{id:"module",organizationId:"org",kind:"driver-group",origin:"curated",name:"Synthetic",attributionSubjectId:"old-subject"}],
    placements:[{id:"old-placement",organizationId:"org",attributionSubjectId:"old-subject",driverGroupModuleId:"module"}],
    bindings:[1,2,3].map(index => ({id:`binding-${index}`,organizationId:"org",parameterSpecId:`spec-${index === 3 ? "right":"left"}`,moduleId:"module"})),
    bindingRevisions:[1,2,3].flatMap(index => [1,2].map(revision => ({id:`value-${index}-${revision}`,bindingId:`binding-${index}`,parameterSpecVersionId:`spec-${index === 3 ? "right":"left"}-revision`}))),
  };
  beforeAll(async () => {
    database = await createCheckedEmptyDatabase("s7bindingproducer");
    root = await mkdtemp(path.join(os.tmpdir(),"s7-binding-producer-"));
    const oldMigrations = path.join(root,"old-migrations"); await mkdir(oldMigrations);
    const sha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const names = execFileSync("git",["ls-tree","--name-only",`${sha}:server/migrations`],{encoding:"utf8"}).trim().split("\n").filter(n => n.endsWith(".sql"));
    for (const name of names) await writeFile(path.join(oldMigrations,name),execFileSync("git",["show",`${sha}:server/migrations/${name}`]));
    const connection = createPostgresDatabase(database.url);
    await applyMigrations(connection,oldMigrations);
    admin = new pg.Pool({connectionString:database.url,max:3});
    await admin.query(`
      insert into public.organizations(id,name) values('org','Synthetic');
      insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values('old-subject',null,'driver-registration','Synthetic','compatible:acme,power');
      insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values('old-subject','physical-device','multiple');
      insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values('module','org','Synthetic','module',1,'driver-group','curated','old-subject');
      insert into public.driver_registration_placements(id,organization_id,attribution_subject_id,driver_group_module_id) values('old-placement','org','old-subject','module');
    `);
    for (const side of ["left","right"]) {
      await admin.query("insert into public.parameter_specs(id,source_kind,specification_key,attribution_subject_id,definition_lifecycle) values($1,'dts',$2,'old-subject','deprecated')",[`spec-${side}`,`source-${side}`]);
      await admin.query("insert into public.parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle,version_status) values($1,$2,1,'Synthetic','Synthetic','{\"kind\":\"number\"}','deprecated','superseded')",[`spec-${side}-revision`,`spec-${side}`]);
    }
    await admin.query("insert into public.parameter_specs(id,source_kind,specification_key,attribution_subject_id,definition_lifecycle) values('spec-root','dts','source-root','old-subject','deprecated')");
    await admin.query("insert into public.driver_schemas(id,parameter_spec_id,schema_namespace,attribution_subject_id) values('old-schema','spec-root','synthetic','old-subject')");
    for (const [index,spec] of [[1,"left"],[2,"left"],[3,"right"]] as const) {
      const id = String(index);
      await admin.query("insert into public.projects(id,organization_id,name,code) values($1,'org',$1,$1)",[`project-${id}`]);
      await admin.query("insert into public.dts_config_set(id,organization_id,project_id,name) values($1,'org',$2,'Synthetic')",[`config-${id}`,`project-${id}`]);
      await admin.query("insert into public.dts_logical_nodes(id,organization_id,project_id,config_set_id) values($1,'org',$2,$3)",[`node-${id}`,`project-${id}`,`config-${id}`]);
      await admin.query("insert into public.project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,enabled) values($1,'org',$2,'synthetic.dts','dts',$3,true)",[`file-${id}`,`project-${id}`,`config-${id}`]);
      for (const revision of [1,2]) {
        await admin.query("insert into public.dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status) values($1,'org',$2,$3,$4,'draft')",[`config-${id}-v${revision}`,`project-${id}`,`config-${id}`,revision]);
        await admin.query("insert into public.project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin) values($1,$2,$3,$1,$1,1,'{}','upload')",[`file-${id}-v${revision}`,`file-${id}`,revision]);
        await admin.query("insert into public.dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order) values($1,$2,$3,$4,'primary',0)",[`member-${id}-${revision}`,`config-${id}-v${revision}`,`file-${id}`,`file-${id}-v${revision}`]);
      }
      await admin.query("update public.project_parameter_files set current_version_id=$1 where id=$2",[`file-${id}-v${index === 1 ? 1:2}`,`file-${id}`]);
      await admin.query("insert into public.dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name) values($1,$2,$3,$4,'synthetic')",[`node-rev-${id}`,`node-${id}`,`config-${id}-v${index === 1 ? 1:2}`,`/synthetic-${id}`]);
      await admin.query("insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id,created_at) values($1,'org',$2,$3,$4,'module','2025-01-01Z')",[`binding-${id}`,`project-${id}`,`node-${id}`,`spec-${spec}`]);
      for (const revision of [1,2]) {
        await admin.query("insert into public.project_parameter_binding_revisions(id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,raw_value,schema_state,policy_state,created_at) values($1,$2,$3,$4,$5::jsonb,$6,'unknown','unknown',$7)",[`value-${id}-${revision}`,`binding-${id}`,`config-${id}-v${revision}`,`spec-${spec}-revision`,revision === 1 ? "null":String(index*10),`raw-${id}-${revision}`,`2025-01-0${revision+1}Z`]);
        await admin.query("insert into public.audit_events(id,organization_id,project_id,actor_type,app,kind,action,severity,target_type,target_id,metadata,trace_id) values($1,'org',$2,'user','parameters','value','saved','info','binding-revision',$3,'{}',$1)",[`audit-${id}-${revision}`,`project-${id}`,`value-${id}-${revision}`]);
      }
    }
    await applyMigrations(connection,path.resolve("server/migrations")); await connection.close();
    const installed = await installPublishedRelease(admin,{mode:"bootstrap",source:jsonCatalogReleaseSource(bundle),expectedTargetDigest:CatalogReleaseDigest(release.digest)});
    if (!installed.ok) throw new Error(installed.error.kind);
    // These fixture assignments are explicit identity assertions, never name/key matching.
    const classificationGraph = graph;
    const classification = classifyFrozenP0Graph(classificationGraph); if (!classification.ok) throw new Error(classification.error.code);
    const conversion: ConversionManifest = {version:"pcat-conversion-manifest-v1",sourceSnapshotFingerprint:fingerprintP0Graph(classificationGraph),sourceInventoryFingerprint:await captureConversionSourceInventory(admin),targetCatalogReleaseDigest:release.digest,
      mappings:classificationGraph.identities.filter(i => ["parameter-spec","parameter-spec-version"].includes(i.sourceKind)).map(i => ({legacyIdentityId:i.id,targetKind:i.id === "id-root" ? "catalog-subject":i.sourceKind === "parameter-spec" ? "parameter-definition":"definition-revision",targetId:i.id === "id-root" ? "csub_acme_power":i.sourceKind === "parameter-spec" ? "pdef_acme_power_iin_max":"drev_acme_power_iin_max_1",targetSourceDigest:bundle.releases[0].manifest.files[0].digest,...(i.sourceKind === "parameter-spec-version" ? {retainedReleaseId:release.id}: {})}))};
    const intent = await captureBindingImportIntent(admin,conversion);
    const planned = await planCutover({graph:classificationGraph,conversionManifest:conversion,bindingImportIntent:intent,bindingArchiveRetainUntil:"2035-01-01T00:00:00.000Z",targetArtifactSha:"e".repeat(40),targetCatalogReleaseDigest:release.digest,catalogReleaseSource:jsonCatalogReleaseSource(bundle)});
    if (!planned.ok) throw new Error(planned.error.detail);
    const planDigest = planned.value.planDigest;
    await admin.query("insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state) values($1,$2,$3,$4,'s7-producer-slice',$5,'P7','running')",[runId,conversion.sourceSnapshotFingerprint,"e".repeat(40),release.digest,planDigest]);
    for (const identity of classificationGraph.identities) await admin.query("insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,$2,$3,$4,$5,$6)",[identity.id,identity.sourceSystem,identity.sourceKind,identity.ownerScopeKind,identity.ownerScopeId,identity.sourceId]);
    for (const mapping of conversion.mappings) {
      const result = await appendMappingVersion({client:admin,cutoverRunId:runId,classification:classification.value,identityId:mapping.legacyIdentityId,sourceChecksum:conversion.sourceSnapshotFingerprint,expectedHead:null,outcome:{kind:"operational",targetKind:mapping.targetKind,targetId:mapping.targetId}});
      if (!result.ok || result.value.status === "blocked") throw new Error("fixture-P7-mapping-failed");
    }
    const password = randomUUID();
    await admin.query(`create role ${pg.escapeIdentifier(role)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
    await admin.query(`grant catalog_migration_owner to ${pg.escapeIdentifier(role)}`);
    const url = new URL(database.url); url.username=role;url.password=password;
    management = new pg.Pool({connectionString:url.toString(),max:1}); client = await management.connect();
    await assertBindingManagementLogin(client); await client.query("set role catalog_migration_owner");
    const adminClient = await admin.connect();
    try { expect(await readBindingDatabaseIdentity(client)).toEqual(await readBindingDatabaseIdentity(adminClient)); } finally { adminClient.release(); }
    await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    const p7Pins = await captureBindingMappingPins(client,runId,conversion);
    await persistCheckpoint(client,{runId,phase:"P0",payload:{bindingImportIntent:intent,bindingImportIntentDigest:bindingImportDigest(intent),sourceInventoryFingerprint:conversion.sourceInventoryFingerprint,conversionManifestDigest:conversionManifestDigest(conversion),bindingArchiveRetainUntil:"2035-01-01T00:00:00.000Z"}});
    await persistCheckpoint(client,{runId,phase:"P7",payload:{bindingMappingPins:p7Pins}});
    producer = {client,runId,planDigest,intent,graph:classificationGraph,classification:classification.value,conversion,bundle,p7Pins,
      archive:{objectStore:createLocalArchiveObjectStore(path.join(root,"objects")),encryptionKey:randomBytes(32)},operatorAuditRef:"synthetic-producer-operator",retainUntil:new Date("2035-01-01Z")};
  },120000);
  afterAll(async () => {
    if (client) { await client.query("rollback"); await client.query("select pg_advisory_unlock_all()"); await client.query("reset role"); client.release(); }
    await management?.end();
    if (admin) { await admin.query(`drop role if exists ${pg.escapeIdentifier(role)}`); await admin.end(); }
    await database?.close(); if (root) await rm(root,{recursive:true,force:true});
  },120000);
  it("rejects omission of an entire second source Definition and post-P0 writes",async () => {
    await expect(prepare({intent:{...producer.intent,bindings:producer.intent.bindings.filter(b => b.sourceSpecId !== "spec-right")}})).rejects.toThrow("binding-producer-P0-pin-mismatch");
    await admin.query("update public.project_parameter_binding_revisions set raw_value='changed' where id='value-3-1'");
    try { await expect(prepare()).rejects.toThrow("binding-p0-source-drift"); }
    finally { await admin.query("update public.project_parameter_binding_revisions set raw_value='raw-3-1' where id='value-3-1'"); }
  });
  it("refuses missing journal and unresolved attempts before any new phase or boundary action", async () => {
    const unused = async (): Promise<never> => { throw new Error("unexpected phase or boundary action"); };
    const input = { pool: admin, bindingManagementPool: management, bindingImportIntent: producer.intent,
      bindingBoundary: { establish: unused, verify: unused, snapshot: unused },
      plan: { planDigest: producer.planDigest }, graph: producer.graph,
    } as unknown as ExecuteCutoverInput;
    expect(await executeCutover(input)).toMatchObject({ ok: false, error: { detail: "binding-management-boundary-and-journal-required" } });
    const before = await client.query("select count(*)::int as count from parameter_catalog.parameter_catalog_cutover_checkpoints");
    await client.query("select pg_advisory_unlock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    try {
      for (const outcome of ["pending", "unknown"] as const) {
        expect(await executeCutover({ ...input, bindingJournal: {
          unresolved: async () => [{ attemptId: "synthetic-negative-attempt", runId, planDigest: producer.planDigest, phase: "P9", outcome }],
          begin: unused, finish: unused,
        } })).toMatchObject({ ok: false, error: { detail: "binding-unresolved-phase-attempt" } });
      }
      expect((await client.query("select count(*)::int as count from parameter_catalog.parameter_catalog_cutover_checkpoints")).rows).toEqual(before.rows);
    } finally { await client.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))"); }
  });
  it("rejects missing, ambiguous and empty tip membership rather than choosing latest",async () => {
    expect((await readBindingTipProof(admin,"binding-1")).sourceRevisionId).toBe("value-1-1");
    await admin.query("update public.project_parameter_files set current_version_id=null where id='file-1'");
    try { await expect(readBindingTipProof(admin,"binding-1")).rejects.toThrow("binding-tip-file-pointers-unproved"); }
    finally { await admin.query("update public.project_parameter_files set current_version_id='file-1-v1' where id='file-1'"); }
    await admin.query("update public.dts_config_revision_members set file_version_id='file-1-v1' where id='member-1-2'");
    try { await expect(readBindingTipProof(admin,"binding-1")).rejects.toThrow("binding-tip-not-unique"); }
    finally { await admin.query("update public.dts_config_revision_members set file_version_id='file-1-v2' where id='member-1-2'"); }
    // Management does not have business-write privileges; use an isolated admin transaction for this source fault.
    const fault = await admin.connect();
    try {
      await fault.query("begin");
      await fault.query("insert into public.dts_config_set(id,organization_id,project_id,name) values('empty-config','org','project-1','Empty synthetic')");
      await fault.query("update public.dts_logical_nodes set config_set_id='empty-config' where id='node-1'");
      await expect(readBindingTipProof(fault,"binding-1")).rejects.toThrow("binding-tip-file-pointers-unproved");
    } finally { await fault.query("rollback"); fault.release(); }
  });
  it("rejects P7 mapping pin drift before Archive writes",async () => {
    await expect(prepare({p7Pins:producer.p7Pins.map((p,index) => index ? p:{...p,versionId:"wrong-version"})})).rejects.toThrow("binding-producer-P7-pin-mismatch");
    expect(await producer.archive.objectStore.listRefs()).toHaveLength(0);
    await client.query("begin");
    try {
      await client.query("select pg_catalog.pg_current_xact_id()");
      const pin = producer.p7Pins.find(p => p.identityId === "id-left")!;
      expect(await appendMappingVersion({client,cutoverRunId:runId,classification:producer.classification,identityId:pin.identityId,sourceChecksum:bindingImportDigest("changed source authority"),expectedHead:{versionId:pin.versionId,casVersion:pin.casVersion},outcome:{kind:"operational",targetKind:"parameter-definition",targetId:"pdef_acme_power_iin_max"}})).toMatchObject({ok:true});
      await expect(prepare()).rejects.toThrow("binding-p7-mapping-drift");
    } finally { await client.query("rollback"); }
  });
  it("rejects an active source writer without waiting or granting source-file access to the canonical manager",async () => {
    await expect(client.query("select id from public.project_parameter_files")).rejects.toMatchObject({code:"42501"});
    const writer = await admin.connect();
    try {
      await writer.query("begin");
      await writer.query("update public.project_parameter_files set enabled=enabled where id='file-1'");
      await expect(prepare()).rejects.toMatchObject({code:"55P03"});
    } finally { await writer.query("rollback"); writer.release(); }
    expect(await producer.archive.objectStore.listRefs()).toHaveLength(0);
  });
  it("destroys the real source connection when lock refusal is followed by an unknown rollback response", async () => {
    const writer = await admin.connect();
    const source = await admin.connect();
    let destroyed = false;
    const wrapped = new Proxy(source, { get(target, key) {
      if (key === "query") return async (...args: unknown[]) => {
        const result = await (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        if (args[0] === "rollback") throw new Error("synthetic rollback response loss");
        return result;
      };
      if (key === "release") return (destroy?: boolean) => { destroyed = destroy === true; target.release(destroy); };
      return Reflect.get(target, key);
    } });
    const pool = new Proxy(admin, { get(target, key) { return key === "connect" ? async () => wrapped : Reflect.get(target, key); } });
    try {
      await writer.query("begin");
      await writer.query("update public.project_parameter_files set enabled=enabled where id='file-1'");
      await expect(withLockedBindingSource(pool, client, async () => { throw new Error("unexpected import"); }))
        .rejects.toThrow("binding-source-transaction-close-unknown");
      expect(destroyed).toBe(true);
    } finally { await writer.query("rollback"); writer.release(); }
  });
  it("rejects an independent database as the source before trying to lock its tables",async () => {
    const other = await createCheckedEmptyDatabase("s7wrongsource");
    const otherPool = new pg.Pool({connectionString:other.url,max:1});
    try {
      await expect(withLockedBindingSource(otherPool,client,async () => { throw new Error("wrong source entered producer"); })).rejects.toThrow("binding-source-target-mismatch");
      expect((await admin.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0].n).toBe(0);
    } finally { await otherPool.end(); await other.close(); }
  });
  it("produces the receipt from real mappings/Archive/domain registration, then imports and checkpoints on the same restricted transaction",async () => withSource(async producer => {
    const archives = await prepareBindingEvidenceArchives(producer);
    expect(archives.size).toBe(3);
    await client.query("begin isolation level serializable");
    const receipt = await produceBindingImportReceipt(producer,archives);
    expect(receipt.bindings).toHaveLength(3);
    expect(receipt.bindings[0].archiveId).toBe(receipt.bindings[1].archiveId);
    expect(receipt.bindings[2].archiveId).not.toBe(receipt.bindings[0].archiveId);
    expect(await persistCheckpoint(client,{runId,phase:"P8",payload:{bindingImport:receipt}})).toMatchObject({ok:true});
    await client.query("update parameter_catalog.parameter_catalog_cutover_runs set current_phase='P8' where id=$1",[runId]);
    await client.query("commit");
    const command = {client,sourceClient:producer.sourceClient,runId,planDigest:producer.planDigest,manifestDigest:bindingImportDigest(receipt),archive:producer.archive};
    await client.query("begin isolation level serializable");
    expect(await importPreparedBindingHistory(command)).toMatchObject({ok:true,status:"imported",bindings:3,values:6});
    await client.query("rollback");
    expect((await admin.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0].n).toBe(0);
    await client.query("begin isolation level serializable");
    expect(await importPreparedBindingHistory(command)).toMatchObject({ok:true,status:"imported",bindings:3,values:6});
    for (const assignment of producer.classification.assignments.filter(a => ["project-parameter-binding","project-parameter-binding-revision"].includes(a.sourceKind))) {
      expect(await appendMappingVersion({client,cutoverRunId:runId,classification:producer.classification,identityId:assignment.identityId,sourceChecksum:producer.intent.bindingInventoryDigest,expectedHead:null,outcome:{kind:"operational",targetKind:assignment.sourceKind === "project-parameter-binding" ? "parameter-binding":"project-value",targetId:assignment.sourceId}})).toMatchObject({ok:true});
    }
    expect(await persistCheckpoint(client,{runId,phase:"P9",payload:{manifestDigest:command.manifestDigest}})).toMatchObject({ok:true});
    await client.query("update parameter_catalog.parameter_catalog_cutover_runs set current_phase='P9' where id=$1",[runId]);
    await client.query("commit");
    expect((await admin.query("select id,current_value_id from parameter_catalog.project_parameter_bindings order by id")).rows).toEqual([{id:"binding-1",current_value_id:"value-1-1"},{id:"binding-2",current_value_id:"value-2-2"},{id:"binding-3",current_value_id:"value-3-2"}]);
    const snapshot = await createCatalogKernel(admin).loadPinnedCatalog({id:release.id as any,digest:release.digest as any});
    if (!snapshot.ok) throw new Error("import-history-snapshot-unavailable");
    const binding = {id:ParameterBindingId("binding-1"),organizationId:"org",projectId:"project-1",logicalNodeId:"node-1",registrationId:SubjectRegistrationId(receipt.bindings[0].registrationId),subjectId:CatalogSubjectId("csub_acme_power"),definitionId:ParameterDefinitionId("pdef_acme_power_iin_max"),effectiveRevisionId:DefinitionRevisionId("drev_acme_power_iin_max_1"),catalogRelease:snapshot.value.release,currentValueId:ProjectValueId("value-1-1")};
    expect(await readProjectValueHistory(client,{binding,definitionRevisionId:binding.effectiveRevisionId})).toMatchObject({ok:true,value:[{id:"value-1-1",payload:{kind:"json",value:null}},{id:"value-1-2",payload:{kind:"number",value:10}}]});
    await client.query("begin isolation level serializable");
    expect(await importPreparedBindingHistory(command)).toMatchObject({ok:true,status:"already-imported",values:6});
    await client.query("rollback");
  }));
});
