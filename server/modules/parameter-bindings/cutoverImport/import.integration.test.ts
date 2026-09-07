import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { stringify } from "yaml";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../../testing/upgradeComponents";
import { createPostgresDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { validCatalogReleaseBundle, refreshReleaseAggregateDigest } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { createCatalogKernel, jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { CatalogSubjectId, DefinitionRevisionId, ParameterBindingId, ParameterDefinitionId, ProjectValueId, SubjectRegistrationId, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createArchiveAdapter, createLocalArchiveObjectStore } from "../../catalog-cutover/archive";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "../../catalog-cutover/classifier";
import { appendMappingVersion } from "../../catalog-cutover/mapping";
import { persistCheckpoint } from "../../catalog-cutover/checkpoints";
import { readProjectValueHistory } from "../values";
import { bindingImportDigest, captureBindingImportSource, captureDefinitionBindingImportSource, importLegacyBindingHistory, type BindingImportManifest } from "./index";

const twoRevisionBundle = () => {
  const bundle = validCatalogReleaseBundle();
  const release = bundle.releases[1] as any;
  const definition = release.documents.find((d: any) => d.kind === "definition");
  const revision = definition.content.revision;
  revision.id = "drev_acme_power_iin_max_2";
  revision.number = 2;
  revision.documentation = "Explicit second historical revision.";
  revision.contentDigest = bindingImportDigest({ "/lifecycle":revision.lifecycle,"/displayName":revision.displayName,"/documentation":revision.documentation,"/unit":revision.unit,"/valueSchema":revision.valueSchema,"/matching":revision.matching });
  definition.normalizedDigest = bindingImportDigest(definition.content);
  const bytes = Buffer.from(stringify({schemaVersion:"1.0.0",documents:release.documents.map((d: any) => ({kind:d.kind,content:d.content}))},{lineWidth:0}));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  release.sources[0].bytes = bytes.toString("base64"); release.manifest.files[0].digest = digest;
  for (const document of release.documents) document.source.digest = digest;
  release.manifest.documents = release.documents.map((d: any) => ({sourcePath:d.source.path,kind:d.kind,documentId:d.content.id,normalizedDigest:d.normalizedDigest}));
  refreshReleaseAggregateDigest(release);
  return bundle;
};

// This exercises the S6 receipt consumer, not the absent full P0-P16 controller producer.
// Checkpoints are synthetic management fixtures, never verification reports or release approvals.
describe("S6 management import on exact legacy schema and real restricted login", () => {
  let db: ParameterCatalogDatabase;
  let admin: pg.Pool;
  let management: pg.Pool;
  let reader: pg.Pool;
  let root: string;
  let manifest: BindingImportManifest;
  let registrationId: string;
  let seedClient: pg.PoolClient | undefined;
  const managementRole = `s6_import_${randomUUID().replaceAll("-", "")}`;
  const readerRole = `s6_reader_${randomUUID().replaceAll("-", "")}`;
  const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
  const runId = `cutover_s6_${randomUUID()}`;
  const planDigest = bindingImportDigest({ runId, scope: "synthetic-s6-receipt-consumer" });
  const bundle = twoRevisionBundle();
  const archiveKey = randomBytes(32);
  const graph: FrozenP0Graph = {
    catalog: "parameter-catalog-p0-graph",
    identities: [
      { id:"legacy-spec",sourceSystem:"s6-synthetic",sourceKind:"parameter-spec",ownerScopeKind:"platform",ownerScopeId:"platform",sourceId:"s6-spec" },
      ...[1,2].map(n => ({id:`legacy-spec-v${n}`,sourceSystem:"s6-synthetic",sourceKind:"parameter-spec-version" as const,ownerScopeKind:"platform" as const,ownerScopeId:"platform",sourceId:`s6-spec-v${n}`})),
    ],
    specs:[{id:"s6-spec",organizationId:null,sourceKind:"dts",specificationKey:"private-fixture",attributionSubjectId:null,definitionLifecycle:"deprecated",propertyKey:null}],
    specVersions:[1,2].map(n => ({id:`s6-spec-v${n}`,parameterSpecId:"s6-spec",version:n,lifecycle:"deprecated" as const,versionStatus:"superseded" as const})),
    subjects:[],driverRegistrations:[],nodeTypeDefinitions:[],driverSchemas:[],driverSchemaVersions:[],dtsPropertySpecs:[],modules:[],placements:[],bindings:[],bindingRevisions:[],
  };
  const archive = () => ({ objectStore:createLocalArchiveObjectStore(path.join(root,"objects")),encryptionKey:archiveKey });
  const command = () => ({pool:management,runId,planDigest,manifestDigest:bindingImportDigest(manifest),archive:archive()});
  beforeAll(async () => {
    db = await createCheckedEmptyDatabase("s6oldimport");
    root = await mkdtemp(path.join(os.tmpdir(),"s6-import-"));
    const migrations = path.join(root,"migrations");
    const { mkdir } = await import("node:fs/promises"); await mkdir(migrations);
    const names = execFileSync("git",["ls-tree","--name-only",`${sourceSha}:server/migrations`],{encoding:"utf8"}).trim().split("\n").filter(n => n.endsWith(".sql"));
    for (const name of names) await writeFile(path.join(migrations,name),execFileSync("git",["show",`${sourceSha}:server/migrations/${name}`]));
    const connection = createPostgresDatabase(db.url);
    await applyMigrations(connection,migrations);
    admin = new pg.Pool({connectionString:db.url});
    await admin.query(`
      insert into public.organizations(id,name) values('s6-org','Synthetic import');
      insert into public.projects(id,organization_id,name,code) values('s6-project','s6-org','Synthetic','S6');
      insert into public.dts_config_set(id,organization_id,project_id,name) values('s6-config','s6-org','s6-project','Synthetic');
      insert into public.dts_logical_nodes(id,organization_id,project_id,config_set_id) values('s6-node','s6-org','s6-project','s6-config');
      insert into public.dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status) values
        ('s6-config-v1','s6-org','s6-project','s6-config',1,'draft'),('s6-config-v2','s6-org','s6-project','s6-config',2,'draft');
      insert into public.parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('s6-spec',null,'dts','private-fixture','deprecated');
      insert into public.parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle,version_status) values
        ('s6-spec-v1','s6-spec',1,'Synthetic','Synthetic','{"kind":"number"}','deprecated','superseded'),
        ('s6-spec-v2','s6-spec',2,'Synthetic','Synthetic','{"kind":"number"}','deprecated','superseded');
      insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values('s6-attr','s6-org','driver-registration','Synthetic','compatible:acme,power');
      insert into public.driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values('s6-attr','physical-device','multiple');
      insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values('s6-module','s6-org','Synthetic','s6-module',1,'driver-group','curated','s6-attr');
      insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id,created_at) values('s6-binding','s6-org','s6-project','s6-node','s6-spec','s6-module','2025-01-01Z');
      insert into public.project_parameter_binding_revisions(id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,canonical_value,raw_value,schema_state,policy_state,created_at) values
        ('s6-value-v1','s6-binding','s6-config-v1','s6-spec-v1','null',null,null,'unknown','unknown','2025-01-02Z'),
        ('s6-value-v2','s6-binding','s6-config-v2','s6-spec-v2','13.5','13.5','0x0d.8','valid','allowed','2025-01-03Z');
      insert into public.audit_events(id,organization_id,project_id,actor_type,app,kind,action,severity,target_type,target_id,metadata,trace_id,created_at) values
        ('s6-audit-v1','s6-org','s6-project','user','parameters','value','saved','info','binding-revision','s6-value-v1','{}','s6-trace1','2025-01-02Z'),
        ('s6-audit-v2','s6-org','s6-project','user','parameters','value','saved','info','binding-revision','s6-value-v2','{}','s6-trace2','2025-01-03Z');
    `);
    await admin.query(`
      insert into public.projects(id,organization_id,name,code) values('s6-project-two','s6-org','Second project','S62');
      insert into public.dts_config_set(id,organization_id,project_id,name) values('s6-config-two','s6-org','s6-project-two','Second');
      insert into public.dts_logical_nodes(id,organization_id,project_id,config_set_id) values('s6-node-two','s6-org','s6-project-two','s6-config-two');
      insert into public.dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status) values
        ('s6-config-two-v1','s6-org','s6-project-two','s6-config-two',1,'draft'),('s6-config-two-v2','s6-org','s6-project-two','s6-config-two',2,'draft');
      insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id,created_at)
        values('s6-binding-two','s6-org','s6-project-two','s6-node-two','s6-spec','s6-module','2025-02-01Z');
      insert into public.project_parameter_binding_revisions(id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,canonical_value,raw_value,schema_state,policy_state,created_at) values
        ('s6-value-two-v1','s6-binding-two','s6-config-two-v1','s6-spec-v1','21','21','0x15','valid','allowed','2025-02-02Z'),
        ('s6-value-two-v2','s6-binding-two','s6-config-two-v2','s6-spec-v2','34','34','0x22','valid','allowed','2025-02-03Z');
      insert into public.audit_events(id,organization_id,project_id,actor_type,app,kind,action,severity,target_type,target_id,metadata,trace_id,created_at) values
        ('s6-audit-two-v1','s6-org','s6-project-two','user','parameters','value','saved','info','binding-revision','s6-value-two-v1','{}','s6-trace-two1','2025-02-02Z'),
        ('s6-audit-two-v2','s6-org','s6-project-two','user','parameters','value','saved','info','binding-revision','s6-value-two-v2','{}','s6-trace-two2','2025-02-03Z');
    `);
    expect((await admin.query("select to_regclass('parameter_catalog.project_parameter_bindings') as relation")).rows[0].relation).toBeNull();
    await applyMigrations(connection,path.resolve("server/migrations"));
    await connection.close();
    const compiled = compileCatalogRelease(bundle); expect(compiled.ok).toBe(true); if (!compiled.ok) throw new Error("compile failed");
    const firstBundle = { ...bundle,targetReleaseId:bundle.releases[0].manifest.release.id,releases:[bundle.releases[0]] };
    const firstCompiled = compileCatalogRelease(firstBundle); if (!firstCompiled.ok) throw new Error("first compilation failed");
    const installedFirst = await installPublishedRelease(admin,{mode:"bootstrap",source:jsonCatalogReleaseSource(firstBundle),expectedTargetDigest:firstCompiled.value.aggregateDigest});
    if (!installedFirst.ok) throw new Error(JSON.stringify(installedFirst.error));
    const installed = await installPublishedRelease(admin,{mode:"advance",source:jsonCatalogReleaseSource(bundle),expectedTargetDigest:compiled.value.aggregateDigest,expectedCurrent:{id:firstCompiled.value.release.id,digest:firstCompiled.value.release.digest}});
    if (!installed.ok) throw new Error(JSON.stringify(installed.error));
    const client = await admin.connect();
    seedClient = client;
    await client.query("begin"); await client.query("set constraints all deferred");
    const registered = await writeGuardedRegistration(client,{kind:"register",organizationId:"s6-org",subjectId:CatalogSubjectId("csub_acme_power"),subjectKind:"driver",expectedRelease:{id:compiled.value.release.id,digest:compiled.value.release.digest},placement:{mode:"use-default"},destinationModuleId:"s6-module",method:"explicit",proof:{reason:"synthetic-registration-fixture"},idempotencyKey:runId,context:{actorKind:"org-admin",principalId:"synthetic-registration-owner"}});
    expect(registered.ok).toBe(true); if (!registered.ok) throw new Error("registration failed"); registrationId = registered.value.registrationId;
    await client.query("commit");
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state) values($1,$2,$3,$4,'s6-import-fixture-v1',$5,'P8','running')`,[runId,fingerprintP0Graph(graph),"c".repeat(40),compiled.value.aggregateDigest,planDigest]);
    for (const i of graph.identities) await client.query("insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,$2,$3,$4,$5,$6)",[i.id,i.sourceSystem,i.sourceKind,i.ownerScopeKind,i.ownerScopeId,i.sourceId]);
    const classification = classifyFrozenP0Graph(graph); expect(classification.ok).toBe(true); if (!classification.ok) throw new Error("classification failed");
    const source = await captureBindingImportSource(client,"s6-binding");
    const sourceTwo = await captureBindingImportSource(client,"s6-binding-two");
    const definitionSource = await captureDefinitionBindingImportSource(client,"s6-spec");
    const mappingIds: string[] = [];
    for (const [n,i] of graph.identities.entries()) {
      const mapped = await appendMappingVersion({client,cutoverRunId:runId,classification:classification.value,identityId:i.id,sourceChecksum:bindingImportDigest(definitionSource),expectedHead:null,outcome:{kind:"operational",targetKind:n === 0 ? "parameter-definition":"definition-revision",targetId:n === 0 ? "pdef_acme_power_iin_max":`drev_acme_power_iin_max_${n}`}});
      if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
      if (mapped.value.status === "blocked") throw new Error("mapping blocked"); mappingIds.push(mapped.value.head.currentVersionId);
    }
    const archived = await createArchiveAdapter({...archive(),client}).persistEvidenceArchive({actor:{role:"cutover-operator",auditRef:"synthetic-operator-source-receipt"},legacyIdentityId:"legacy-spec",ownerScopeKind:"platform",ownerScopeId:"platform",rClass:"R9",reason:"source-binding-graph-evidence",sourceGraph:{sourcePayload:definitionSource as unknown as ContractJsonValue,relationGraph:{bindingIds:["s6-binding","s6-binding-two"]}},protectedReferences:[{kind:"binding",id:"s6-binding"},{kind:"binding",id:"s6-binding-two"}],cutoverRunId:runId,catalogReleaseId:compiled.value.release.id,successAuditRef:"synthetic-operator-source-receipt",retainUntil:new Date("2030-01-01")});
    expect(archived.ok).toBe(true); if (!archived.ok) throw new Error(`archive failed: ${archived.error.code}`);
    const withEvidence = await appendMappingVersion({client,cutoverRunId:runId,classification:classification.value,identityId:"legacy-spec",sourceChecksum:bindingImportDigest(definitionSource),expectedHead:{casVersion:1,versionId:mappingIds[0]},outcome:{kind:"operational",targetKind:"parameter-definition",targetId:"pdef_acme_power_iin_max",evidenceArchiveId:archived.value.archiveId}});
    if (!withEvidence.ok || withEvidence.value.status === "blocked") throw new Error("evidence mapping failed");
    mappingIds[0] = withEvidence.value.head.currentVersionId;
    manifest = {version:"s6-binding-import-v1",runId,planDigest,sourceSnapshotFingerprint:fingerprintP0Graph(graph),sourceInventoryFingerprint:bindingImportDigest({scope:"synthetic-source-boundary",definitionSource}),bindings:[source,sourceTwo].map((s,index) => ({sourceBindingId:s.binding.id,archiveId:archived.value.archiveId,sourceChecksum:bindingImportDigest(s),definitionMappingVersionId:mappingIds[0],registrationId,sourceTipRevisionId:index === 0 ? "s6-value-v1":"s6-value-two-v2",revisions:[1,2].map(n => ({sourceRevisionId:index === 0 ? `s6-value-v${n}`:`s6-value-two-v${n}`,revisionMappingVersionId:mappingIds[n],retainedReleaseId:`crel_acme_${n}`,sourceAuditRef:index === 0 ? `s6-audit-v${n}`:`s6-audit-two-v${n}`}))}))};
    expect(await persistCheckpoint(client,{runId,phase:"P0",payload:{bindingImportManifestDigest:bindingImportDigest(manifest),sourceInventoryFingerprint:manifest.sourceInventoryFingerprint}})).toMatchObject({ok:true});
    expect(await persistCheckpoint(client,{runId,phase:"P8",payload:{bindingImport:manifest}})).toMatchObject({ok:true});
    client.release();
    seedClient = undefined;
    for (const [role,capability] of [[managementRole,"catalog_migration_owner"],[readerRole,""]]) {
      const password = randomUUID();
      await admin.query(`create role ${pg.escapeIdentifier(role)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
      if (capability) await admin.query(`grant ${pg.escapeIdentifier(capability)} to ${pg.escapeIdentifier(role)}`);
      const url = new URL(db.url); url.username = role; url.password = password;
      const pool = new pg.Pool({connectionString:url.toString(),max:2});
      if (role === managementRole) management = pool; else reader = pool;
    }
  },120000);
  afterAll(async () => {
    if (seedClient) { await seedClient.query("rollback"); seedClient.release(); }
    await management?.end(); await reader?.end();
    if (admin) { await admin.query(`drop role if exists ${pg.escapeIdentifier(managementRole)}`); await admin.query(`drop role if exists ${pg.escapeIdentifier(readerRole)}`); await admin.end(); }
    await db?.close(); if (root) await rm(root,{recursive:true,force:true});
  },120000);
  it("rejects runtime and superuser logins and mismatched receipt before canonical writes",async () => {
    expect(await importLegacyBindingHistory({...command(),pool:reader})).toEqual({ok:false,reason:"management-login-required"});
    expect(await importLegacyBindingHistory({...command(),pool:admin})).toEqual({ok:false,reason:"management-login-required"});
    expect(await importLegacyBindingHistory({...command(),manifestDigest:bindingImportDigest("wrong")})).toEqual({ok:false,reason:"manifest-pin-mismatch"});
    await expect(reader.query("set role catalog_migration_owner")).rejects.toMatchObject({code:"42501"});
    expect((await admin.query("select count(*)::int as count from parameter_catalog.project_parameter_bindings")).rows[0].count).toBe(0);
  });
  it("rejects a concurrent controller on the same target without a partial import", async () => {
    const holder = await admin.connect();
    await holder.query("select pg_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    try {
      expect(await importLegacyBindingHistory(command())).toEqual({ok:false,reason:"cutover-target-lock-held"});
      expect((await admin.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0].n).toBe(0);
    } finally {
      await holder.query("select pg_advisory_unlock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
      holder.release();
    }
  });
  it("refuses corrupt source evidence without importing any canonical row", async () => {
    const store = archive().objectStore;
    const refs = await store.listRefs(); expect(refs).toHaveLength(1);
    const original = await store.get(refs[0]);
    const objectPath = path.join(root,"objects",refs[0]);
    try {
      await writeFile(objectPath,Buffer.from("truncated-synthetic-object"));
      expect(await importLegacyBindingHistory(command())).toMatchObject({ok:false,reason:"source-archive-unavailable",typedCause:"PCAT-ARC-INTEGRITY"});
      expect((await admin.query("select count(*)::int as n from parameter_catalog.project_parameter_bindings")).rows[0].n).toBe(0);
    } finally { await writeFile(objectPath,original); }
  });
  it("imports two projects sharing one Definition from one complete Archive, preserving their independent tips and revision histories",async () => {
    expect(await importLegacyBindingHistory(command())).toMatchObject({ok:true,status:"imported",bindings:2,values:4});
    const target = (await admin.query("select id,current_value_id,effective_revision_id,catalog_release_id,created_at from parameter_catalog.project_parameter_bindings where id='s6-binding'")).rows[0];
    expect(target).toEqual({id:"s6-binding",current_value_id:"s6-value-v1",effective_revision_id:"drev_acme_power_iin_max_1",catalog_release_id:"crel_acme_1",created_at:new Date("2025-01-01Z")});
    expect((await admin.query("select project_id,definition_id,current_value_id,effective_revision_id,catalog_release_id from parameter_catalog.project_parameter_bindings where id='s6-binding-two'")).rows[0]).toEqual({project_id:"s6-project-two",definition_id:"pdef_acme_power_iin_max",current_value_id:"s6-value-two-v2",effective_revision_id:"drev_acme_power_iin_max_2",catalog_release_id:"crel_acme_2"});
    expect((await admin.query("select id,value,source_ref from parameter_catalog.project_parameter_values where binding_id='s6-binding-two' order by id")).rows).toEqual([{id:"s6-value-two-v1",value:21,source_ref:"config-set:s6-config-two"},{id:"s6-value-two-v2",value:34,source_ref:"config-set:s6-config-two"}]);
    const kernel = createCatalogKernel(admin); const first = bundle.releases[0].manifest.release;
    const snapshot = await kernel.loadPinnedCatalog({id:first.id as any,digest:first.digest as any}); expect(snapshot.ok).toBe(true); if (!snapshot.ok) throw new Error("snapshot unavailable");
    const binding = {id:ParameterBindingId("s6-binding"),organizationId:"s6-org",projectId:"s6-project",logicalNodeId:"s6-node",registrationId:SubjectRegistrationId(registrationId),subjectId:CatalogSubjectId("csub_acme_power"),definitionId:ParameterDefinitionId("pdef_acme_power_iin_max"),effectiveRevisionId:DefinitionRevisionId("drev_acme_power_iin_max_1"),catalogRelease:snapshot.value.release,currentValueId:ProjectValueId("s6-value-v1")};
    const firstHistory = await readProjectValueHistory(admin,{binding,definitionRevisionId:DefinitionRevisionId("drev_acme_power_iin_max_1")});
    const secondHistory = await readProjectValueHistory(admin,{binding,definitionRevisionId:DefinitionRevisionId("drev_acme_power_iin_max_2")});
    expect(firstHistory).toMatchObject({ok:true,value:[{id:"s6-value-v1",payload:{kind:"json",value:null},source:{sourceRef:"config-set:s6-config",configRevisionId:"s6-config-v1"},createdAt:"2025-01-02T00:00:00.000Z"}]});
    expect(secondHistory).toMatchObject({ok:true,value:[{id:"s6-value-v2",payload:{kind:"number",value:13.5},source:{sourceRef:"config-set:s6-config",configRevisionId:"s6-config-v2"},createdAt:"2025-01-03T00:00:00.000Z"}]});
    expect((await admin.query("select success_audit_ref,reason from parameter_catalog.binding_history_events where binding_id='s6-binding' order by created_at")).rows).toEqual([{success_audit_ref:"s6-audit-v1",reason:"legacy-project-value-import"},{success_audit_ref:"s6-audit-v2",reason:"legacy-project-value-import"}]);
    expect(await importLegacyBindingHistory(command())).toMatchObject({ok:true,status:"already-imported",values:4});
    expect((await admin.query("select count(*)::int as n from parameter_catalog.parameter_catalog_cutover_events where event_kind='s6-binding-import-completed'")).rows[0].n).toBe(1);
    expect((await management.query("select current_user=session_user as reset")).rows[0].reset).toBe(true);
    const restored = await createArchiveAdapter({...archive(),client:admin}).restoreArchive({actor:{role:"cutover-operator",auditRef:"synthetic-inspection"},archiveId:manifest.bindings[0].archiveId});
    expect(restored).toMatchObject({ok:true,value:{sourceGraph:{sourcePayload:{version:"s6-definition-binding-source-v1",bindings:[
      {binding:{id:"s6-binding"},revisions:[{id:"s6-value-v1",typed_value:null,canonical_value:null,typed_value_sql_null:false,canonical_value_sql_null:true},{id:"s6-value-v2",raw_value:"0x0d.8",schema_state:"valid",policy_state:"allowed"}]},
      {binding:{id:"s6-binding-two"},revisions:[{id:"s6-value-two-v1",raw_value:"0x15"},{id:"s6-value-two-v2",raw_value:"0x22"}]},
    ]}}}});
  });
  it("refuses source byte drift on replay without mutating imported history",async () => {
    await admin.query("update public.project_parameter_binding_revisions set raw_value='changed-after-plan' where id='s6-value-v2'");
    expect(await importLegacyBindingHistory(command())).toEqual({ok:false,reason:"source-bytes-drift"});
    expect((await admin.query("select count(*)::int as n from parameter_catalog.project_parameter_values")).rows[0].n).toBe(4);
  });
});
