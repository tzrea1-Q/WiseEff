import pg from "pg";
import {
  dropLabRuntimeLogins as dropLab,
  provisionPublicationRuntimeLogins as provision,
  publicationRuntimeLoginNames,
  publicationRuntimeOwnershipComment,
} from "../modules/catalog-publication/runtime/provisionRuntimeLogins";
import { acquireDatabaseLock, hasTestClusterRoleCatalogLock, isGeneratedTestDatabaseName, TEMPLATE_BUILD_LOCK, withTestClusterRoleCatalogLock } from "./testDatabase";

export * from "../modules/catalog-publication/runtime/provisionRuntimeLogins";

/** Lab role membership writes share the postgres lease with migration observations. */
export const provisionPublicationRuntimeLogins: typeof provision = (url, input) =>
  input?.mode === "lab" && !hasTestClusterRoleCatalogLock()
    ? withTestClusterRoleCatalogLock(() => provision(url, input))
    : provision(url, input);

/** Remove only exact upgrade RPC/read grants copied into foreign fixtures; unexpected dependencies still fail DROP ROLE. */
export async function revokeForeignTestRuntimeGrants(url: string, roles: readonly string[], ownershipComment: string): Promise<void> {
  if (!hasTestClusterRoleCatalogLock()) throw new Error("Lab runtime cleanup requires the cluster role catalog lease");
  if (!ownershipComment.startsWith("wiseeff-publication-runtime:lab:")) throw new Error("Lab runtime ownership is required");
  const source = new URL(url);
  const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
  source.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: source.href });
  await admin.connect();
  try {
    // No clone may copy a foreign grant after the dependency snapshot.
    await acquireDatabaseLock(admin, TEMPLATE_BUILD_LOCK);
    for (const role of roles) {
      const dependencies = await admin.query<{ database: string }>(
        `select distinct database.datname as database from pg_shdepend dependency
         join pg_database database on database.oid = dependency.dbid
         join pg_roles role on role.oid = dependency.refobjid
         where dependency.refclassid = 'pg_authid'::regclass and dependency.deptype = 'a'
           and role.rolname = $1 and shobj_description(role.oid, 'pg_authid') = $2`, [role, ownershipComment]
      );
      for (const { database } of dependencies.rows) {
        if (database === sourceDatabase || !isGeneratedTestDatabaseName(database)) continue;
        const target = new URL(source);
        target.pathname = `/${database}`;
        const client = new pg.Client({ connectionString: target.href });
        try {
          await client.connect();
          const grants = await client.query<{ routine: string }>(
            `select routine.oid::regprocedure::text as routine from pg_proc routine
             join pg_namespace namespace on namespace.oid = routine.pronamespace
             cross join lateral aclexplode(routine.proacl) acl
             join pg_roles role on role.oid = acl.grantee
             where role.rolname = $1 and shobj_description(role.oid, 'pg_authid') = $2
               and acl.privilege_type = 'EXECUTE' and namespace.nspname = 'parameter_catalog'
               and routine.oid = any(array[
                 to_regprocedure('parameter_catalog.preview_parameter_definition_purge(text)'),
                 to_regprocedure('parameter_catalog.lock_parameter_definition_purge(text)'),
                 to_regprocedure('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'),
                 to_regprocedure('parameter_catalog.read_parameter_definition_erasure(text)'),
                 to_regprocedure('parameter_catalog.list_definition_erasures(text)'),
                 to_regprocedure('parameter_catalog.finish_parameter_definition_erasure_object(text,text)'),
                 to_regprocedure('parameter_catalog.lock_parameter_plane_archive()'),
                 to_regprocedure('parameter_catalog.definition_erasure_object_is_referenced(text,text)'),
                 to_regprocedure('parameter_catalog.register_agent_checkpoint_namespace(text,text,text,text,text,text,boolean)'),
                 to_regprocedure('parameter_catalog.preview_organization_deletion(text,text)')
               ]::oid[])`, [role, ownershipComment]
          );
          for (const { routine } of grants.rows) {
            await client.query(`revoke execute on function ${routine} from ${pg.escapeIdentifier(role)}`);
          }
          const checkpointOwnership = await client.query<{ exists: boolean }>("select to_regclass('public.agent_checkpoint_namespaces') is not null as exists");
          if (checkpointOwnership.rows[0]?.exists) {
            await client.query(`revoke select on public.agent_checkpoint_namespaces from ${pg.escapeIdentifier(role)}`);
          }
        } catch (error) {
          // Another fixture may drop its database after the dependency snapshot.
          if ((error as { code?: string }).code !== "3D000"
            || (await admin.query("select 1 from pg_database where datname = $1", [database])).rows.length) throw error;
        } finally { await client.end(); }
      }
    }
  } finally {
    await admin.query("select pg_advisory_unlock($1)", [TEMPLATE_BUILD_LOCK]).catch(() => undefined);
    await admin.end();
  }
}

export const dropLabRuntimeLogins: typeof dropLab = (url, token) => {
  const drop = async () => {
    const names = publicationRuntimeLoginNames({ mode: "lab", runToken: token });
    await revokeForeignTestRuntimeGrants(url, Object.values(names), publicationRuntimeOwnershipComment("lab", token.toLowerCase().replace(/[^a-z0-9]/g, "")));
    return dropLab(url, token);
  };
  return hasTestClusterRoleCatalogLock() ? drop() : withTestClusterRoleCatalogLock(drop);
};
