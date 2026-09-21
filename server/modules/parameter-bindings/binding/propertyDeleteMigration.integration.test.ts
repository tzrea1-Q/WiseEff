import { describe, expect, it } from "vitest";

import { applyMigrations } from "../../../shared/database/migrations";
import { createPostgresDatabase } from "../../../shared/database/client";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";

const ORG = "org-849-delete-upgrade";
const PROJECT = "project-849-delete-upgrade";
const USER = "user-849-delete-upgrade";
const SUBJECT = "csub-849-delete-upgrade";
const SCHEMA = "wiseeff.delete.upgrade";
const CONFIG_SET = "dcs-849-delete-upgrade";
const FILE = "file-849-delete-upgrade";
const VERSION = "file-version-849-delete-upgrade";
const REVISION = "revision-849-delete-upgrade";
const MEMBER = "member-849-delete-upgrade";
const NODE = "node-849-delete-upgrade";
const LOGICAL_REVISION = "logical-revision-849-delete-upgrade";
const PROPERTY = "property-849-delete-upgrade";
const EFFECT = "effect-849-delete-upgrade";
const OCCURRENCE = "occurrence-849-delete-upgrade";
const BINDING = "binding-849-delete-upgrade";
const VALUE = "value-849-delete-upgrade";
const PIN = "pin-849-delete-upgrade";
const HISTORY = "history-849-delete-upgrade";
const AUDIT = "audit-849-delete-upgrade";

describe("0160/0161 populated canonical property-delete upgrade", () => {
  it("preserves a present binding, value, source pin, history, and source file version", async () => {
    await withTempDatabase(
      { prefix: "deleteupgrade", migrate: false },
      async ({ db: migrationDb, connectionString }) => {
        await applyMigrations(migrationDb, migrationsDir, {
          through: "0159_plane_disposal_definer_select.sql",
        });
        const db = createPostgresDatabase(connectionString);
        const auth = makeTestAuthContext({
          userId: USER,
          organizationId: ORG,
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        });
        try {
          await db.query(`insert into public.organizations(id,name) values ($1,'delete upgrade')`, [ORG]);
          await db.query(`insert into public.users(id,organization_id,name,title,is_active) values ($1,$2,'Delete upgrade','Admin',true)`, [USER, ORG]);
          await db.query(`insert into public.projects(id,organization_id,name,code,status) values ($1,$2,'Delete upgrade','D849U','initialized')`, [PROJECT, ORG]);
          await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT, schemaId: SCHEMA });

          const definition = (await db.query<{
            release_id: string;
            definition_id: string;
            revision_id: string;
            subject_id: string;
            property_key: string;
          }>(`select head.release_id,head.definition_id,head.revision_id,definition.subject_id,definition.property_key
                from parameter_catalog.catalog_release_definition_heads head
                join parameter_catalog.parameter_definitions definition on definition.id=head.definition_id
               where definition.subject_id=$1 order by head.definition_id limit 1`, [SUBJECT])).rows[0];
          expect(definition).toBeDefined();
          const registrationId = (await db.query<{ id: string }>(
            `select id from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2 and status='active'`,
            [ORG, SUBJECT],
          )).rows[0]?.id;
          expect(registrationId).toBeDefined();

          await db.transaction(async (tx) => {
            await tx.query("set constraints all deferred");
            await tx.query(`insert into public.dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,'delete upgrade')`, [CONFIG_SET, ORG, PROJECT]);
            await tx.query(`insert into public.project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role,enabled)
              values ($1,$2,$3,'source.dts','dts',$4,'base',true)`, [FILE, ORG, PROJECT, CONFIG_SET]);
            await tx.query(`insert into public.project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin)
              values ($1,$2,1,'delete-upgrade/source.dts',$3,1,'{}'::jsonb,'upload')`, [VERSION, FILE, `sha256:${"1".repeat(64)}`]);
            await tx.query(`update public.project_parameter_files set current_version_id=$1 where id=$2`, [VERSION, FILE]);
            await tx.query(`insert into public.dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,entry_file,include_search_paths,overlay_order,manifest_state)
              values ($1,$2,$3,$4,1,'resolved','source.dts','["."]'::jsonb,'[]'::jsonb,'complete')`, [REVISION, ORG, PROJECT, CONFIG_SET]);
            await tx.query(`insert into public.dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
              values ($1,$2,$3,$4,'base',0,'source.dts')`, [MEMBER, REVISION, FILE, VERSION]);
            await tx.query(`insert into public.dts_logical_nodes(id,organization_id,project_id,config_set_id) values ($1,$2,$3,$4)`, [NODE, ORG, PROJECT, CONFIG_SET]);
            await tx.query(`insert into public.dts_logical_node_revisions(id,logical_node_id,config_revision_id,node_locator,name,compatible)
              values ($1,$2,$3,'/delete-upgrade','delete-upgrade','delete-upgrade')`, [LOGICAL_REVISION, NODE, REVISION]);
            await tx.query(`insert into public.dts_node_occurrences(id,config_revision_id,file_version_id,name,node_path,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order)
              values ($1,$2,$3,'delete-upgrade','/delete-upgrade',0,10,1,1,1,10,'delete-upgrade','{}'::jsonb,0)`, [NODE, REVISION, VERSION]);
            await tx.query(`insert into public.dts_property_occurrences(id,config_revision_id,node_occurrence_id,file_version_id,property_name,start_offset,end_offset,start_line,start_column,end_line,end_column,raw_text,ast_json,source_order)
              values ($1,$2,$3,$4,$5,1,2,1,2,1,3,'7','{}'::jsonb,0)`, [PROPERTY, REVISION, NODE, VERSION, definition!.property_key]);
            await tx.query(`insert into public.dts_occurrence_effects(id,config_revision_id,logical_node_revision_id,property_occurrence_id,node_occurrence_id,property_name,effect_kind,source_order)
              values ($1,$2,$3,$4,$5,$6,'set',0)`, [EFFECT, REVISION, LOGICAL_REVISION, PROPERTY, NODE, definition!.property_key]);
            await tx.query(`insert into parameter_catalog.project_parameter_source_occurrences(id,organization_id,project_id,config_set_id,file_id,occurrence_kind,logical_node_id)
              values ($1,$2,$3,$4,$5,'dts',$6)`, [OCCURRENCE, ORG, PROJECT, CONFIG_SET, FILE, NODE]);
            await tx.query(`insert into parameter_catalog.project_parameter_bindings(id,organization_id,catalog_release_id,project_id,logical_node_id,registration_id,subject_id,definition_id,effective_revision_id,current_value_id,source_occurrence_id)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [BINDING, ORG, definition!.release_id, PROJECT, NODE, registrationId, definition!.subject_id, definition!.definition_id, definition!.revision_id, VALUE, OCCURRENCE]);
            await tx.query(`insert into parameter_catalog.project_parameter_values(id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value,replaced_from_value_id,replaced_from_definition_id)
              values ($1,$2,$3,$4,'source.dts!/delete-upgrade',$5,$6,'number','7'::jsonb,null,null)`, [VALUE, BINDING, definition!.definition_id, definition!.revision_id, REVISION, `sha256:${"2".repeat(64)}`]);
            const locator = { kind: "dts-property", propertyOccurrenceId: PROPERTY, nodeOccurrenceId: NODE, fileVersionId: VERSION, propertyName: definition!.property_key };
            await tx.query(`insert into parameter_catalog.project_value_source_pins(id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,parameter_catalog.canonical_dts_parameter_locator_digest($12::jsonb))`,
            [PIN, VALUE, BINDING, definition!.definition_id, ORG, PROJECT, OCCURRENCE, REVISION, FILE, VERSION, PROPERTY, JSON.stringify(locator)]);
            await tx.query(`insert into parameter_catalog.binding_history_events(id,binding_id,new_effective_revision_id,new_current_value_id,reason,success_audit_ref,catalog_release_id)
              values ($1,$2,$3,$4,'source upgrade',$5,$6)`, [HISTORY, BINDING, definition!.revision_id, VALUE, AUDIT, definition!.release_id]);
            await tx.query("set constraints all immediate");
          });

          const read = async () => ({
            binding: (await db.query(`select id,organization_id,catalog_release_id,project_id,logical_node_id,registration_id,subject_id,definition_id,effective_revision_id,current_value_id,source_occurrence_id,created_at,updated_at from parameter_catalog.project_parameter_bindings where id=$1`, [BINDING])).rows,
            value: (await db.query(`select id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value,replaced_from_value_id,replaced_from_definition_id,created_at from parameter_catalog.project_parameter_values where id=$1`, [VALUE])).rows,
            pin: (await db.query(`select id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest,created_at from parameter_catalog.project_value_source_pins where id=$1`, [PIN])).rows,
            history: (await db.query(`select id,binding_id,old_effective_revision_id,new_effective_revision_id,old_current_value_id,new_current_value_id,reason,success_audit_ref,catalog_release_id,legacy_mapping_version_id,created_at,applied_request_id from parameter_catalog.binding_history_events where id=$1`, [HISTORY])).rows,
            source: (await db.query(`select * from parameter_catalog.project_parameter_source_occurrences where id=$1`, [OCCURRENCE])).rows,
            version: (await db.query(`select * from public.project_parameter_file_versions where id=$1`, [VERSION])).rows,
            current: (await db.query(`select id,current_value_id from parameter_catalog.current_project_parameter_bindings where id=$1`, [BINDING])).rows,
          });
          const before = await read();

          expect(await applyMigrations(migrationDb, migrationsDir, { through: "0160_canonical_dts_delete_source_pin.sql" })).toEqual([
            "0160_canonical_dts_delete_source_pin.sql",
          ]);
          const after0160 = await read();
          expect(after0160.binding).toEqual(before.binding);
          expect(after0160.value).toEqual(before.value);
          expect(after0160.pin).toEqual(before.pin);
          expect(after0160.history).toEqual(before.history);
          expect(after0160.source).toEqual(before.source);
          expect(after0160.version).toEqual(before.version);
          expect(after0160.current).toEqual(before.current);

          expect(await applyMigrations(migrationDb, migrationsDir, { through: "0161_canonical_property_delete_tombstone.sql" })).toEqual([
            "0161_canonical_property_delete_tombstone.sql",
          ]);
          const after0161 = await read();
          expect(after0161.binding).toEqual(before.binding);
          expect(after0161.value).toEqual(before.value);
          expect(after0161.pin).toEqual(before.pin);
          expect(after0161.history).toEqual(before.history);
          expect(after0161.source).toEqual(before.source);
          expect(after0161.version).toEqual(before.version);
          expect(after0161.current).toEqual(before.current);
          expect((await db.query<{ value_state: string }>(`select value_state from parameter_catalog.project_parameter_values where id=$1`, [VALUE])).rows).toEqual([{ value_state: "present" }]);
          expect((await db.query<{ value_state: string; base_source_pin_id: string | null; delete_request_id: string | null; delete_proof: unknown }>(
            `select value_state,base_source_pin_id,delete_request_id,delete_proof from parameter_catalog.project_value_source_pins where id=$1`, [PIN],
          )).rows).toEqual([{ value_state: "present", base_source_pin_id: null, delete_request_id: null, delete_proof: null }]);
          expect((await db.query(`select pg_get_userbyid(proowner) as owner,
            has_function_privilege('catalog_synchronizer_role',oid,'EXECUTE') as synchronizer,
            has_function_privilege('parameter_governance_writer_role',oid,'EXECUTE') as governance
            from pg_proc where oid='parameter_catalog.canonical_json_delete_locator_digest(jsonb)'::regprocedure`)).rows)
            .toEqual([{ owner: "catalog_migration_owner", synchronizer: false, governance: false }]);
        } finally {
          await db.close();
        }
      },
    );
  }, 120_000);
});
