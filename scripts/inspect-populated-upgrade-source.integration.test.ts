import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../server/shared/database/migrations";
import { createPostgresDatabase } from "../server/shared/database/client";
import { gitMigrationInventory, inspectSource, SOURCE_SHA } from "./inspect-populated-upgrade-source";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

// No external database URL is accepted. This suite owns a newly created cluster,
// including its cluster-global roles. No volume or host mount is used.
describe("source SHA on a disposable postgres:16-alpine cluster", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const name = `wiseeff-upg-source-${randomUUID().slice(0, 8)}`;
  const password = randomUUID();
  const source = gitMigrationInventory(root, SOURCE_SHA);
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const candidate = gitMigrationInventory(root, candidateSha);
  let directory: string;
  let client: pg.Client;
  let database: ReturnType<typeof createPostgresDatabase>;
  let connectionUrl: string;
  let id = "";
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>;
  beforeAll(async () => {
    docker = createIsolatedUpgradeDocker();
    directory = await mkdtemp(path.join(os.tmpdir(), "wiseeff-source-migrations-"));
    for (const migration of source) await writeFile(path.join(directory, migration.name), execFileSync("git", ["show", `${SOURCE_SHA}:server/migrations/${migration.name}`], { cwd: root }));
    id = docker.command(["run", "-d", "--name", name, "--label", `wiseeff.test=${name}`, "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"]).toString().trim();
    docker.assertOwned(id, "wiseeff.test", name);
    const port = docker.command(["port", id, "5432/tcp"]).toString().trim().split(":").at(-1);
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    connectionUrl = url;
    for (let attempt = 0; ; attempt++) {
      try { docker.assertOwned(id, "wiseeff.test", name); docker.command(["exec", id, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); break; }
      catch { if (attempt === 40) throw new Error("disposable-postgres-not-ready"); await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    database = createPostgresDatabase(url);
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await applyMigrations(database, directory);
  }, 120_000);
  afterAll(async () => {
    await client?.end();
    await database?.close();
    if (id) { docker.assertOwned(id, "wiseeff.test", name); docker.command(["rm", "-f", "-v", id]); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("inspects actual old schema without exposing values; vector is unavailable", async () => {
    await client.query("insert into organizations(id,name) values ('upg-synthetic-org','synthetic-secret-marker')");
    await client.query(`
      insert into projects(id,organization_id,name,code) values ('upg-project','upg-synthetic-org','Synthetic','UPG');
      insert into dts_config_set(id,organization_id,project_id,name) values ('upg-config','upg-synthetic-org','upg-project','Synthetic');
      insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
        values ('upg-rev1','upg-synthetic-org','upg-project','upg-config',1,'draft'), ('upg-rev2','upg-synthetic-org','upg-project','upg-config',2,'draft');
      insert into parameter_specs(id,organization_id,source_kind,specification_key) values ('upg-spec','upg-synthetic-org','manual','synthetic');
      insert into parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle)
        values ('upg-spec-v1','upg-spec',1,'Synthetic','Synthetic','{"kind":"string"}','draft');
      insert into parameter_modules(id,organization_id,name,path,depth,sort_order,description,scope)
        values ('upg-module','upg-synthetic-org','Synthetic','upg-module',1,0,'','');
      insert into project_parameter_bindings(id,organization_id,project_id,parameter_spec_id,module_id)
        values ('upg-binding','upg-synthetic-org','upg-project','upg-spec','upg-module');
      insert into project_parameter_binding_revisions(id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,canonical_value,raw_value)
        values ('upg-binding-v1','upg-binding','upg-rev1','upg-spec-v1','null',null,null),
          ('upg-binding-v2','upg-binding','upg-rev2','upg-spec-v1','"synthetic-secret-marker"','"synthetic-secret-marker"','synthetic-secret-marker');
    `);
    const result = await inspectSource(client, source, source);
    expect(result.kind).toBe("inspected");
    expect(result.mode).toBe("populated");
    expect(result.valuePresence).toEqual({ typed_value: "2", canonical_value: "1", raw_value: "1" });
    expect(result.inventory.find((entry) => entry.name === "project_parameter_bindings")?.count).toBe("1");
    expect(result.inventory.find((entry) => entry.name === "project_parameter_binding_revisions")?.count).toBe("2");
    expect(result.extensions.some((entry) => entry.name === "vector")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-marker");
    expect(result.ledger).toEqual(source);
    expect(await applyMigrations(database, directory)).toEqual([]);
    const output = execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/inspect-populated-upgrade-source.ts"), "--candidate-sha", candidateSha], { cwd: root, env: { ...process.env, DATABASE_URL: connectionUrl }, encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({ kind: "inspected", authorization: "none", mode: "populated" });
    expect(output).not.toContain(password);
    expect(output).not.toContain("synthetic-secret-marker");
  });
  it("applies the exact candidate suffix while preserving synthetic legacy values", async () => {
    for (const migration of candidate) await writeFile(path.join(directory, migration.name), execFileSync("git", ["show", `${candidateSha}:server/migrations/${migration.name}`], { cwd: root }));
    expect(await applyMigrations(database, directory)).toEqual(candidate.filter((entry) => !source.some((old) => old.name === entry.name)).map((entry) => entry.name));
    const result = await inspectSource(client, source, candidate);
    expect(result.kind).toBe("inspected");
    expect(result.mode).toBe("canonical-present-requires-separate-patch-inspection");
    expect((await client.query("select typed_value,canonical_value,raw_value from public.project_parameter_binding_revisions order by id")).rows).toEqual([
      { typed_value: null, canonical_value: null, raw_value: null },
      { typed_value: "synthetic-secret-marker", canonical_value: "synthetic-secret-marker", raw_value: "synthetic-secret-marker" },
    ]);
    expect(await applyMigrations(database, directory)).toEqual([]);
  });
  it("keeps a committed migration before failure and retries only the failed suffix", async () => {
    await writeFile(path.join(directory, "9998_upg_test.sql"), "create table upg_test_committed(id integer primary key); insert into upg_test_committed values (1);");
    await writeFile(path.join(directory, "9999_upg_test.sql"), "select * from upg_test_missing_dependency;");
    await expect(applyMigrations(database, directory)).rejects.toThrow();
    expect((await client.query("select count(*)::int as count from upg_test_committed")).rows[0].count).toBe(1);
    expect((await client.query("select name from schema_migrations where name like '999%' order by name")).rows).toEqual([{ name: "9998_upg_test.sql" }]);
    await client.query("create table upg_test_missing_dependency(id integer)");
    expect(await applyMigrations(database, directory)).toEqual(["9999_upg_test.sql"]);
    expect((await client.query("select count(*)::int as count from upg_test_committed")).rows[0].count).toBe(1);
  });
  it("refuses checksum drift before another migration", async () => {
    await client.query("update schema_migrations set checksum='corrupt' where name=$1", [source[0].name]);
    await expect(applyMigrations(database, directory)).rejects.toThrow(/checksum/i);
    const result = await inspectSource(client, source, source);
    expect(result.kind).toBe("blocked");
    expect(result.blockers).toContain(`checksum-drift:${source[0].name}`);
  });
});
