import { fingerprintReplacementPreview } from "../../modules/parameter-catalog-migration/fingerprint";
import type { FrozenProjectTip } from "../../modules/parameter-catalog-migration/types";
import { digestProjectValuePayload } from "../../modules/parameter-bindings/values/repositories";
import type { Database, Queryable } from "../../shared/database/client";
import type { ObjectStore } from "../../modules/logs/objectStore";
import { offsetToLineColumn, parseDts } from "../../modules/dts";

/** Frozen pre-0259/pre-0301 producer ABI: a real stored DTS graph, Binding, value and pin.
 * Never call current upload/ingest owners against a deliberately historical schema. */
export async function seedHistoricalPinnedSourceFixture(db: Database, storage: ObjectStore, input: {
  organizationId: string; projectId: string; source: string; createdByUserId?: string;
}) {
  const { organizationId, projectId, source, createdByUserId } = input;
  const definition=(await db.query<{release_id:string;definition_id:string;revision_id:string;registration_id:string}>(`select head.release_id,head.definition_id,head.revision_id,registration.id as registration_id
    from parameter_catalog.catalog_release_definition_heads head join parameter_catalog.parameter_definitions definition on definition.id=head.definition_id
    join parameter_catalog.organization_subject_registrations registration on registration.subject_id=definition.subject_id and registration.organization_id=$1 and registration.status='active'
    where definition.subject_id='csub_acme_power' and definition.property_key='iin_max'`,[organizationId])).rows[0]!;
  const object=await storage.put({organizationId,fileName:"source.dts",contentType:"text/plain",bytes:Buffer.from(source)});
  const node=parseDts(source).topLevel[0]!.children[0]!;
  if(node.kind!=="node")throw new Error("Expected historical charger");
  const property=node.children.find(child=>child.kind==="property"&&child.name==="iin_max")!;
  if(property.kind!=="property")throw new Error("Expected historical property");
  const nodeStart=offsetToLineColumn(source,node.span.start),nodeEnd=offsetToLineColumn(source,node.span.end);
  const propertyStart=offsetToLineColumn(source,property.span.start),propertyEnd=offsetToLineColumn(source,property.span.end);
  // Literal pre-0301 producer contract: current ingest requires the new declaration column.
  await db.transaction(async tx=>{
    await tx.query("set constraints all deferred");
    await tx.query("insert into dts_config_set(id,organization_id,project_id,name) values ('cpp-set',$1,$2,'Historical inputs')",[organizationId,projectId]);
    await tx.query("insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role) values ('cpp-file',$1,$2,'source.dts','dts','cpp-set','base')",[organizationId,projectId]);
    await tx.query("insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin,created_by_user_id) values ('cpp-version','cpp-file',1,$1,$2,$3,'upload',$4)",[object.storageKey,object.checksumSha256,object.fileSizeBytes,createdByUserId ?? null]);
    await tx.query("update project_parameter_files set current_version_id='cpp-version' where id='cpp-file'");
    await tx.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,entry_file,include_search_paths,overlay_order,manifest_state)
      values ('cpp-revision',$1,$2,'cpp-set',1,'resolved','source.dts','[".","include"]'::jsonb,'[]'::jsonb,'complete')`,[organizationId,projectId]);
    await tx.query("insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name) values ('cpp-member','cpp-revision','cpp-file','cpp-version','base',0,'source.dts')");
    await tx.query("insert into dts_logical_nodes(id,organization_id,project_id,config_set_id) values ('cpp-node',$1,$2,'cpp-set')",[organizationId,projectId]);
    await tx.query("insert into dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name,compatible) values ('cpp-logical','cpp-node','cpp-revision','/charger','charger','acme,power')");
    await tx.query(`insert into dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order)
      values ('cpp-node-occurrence','cpp-revision','cpp-version','charger','/charger',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,0)`,[node.span.start,node.span.end,nodeStart.line,nodeStart.column,nodeEnd.line,nodeEnd.column,source.slice(node.span.start,node.span.end),JSON.stringify(node)]);
    await tx.query(`insert into dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order)
      values ('cpp-property','cpp-revision','cpp-node-occurrence','cpp-version','iin_max',$1,$2,$3,$4,$5,$6,$7,$8::jsonb,0)`,[property.span.start,property.span.end,propertyStart.line,propertyStart.column,propertyEnd.line,propertyEnd.column,property.rawText,JSON.stringify(property.value)]);
    await tx.query("insert into dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,property_occurrence_id,node_occurrence_id,property_name,effect_kind,source_order) values ('cpp-effect','cpp-revision','cpp-logical','cpp-property','cpp-node-occurrence','iin_max','set',0)");
    await tx.query("insert into parameter_catalog.project_parameter_source_occurrences(id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id) values ('cpp-occurrence',$1,$2,'cpp-set','cpp-file','dts','cpp-node')",[organizationId,projectId]);
    await tx.query(`insert into parameter_catalog.project_parameter_bindings(id,organization_id,catalog_release_id,project_id,logical_node_id,registration_id,subject_id,definition_id,effective_revision_id,current_value_id,source_occurrence_id)
      values ('cpp-binding',$1,$2,$3,'cpp-node',$4,'csub_acme_power',$5,$6,'cpp-value','cpp-occurrence')`,[organizationId,definition.release_id,projectId,definition.registration_id,definition.definition_id,definition.revision_id]);
    await tx.query(`insert into parameter_catalog.project_parameter_values(id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value)
      values ('cpp-value','cpp-binding',$1,$2,'source.dts!/charger','cpp-revision',$3,'number','36'::jsonb)`,[definition.definition_id,definition.revision_id,digestProjectValuePayload({kind:"number",value:36})]);
    const locator=JSON.stringify({kind:"dts-property",propertyOccurrenceId:"cpp-property",nodeOccurrenceId:"cpp-node-occurrence",fileVersionId:"cpp-version",propertyName:"iin_max"});
    await tx.query(`insert into parameter_catalog.project_value_source_pins(id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
      values ('cpp-pin','cpp-value','cpp-binding',$1,$2,$3,'cpp-occurrence','cpp-revision','cpp-file','cpp-version','dts','cpp-property',$4::jsonb,parameter_catalog.canonical_dts_parameter_locator_digest($4::jsonb))`,[definition.definition_id,organizationId,projectId,locator]);
    await tx.query("set constraints all immediate");
  });
  return { object, fileId: "cpp-file", fileVersionId: "cpp-version" };
}

export async function readHistoricalPinnedCatalogEvidenceFixture(db: Queryable) {
  return {
    pins: (await db.query("select * from parameter_catalog.project_value_source_pins where id='cpp-pin'")).rows,
    values: (await db.query("select * from parameter_catalog.project_parameter_values where id='cpp-value'")).rows,
    binding: (await db.query("select * from parameter_catalog.project_parameter_bindings where id='cpp-binding'")).rows,
  };
}

/** Frozen 0152 receipt ABI; publication and both real pinned source endpoints already exist. */
export async function insertHistoricalReplacementReceiptFixture(db: Database, input: {
  organizationId: string; projectId: string; oldBindingId: string; oldValueId: string;
  newBindingId: string; newValueId: string; newDefinitionId: string; newRevisionId: string;
  previewRelease: { id: string; digest: string }; successorRelease: { id: string; digest: string };
  principalId: string;
}) {
  const receipt = (await db.query<{ candidate_id: string; artifact_digest: string; impact_report_digest: string; policy_revision: string; job_id: string; authorization_id: string }>(`
    select candidate.id as candidate_id,candidate.artifact_digest,candidate.impact_report_digest,job.id as job_id,job.authorization_id,approval.policy_revision::text
    from catalog_publication.candidates candidate
    join catalog_publication.release_artifacts artifact on artifact.id=candidate.artifact_id
    join catalog_publication.publication_jobs job on job.candidate_id=candidate.id
    join catalog_publication.publication_authorizations approval on approval.id=job.authorization_id
    where artifact.target_release_id=$1`, [input.successorRelease.id])).rows[0];
  if (!receipt) throw new Error("Historical replacement requires a real successor publication receipt");
  const tip = (await db.query<{ projectId: string; bindingId: string; logicalNodeId: string; currentValueId: string;
    configRevisionId: string; sourceRef: string; valueKind: string; valueDigest: string }>(`
    select binding.project_id as "projectId",binding.id as "bindingId",binding.logical_node_id as "logicalNodeId",
      value.id as "currentValueId",value.config_revision_id as "configRevisionId",value.source_ref as "sourceRef",
      value.value_kind as "valueKind",value.value_digest as "valueDigest"
    from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id and value.binding_id=binding.id
    where binding.id=$1 and value.id=$2 and binding.organization_id=$3 and binding.project_id=$4`,
  [input.oldBindingId,input.oldValueId,input.organizationId,input.projectId])).rows[0];
  if (!tip) throw new Error("Historical replacement requires the exact predecessor value tip");
  const frozenManifest: FrozenProjectTip[] = [{ ...tip, rewrittenSourceRef: tip.sourceRef,
    sourceFormat: "dts", coupledBindingIds: [], exactSourceProof: null }];
  const fingerprint = fingerprintReplacementPreview({ oldDefinitionId: "pdef_acme_power_iin_max",
    oldRevisionId: "drev_acme_power_iin_max_1", newDefinitionId: input.newDefinitionId,
    newSubjectId: "csub_acme_power", newPropertyKey: "iin_guard_max", newRevisionId: input.newRevisionId,
    manifest: frozenManifest, previewReleaseId: input.previewRelease.id,
    capabilityContractDigest: receipt.impact_report_digest, policyRevision: Number(receipt.policy_revision) });
  const manifest = JSON.stringify(frozenManifest);
  await db.transaction(async tx => {
    await tx.query("set constraints all deferred");
    await tx.query(`insert into parameter_catalog.definition_replacement_previews (
      id,organization_id,old_definition_id,old_subject_id,old_property_key,old_revision_id,
      new_definition_id,new_subject_id,new_property_key,new_revision_id,preview_fingerprint,
      preview_catalog_release_id,preview_catalog_release_digest,candidate_id,artifact_digest,
      manifest,blockers,impact,approval_principal_id,reason,expires_at,consumed_by_replacement_id)
      values ('drpv_historical_source_guard',$1,'pdef_acme_power_iin_max','csub_acme_power','iin_max','drev_acme_power_iin_max_1',
      $2,'csub_acme_power','iin_guard_max',$3,$4,$5,$6,$7,$8,$9::jsonb,'[]'::jsonb,'{}'::jsonb,$10,
      'Historical source occurrence guard',now()+interval '1 hour','drep_historical_source_guard')`,
    [input.organizationId,input.newDefinitionId,input.newRevisionId,fingerprint,input.previewRelease.id,
      input.previewRelease.digest,receipt.candidate_id,receipt.artifact_digest,manifest,input.principalId]);
    await tx.query(`insert into parameter_catalog.definition_replacements (
      id,organization_id,status,replacement_version,old_definition_id,old_subject_id,old_property_key,old_revision_id,
      new_definition_id,new_subject_id,new_property_key,new_revision_id,preview_fingerprint,preview_catalog_release_id,
      preview_catalog_release_digest,source_preview_id,frozen_manifest,candidate_id,publication_job_id,authorization_id,
      successor_release_id,successor_release_digest,approval_principal_id,reason)
      values ('drep_historical_source_guard',$1,'completed',1,'pdef_acme_power_iin_max','csub_acme_power','iin_max',
      'drev_acme_power_iin_max_1',$2,'csub_acme_power','iin_guard_max',$3,$4,$5,$6,'drpv_historical_source_guard',
      $7::jsonb,$8,$9,$10,$11,$12,$13,'Historical source occurrence guard')`,
    [input.organizationId,input.newDefinitionId,input.newRevisionId,fingerprint,input.previewRelease.id,
      input.previewRelease.digest,manifest,receipt.candidate_id,receipt.job_id,receipt.authorization_id,
      input.successorRelease.id,input.successorRelease.digest,input.principalId]);
    await tx.query(`insert into parameter_catalog.definition_replacement_projects (
      id,replacement_id,organization_id,project_id,status,old_binding_id,old_value_id,new_binding_id,new_value_id,
      old_definition_id,new_definition_id)
      values ('drepp_historical_source_guard','drep_historical_source_guard',$1,$2,'completed',$3,$4,$5,$6,
      'pdef_acme_power_iin_max',$7)`, [input.organizationId,input.projectId,input.oldBindingId,input.oldValueId,
      input.newBindingId,input.newValueId,input.newDefinitionId]);
    await tx.query("set constraints all immediate");
  });
  return "drep_historical_source_guard";
}
