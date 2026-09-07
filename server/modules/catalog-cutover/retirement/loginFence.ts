import pg from "pg";
import { isDeepStrictEqual } from "node:util";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import type { RecoveryRole } from "../../../../ops/self-hosted/storage/recoveryPackage";
import { legacyRolesAreRecoverable, type RetiringRole } from "./roleRecovery";

const requireFact = (value: unknown, reason: string): void => { if (!value) throw new Error(`legacy-login-fence-${reason}`); };
export const retiringRolesSql = `select r.oid::text as oid,r.rolname as name,r.rolcanlogin as login,r.rolinherit as inherit,
  r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication as privileged,
  (with recursive callers(oid) as (select r.oid union select a.member from pg_catalog.pg_auth_members a join callers c on c.oid=a.roleid)
    select json_agg(json_build_object('oid',p.oid::text,'name',p.rolname) order by p.rolname)
    from callers c join pg_catalog.pg_roles p on p.oid=c.oid) as callers,
  coalesce((select json_agg(json_build_object('name',m.rolname,'inherit',a.inherit_option,'set',a.set_option,'admin',a.admin_option) order by m.rolname)
    from pg_catalog.pg_auth_members a join pg_catalog.pg_roles m on m.oid=a.member where a.roleid=r.oid),'[]') as members
  from pg_catalog.pg_roles r where r.rolname=any($1::text[]) order by r.rolname`;

export async function assertNoSharedLegacyRoleUse(client: pg.PoolClient, roles: readonly RetiringRole[], target: BindingDatabaseIdentity): Promise<void> {
  // Re-observe backend liveness, not an earlier transaction's statistics cache.
  await client.query("select pg_catalog.pg_stat_clear_snapshot()");
  const conflicts = (await client.query(`with recursive reachable(oid) as (
    select oid from pg_catalog.pg_roles where oid=any($1::oid[])
    union select m.roleid from pg_catalog.pg_auth_members m join reachable r on r.oid=m.member
  ) select
    (select count(*)::int from pg_catalog.pg_shdepend where refclassid='pg_catalog.pg_authid'::regclass and refobjid in(select oid from reachable)
      and dbid<>$2::oid and not(dbid=0 and classid='pg_catalog.pg_database'::regclass and objid=$2::oid)) as shared,
    (select count(*)::int from pg_catalog.pg_roles where oid in(select oid from reachable)
      and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) as privileged,
    (select count(*)::int from pg_catalog.pg_stat_activity where usesysid=any($3::oid[])) as sessions`,
    [roles.map(role => role.oid), target.databaseOid, roles.flatMap(role => role.callers.map(caller => caller.oid))])).rows[0];
  requireFact(conflicts?.shared === 0 && conflicts.privileged === 0 && conflicts.sessions === 0, "shared-role-or-live-session");
}

/** Internal management effect. The caller owns its transaction, durable intent,
 * exact source-credential observation, same-package provenance and host fence.
 * This effect additionally requires the existing Cutover lock on THIS session.
 * It does not commit, terminate backends, mark P13, or grant any capability.
 */
export async function applyLegacyLoginFence(input: {
  client: pg.PoolClient; target: BindingDatabaseIdentity;
  expectedRoles: readonly RetiringRole[]; recoveryRoles: readonly RecoveryRole[];
}): Promise<void> {
  const { client } = input;
  requireFact(isDeepStrictEqual(await readBindingDatabaseIdentity(client), input.target), "target-mismatch");
  const boundary = (await client.query(`select session_user=current_user as same,
    (select rolsuper from pg_catalog.pg_roles where rolname=session_user) as manager,
    exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid()
      and database=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())
      and locktype='advisory' and granted and classid=hashtext('s7-orc-cutover-target')::oid
      and objid=hashtext(current_database())::oid and objsubid=2) as locked`)).rows[0];
  requireFact(boundary?.same === true && boundary.manager === true && boundary.locked === true, "management-lock-required");
  const current = (await client.query<RetiringRole>(retiringRolesSql, [input.expectedRoles.map(role => role.name)])).rows;
  requireFact(isDeepStrictEqual(current, input.expectedRoles) && legacyRolesAreRecoverable(current, input.recoveryRoles), "role-drift-or-unrestorable");
  const outgoing = (await client.query(`select granted.rolname as role,member.rolname as member,a.inherit_option as inherit,a.set_option as set,a.admin_option as admin
    from pg_catalog.pg_auth_members a join pg_catalog.pg_roles granted on granted.oid=a.roleid
    join pg_catalog.pg_roles member on member.oid=a.member where a.member=any($1::oid[])`, [current.map(role => role.oid)])).rows;
  const expected = input.recoveryRoles.flatMap(role => role.members.filter(member => current.some(item => item.name === member.name))
    .map(member => ({ role: role.name, member: member.name, inherit: member.inherit, set: member.set, admin: false })));
  const order = (left: { role: string; member: string }, right: { role: string; member: string }) =>
    left.role < right.role ? -1 : left.role > right.role ? 1 : left.member < right.member ? -1 : left.member > right.member ? 1 : 0;
  requireFact(isDeepStrictEqual(outgoing.sort(order), expected.sort(order)), "membership-recovery-drift");
  await assertNoSharedLegacyRoleUse(client, current, input.target);
  for (const role of current) {
    await client.query(`alter role ${pg.escapeIdentifier(role.name)} nologin`);
    for (const member of role.members) await client.query(`revoke ${pg.escapeIdentifier(role.name)} from ${pg.escapeIdentifier(member.name)} restrict`);
  }
}
