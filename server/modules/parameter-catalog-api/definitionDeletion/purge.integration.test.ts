import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDefinitionDeletionFixture } from "../../../testing/parameterCatalog/definitionDeletion";
import { prepareCatalogDefinitionErasure } from "../../catalog-publication/definitionErasure";
import { X_DEFINITION_ID, Y_DEFINITION_ID } from "../../catalog-kernel/runtime/catalogChain.fixture";

describe("platform Definition erasure through the runtime API database role", () => {
  let fixture: Awaited<ReturnType<typeof createDefinitionDeletionFixture>>;

  beforeAll(async () => {
    fixture = await createDefinitionDeletionFixture("definition_purge_sql");
    const owner = fixture.owners[0]!;
    await fixture.root.query(`insert into public.parameter_specs(id,organization_id,source_kind,specification_key,property_key)
      values ('legacy-erase-spec',$1,'manual','manual/legacy-erase','iin_max'),('legacy-retain-spec',$1,'manual','manual/legacy-retain','iin_max')`, [owner.organizationId]);
    await fixture.root.query(`insert into public.parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle,version_status)
      values ('legacy-erase-version','legacy-erase-spec',1,'Old parameter','Old metadata','{}','deprecated','superseded')`);
    await fixture.root.query(`insert into public.parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk)
      values ('legacy-erase-flat',$1,'Legacy erasure','Legacy description','','json','Legacy','','','Low')`, [owner.organizationId]);
    await fixture.root.query(`insert into public.project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value)
      values ('legacy-erase-value',$1,$2,'legacy-erase-flat','42','43')`, [owner.organizationId, owner.projectId]);
    await fixture.root.query(`insert into public.parameter_history_entries(id,organization_id,project_id,parameter_definition_id,project_parameter_value_id,version,value)
      values ('legacy-erase-history',$1,$2,'legacy-erase-flat','legacy-erase-value',1,'41')`, [owner.organizationId, owner.projectId]);
    await fixture.root.query(`insert into public.legacy_parameter_migration_evidence(id,organization_id,legacy_kind,legacy_id,parameter_spec_id,parameter_spec_version_id,evidence)
      values ('legacy-erase-evidence',$1,'parameter_definition','legacy-erase-flat','legacy-erase-spec','legacy-erase-version','{"historicalValue":"41"}')`, [owner.organizationId]);
    await fixture.root.query(`insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
      values ('legacy-erase-identity','wiseeff-v1','parameter-spec','organization',$1,'legacy-erase-spec')`, [owner.organizationId]);
    await fixture.root.query(`insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values ('legacy-erase-run','fixture',$1,$2,'1.0.0','fixture-plan','P0','planned')`, ["a".repeat(40), fixture.chain.pinC.digest]);
    await fixture.root.query(`insert into parameter_catalog.legacy_mapping_versions(id,legacy_identity_id,cutover_run_id,version_number,source_checksum,graph_fingerprint,r_class,target_kind,target_id)
      values ('legacy-erase-mapping','legacy-erase-identity','legacy-erase-run',1,'fixture-source','fixture-graph','R4','parameter-definition',$1)`, [X_DEFINITION_ID]);
    await fixture.root.query(`insert into parameter_catalog.legacy_mapping_heads(legacy_identity_id,current_version_id,cas_version)
      values ('legacy-erase-identity','legacy-erase-mapping',1)`);
    const items = [X_DEFINITION_ID, Y_DEFINITION_ID].map((definitionId, index) => ({
      id: `import-${index}`, definitionId, projectParameterValueId: owner.bindings[index]!.currentValueId,
      currentValue: String(index + 100), recommendedValue: String(index + 200), classification: "updated", riskFlag: index === 0,
    }));
    await fixture.root.query(`insert into public.parameter_import_batches(id,organization_id,project_id,created_by_user_id,source_name,status,summary,items)
      values ('shared-erasure-import',$1,$2,$3,'shared.json','previewed',$4::jsonb,$5::jsonb)`,
    [owner.organizationId, owner.projectId, owner.userId, JSON.stringify({ added: 0, updated: 2, unchanged: 0, conflict: 0, highRisk: 1 }), JSON.stringify(items)]);
    await fixture.root.query(`insert into public.project_parameter_plane_archives(id,organization_id,project_id,scope,object_ref,content_digest,archive_digest,counts,truncated,created_by)
      values ('shared-erasure-archive',$1,$2,'legacy-parameter-plane','old-owned-archive','sha256:'||repeat('a',64),'sha256:'||repeat('b',64),'{}',false,$3)`,
    [owner.organizationId, owner.projectId, owner.userId]);
  }, 120_000);

  afterAll(async () => { await fixture?.close(); });

  it("previews both tenants and legacy references without granting general deletion", async () => {
    const result = await fixture.api.query<{ preview: { affectedOrganizations: number; affectedProjects: number; legacySpecIds: string[] } }>(
      "select parameter_catalog.preview_parameter_definition_purge($1) preview", [X_DEFINITION_ID]);
    expect(result.rows[0]!.preview).toMatchObject({ affectedOrganizations: 2, affectedProjects: 2, legacySpecIds: ["legacy-erase-spec"] });
    await expect(fixture.api.query("delete from parameter_catalog.parameter_definitions where id=$1", [X_DEFINITION_ID])).rejects.toMatchObject({ code: "42501" });
    await expect(fixture.api.query("insert into parameter_catalog.definition_purge_rows values (txid_current(),'public.projects','{}','DELETE')")).rejects.toMatchObject({ code: "42501" });
    await expect(fixture.root.query("delete from parameter_catalog.parameter_definitions where id=$1", [X_DEFINITION_ID])).rejects.toMatchObject({ code: "55000" });
  });

  it("includes shared import snapshots in the confirmation fingerprint", async () => {
    const read = async () => (await fixture.api.query<{ preview: { fingerprint: string } }>(
      "select parameter_catalog.preview_parameter_definition_purge($1) preview", [X_DEFINITION_ID])).rows[0]!.preview.fingerprint;
    const before = await read();
    await fixture.root.query("update public.parameter_import_batches set items=jsonb_set(items,'{0,currentValue}','\"changed-after-preview\"') where id='shared-erasure-import'");
    expect(await read()).not.toBe(before);
  });

  it("serializes archive capture and erasure before either can read its source", async () => {
    await fixture.api.transaction(async erasure => {
      await erasure.query("select parameter_catalog.lock_parameter_definition_purge($1)", [X_DEFINITION_ID]);
      await expect(fixture.api.query("select parameter_catalog.lock_parameter_plane_archive()"))
        .rejects.toMatchObject({ code: "PCA05", detail: "PCAT-GUARD-SYNCHRONIZATION-BUSY" });
    });
    await fixture.api.transaction(async archive => {
      await archive.query("select parameter_catalog.lock_parameter_plane_archive()");
      await expect(fixture.api.query("select parameter_catalog.lock_parameter_definition_purge($1)", [X_DEFINITION_ID]))
        .rejects.toMatchObject({ code: "PCA05", detail: "PCAT-GUARD-SYNCHRONIZATION-BUSY" });
    });
  });

  it("rolls all values, legacy data, artifacts and cleanup pointers back after a partial failure", async () => {
    const before = (await fixture.root.query("select id,value from parameter_catalog.project_parameter_values order by id")).rows;
    await expect(fixture.api.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [X_DEFINITION_ID]);
      const plan = await prepareCatalogDefinitionErasure(tx, X_DEFINITION_ID);
      await tx.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)", [X_DEFINITION_ID, JSON.stringify(plan), "erase-platform", "audit-purge-rollback"]);
      throw new Error("injected-after-purge");
    })).rejects.toThrow("injected-after-purge");
    expect((await fixture.root.query("select id,value from parameter_catalog.project_parameter_values order by id")).rows).toEqual(before);
    expect((await fixture.root.query("select id from public.parameter_specs where id='legacy-erase-spec'")).rows).toHaveLength(1);
    expect((await fixture.root.query("select * from parameter_catalog.definition_erasures")).rows).toHaveLength(0);
  });

  it("erases all target data, retains the other Definition and raw source, and supports cleanup retry", async () => {
    const retainedBefore = (await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID])).rows;
    const files = (await fixture.root.query<{ id: string; storage_key: string }>("select id,storage_key from public.project_parameter_file_versions order by id")).rows;
    const bytes = await Promise.all(files.map(file => fixture.storage.get(file.storage_key)));
    const definition = (await fixture.root.query<Record<string, string>>("select * from parameter_catalog.parameter_definitions where id=$1", [X_DEFINITION_ID])).rows[0]!;
    await fixture.api.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [X_DEFINITION_ID]);
      const plan = await prepareCatalogDefinitionErasure(tx, X_DEFINITION_ID);
      await tx.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)", [X_DEFINITION_ID,
        JSON.stringify({ ...plan, archiveErasure: { planeUpdates: [{ id: "shared-erasure-archive", oldObjectRef: "old-owned-archive", newObjectRef: "new-sanitized-archive", contentDigest: `sha256:${"c".repeat(64)}`, archiveDigest: `sha256:${"d".repeat(64)}`, counts: {} }],
          catalogDeletes: [], pendingObjectRefs: ["plane::old-owned-archive"] } }), "erase-platform", "audit-purge-success"]);
    });
    for (const table of ["parameter_catalog.parameter_definitions", "parameter_catalog.definition_revisions", "parameter_catalog.project_parameter_bindings", "parameter_catalog.project_parameter_values"]) {
      const column = table.endsWith(".parameter_definitions") ? "id" : "definition_id";
      expect((await fixture.root.query(`select 1 from ${table} where ${column}=$1`, [X_DEFINITION_ID])).rows, table).toHaveLength(0);
    }
    for (const table of ["public.parameter_specs", "public.parameter_spec_versions", "public.parameter_definitions", "public.project_parameter_values", "public.parameter_history_entries", "public.legacy_parameter_migration_evidence", "parameter_catalog.legacy_identities", "parameter_catalog.legacy_mapping_versions"]) {
      expect((await fixture.root.query(`select 1 from ${table} where id like 'legacy-erase-%'`)).rows, table).toHaveLength(0);
    }
    expect((await fixture.root.query("select id from public.parameter_specs where id='legacy-retain-spec'")).rows).toHaveLength(1);
    expect((await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID])).rows).toEqual(retainedBefore);
    expect((await fixture.root.query("select id,storage_key from public.project_parameter_file_versions order by id")).rows).toEqual(files);
    expect(await Promise.all(files.map(file => fixture.storage.get(file.storage_key)))).toEqual(bytes);
    const batch = (await fixture.root.query<{ items: Array<{ definitionId: string }>; summary: Record<string, number> }>("select items,summary from public.parameter_import_batches where id='shared-erasure-import'")).rows[0]!;
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]!.definitionId).toBe(Y_DEFINITION_ID);
    expect(batch.summary).toMatchObject({ updated: 1, highRisk: 0 });
    expect((await fixture.api.query<{ referenced: boolean }>("select parameter_catalog.definition_erasure_object_is_referenced('plane',$1) referenced", [files[0]!.storage_key])).rows[0]!.referenced).toBe(true);
    expect((await fixture.api.query<{ referenced: boolean }>("select parameter_catalog.definition_erasure_object_is_referenced('plane','old-owned-archive') referenced")).rows[0]!.referenced).toBe(false);
    const state = () => fixture.api.query<{ state: { pending_object_refs: string[] } }>("select parameter_catalog.read_parameter_definition_erasure($1) state", [X_DEFINITION_ID]);
    expect((await state()).rows[0]!.state.pending_object_refs).toEqual(["plane::old-owned-archive"]);
    await fixture.api.query("select parameter_catalog.finish_parameter_definition_erasure_object($1,'plane::old-owned-archive')", [X_DEFINITION_ID]);
    expect((await state()).rows[0]!.state.pending_object_refs).toEqual([]);
    await expect(fixture.root.query(`insert into parameter_catalog.parameter_definitions(id,introduced_release_id,subject_id,property_key,current_revision_id) values($1,$2,$3,$4,$5)`,
      [definition.id, definition.introduced_release_id, definition.subject_id, definition.property_key, definition.current_revision_id])).rejects.toMatchObject({ code: "55000", message: "Parameter definition was permanently erased" });
    expect((await fixture.api.query<{ result: { erased: boolean } }>("select parameter_catalog.purge_parameter_definition($1,'{}','erase-platform','audit-retry') result", [X_DEFINITION_ID])).rows[0]!.result.erased).toBe(true);
  });
});
