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
    const hasGrant = blocks.some((block) => {
      if (block.index! <= create.index! || !new RegExp(`\\b${table}\\b`).test(block[2])) return false;
      const runtimeDml = /has_table_privilege\s*\(\s*oid\s*,\s*'public\.log_domains'\s*,\s*'INSERT'\s*\)/i.test(block[2])
        && /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\b/i.test(block[2]);
      // Feedback cleanup companions inherit the existing attachment writers,
      // including deployments whose feedback role cannot write log domains.
      const feedbackPrivileges = ["product_feedback_attachment_uploads", "product_feedback_attachment_deletions"].includes(table)
        && /has_table_privilege\s*\(\s*oid\s*,\s*'public\.product_feedback_attachments'\s*,\s*'INSERT'\s*\)/i.test(block[2])
        && new RegExp(`grant\\s+select\\s*,\\s*insert\\s*,\\s*update\\s*,\\s*delete\\s+on\\s+public\\.${table}\\s+to\\s+%I`, "i").test(block[2]);
      // Recognition settings mirror each existing module privilege separately;
      // a read-only module role must not receive all runtime DML privileges.
      const modulePrivileges = /select\s+grantee\s*,\s*privilege_type\s+from\s+information_schema\.role_table_grants/i.test(block[2])
        && /table_schema\s*=\s*'public'\s+and\s+table_name\s*=\s*'parameter_modules'/i.test(block[2])
        && /privilege_type\s+in\s*\(\s*'SELECT'\s*,\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)/i.test(block[2])
        && new RegExp(`execute\\s+format\\(\\s*'grant %s on public\\.${table} to %I'\\s*,\\s*(\\w+)\\.privilege_type\\s*,\\s*\\1\\.grantee\\s*\\)`, "i").test(block[2]);
      // Identity reads mirror credentials, but writes also require coordinator membership.
      const identityPrivileges = table === "user_oidc_identities"
        && /table_schema\s*=\s*'public'\s+and\s+table_name\s*=\s*'user_password_credentials'/i.test(block[2])
        && /privilege_type\s+in\s*\(\s*'SELECT'\s*,\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*\)\s+and\s+grantee\s*<>\s*'PUBLIC'/i.test(block[2])
        && /for\s+(\w+)\s+in\s+select\s+grantee\s*,\s*privilege_type\s+from\s+information_schema\.role_table_grants[\s\S]*?\bloop\s+if\s+\1\.privilege_type\s*=\s*'SELECT'\s+or\s+pg_has_role\(\s*\1\.grantee\s*,\s*'catalog_publication_coordinator_role'\s*,\s*'MEMBER'\s*\)\s+then\s+execute\s+format\(\s*'grant %s on public\.user_oidc_identities to %I'\s*,\s*\1\.privilege_type\s*,\s*\1\.grantee\s*\)\s*;\s*end\s+if/i.test(block[2]);
      return runtimeDml || feedbackPrivileges || modulePrivileges || identityPrivileges;
    });
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

  it("accepts exact per-privilege module grants without allowing an unrelated or broader grant", () => {
    const create = "create table public.example (id text);";
    const block = `do $$ declare app_grant record; begin
      for app_grant in select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'parameter_modules'
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      loop execute format('grant %s on public.example to %I', app_grant.privilege_type, app_grant.grantee);
      end loop; end $$;`;
    expect(missingRuntimeGrants(`${create}\n${block}`)).toEqual([]);
    for (const invalid of [block.replace("'parameter_modules'", "'unrelated'"),
      block.replace("'public'", "'other_schema'"), block.replace("app_grant.grantee", "someone_else.grantee"),
      block.replace("app_grant.privilege_type", "'ALL'"), block.replace("on public.example", "on public.unrelated"),
      block.replace(", 'DELETE'", "")]) {
      expect(missingRuntimeGrants(`${create}\n${invalid}`)).toEqual(["example"]);
    }
    expect(missingRuntimeGrants(`${block}\n${create}`)).toEqual(["example"]);
  });

  it("recognizes only exact feedback companion grants from existing attachment writers", () => {
    for (const table of ["product_feedback_attachment_uploads", "product_feedback_attachment_deletions"]) {
      const create = `create table public.${table}(id text);`;
      const block = `do $$ declare r record; begin
        for r in select rolname from pg_roles where has_table_privilege(oid,'public.product_feedback_attachments','INSERT') loop
          execute format('grant select,insert,update,delete on public.${table} to %I',r.rolname);
        end loop; end $$;`;
      expect(missingRuntimeGrants(create + block)).toEqual([]);
      for (const invalid of [block.replace("product_feedback_attachments", "unrelated"),
        block.replace("'INSERT'", "'SELECT'"), block.replace(`on public.${table}`, "on public.unrelated"),
        block.replace("select,insert,update,delete", "all")]) {
        expect(missingRuntimeGrants(create + invalid)).toEqual([table]);
      }
      expect(missingRuntimeGrants((create + block).replaceAll(table, "unrelated"))).toEqual(["unrelated"]);
      expect(missingRuntimeGrants(block + create)).toEqual([table]);
    }
  });

  it("recognizes identity grants only from credential privileges with coordinator-only writes", () => {
    const create = "create table public.user_oidc_identities(id text);";
    const block = `do $$ declare identity_grant record; begin
      for identity_grant in select grantee,privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='user_password_credentials'
          and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
      loop
        if identity_grant.privilege_type='SELECT' or pg_has_role(identity_grant.grantee,'catalog_publication_coordinator_role','MEMBER') then
          execute format('grant %s on public.user_oidc_identities to %I',identity_grant.privilege_type,identity_grant.grantee);
        end if;
      end loop; end $$;`;
    expect(missingRuntimeGrants(create + block)).toEqual([]);
    for (const invalid of [block.replace("'user_password_credentials'", "'unrelated'"),
      block.replace("'public'", "'other_schema'"), block.replace("grantee<>'PUBLIC'", "true"),
      block.replace("pg_has_role(identity_grant.grantee", "pg_has_role(someone_else.grantee"),
      block.replace("'catalog_publication_coordinator_role'", "'catalog_worker_role'"),
      block.replace("'MEMBER'", "'USAGE'"), block.replace("='SELECT' or", "='INSERT' or"),
      block.replace("identity_grant.privilege_type,identity_grant.grantee", "'ALL',identity_grant.grantee"),
      block.replace("on public.user_oidc_identities", "on public.unrelated"), block.replace(",'DELETE'", "")]) {
      expect(missingRuntimeGrants(create + invalid)).toEqual(["user_oidc_identities"]);
    }
    expect(missingRuntimeGrants((create + block).replaceAll("user_oidc_identities", "unrelated"))).toEqual(["unrelated"]);
    expect(missingRuntimeGrants(block + create)).toEqual(["user_oidc_identities"]);
  });

  const migrationsDir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name) && Number.parseInt(name, 10) >= 185).sort()) {
    it(`${file} includes runtime grants for each new public table`, () => {
      const missing = missingRuntimeGrants(readFileSync(new URL(file, migrationsDir), "utf8"));
      expect(missing, `${file}: add a subsequent runtime DML grant DO block for each table using has_table_privilege(oid, 'public.log_domains', 'INSERT'), or -- runtime-acl: owner-only <table> <reason>`).toEqual([]);
    });
  }
});
