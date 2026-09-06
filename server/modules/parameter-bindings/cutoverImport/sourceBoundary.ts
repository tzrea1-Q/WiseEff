import type pg from "pg";

/** Frozen source readers have broader read needs than the S6 canonical writer. */
export const BINDING_SOURCE_RELATIONS = [
  "public.audit_events", "public.attribution_subjects", "public.driver_registrations",
  "public.driver_registration_placements", "public.driver_schema_versions", "public.driver_schemas",
  "public.dts_config_revision_members", "public.dts_config_revisions", "public.dts_config_set",
  "public.dts_logical_node_revisions", "public.dts_logical_nodes", "public.dts_property_specs",
  "public.organizations", "public.parameter_modules", "public.parameter_spec_versions",
  "public.parameter_specs", "public.project_parameter_binding_revisions", "public.project_parameter_bindings",
  "public.project_parameter_file_versions", "public.project_parameter_files", "public.projects",
] as const;

export type BindingDatabaseIdentity = { systemIdentifier: string; databaseOid: string };
export class BindingSourceRefusal extends Error {
  constructor(reason:string,readonly code?:string) { super(reason); }
}

export async function readBindingDatabaseIdentity(client: pg.PoolClient): Promise<BindingDatabaseIdentity> {
  const result = await client.query<{ system_identifier:string; database_oid:string }>(`select s.system_identifier::text,d.oid::text as database_oid
    from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=current_database()`);
  if (result.rowCount !== 1) throw new BindingSourceRefusal("binding-database-identity-unavailable");
  return {systemIdentifier:result.rows[0].system_identifier,databaseOid:result.rows[0].database_oid};
}

/** Both identity and lock ownership come from real backend queries, not a caller's receipt boolean. */
export async function verifyLockedBindingSource(source: pg.PoolClient, management: pg.PoolClient): Promise<void> {
  const sourceIdentity = await readBindingDatabaseIdentity(source);
  const targetIdentity = await readBindingDatabaseIdentity(management);
  if (sourceIdentity.systemIdentifier !== targetIdentity.systemIdentifier || sourceIdentity.databaseOid !== targetIdentity.databaseOid) throw new BindingSourceRefusal("binding-source-target-mismatch");
  const sourceState = await source.query<{ pid:number; locked:number }>(`select pg_backend_pid() as pid,
    (select count(distinct relation)::int from pg_locks where pid=pg_backend_pid() and granted and mode='ShareLock'
      and database=(select oid from pg_database where datname=current_database()) and relation=any($1::regclass[])) as locked`,[BINDING_SOURCE_RELATIONS]);
  const targetState = await management.query<{ pid:number }>("select pg_backend_pid() as pid");
  if (sourceState.rows[0]?.pid === targetState.rows[0]?.pid || sourceState.rows[0]?.locked !== BINDING_SOURCE_RELATIONS.length) throw new BindingSourceRefusal("binding-source-locks-required");
}

export type LockedBindingSource = { readonly client:pg.PoolClient; close():Promise<void> };

/** Called only in the controlled import phase, after the external writer/queue boundary. */
export async function openLockedBindingSource(pool:pg.Pool, management:pg.PoolClient): Promise<LockedBindingSource> {
  const source = await pool.connect();
  try {
    const left = await readBindingDatabaseIdentity(source);
    const right = await readBindingDatabaseIdentity(management);
    if (left.systemIdentifier !== right.systemIdentifier || left.databaseOid !== right.databaseOid) throw new BindingSourceRefusal("binding-source-target-mismatch");
    await source.query("begin");
    await source.query("set local row_security=off");
    // SHARE permits P8's existing SELECT FOR SHARE on parameter_modules, but refuses
    // all source DML/DDL. P8 writes only parameter_catalog registrations/placements.
    await source.query(`lock table ${BINDING_SOURCE_RELATIONS.join(", ")} in share mode nowait`);
    await verifyLockedBindingSource(source,management);
    return {client:source,async close() {
      try { await source.query("rollback"); }
      catch { source.release(true); throw new BindingSourceRefusal("binding-source-transaction-close-unknown"); }
      source.release();
    }};
  } catch (error) {
    await source.query("rollback").catch(() => undefined);
    source.release();
    if (error instanceof BindingSourceRefusal) throw error;
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
    throw new BindingSourceRefusal(code === "55P03" ? "binding-source-lock-held":"binding-source-authority-unavailable",code);
  }
}

export async function withLockedBindingSource<T>(pool:pg.Pool, management:pg.PoolClient, body:(source:pg.PoolClient)=>Promise<T>): Promise<T> {
  const source = await openLockedBindingSource(pool,management);
  try { return await body(source.client); } finally { await source.close(); }
}
