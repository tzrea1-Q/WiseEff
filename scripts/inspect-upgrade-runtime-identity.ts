import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

// This is a read-only inventory, never release approval or a complete capability audit.
// Membership is deliberately conservative: even NOINHERIT edges are inventoried,
// including SET-only reachability. An operator must review the real capability map.
export const identityInventorySql = `
with recursive reachable(oid) as (
  select oid from pg_roles where rolname = session_user
  union
  select membership.roleid from pg_auth_members membership
  join reachable on membership.member = reachable.oid
), application_schemas as (
  select oid from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema')
    and nspname not like 'pg_toast%' and nspname not like 'pg_temp%'
), definers as (
  select p.* from pg_proc p join application_schemas s on s.oid = p.pronamespace
  where p.prosecdef and exists (select 1 from reachable r where has_function_privilege(r.oid, p.oid, 'EXECUTE'))
)
select
  session_user = current_user as same_identity,
  (select count(*)::int from reachable) as reachable_roles,
  (select count(*)::int from pg_roles r join reachable on reachable.oid = r.oid
   where r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication) as privileged_roles,
  (select count(*)::int from pg_roles r join reachable on reachable.oid = r.oid
   where r.rolname in ('catalog_migration_owner', 'catalog_synchronizer_role')) as management_roles,
  (select count(*)::int from pg_class c join application_schemas s on s.oid = c.relnamespace
   where c.relowner in (select oid from reachable)) as owned_relations,
  (select count(*)::int from pg_namespace n where n.oid in (select oid from application_schemas)
   and n.nspowner in (select oid from reachable)) as owned_schemas,
  (select count(*)::int from definers) as executable_definers,
  (select count(*)::int from definers
   where not coalesce(proconfig @> array['search_path=pg_catalog'], false)) as definers_requiring_search_path_review,
  (select count(*)::int from pg_default_acl d, lateral aclexplode(d.defaclacl) a
   where a.grantee = 0) as public_default_acl_entries,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'parameter_catalog' and c.relkind in ('r','p')
   and exists (select 1 from reachable r where has_table_privilege(r.oid,c.oid,'INSERT')
        or has_table_privilege(r.oid,c.oid,'UPDATE') or has_table_privilege(r.oid,c.oid,'DELETE')
        or has_table_privilege(r.oid,c.oid,'TRUNCATE'))) as catalog_writable_relations
`;

export type IdentityInventory = {
  same_identity: boolean;
  reachable_roles: number;
  privileged_roles: number;
  management_roles: number;
  owned_relations: number;
  owned_schemas: number;
  executable_definers: number;
  definers_requiring_search_path_review: number;
  public_default_acl_entries: number;
  catalog_writable_relations: number;
};

export function evaluateIdentityInventory(inventory: IdentityInventory) {
  const reasons: string[] = [];
  if (!inventory.same_identity) reasons.push("session-effective-identity-mismatch");
  if (inventory.privileged_roles) reasons.push("privileged-role-reachable");
  if (inventory.management_roles) reasons.push("catalog-management-role-reachable");
  if (inventory.owned_relations || inventory.owned_schemas) reasons.push("application-object-ownership");
  if (inventory.executable_definers) reasons.push("security-definer-review-required");
  if (inventory.catalog_writable_relations) reasons.push("catalog-write-capability-review-required");
  if (inventory.public_default_acl_entries) reasons.push("public-default-acl-review-required");
  return {
    schemaVersion: "upgrade-runtime-identity-v1",
    status: reasons.length ? "blocked" : "inventory-collected",
    releaseApproved: false,
    capabilityAuditComplete: false,
    reasons,
    inventory,
    receiptDigest: `sha256:${createHash("sha256").update(JSON.stringify(inventory)).digest("hex")}`,
  };
}

export async function inspectRuntimeIdentity(connectionString: string) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, application_name: "wiseeff-runtime-identity-inspector" });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query("begin read only");
    const result = await client.query<IdentityInventory>(identityInventorySql);
    if (!result.rows[0]) throw new Error("missing inventory");
    return evaluateIdentityInventory(result.rows[0]);
  } finally {
    if (connected) await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export async function runIdentityInspector(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length || !env.DATABASE_URL?.trim()) {
    return { exitCode: 2, output: { status: "blocked", reason: "database-url-required-and-no-arguments-accepted" } };
  }
  try {
    const output = await inspectRuntimeIdentity(env.DATABASE_URL);
    return { exitCode: output.status === "blocked" ? 1 : 0, output };
  } catch {
    // Driver errors may contain hostnames, usernames, SQL, or connection secrets.
    return { exitCode: 1, output: { status: "blocked", reason: "runtime-identity-query-failure" } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runIdentityInspector(process.argv.slice(2));
  console.log(JSON.stringify(result.output));
  process.exitCode = result.exitCode;
}
