import { randomInt } from "node:crypto";
import pg from "pg";
import { createPostgresDatabase, type Database, type Queryable, type RootDatabase } from "../../../../server/shared/database/client";
import { createReleaseVerificationService } from "../../../../server/modules/release-verification/core";
import { assertDeploymentReportCommandCurrent, DeploymentAuthorityError, type DeploymentReportApproval } from "./deploymentAuthority";

export type ReportDatabaseIdentity = Readonly<{ systemIdentifier: string; databaseOid: string }>;
export class ReportApprovalTargetError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReportApprovalTargetError"; }
}
const refuse = (reason: string): never => { throw new ReportApprovalTargetError(`PCAT-REPORT-APPROVAL-${reason}`); };
const relations = ["verification_gate_registry", "verification_plans", "verification_attempts", "verification_gate_results", "verification_reports", "verification_approvals"];
const identitySql = `with recursive reachable(oid) as (
 select oid from pg_catalog.pg_roles where rolname=session_user
 union select m.roleid from pg_catalog.pg_auth_members m join reachable r on r.oid=m.member
), schemas as (select oid,nspname from pg_catalog.pg_namespace where nspname not in ('pg_catalog','information_schema') and nspname !~ '^pg_(temp|toast)'),
 relations as (select c.*,s.nspname from pg_catalog.pg_class c join schemas s on s.oid=c.relnamespace where c.relkind in ('r','p','v','m','f','S')),
 permitted as (select oid,relname from relations where nspname='parameter_catalog' and relkind='r' and relname=any($1::text[]))
 select session_user=current_user as same_identity,
 exists(select 1 from pg_catalog.pg_roles r where r.rolname='catalog_verification_writer_role'
  and not r.rolcanlogin and not r.rolinherit and pg_catalog.pg_has_role(session_user,r.oid,'USAGE')) as writer,
 (select count(*)::int from pg_catalog.pg_roles r join reachable x on x.oid=r.oid where r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication
  or r.rolname not in (session_user,'catalog_verification_writer_role')) as roles,
 (select count(*)::int from pg_catalog.pg_auth_members m join reachable x on x.oid=m.member where m.admin_option or m.set_option or not m.inherit_option) as memberships,
 (select count(*)::int from pg_catalog.pg_shdepend d join reachable x on x.oid=d.refobjid where d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass and d.deptype='o') as owners,
 (6-(select count(*)::int from permitted p where pg_catalog.has_table_privilege(session_user,p.oid,'SELECT')
   and pg_catalog.has_schema_privilege(session_user,'parameter_catalog','USAGE')
   and (p.relname='verification_gate_registry' or pg_catalog.has_table_privilege(session_user,p.oid,'INSERT')))) as missing,
 (select count(*)::int from relations c where case when c.relkind='S' then pg_catalog.has_sequence_privilege(session_user,c.oid,'USAGE,SELECT,UPDATE') else
  (c.oid not in(select oid from permitted) and (pg_catalog.has_table_privilege(session_user,c.oid,'SELECT,INSERT') or pg_catalog.has_any_column_privilege(session_user,c.oid,'SELECT,INSERT')))
  or (c.relname='verification_gate_registry' and pg_catalog.has_any_column_privilege(session_user,c.oid,'INSERT'))
  or pg_catalog.has_table_privilege(session_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or pg_catalog.has_any_column_privilege(session_user,c.oid,'UPDATE,REFERENCES') end) as extra_relations,
 (select count(*)::int from pg_catalog.pg_namespace s where s.nspname !~ '^pg_(temp|toast)' and pg_catalog.has_schema_privilege(session_user,s.oid,'CREATE'))
  +case when pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE') then 1 else 0 end as ddl,
 (select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace where
  (p.prosecdef and pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE')
    and (s.nspname not in ('pg_catalog','information_schema') or not exists(
      select 1 from pg_catalog.pg_init_privs i where i.classoid='pg_catalog.pg_proc'::pg_catalog.regclass
        and i.objoid=p.oid and i.objsubid=0 and i.privtype='i')))
  or exists(select 1 from pg_catalog.aclexplode(p.proacl) a where a.grantee in(select oid from reachable))) as functions,
 (select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
  join pg_catalog.pg_init_privs i on i.classoid='pg_catalog.pg_proc'::pg_catalog.regclass and i.objoid=p.oid and i.objsubid=0 and i.privtype='i'
  where s.nspname='pg_catalog' and exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
   and not exists(select 1 from pg_catalog.aclexplode(i.initprivs) a where a.grantee=0 and a.privilege_type='EXECUTE')) as builtins,
 (select count(*)::int from pg_catalog.pg_parameter_acl p cross join lateral pg_catalog.aclexplode(p.paracl) a left join pg_catalog.pg_settings s on s.name=p.parname
  where (a.grantee=0 or a.grantee in(select oid from reachable)) and (a.privilege_type='ALTER SYSTEM' or s.context is distinct from 'user')) as parameters,
 (select count(*)::int from pg_catalog.pg_default_acl d cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where a.grantee=0 or a.grantee in(select oid from reachable)) as defaults,
 ((select count(*)::int from relations c cross join lateral pg_catalog.aclexplode(c.relacl) a where a.is_grantable and (a.grantee=0 or a.grantee in(select oid from reachable)))
  +(select count(*)::int from pg_catalog.pg_attribute c cross join lateral pg_catalog.aclexplode(c.attacl) a where a.is_grantable and (a.grantee=0 or a.grantee in(select oid from reachable)))) as grant_options`;

async function physicalIdentity(management: Queryable): Promise<ReportDatabaseIdentity> {
  const result = await management.query<ReportDatabaseIdentity>(`select c.system_identifier::text as "systemIdentifier", d.oid::text as "databaseOid"
    from pg_catalog.pg_control_system() c cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database()`);
  if (result.rowCount !== 1 || !result.rows[0]) refuse("PHYSICAL-TARGET-UNAVAILABLE");
  return result.rows[0];
}
const samePhysical = (left: ReportDatabaseIdentity, right: ReportDatabaseIdentity) => left.systemIdentifier === right.systemIdentifier && left.databaseOid === right.databaseOid;
async function verifyWriter(management: Queryable, writer: Queryable, expected: ReportDatabaseIdentity) {
  if (!samePhysical(await physicalIdentity(management), expected)) refuse("PHYSICAL-TARGET-MISMATCH");
  const result = await writer.query<Record<string, number | boolean>>(identitySql, [relations]);
  const facts = result.rows[0];
  if (result.rowCount !== 1 || facts?.same_identity !== true || facts?.writer !== true
    || Object.entries(facts).some(([key,value]) => !["same_identity","writer"].includes(key) && value !== 0)) refuse("WRITER-CAPABILITY-REJECTED");
  const namespace = 1346584915, key = randomInt(1, 2 ** 31 - 1);
  let held = false; let primary: unknown;
  try {
    const probe = (await writer.query<{ pid: number; held: boolean }>("select pg_catalog.pg_backend_pid() as pid,pg_catalog.pg_try_advisory_lock($1::int,$2::int) as held", [namespace,key])).rows[0];
    held = probe?.held === true;
    if (!held) refuse("SESSION-CHALLENGE-UNAVAILABLE");
    const observed = (await management.query<{ count: number }>(`select count(*)::int as count from pg_catalog.pg_locks where locktype='advisory'
      and pid=$1 and database=$2::oid and classid=$3::oid and objid=$4::oid and objsubid=2 and granted and mode='ExclusiveLock'`, [probe.pid,expected.databaseOid,namespace,key])).rows[0];
    if (observed?.count !== 1 || !samePhysical(await physicalIdentity(management), expected)) refuse("WRITER-TARGET-MISMATCH");
  } catch (error) { primary = error; throw error; }
  finally {
    if (held) {
      try { if ((await writer.query<{ released: boolean }>("select pg_catalog.pg_advisory_unlock($1::int,$2::int) as released", [namespace,key])).rows[0]?.released !== true) refuse("SESSION-CHALLENGE-CLOSE-UNKNOWN"); }
      catch { throw primary ?? new ReportApprovalTargetError("PCAT-REPORT-APPROVAL-SESSION-CHALLENGE-CLOSE-UNKNOWN"); }
    }
  }
}

/** Register in pg's acquisition callback, before any cross-pool await. A lost
 * lease stays observed through destruction; no raw server error is surfaced. */
function withManagement<T>(pool: pg.Pool, body: (client: Queryable) => Promise<T>): Promise<T> {
  return new Promise((resolve,reject) => {
    pool.connect((error,client) => {
      if (error || !client) { reject(new ReportApprovalTargetError("PCAT-REPORT-APPROVAL-MANAGEMENT-CONNECTION-FAILED")); return; }
      let lost = false;
      const onError = () => { lost = true; };
      client.on("error",onError);
      const assertConnected = () => { if (lost) refuse("MANAGEMENT-CONNECTION-FAILED"); };
      const guarded: Queryable = { async query<Row>(sql: string, values?: unknown[]) {
        assertConnected();
        try { const result = await client.query(sql,values); assertConnected(); return { rows: result.rows as Row[], rowCount: result.rowCount }; }
        catch (error) { assertConnected(); throw error; }
      } };
      const settle = (failure: unknown, value?: T) => {
        const destroy = lost || failure !== undefined;
        if (destroy) client.once("end", () => client.removeListener("error",onError));
        try { client.release(destroy); }
        catch { failure ??= new ReportApprovalTargetError("PCAT-REPORT-APPROVAL-MANAGEMENT-CONNECTION-FAILED"); }
        finally { if (!destroy) client.removeListener("error",onError); }
        if (failure !== undefined) reject(failure); else resolve(value!);
      };
      void Promise.resolve().then(() => body(guarded)).then(value => { assertConnected(); return value; })
        .then(value => settle(undefined,value), error => settle(error instanceof Error ? error : new ReportApprovalTargetError("PCAT-REPORT-APPROVAL-TARGET-OBSERVATION-FAILED")));
    });
  });
}

export type ReportApprovalTarget = Readonly<{ physicalTarget: ReportDatabaseIdentity; close(): Promise<void> }>;
const targets = new WeakMap<object, { db: RootDatabase; assertCurrent(): void }>();
export async function openReportApprovalTarget(input: { physicalTarget: ReportDatabaseIdentity; managementConnectionString: string; writerConnectionString: string }): Promise<ReportApprovalTarget> {
  let management: pg.Pool | undefined, db: RootDatabase | undefined;
  try {
    const options = structuredClone(input);
    if (!/^\d+$/.test(options.physicalTarget.systemIdentifier) || !/^\d+$/.test(options.physicalTarget.databaseOid)) refuse("CONFIG-REJECTED");
    for (const value of [options.managementConnectionString, options.writerConnectionString]) {
      let url: URL; try { url = new URL(value); } catch { return refuse("CONFIG-REJECTED"); }
      if (!["postgres:","postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) refuse("CONFIG-REJECTED");
    }
    management = new pg.Pool({ connectionString: options.managementConnectionString });
    const manager = management;
    let closed = false, managementLost = false;
    manager.on("error", () => { managementLost = true; });
    const assertCurrent = () => { if (closed) refuse("TARGET-CLOSED"); if (managementLost) refuse("MANAGEMENT-CONNECTION-FAILED"); };
    db = createPostgresDatabase(options.writerConnectionString, { verifyCheckout: async writer => {
      assertCurrent();
      try {
        await withManagement(manager, async session => {
          await writer.query("select pg_catalog.set_config('search_path','pg_catalog,public,pg_temp',false)");
          await verifyWriter(session, writer, options.physicalTarget);
        });
      } catch (error) { if (error instanceof ReportApprovalTargetError) throw error; refuse("TARGET-OBSERVATION-FAILED"); }
    } });
    await db.query("select 1");
    const writer = db;
    const target = Object.freeze({ physicalTarget: Object.freeze({ ...options.physicalTarget }), async close() {
      if (!closed) {
        closed = true;
        try { try { await writer.close(); } finally { await manager.end(); } }
        catch { refuse("TARGET-CLOSE-FAILED"); }
      }
    } });
    targets.set(target, { db, assertCurrent }); return target;
  } catch (error) {
    await db?.close().catch(() => undefined); await management?.end().catch(() => undefined);
    if (error instanceof ReportApprovalTargetError) throw error;
    return refuse("TARGET-OBSERVATION-FAILED");
  }
}

export async function approveDeploymentReport(target: unknown, command: DeploymentReportApproval) {
  try {
  const issued = typeof target === "object" && target !== null ? targets.get(target) : undefined;
  if (!issued) return refuse("TARGET-REJECTED");
  issued.assertCurrent();
  const physical = (target as ReportApprovalTarget).physicalTarget;
  await assertDeploymentReportCommandCurrent(command, physical);
  // Recheck after the actual writer checkout, immediately before the existing
  // service's transaction body. This wrapper grants no transaction to Kernel.
  const guarded: Database = { query: issued.db.query.bind(issued.db), transaction: body =>
    issued.db.transaction(async tx => { await assertDeploymentReportCommandCurrent(command, physical); return body(tx); }) };
  return await createReleaseVerificationService({ db: guarded }).approveReport(command.reportDigest, command.command);
  } catch (error) {
    if (error instanceof ReportApprovalTargetError || error instanceof DeploymentAuthorityError) throw error;
    return refuse("ACTION-FAILED");
  }
}
