import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { offsetToLineColumn, parseDts } from "../dts";
import { createLocalObjectStore } from "../logs/objectStore";

describe("populated declared build-input upgrade", () => {
  it("backfills pinned revisions without changing original evidence and restores exact trigger modes", async () => {
    await withTempDatabase({ prefix: "cppinputupgrade", migrate: false }, async ({ connectionString }) => {
      const db = createPostgresDatabase(connectionString), directory = await mkdtemp(join(tmpdir(), "wiseeff-cpp-input-upgrade-"));
      const organizationId="cpp-input-upgrade",projectId="cpp-input-project",userId="cpp-input-author";
      const source='/dts-v1/;\r\n/ { charger { compatible = "acme,power"; iin_max = <36>; }; };\r\n';
      try {
        await applyMigrations(db,migrationsDir,{before:"0301_dts_declared_build_inputs.sql"});
        await seedCoreGraph(db,{organization:{id:organizationId},projects:[{id:projectId}],users:[{id:userId}]});
        const auth=makeTestAuthContext({organizationId,userId,roleId:"admin"});
        await installDriverSourceFixture(db,auth,{subjectId:"csub_acme_power",compatible:"acme,power",businessName:"Upgrade",driverName:"Upgrade source",idempotencyKey:"cpp-input-upgrade",reason:"Prove populated source upgrade"});
        const definition=(await db.query<{release_id:string;definition_id:string;revision_id:string;registration_id:string}>(`select head.release_id,head.definition_id,head.revision_id,registration.id as registration_id
          from parameter_catalog.catalog_release_definition_heads head join parameter_catalog.parameter_definitions definition on definition.id=head.definition_id
          join parameter_catalog.organization_subject_registrations registration on registration.subject_id=definition.subject_id and registration.organization_id=$1 and registration.status='active'
          where definition.subject_id='csub_acme_power' and definition.property_key='iin_max'`,[organizationId])).rows[0]!;
        const storage=createLocalObjectStore(directory),object=await storage.put({organizationId,fileName:"source.dts",contentType:"text/plain",bytes:Buffer.from(source)});
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
          await tx.query("insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin) values ('cpp-version','cpp-file',1,$1,$2,$3,'upload')",[object.storageKey,object.checksumSha256,object.fileSizeBytes]);
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
            values ('cpp-value','cpp-binding',$1,$2,'source.dts!/charger','cpp-revision','sha256:historical-value','number','36'::jsonb)`,[definition.definition_id,definition.revision_id]);
          const locator=JSON.stringify({kind:"dts-property",propertyOccurrenceId:"cpp-property",nodeOccurrenceId:"cpp-node-occurrence",fileVersionId:"cpp-version",propertyName:"iin_max"});
          await tx.query(`insert into parameter_catalog.project_value_source_pins(id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
            values ('cpp-pin','cpp-value','cpp-binding',$1,$2,$3,'cpp-occurrence','cpp-revision','cpp-file','cpp-version','dts','cpp-property',$4::jsonb,parameter_catalog.canonical_dts_parameter_locator_digest($4::jsonb))`,[definition.definition_id,organizationId,projectId,locator]);
          await tx.query("set constraints all immediate");
        });
        await expect(db.query("update dts_config_revisions set include_search_paths='[]'::jsonb where id='cpp-revision'")).rejects.toMatchObject({code:"55000"});
        await db.query("alter table dts_config_revisions enable always trigger dts_config_revisions_pinned_provenance_immutable");
        await db.query("alter table dts_config_revisions enable replica trigger zz_historical_attribution_capture");
        await db.query("create function public.cpp_upgrade_mode_probe() returns trigger language plpgsql as $$ begin return new; end $$");
        for(const name of ["cpp_upgrade_origin_mode","cpp_upgrade_disabled_mode"])await db.query(`create trigger ${name} before update on dts_config_revisions for each row execute function public.cpp_upgrade_mode_probe()`);
        await db.query("alter table dts_config_revisions disable trigger cpp_upgrade_disabled_mode");
        const modes=async()=>(await db.query<{tgname:string;tgenabled:string;definition:string}>("select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.dts_config_revisions'::regclass and not tgisinternal order by tgname")).rows;
        const evidence=async()=>({
          revision:(await db.query("select to_jsonb(revision)-'declared_build_inputs' as evidence from dts_config_revisions revision where id='cpp-revision'")).rows,
          graph:(await db.query(`select jsonb_build_object('members',(select jsonb_agg(row) from dts_config_revision_members row where config_revision_id='cpp-revision'),
            'nodes',(select jsonb_agg(row) from dts_node_occurrences row where config_revision_id='cpp-revision'),
            'properties',(select jsonb_agg(row) from dts_property_occurrences row where config_revision_id='cpp-revision'),
            'effects',(select jsonb_agg(row) from dts_occurrence_effects row where config_revision_id='cpp-revision')) as evidence`)).rows,
          version:(await db.query("select * from project_parameter_file_versions where id='cpp-version'")).rows,
          pins:(await db.query("select * from parameter_catalog.project_value_source_pins where id='cpp-pin'")).rows,
          values:(await db.query("select * from parameter_catalog.project_parameter_values where id='cpp-value'")).rows,
          binding:(await db.query("select * from parameter_catalog.project_parameter_bindings where id='cpp-binding'")).rows,
          bytes:await storage.getBounded!(object.storageKey,1024)
        });
        const before=await evidence(),beforeModes=await modes();
        expect(before.pins).toHaveLength(1);
        expect([...new Set(beforeModes.map(row=>row.tgenabled))].sort()).toEqual(["A","D","O","R"]);
        expect(await applyMigrations(db,migrationsDir,{through:"0301_dts_declared_build_inputs.sql"})).toEqual(["0301_dts_declared_build_inputs.sql"]);
        expect(await evidence()).toEqual(before);
        expect(await modes()).toEqual(beforeModes);
        expect((await db.query("select declared_build_inputs from dts_config_revisions where id='cpp-revision'")).rows).toEqual([{declared_build_inputs:{includeSearchPaths:[".","include"],defines:{}}}]);
        for(const statement of ["update dts_config_revisions set declared_build_inputs='{\"includeSearchPaths\":[],\"defines\":{}}'::jsonb where id='cpp-revision'",
          "update dts_property_occurrences set raw_text='<99>' where id='cpp-property'","update project_parameter_file_versions set checksum='changed' where id='cpp-version'"])
          await expect(db.query(statement)).rejects.toMatchObject({code:"55000"});
      } finally {await db.close();await rm(directory,{recursive:true,force:true});}
    });
  },120_000);
});
