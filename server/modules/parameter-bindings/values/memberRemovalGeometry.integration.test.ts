import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type Queryable } from "../../../shared/database/client";
import { createEphemeralTestDatabase, withTestClusterRoleCatalogLock } from "../../../testing/testDatabase";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { readCanonicalSchemaFingerprint, S2_SCH_LIVE_FINGERPRINT as HISTORY_0182_FINGERPRINT } from "../../../testing/parameterCatalog";
import { captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { CatalogSubjectId, serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx, withAuditedWrite } from "../../audit/auditedWrite";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { ingestConfigRevision, ingestConfigRevisionInTransaction } from "../../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import { asValueClient, listObservedProperties, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../catalogProjectValueSync";
import { casCurrentTip, deriveHistoryEventId, insertBindingHistoryEvent } from "./repositories";

const organizationId = "org-a0183-geometry";
const projectId = "project-a0183-geometry";
const submitterId = "user-a0183-submitter";
const reviewerId = "user-a0183-reviewer";
const admin = makeTestAuthContext({ userId: submitterId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: reviewerId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"] });
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
type FrozenEntry = Record<string, ContractJsonValue> & { bindingId: string; oldValueId: string; fileId: string; fileVersionId: string; sourcePinId: string; locator: Record<string, ContractJsonValue> };

describe("reviewed DTS member-removal native geometry boundary", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let manifest: ConfigRevisionManifest;
  let predecessorId: string;
  let removedFileId: string;
  let removedVersionId: string;
  let entries: FrozenEntry[];
  let initialState: Awaited<ReturnType<typeof captureConfigurationSourceState>>;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("a0183-geometry");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-a0183-geometry-"));
    const storage = createLocalObjectStore(directory);
    const full = validCatalogReleaseBundle();
    const bundle = { schemaVersion: full.schemaVersion, targetReleaseId: full.releases[0]!.manifest.release.id, releases: [full.releases[0]!] };
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect((await installPublishedRelease(getRootPostgresPool(db)!, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest })).ok).toBe(true);
    await db.query("insert into organizations(id,name) values ($1,'A0183')", [organizationId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$3,'Submitter','Admin',true),($2,$3,'Reviewer','Reviewer',true)", [submitterId, reviewerId, organizationId]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Geometry','A0183','initialized')", [projectId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('a0183-admin',$1,$3,null,'admin'),('a0183-reviewer',$2,$3,$4,'software-committer')", [submitterId, reviewerId, organizationId, projectId]);
    await db.query("insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values ('a0183-attr',$1,'driver-registration','Acme','compatible:acme,power')", [organizationId]);
    await db.query("insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values ('a0183-attr','physical-device','multiple')");
    await db.query("insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id) values ('a0183-module',$1,'Acme','a0183-module',1,'driver-group','curated','a0183-attr')", [organizationId]);
    await db.transaction(async (tx) => {
      const registration = await writeGuardedRegistration(tx, { kind: "register", organizationId,
        subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: compiled.value.release,
        placement: { mode: "use-default" }, destinationModuleId: "a0183-module", method: "explicit",
        proof: { reason: "A0183 native boundary" }, idempotencyKey: "a0183-registration",
        context: { actorKind: "org-admin", principalId: submitterId } });
      if (!registration.ok) throw new Error(JSON.stringify(registration.error));
    });
    const configSet = await createConfigSet(db, admin, { projectId, name: "native geometry" });
    const source = `/dts-v1/;\n/ {\n charger@0 { compatible = "acme,power"; iin_max = <1000>; };\n charger@1 { compatible = "acme,power"; iin_max = <1100>; };\n charger@2 { compatible = "acme,power"; };\n};\n`;
    const overlay = `/ { charger@2 { iin_max = <1200>; }; };\n`;
    const main = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "main.dts", bytes: Buffer.from(source) });
    const removed = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "removed.dts", bytes: Buffer.from(overlay) });
    removedFileId = removed.file.id; removedVersionId = removed.version.id;
    await addConfigSetFile(db, admin, { configSetId: configSet.id, fileId: main.file.id, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId: configSet.id, fileId: removed.file.id, role: "overlay", sortOrder: 1 });
    manifest = { organizationId, projectId, configSetId: configSet.id, entryFile: "main.dts", includeSearchPaths: ["."], overlayOrder: ["removed.dts"], members: [
      { fileId: main.file.id, fileVersionId: main.version.id, fileName: "main.dts", role: "base", sortOrder: 0, content: source },
      { fileId: removed.file.id, fileVersionId: removed.version.id, fileName: "removed.dts", role: "overlay", sortOrder: 1, content: overlay },
    ] };
    predecessorId = (await ingestConfigRevision(db, manifest, admin, { legacyProjection: "skip" })).id;
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Fixture Catalog unavailable");
    await withAuditedWrite(db, admin, { requestId: "a0183-materialize" }, async (tx) => ({
      result: await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId, projectId, configSetId: configSet.id, configRevisionId: predecessorId }),
      audit: { app: "parameters", kind: "parameter-topology-governance", action: "binding-edited", severity: "Medium", projectId, targetType: "dts-config-revision", targetId: predecessorId, metadata: {} },
    }));
    entries = (await db.query<{ entry: FrozenEntry }>(`select jsonb_build_object(
      'bindingId',binding.id,'oldValueId',value.id,'sourcePinId',pin.id,'sourceOccurrenceId',occurrence.id,
      'definitionId',binding.definition_id,'effectiveRevisionId',binding.effective_revision_id,'catalogReleaseId',binding.catalog_release_id,
      'registrationId',binding.registration_id,'subjectId',binding.subject_id,'fileId',pin.file_id,'fileVersionId',pin.file_version_id,
      'format',pin.format,'locator',pin.locator,'locatorDigest',pin.locator_digest,'valueKind',value.value_kind,'value',value.value,'valueDigest',value.value_digest,
      'dtsGeometry',jsonb_build_object(
        'property',jsonb_build_object('name',property.property_name,'fileVersionId',property.file_version_id,'span',jsonb_build_array(property.start_offset,property.end_offset,property.start_line,property.start_column,property.end_line,property.end_column),'rawText',property.raw_text,'ast',property.ast_json,'contentHash',property.content_hash),
        'node',jsonb_build_object('fileVersionId',node.file_version_id,'path',node.node_path,'name',node.name,'unitAddress',node.unit_address,'labels',node.labels,'refTarget',node.ref_target,'overlayRoot',node.is_overlay_root,'span',jsonb_build_array(node.start_offset,node.end_offset,node.start_line,node.start_column,node.end_line,node.end_column),'rawText',node.raw_text,'ast',node.ast_json,'contentHash',node.content_hash),
        'parent',case when node.parent_occurrence_id is null then 'null'::jsonb else jsonb_build_object('fileVersionId',parent.file_version_id,'path',parent.node_path,'name',parent.name,'unitAddress',parent.unit_address,'labels',parent.labels,'refTarget',parent.ref_target,'overlayRoot',parent.is_overlay_root,'span',jsonb_build_array(parent.start_offset,parent.end_offset,parent.start_line,parent.start_column,parent.end_line,parent.end_column),'rawText',parent.raw_text,'ast',parent.ast_json,'contentHash',parent.content_hash) end,
        'logical',jsonb_build_object('logicalNodeId',logical.logical_node_id,'locator',logical.node_locator,'name',logical.name,'unitAddress',logical.unit_address,'compatible',logical.compatible,'driverSchemaVersionId',logical.driver_schema_version_id,'parentLogicalNodeId',logical.parent_logical_node_id)
      )) entry
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id
      join dts_property_occurrences property on property.id=pin.property_occurrence_id
      join dts_node_occurrences node on node.id=property.node_occurrence_id
      left join dts_node_occurrences parent on parent.id=node.parent_occurrence_id
      join dts_occurrence_effects effect on effect.property_occurrence_id=property.id and effect.effect_kind in ('set','override')
      join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
      where binding.organization_id=$1 and binding.project_id=$2 order by binding.id`, [organizationId, projectId])).rows.map((row) => row.entry);
    expect(entries.filter((entry) => entry.fileId === removedFileId)).toHaveLength(1);
    expect(entries.filter((entry) => entry.fileId !== removedFileId)).toHaveLength(2);
    initialState = await captureConfigurationSourceState(db, { organizationId, projectId });
  });

  afterEach(async () => { expect(await captureConfigurationSourceState(db, { organizationId, projectId })).toEqual(initialState); });
  afterAll(async () => { await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });

  async function applyNative(tx: Queryable, mutate?: (frozen: FrozenEntry[], receipts: Record<string, unknown>[]) => void,
    negative?: { graph?: (tx: Queryable, revisionId: string) => Promise<void>; receipt?: (rows: Record<string, unknown>[]) => void; pending?: boolean; wrongDigest?: boolean; proofVersion?: ContractJsonValue }) {
    const frozen = structuredClone(entries);
    const receipts: Record<string, unknown>[] = [];
    mutate?.(frozen, receipts);
    const requestId = randomUUID(); const auditId = randomUUID(); const tombstoneId = randomUUID();
    const proof = { kind: "canonical-member-removal", proofVersion: negative?.proofVersion ?? 2, format: "dts", organizationId, projectId,
      configSetId: manifest.configSetId, fileId: removedFileId, fileVersionId: removedVersionId, configRevisionId: predecessorId,
      members: manifest.members.map((member) => ({ fileId: member.fileId, fileVersionId: member.fileVersionId,
        sourceName: member.fileName, format: "dts", role: member.role, sortOrder: member.sortOrder,
        checksum: createHash("sha256").update(member.content).digest("hex"), sizeBytes: Buffer.byteLength(member.content) })),
      cohort: frozen, proofDigest: sha(serializeContract(frozen)).slice(7) };
    await tx.query(`insert into project_parameter_value_change_requests(id,organization_id,project_id,request_kind,reason,status,submitter_user_id,assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,member_proof_digest,member_frozen_proof)
      values ($1,$2,$3,'member-removal','Geometry boundary','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`, [requestId, organizationId, projectId, submitterId, reviewerId, removedFileId, manifest.configSetId, removedVersionId, proof.proofDigest, JSON.stringify(proof)]);
    const successor = await ingestConfigRevisionInTransaction(tx, { ...manifest, overlayOrder: [], members: manifest.members.filter((member) => member.fileId !== removedFileId) }, admin, undefined, { legacyProjection: "skip", sourceCommit: { baseConfigRevisionId: predecessorId } });
    await negative?.graph?.(tx, successor.id);
    const observed = await listObservedProperties(asValueClient(tx), successor.id);
    for (const entry of entries.filter((item) => item.fileId !== removedFileId)) {
      const oldLocator = entry.locator;
      const property = observed.find((row) => row.logicalNodeId === (entry.dtsGeometry as { logical: { logicalNodeId: string } }).logical.logicalNodeId && row.propertyKey === "iin_max");
      if (!property) throw new Error("Real successor property missing");
      const native = (await tx.query<{ node_id: string; logical_id: string; effect_id: string }>(`select property.node_occurrence_id node_id,effect.logical_node_revision_id logical_id,effect.id effect_id from dts_property_occurrences property join dts_occurrence_effects effect on effect.property_occurrence_id=property.id where property.id=$1 and effect.effect_kind in ('set','override')`, [property.propertyOccurrenceId])).rows[0]!;
      const valueId = randomUUID(); const pinId = randomUUID();
      const locator = { kind: "dts-property", fileVersionId: entry.fileVersionId, nodeOccurrenceId: native.node_id, propertyOccurrenceId: property.propertyOccurrenceId, propertyName: "iin_max" };
      expect(locator.propertyOccurrenceId).not.toBe(oldLocator.propertyOccurrenceId);
      expect(locator.nodeOccurrenceId).not.toBe(oldLocator.nodeOccurrenceId);
      await tx.query(`insert into parameter_catalog.project_parameter_values(id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value)
        select $1,binding_id,definition_id,definition_revision_id,source_ref,$2,value_digest,value_kind,value from parameter_catalog.project_parameter_values where id=$3`, [valueId, successor.id, entry.oldValueId]);
      await tx.query(`insert into parameter_catalog.project_value_source_pins(id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
        select $1,$2,binding_id,definition_id,organization_id,project_id,source_occurrence_id,$3,file_id,file_version_id,format,$4,$5::jsonb,$6 from parameter_catalog.project_value_source_pins where id=$7`, [pinId, valueId, successor.id, property.propertyOccurrenceId, JSON.stringify(locator), negative?.wrongDigest ? "sha256:wrong" : sha(serializeContract(locator)), entry.sourcePinId]);
      if (!await casCurrentTip(asValueClient(tx), { bindingId: entry.bindingId, expectedTip: entry.oldValueId, nextTip: valueId, sourceCommitRequestId: requestId })) throw new Error("Exact typed pair refused at CAS");
      const historyId = deriveHistoryEventId({ bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: valueId });
      await insertBindingHistoryEvent(asValueClient(tx), { id: historyId, bindingId: entry.bindingId, effectiveRevisionId: entry.effectiveRevisionId as string, oldCurrentValueId: entry.oldValueId, newCurrentValueId: valueId, successAuditRef: auditId, catalogReleaseId: entry.catalogReleaseId as string, reason: "source-revision-propagation" });
      receipts.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId, newValueId: valueId, sourcePinId: pinId, historyEventId: historyId, fileId: entry.fileId, fileVersionId: entry.fileVersionId, format: "dts", nodeOccurrenceId: native.node_id, propertyOccurrenceId: property.propertyOccurrenceId, logicalNodeRevisionId: native.logical_id, effectId: native.effect_id });
    }
    const removed = entries.filter((entry) => entry.fileId === removedFileId).map((entry) => ({ bindingId: entry.bindingId, valueId: entry.oldValueId, sourcePinId: entry.sourcePinId }));
    negative?.receipt?.(receipts);
    await writeTrustedAuditEventInTx(asAuditTx(tx), { id: auditId, invocation: createUserInvocation(reviewer), app: "parameters", kind: "parameter-topology-governance", action: "source-member-removed", severity: "Medium", projectId, targetType: "project-parameter-file", targetId: removedFileId, metadata: { tombstoneId, configSetId: manifest.configSetId, configRevisionId: predecessorId, fileVersionId: removedVersionId, bindings: removed, successorConfigRevisionId: successor.id, successorBindings: receipts, reviewRequestId: requestId, submitterUserId: submitterId, proofDigest: proof.proofDigest }, traceId: requestId });
    await tx.query("set local role parameter_governance_writer_role");
    await tx.query("select parameter_catalog.insert_reviewed_member_tombstone($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)", [tombstoneId, organizationId, projectId, manifest.configSetId, removedFileId, predecessorId, removedVersionId, JSON.stringify(removed), successor.id, JSON.stringify(receipts), auditId]);
    await tx.query("reset role");
    await tx.query("update project_parameter_files set config_set_id=null,config_set_role=null,config_set_sort_order=0 where id=$1", [removedFileId]);
    if (!negative?.pending) await tx.query("update project_parameter_value_change_requests set status='approved',reviewer_user_id=$2,applied_at=now(),apply_outcome='committed',applied_audit_ref=$3,applied_file_version_ids='[]',applied_source_result=$4::jsonb where id=$1", [requestId, reviewerId, auditId, JSON.stringify({ tombstoneId, successorConfigRevisionId: successor.id })]);
    await tx.query("set constraints all immediate");
    return { receipts, tombstoneId };
  }

  it("accepts genuine successor IDs for two survivors and rolls the probe back without changing its source", async () => {
    const rollback = new Error("rollback successful native probe");
    await expect(db.transaction(async (tx) => {
      const result = await applyNative(tx);
      expect(result.receipts).toHaveLength(2);
      expect(result.receipts.every((receipt) => Object.keys(receipt).length === 12)).toBe(true);
      expect((await tx.query("select successor_binding_manifest from parameter_catalog.project_source_member_tombstones where id=$1", [result.tombstoneId])).rows[0]?.successor_binding_manifest).toEqual(result.receipts);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db.query("select count(*)::int count from parameter_catalog.project_source_member_tombstones where project_id=$1", [projectId])).rows[0]?.count).toBe(0);
    expect((await db.query("select count(*)::int count from project_parameter_files where config_set_id=$1", [manifest.configSetId])).rows[0]?.count).toBe(2);
  });

  it("refuses a changed frozen geometry before accepting the new tip", async () => {
    await expect(db.transaction((tx) => applyNative(tx, (frozen) => {
      const survivor = frozen.find((entry) => entry.fileId !== removedFileId)!;
      (survivor.dtsGeometry as { property: { rawText: string } }).property.rawText = "forged";
    }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it("refuses an omitted frozen member at the full deferred census", async () => {
    await expect(db.transaction((tx) => applyNative(tx, (frozen) => {
      frozen.splice(frozen.findIndex((entry) => entry.fileId === removedFileId), 1);
    }))).rejects.toMatchObject({ code: "23514" });
  });

  it.each(["definitionId", "registrationId", "sourceOccurrenceId", "locatorDigest", "valueDigest", "format"])("refuses a changed frozen %s at CAS", async (field) => {
    await expect(db.transaction((tx) => applyNative(tx, (frozen) => {
      frozen.find((entry) => entry.fileId !== removedFileId)![field] = "wrong";
    }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it.each(["span", "ast", "contentHash"])("refuses a forged frozen property %s at CAS", async (field) => {
    await expect(db.transaction((tx) => applyNative(tx, (frozen) => {
      const geometry = frozen.find((entry) => entry.fileId !== removedFileId)!.dtsGeometry as { property: Record<string, ContractJsonValue> };
      geometry.property[field] = field === "span" ? [0, 0, 0, 0, 0, 0] : "forged";
    }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it("rejects numeric-string version without falling through JSON V1", async () => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { proofVersion: "2" }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it("rejects a noncanonical present DTS digest at CAS", async () => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { wrongDigest: true }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it.each(["omit", "reorder", "same-count-substitution", "native-id"])("rejects %s in the immutable successor receipt", async (change) => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { receipt: (rows) => {
      if (change === "omit") rows.pop();
      else if (change === "reorder") rows.reverse();
      else if (change === "native-id") rows[0]!.effectId = "wrong";
      else rows[0]!.bindingId = rows[1]!.bindingId;
    } }))).rejects.toMatchObject({ code: "23514" });
  });

  it("requires approved phase at the deferred boundary", async () => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { pending: true }))).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects an unbound effective property added to the successor", async () => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { graph: async (tx, revisionId) => {
      const propertyId = randomUUID();
      await tx.query(`insert into dts_property_occurrences(id,config_revision_id,file_version_id,node_occurrence_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,content_hash)
        select $1,config_revision_id,file_version_id,node_occurrence_id,'unbound_extra',start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,content_hash from dts_property_occurrences where config_revision_id=$2 limit 1`, [propertyId, revisionId]);
      await tx.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order)
        select $1,config_revision_id,logical_node_revision_id,node_occurrence_id,$2,'unbound_extra','set',source_order from dts_occurrence_effects where config_revision_id=$3 and property_occurrence_id is not null limit 1`, [randomUUID(), propertyId, revisionId]);
    } }))).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects tied final effects before accepting a successor tip", async () => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { graph: async (tx, revisionId) => {
      await tx.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order)
        select $1,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order from dts_occurrence_effects where config_revision_id=$2 and property_name='iin_max' limit 1`, [randomUUID(), revisionId]);
    } }))).rejects.toThrow("Exact typed pair refused at CAS");
  });

  it.each(["wrong-revision", "wrong-file-version"])("rejects a hidden unbound property with a %s physical parent", async (wrong) => {
    await expect(db.transaction((tx) => applyNative(tx, undefined, { graph: async (tx, revisionId) => {
      const parentId = randomUUID(); const nodeId = randomUUID(); const propertyId = randomUUID();
      const oldParent = (await tx.query<{ id: string }>("select id from dts_node_occurrences where config_revision_id=$1 order by id limit 1", [predecessorId])).rows[0]!.id;
      if (wrong === "wrong-file-version") await tx.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,parent_occurrence_id,name,unit_address,labels,ref_target,is_overlay_root,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash)
        select $1,$2,$3,null,name,unit_address,labels,ref_target,is_overlay_root,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash from dts_node_occurrences where id=$4`, [parentId, revisionId, removedVersionId, oldParent]);
      await tx.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,parent_occurrence_id,name,unit_address,labels,ref_target,is_overlay_root,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash)
        select $1,config_revision_id,file_version_id,$2,name,unit_address,labels,ref_target,is_overlay_root,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order,content_hash from dts_node_occurrences where config_revision_id=$3 limit 1`, [nodeId, wrong === "wrong-revision" ? oldParent : parentId, revisionId]);
      await tx.query(`insert into dts_property_occurrences(id,config_revision_id,file_version_id,node_occurrence_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,content_hash)
        select $1,config_revision_id,file_version_id,$2,'hidden_extra',start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,content_hash from dts_property_occurrences where config_revision_id=$3 limit 1`, [propertyId, nodeId, revisionId]);
      await tx.query(`insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,node_occurrence_id,property_occurrence_id,property_name,effect_kind,source_order)
        select $1,config_revision_id,logical_node_revision_id,$2,$3,'hidden_extra','set',source_order from dts_occurrence_effects where config_revision_id=$4 and property_occurrence_id is not null limit 1`, [randomUUID(), nodeId, propertyId, revisionId]);
    } }))).rejects.toMatchObject({ code: "23514" });
  });

  it("retains the restricted owner/helper boundary while the primitive digest matches the installed serializer", async () => {
    await db.transaction(async (tx) => {
      const metadata = (await tx.query(`select owner.rolname owner,fn.prosecdef,fn.proconfig,fn.proacl::text acl
        from pg_proc fn join pg_roles owner on owner.oid=fn.proowner where fn.oid='parameter_catalog.assert_member_removal_tombstone()'::regprocedure`)).rows[0]!;
      expect(metadata.owner).toBe("catalog_migration_owner"); expect(metadata.prosecdef).toBe(true);
      expect(metadata.proconfig).toContain("search_path=pg_catalog, parameter_catalog, public");
      for (const role of ["parameter_governance_writer_role", "catalog_synchronizer_role"]) {
        expect((await tx.query("select has_function_privilege($1,'parameter_catalog.canonical_dts_parameter_locator_digest(jsonb)','execute') allowed", [role])).rows[0]?.allowed).toBe(false);
      }
      const locator = { kind: "dts-property", fileVersionId: "quote\"雪\n", nodeOccurrenceId: "node\\x", propertyName: "limit", propertyOccurrenceId: "property" };
      const ownerDigest = (await tx.query("select parameter_catalog.canonical_dts_parameter_locator_digest($1::jsonb) digest", [JSON.stringify(locator)])).rows[0]?.digest;
      await tx.query("set local role parameter_governance_writer_role");
      const result = (await tx.query(`select session_user,current_user,
        'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat(
          '{',pg_catalog.chr(10),
          '  "fileVersionId": ',pg_catalog.to_json($1::jsonb->>'fileVersionId')::text,',',pg_catalog.chr(10),
          '  "kind": ',pg_catalog.to_json($1::jsonb->>'kind')::text,',',pg_catalog.chr(10),
          '  "nodeOccurrenceId": ',pg_catalog.to_json($1::jsonb->>'nodeOccurrenceId')::text,',',pg_catalog.chr(10),
          '  "propertyName": ',pg_catalog.to_json($1::jsonb->>'propertyName')::text,',',pg_catalog.chr(10),
          '  "propertyOccurrenceId": ',pg_catalog.to_json($1::jsonb->>'propertyOccurrenceId')::text,pg_catalog.chr(10),
          '}',pg_catalog.chr(10)), 'UTF8')), 'hex') digest`, [JSON.stringify(locator)])).rows[0]!;
      expect(result.current_user).toBe("parameter_governance_writer_role");
      expect(result.session_user).toBe("postgres"); // SET ROLE capability, not a LOGIN or deployment claim.
      expect(result.digest).toBe(ownerDigest); expect(result.digest).toBe(sha(serializeContract(locator)));
      await tx.query("reset role");
    });
  });

  it("preserves populated 0182 receipts and source history, and matches fresh 0183 schema/ACL", async () => withTestClusterRoleCatalogLock(async () => {
    await withTempDatabase({ prefix: "a0183_upgrade", migrate: false }, async ({ db: upgrade, connectionString }) => {
      await applyMigrations(upgrade, migrationsDir, { before: "0183_reviewed_dts_member_removal_geometry.sql" });
      const before = (await upgrade.query("select name,checksum from schema_migrations order by name")).rows;
      const beforeFingerprint = await readCanonicalSchemaFingerprint(connectionString);
      expect(beforeFingerprint).toBe(HISTORY_0182_FINGERPRINT);
      const ownerSql = `select owner.rolname owner,fn.prosecdef,fn.proconfig,fn.proacl::text acl from pg_proc fn join pg_roles owner on owner.oid=fn.proowner where fn.oid='parameter_catalog.assert_member_removal_tombstone()'::regprocedure`;
      const beforeAcl = (await upgrade.query(ownerSql)).rows;
      await upgrade.query("insert into organizations(id,name) values ('a0183-upgrade-org','Upgrade')");
      await upgrade.query("insert into users(id,organization_id,name,title,is_active) values ('a0183-upgrade-user','a0183-upgrade-org','Upgrade','Admin',true)");
      await upgrade.query("insert into projects(id,organization_id,name,code,status) values ('a0183-upgrade-project','a0183-upgrade-org','Upgrade','UPG0183','initialized')");
      await upgrade.query("insert into dts_config_set(id,organization_id,project_id,name) values ('a0183-upgrade-set','a0183-upgrade-org','a0183-upgrade-project','Upgrade')");
      await upgrade.query("insert into project_parameter_files(id,organization_id,project_id,file_name,format,enabled,config_set_id,config_set_role) values ('a0183-upgrade-file','a0183-upgrade-org','a0183-upgrade-project','old.dts','dts',true,'a0183-upgrade-set','base')");
      await upgrade.query("insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id) values ('a0183-upgrade-version','a0183-upgrade-file',1,'upgrade-history',repeat('1',64),1,'{}','upload','a0183-upgrade-user')");
      await upgrade.query("update project_parameter_files set current_version_id='a0183-upgrade-version' where id='a0183-upgrade-file'");
      await upgrade.query("insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,created_by_user_id,entry_file,include_search_paths,overlay_order,manifest_state) values ('a0183-upgrade-revision','a0183-upgrade-org','a0183-upgrade-project','a0183-upgrade-set',1,'resolved','a0183-upgrade-user','old.dts','[\".\"]','[]','complete')");
      await upgrade.query("insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name) values ('a0183-upgrade-member','a0183-upgrade-revision','a0183-upgrade-file','a0183-upgrade-version','base',0,'old.dts')");
      const historySql = `select row_to_json(member) member,row_to_json(version) version from dts_config_revision_members member join project_parameter_file_versions version on version.id=member.file_version_id where member.id='a0183-upgrade-member'`;
      const historical = (await upgrade.query(historySql)).rows;
      expect(await applyMigrations(upgrade, migrationsDir)).toEqual(["0183_reviewed_dts_member_removal_geometry.sql"]);
      const receipts = (await upgrade.query("select name,checksum from schema_migrations order by name")).rows;
      expect(receipts.slice(0, -1)).toEqual(before);
      expect(receipts.at(-1)?.checksum).toBe(createHash("sha256").update(await readFile(join(migrationsDir, "0183_reviewed_dts_member_removal_geometry.sql"))).digest("hex"));
      expect((await upgrade.query(historySql)).rows).toEqual(historical);
      expect((await upgrade.query(ownerSql)).rows).toEqual(beforeAcl);
      // The schema fingerprint includes the replaced function body. Preserve
      // the measured 0182 stage; do not overwrite its shared historical pin.
      const upgradedFingerprint = await readCanonicalSchemaFingerprint(connectionString);
      expect(upgradedFingerprint).toBe("b530d605944df51b1c9a5bfc0e032c37bd19732c2c254d995532539a9250a8c0");
      expect(upgradedFingerprint).not.toBe(beforeFingerprint);
      await withTempDatabase({ prefix: "a0183_fresh" }, async ({ db: fresh, connectionString: freshUrl }) => {
        expect(await readCanonicalSchemaFingerprint(freshUrl)).toBe(await readCanonicalSchemaFingerprint(connectionString));
        expect((await fresh.query(ownerSql)).rows).toEqual(beforeAcl);
      });
    });
  }));
});
