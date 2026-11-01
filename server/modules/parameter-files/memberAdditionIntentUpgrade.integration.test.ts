import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";

it("upgrades existing API and worker logins without giving the worker intent access",async()=>{
  await withTempDatabase({prefix:"intentupgrade",migrate:false},async({db,connectionString})=>{
    await applyMigrations(db,migrationsDir,{through:"0317_catalog_markdown_import_source.sql"});
    await seedCoreGraph(db,{organization:{id:"intent-upgrade-org"},users:[{id:"intent-upgrade-admin"}]});
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('intent-upgrade-role','intent-upgrade-admin','intent-upgrade-org','admin')");
    await db.query("insert into projects(id,organization_id,name,code) values('intent-upgrade-project','intent-upgrade-org','Upgrade','UPGRADE')");
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values('intent-upgrade-set','intent-upgrade-org','intent-upgrade-project','Upgrade')");
    const token=`intentupgrade${randomBytes(4).toString("hex")}`,runtime=await provisionPublicationRuntimeLogins(connectionString,{mode:"lab",runToken:token});
    const api=createPostgresDatabase(runtime.apiUrl),worker=createPostgresDatabase(runtime.workerUrl);
    try{
      await applyMigrations(db,migrationsDir);
      const privileges=await api.query(`select has_table_privilege(current_user,'public.member_addition_intents','SELECT') as can_read,
        has_table_privilege(current_user,'public.member_addition_intents','INSERT') as can_insert,
        has_table_privilege(current_user,'public.member_addition_intents','DELETE') as can_delete,
        has_column_privilege(current_user,'public.member_addition_intents','status','UPDATE') as can_update_status,
        has_column_privilege(current_user,'public.member_addition_intents','mutation_id','UPDATE') as can_update_identity`);
      expect(privileges.rows).toEqual([{can_read:true,can_insert:true,can_delete:false,can_update_status:true,can_update_identity:false}]);
      expect((await worker.query(`select has_table_privilege(current_user,'public.member_addition_intents','SELECT') as can_read,
        has_table_privilege(current_user,'public.member_addition_intents','INSERT') as can_insert,
        has_table_privilege(current_user,'public.member_addition_intents','UPDATE') as can_update,
        has_table_privilege(current_user,'public.member_addition_intents','DELETE') as can_delete`)).rows)
        .toEqual([{can_read:false,can_insert:false,can_update:false,can_delete:false}]);
      const result=await requestJson(createWiseEffServer({db:api}),"/api/v1/projects/intent-upgrade-project/config-sets/intent-upgrade-set/member-addition/intents",
        {method:"POST",headers:{"x-wiseeff-user":"intent-upgrade-admin"},body:JSON.stringify({registrationId:"8e3841e7-bef4-4779-96c5-455357fd2168"})});
      expect(result.status,result.bodyText).toBe(200);
      await expect(worker.query("select * from public.member_addition_intents")).rejects.toMatchObject({code:"42501"});
      await expect(api.query("update public.member_addition_intents set mutation_id=gen_random_uuid() where false")).rejects.toMatchObject({code:"42501"});
    }finally{await api.close();await worker.close();await dropLabRuntimeLogins(connectionString,token);}
  });
},120_000);
