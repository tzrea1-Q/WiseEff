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
import { readHistoricalPinnedCatalogEvidenceFixture, seedHistoricalPinnedSourceFixture } from "../../testing/parameterCatalog/historicalSource";
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
        const storage=createLocalObjectStore(directory);
        const {object}=await seedHistoricalPinnedSourceFixture(db,storage,{organizationId,projectId,source});
        await expect(db.query("update dts_config_revisions set include_search_paths='[]'::jsonb where id='cpp-revision'")).rejects.toMatchObject({code:"55000"});
        await db.query("alter table dts_config_revisions enable always trigger dts_config_revisions_pinned_provenance_immutable");
        await db.query("alter table dts_config_revisions enable replica trigger zz_historical_attribution_capture");
        await db.query("create function public.cpp_upgrade_mode_probe() returns trigger language plpgsql as $$ begin return new; end $$");
        await db.query("create trigger cpp_upgrade_origin_mode before update on dts_config_revisions for each row execute function public.cpp_upgrade_mode_probe()");
        await db.query("create trigger cpp_upgrade_disabled_mode before update on dts_config_revisions for each row execute function public.cpp_upgrade_mode_probe()");
        await db.query("alter table dts_config_revisions disable trigger cpp_upgrade_disabled_mode");
        const modes=async()=>(await db.query<{tgname:string;tgenabled:string;definition:string}>("select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.dts_config_revisions'::regclass and not tgisinternal order by tgname")).rows;
        const evidence=async()=>({
          revision:(await db.query("select to_jsonb(revision)-'declared_build_inputs' as evidence from dts_config_revisions revision where id='cpp-revision'")).rows,
          graph:(await db.query(`select jsonb_build_object('members',(select jsonb_agg(row) from dts_config_revision_members row where config_revision_id='cpp-revision'),
            'nodes',(select jsonb_agg(row) from dts_node_occurrences row where config_revision_id='cpp-revision'),
            'properties',(select jsonb_agg(row) from dts_property_occurrences row where config_revision_id='cpp-revision'),
            'effects',(select jsonb_agg(row) from dts_occurrence_effects row where config_revision_id='cpp-revision')) as evidence`)).rows,
          version:(await db.query("select * from project_parameter_file_versions where id='cpp-version'")).rows,
          ...await readHistoricalPinnedCatalogEvidenceFixture(db),
          bytes:await storage.getBounded!(object.storageKey,1024)
        });
        const before=await evidence(),beforeModes=await modes();
        expect(before.pins).toHaveLength(1);
        expect([...new Set(beforeModes.map(row=>row.tgenabled))].sort()).toEqual(["A","D","O","R"]);
        expect(await applyMigrations(db,migrationsDir,{through:"0301_dts_declared_build_inputs.sql"})).toEqual(["0301_dts_declared_build_inputs.sql"]);
        expect(await evidence()).toEqual(before);
        expect(await modes()).toEqual(beforeModes);
        expect((await db.query("select declared_build_inputs from dts_config_revisions where id='cpp-revision'")).rows).toEqual([{declared_build_inputs:{includeSearchPaths:[".","include"],defines:{}}}]);
        await expect(db.query("update dts_config_revisions set declared_build_inputs='{\"includeSearchPaths\":[],\"defines\":{}}'::jsonb where id='cpp-revision'")).rejects.toMatchObject({code:"55000"});
        await expect(db.query("update dts_property_occurrences set raw_text='<99>' where id='cpp-property'")).rejects.toMatchObject({code:"55000"});
        await expect(db.query("update project_parameter_file_versions set checksum='changed' where id='cpp-version'")).rejects.toMatchObject({code:"55000"});
      } finally {await db.close();await rm(directory,{recursive:true,force:true});}
    });
  },120_000);
});
