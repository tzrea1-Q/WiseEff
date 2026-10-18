import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function missingRuntimeGrants(sql: string): string[] {
  const optOuts = [...sql.matchAll(/^\s*-- runtime-acl: owner-only (?:public\.)?(\w+) [^\S\r\n]*\S[^\r\n]*/gm)]
    .map((match) => match[1]);
  const uncommented = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const blocks = [...uncommented.matchAll(/\bdo\s+(\$(?:\w+)?\$)([\s\S]*?)\1\s*;/gi)];
  const missing: string[] = [];
  for (const create of uncommented.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"\w+"|\w+)(?:\s*\.\s*(?:"\w+"|\w+))?)(?=\s|\(|;)/gi)) {
    const parts = create[1].replaceAll('"', "").split(/\s*\.\s*/);
    if (parts.length === 2 && parts[0] !== "public") continue;
    const table = parts.at(-1)!;
    if (optOuts.includes(table)) continue;
    const hasGrant = blocks.some((block) => block.index! > create.index!
      && new RegExp(`\\b${table}\\b`).test(block[2])
      && /has_table_privilege\s*\(\s*oid\s*,\s*'public\.log_domains'\s*,\s*'INSERT'\s*\)/i.test(block[2])
      && /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\b/i.test(block[2]));
    if (!hasGrant) missing.push(table);
  }
  return missing;
}

describe("public table runtime grants (0185 onward)", () => {
  it("rejects missing grants and accepts a runtime block or a reasoned owner-only opt-out", () => {
    const create = "create table public.example (id text);";
    const block = `do $$
      declare role_name text;
      begin
        for role_name in select rolname from pg_roles
          where has_table_privilege(oid, 'public.log_domains', 'INSERT')
            and oid <> (select relowner from pg_class where oid = 'public.example'::regclass)
            and rolname <> 'PUBLIC'
        loop
          execute format('grant select, insert, update, delete on public.example to %I', role_name);
        end loop;
      end $$;`;
    expect(missingRuntimeGrants(create)).toEqual(["example"]);
    expect(missingRuntimeGrants(`${create}\n${block}`)).toEqual([]);
    expect(missingRuntimeGrants(`${create}\n-- runtime-acl: owner-only example internal owner workflow`)).toEqual([]);
    expect(missingRuntimeGrants(`${block}\n${create}`)).toEqual(["example"]);
    expect(missingRuntimeGrants(`${create}\n-- runtime-acl: owner-only example `)).toEqual(["example"]);
    expect(missingRuntimeGrants('create table if not exists "public"."example" (id text);')).toEqual(["example"]);
    expect(missingRuntimeGrants("create table example (id text);")).toEqual(["example"]);
    expect(missingRuntimeGrants("create table public.example as select 1 as id;")).toEqual(["example"]);
    expect(missingRuntimeGrants("create table parameter_catalog.example (id text);")).toEqual([]);
    expect(missingRuntimeGrants(`/* ${create} */ -- ${create}`)).toEqual([]);
  });

  const migrationsDir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name) && Number.parseInt(name, 10) >= 185).sort()) {
    it(`${file} includes runtime grants for each new public table`, () => {
      const missing = missingRuntimeGrants(readFileSync(new URL(file, migrationsDir), "utf8"));
      expect(missing, `${file}: add a subsequent runtime DML grant DO block for each table using has_table_privilege(oid, 'public.log_domains', 'INSERT'), or -- runtime-acl: owner-only <table> <reason>`).toEqual([]);
    });
  }
});
