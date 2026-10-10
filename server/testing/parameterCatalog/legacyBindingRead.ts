import type { Database } from "../../shared/database/client";

export async function installLegacyBindingReadFixture(db: Database, input: {
  organizationId: string; moduleId: string; projectId: string; otherProjectId: string;
  bindingId: string; otherBindingId: string; mappedId: string; unmappedId: string; deniedId: string; nonBindingId: string;
  unmappedInaccessibleId?: string;
}) {
  const { organizationId, moduleId: boundModuleId, projectId, otherProjectId, bindingId, otherBindingId, mappedId, unmappedId, deniedId, nonBindingId } = input;
  await db.transaction(async (tx) => {
    await tx.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,
       migration_contract_version,plan_digest,current_phase,state)
      values ('t1081-read-cutover','t1081-source',$1,'t1081-release','t1081','t1081-plan','P7','completed')`, ["a".repeat(40)]);
    for (const [legacyId, sourceProjectId, canonicalId] of [
      [mappedId, projectId, bindingId], [unmappedId, projectId, null],
      [deniedId, otherProjectId, otherBindingId], [nonBindingId, projectId, bindingId],
      ...(input.unmappedInaccessibleId ? [[input.unmappedInaccessibleId, otherProjectId, null] as const] : [])
    ] as const) {
      await tx.query(`insert into parameter_specs (id,organization_id,source_kind,specification_key)
        values ($1,$2,'manual',$1)`, [`spec-${legacyId}`, organizationId]);
      await tx.query(`insert into parameter_spec_versions
        (id,parameter_spec_id,version,display_name,description,value_shape,lifecycle)
        values ($1,$2,1,'Legacy only','Retained history','{"kind":"u32"}','active')`,
      [`revision-${legacyId}`, `spec-${legacyId}`]);
      await tx.query(`insert into project_parameter_bindings (id,organization_id,project_id,parameter_spec_id,module_id)
        values ($1,$2,$3,$4,$5)`, [legacyId, organizationId, sourceProjectId, `spec-${legacyId}`, boundModuleId]);
      await tx.query(`insert into project_parameter_binding_revisions
        (id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,raw_value)
        select $1,$2,pin.config_revision_id,$3,'{"kind":"u32","value":999}','legacy-value-never-returned'
        from parameter_catalog.project_value_source_pins pin where pin.binding_id=$4 limit 1`,
      [legacyId, legacyId, `revision-${legacyId}`, sourceProjectId === projectId ? bindingId : otherBindingId]);
      await tx.query(`insert into parameter_catalog.legacy_identities
        (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
        values ($1,'wiseeff-v1','project-parameter-binding','project',$2,$3)`,
      [`identity-${legacyId}`, sourceProjectId, legacyId]);
      if (!canonicalId) continue;
      await tx.query(`insert into parameter_catalog.legacy_mapping_versions
        (id,legacy_identity_id,cutover_run_id,version_number,source_checksum,graph_fingerprint,r_class,target_kind,target_id)
        select $1,$2,'t1081-read-cutover',1,'t1081-checksum','t1081-graph','R5',$3,
          case when $3 = 'project-value' then current_value_id else id end
        from parameter_catalog.project_parameter_bindings where id = $4`,
      [`mapping-${legacyId}`, `identity-${legacyId}`, legacyId === nonBindingId ? "project-value" : "parameter-binding", canonicalId]);
      await tx.query(`insert into parameter_catalog.legacy_mapping_heads
        (legacy_identity_id,current_version_id,cas_version) values ($1,$2,1)`,
      [`identity-${legacyId}`, `mapping-${legacyId}`]);
    }
    await tx.query(`insert into parameter_catalog.legacy_identities
      (id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
      values ('identity-t1081-wrong-kind','wiseeff-v1','project-parameter-binding-revision','project',$1,$2)`, [projectId, mappedId]);
    await tx.query(`insert into parameter_catalog.legacy_mapping_versions
      (id,legacy_identity_id,cutover_run_id,version_number,source_checksum,graph_fingerprint,r_class,target_kind,target_id)
      select 'mapping-t1081-wrong-kind','identity-t1081-wrong-kind','t1081-read-cutover',1,
        't1081-checksum','t1081-graph','R5','project-value',current_value_id
      from parameter_catalog.project_parameter_bindings where id=$1`, [bindingId]);
    await tx.query(`insert into parameter_catalog.legacy_mapping_heads
      (legacy_identity_id,current_version_id,cas_version) values ('identity-t1081-wrong-kind','mapping-t1081-wrong-kind',1)`);
  });
  return {
    readRetainedValue: async () => (await db.query("select raw_value from project_parameter_binding_revisions where binding_id = $1", [unmappedId])).rows
  };
}
