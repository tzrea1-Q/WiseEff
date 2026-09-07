import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { LEGACY_STRUCTURAL_TABLES } from "../../catalog-kernel/security/catalogRoleManifest";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../release-verification/core/digest";
import type { RecoveryRole } from "../../../../ops/self-hosted/storage/recoveryPackage";

const relations = [...LEGACY_STRUCTURAL_TABLES, "driver_schemas", "driver_schema_versions", "dts_property_specs"];
const mutation = new Set(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
const intentKind = "legacy-sql-privileges-intent", appliedKind = "legacy-sql-privileges-applied";
export class LegacySqlPrivilegeFenceError extends Error {
  constructor(readonly code: string) { super(`PCAT-LEGACY-SQL-PRIVILEGE-${code}`); }
}
function need(value: unknown, code: string): asserts value { if (!value) throw new LegacySqlPrivilegeFenceError(code); }
type Identity = { oid: string; name: string };
type Entry = { column: number; grantor: string; grantorName: string; grantee: string; granteeName: string;
  privilege: string; grantable: boolean };
type Relation = { oid: string; name: string; owner: string; ownerName: string; acl: string[] | null;
  columns: { number: number; name: string; type: string; acl: string[] | null }[]; entries: Entry[] };
type Membership = { role: string; member: string; inherit: boolean; set: boolean; admin: boolean };
type Inventory = { relations: Relation[]; roles: (Identity & { login: boolean; inherit: boolean; unsafe: boolean })[];
  memberships: Membership[]; shared: number };
export type LegacySqlPrivilegeSelection = {
  runId: string; attemptId: string; target: BindingDatabaseIdentity;
  activationBindingDigest: string; rootRequestDigest: string; recoveryPackageDigest: string;
};
export type LegacySqlPrivilegeIntent = { contract: "pcat-legacy-sql-privileges-v1";
  selection: LegacySqlPrivilegeSelection; runtimeRoles: Identity[]; inventory: Inventory; intentDigest: string };

const scope = `with recursive settable(oid) as (
  select oid from pg_catalog.pg_roles where oid=any($1::oid[])
  union select m.roleid from pg_catalog.pg_auth_members m join settable r on r.oid=m.member where m.set_option
), reachable(oid) as (
  select distinct role.oid from pg_catalog.pg_roles role cross join settable s
    where role.oid=s.oid or pg_catalog.pg_has_role(s.oid,role.oid,'USAGE')
)`;
async function observe(client: pg.PoolClient, roots: Identity[], target: BindingDatabaseIdentity): Promise<Inventory> {
  const roleRows = (await client.query<Inventory["roles"][number]>(`${scope}
    select r.oid::text,r.rolname as name,r.rolcanlogin as login,r.rolinherit as inherit,
      r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication as unsafe
    from pg_catalog.pg_roles r join reachable s on s.oid=r.oid order by r.rolname`, [roots.map(r => r.oid)])).rows;
  need(roots.length > 0 && roots.every(root => roleRows.some(role => role.oid === root.oid && role.name === root.name && role.login)), "ROLE-IDENTITY-DRIFT");
  need(roleRows.every(role => !role.unsafe && role.oid !== "10"), "PRIVILEGED-RUNTIME");
  const memberships = (await client.query<Membership>(`select granted.rolname as role,member.rolname as member,
    a.inherit_option as inherit,a.set_option as set,a.admin_option as admin
    from pg_catalog.pg_auth_members a join pg_catalog.pg_roles granted on granted.oid=a.roleid
    join pg_catalog.pg_roles member on member.oid=a.member
    where a.member=any($1::oid[]) or a.roleid=any($1::oid[]) order by 1,2`, [roleRows.map(r => r.oid)])).rows;
  need(memberships.every(edge => !edge.admin), "MEMBERSHIP-UNSUPPORTED");
  need(memberships.every(edge => roleRows.some(role => role.name === edge.member)), "SHARED-ROLE-USE");
  const shared = (await client.query<{ count: number }>(`select count(*)::int as count from pg_catalog.pg_shdepend
    where refclassid='pg_catalog.pg_authid'::regclass and refobjid=any($1::oid[])
      and dbid<>$2::oid and not(dbid=0 and classid='pg_catalog.pg_database'::regclass and objid=$2::oid)`,
  [roleRows.map(r => r.oid), target.databaseOid])).rows[0]?.count;
  need(shared === 0, "SHARED-ROLE-USE");
  const rows = (await client.query<Relation>(`select c.oid::text,c.relname as name,c.relowner::text as owner,
    pg_catalog.pg_get_userbyid(c.relowner) as "ownerName",c.relacl::text[] as acl,
    (select coalesce(json_agg(json_build_object('number',a.attnum,'name',a.attname,'type',a.atttypid::text,'acl',a.attacl::text[]) order by a.attnum),'[]')
      from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
    (select coalesce(json_agg(json_build_object('column',x.column_number,'grantor',x.grantor::text,
      'grantorName',pg_catalog.pg_get_userbyid(x.grantor),'grantee',x.grantee::text,
      'granteeName',case when x.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(x.grantee) end,
      'privilege',x.privilege_type,'grantable',x.is_grantable)
      order by x.column_number,x.grantor,x.grantee,x.privilege_type),'[]') from (
        select 0 as column_number,e.* from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) e
        union all select a.attnum,e.* from pg_catalog.pg_attribute a
          cross join lateral pg_catalog.aclexplode(a.attacl) e
          where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      ) x) as entries
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and c.relkind in('r','p') order by c.relname`, [relations])).rows;
  need(rows.length === relations.length && new Set(rows.map(r => r.name)).size === relations.length &&
    rows.every(row => relations.includes(row.name) && row.columns.length > 0 && row.entries.length > 0), "INVENTORY-UNAVAILABLE");
  need(rows.every(row => !roleRows.some(role => role.oid === row.owner)), "RUNTIME-OWNER");
  return { relations: rows, roles: roleRows, memberships, shared };
}

function changes(inventory: Inventory) {
  const scopeOids = new Set(inventory.roles.map(role => role.oid));
  const selected: { relation: Relation; entry: Entry }[] = [];
  for (const relation of inventory.relations) for (const entry of relation.entries) {
    if (entry.grantee === relation.owner) continue; // Preserve every owner privilege.
    const mutating = mutation.has(entry.privilege) || ["REFERENCES", "TRIGGER"].includes(entry.privilege);
    if (!mutating) continue;
    need(entry.grantee === "0" || scopeOids.has(entry.grantee), "GRANTEE-SCOPE-UNPROVEN");
    need(entry.grantor === relation.owner && !entry.grantable, "GRANT-CHAIN-UNSUPPORTED");
    need(mutation.has(entry.privilege) && (!entry.column || ["INSERT", "UPDATE"].includes(entry.privilege)), "CAPABILITY-OUTSIDE-EFFECT");
    selected.push({ relation, entry });
  }
  return selected;
}
const comparison = (inventory: Inventory, removed: ReturnType<typeof changes> = []) => ({
  ...inventory,
  relations: inventory.relations.map(relation => ({ ...relation, acl: undefined,
    columns: relation.columns.map(column => ({ ...column, acl: undefined })),
    entries: relation.entries.filter(entry => !removed.some(change => change.relation.oid === relation.oid && isDeepStrictEqual(change.entry, entry))),
  })),
});
async function assertManagement(client: pg.PoolClient, target: BindingDatabaseIdentity) {
  const schemas = (await client.query<{ schemas: string[] }>("select pg_catalog.current_schemas(true)::text[] as schemas")).rows[0]?.schemas;
  need(Array.isArray(schemas) && schemas[0] === "pg_catalog", "RESOLUTION-UNSAFE");
  need(isDeepStrictEqual(await readBindingDatabaseIdentity(client), target), "TARGET-MISMATCH");
  const row = (await client.query(`select session_user=current_user as same,
    (select rolsuper from pg_catalog.pg_roles where rolname=session_user) as manager,
    exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and database=$1::oid
      and locktype='advisory' and granted and mode='ExclusiveLock' and objsubid=2
      and classid=pg_catalog.hashtext('s7-orc-cutover-target')::oid and objid=pg_catalog.hashtext(pg_catalog.current_database())::oid) as held`, [target.databaseOid])).rows[0];
  need(row?.same === true && row.manager === true && row.held === true, "MANAGEMENT-LOCK-REQUIRED");
}
async function begin(client: pg.PoolClient) {
  await client.query("begin isolation level serializable");
  await client.query("set local synchronous_commit=on");
  // Role identity/membership are cluster-wide metadata. These short NOWAIT
  // locks prevent a concurrent GRANT/ALTER from escaping the ACL snapshot;
  // they do not change roles or privileges and are released at transaction end.
  await client.query("lock table pg_catalog.pg_authid,pg_catalog.pg_auth_members in share mode nowait");
  // The seven legacy tables are not the six separate P12 inventory tables.
  // Lock before the first snapshot, covering concurrent DML, DDL and ACL changes.
  await client.query(`lock table ${relations.map(name => `public.${pg.escapeIdentifier(name)}`).join(",")} in access exclusive mode nowait`);
}

/** Existing management effect only. Root-supplied closures retain real host,
 * source, report/package and P12 guards; these hooks never confer approval.
 * It owns two write transactions and a locked readback transaction, but never
 * releases/ends the borrowed client. */
export async function applyLegacySqlPrivilegeFence(input: {
  client: pg.PoolClient; selection: LegacySqlPrivilegeSelection; runtimeRoles: readonly Identity[];
  recoveryRoles: readonly RecoveryRole[];
  beforeEffect: () => Promise<void>;
  persistHostIntent: (intent: LegacySqlPrivilegeIntent) => Promise<void>;
  persistHostStep: (intentDigest: string) => Promise<void>;
}): Promise<{ outcome: "legacy-sql-privileges-fenced-not-P13"; intentDigest: string }> {
  const { client, beforeEffect, persistHostIntent, persistHostStep } = input;
  const selection = structuredClone(input.selection), roots = [...structuredClone(input.runtimeRoles)], recovered = structuredClone(input.recoveryRoles);
  need(/^[A-Za-z0-9_-]{1,160}$/.test(selection.runId) && /^[A-Za-z0-9_-]{1,160}$/.test(selection.attemptId) &&
    [selection.activationBindingDigest, selection.rootRequestDigest, selection.recoveryPackageDigest].every(value => /^sha256:[a-f0-9]{64}$/.test(value)) &&
    roots.length > 0 && roots.every(role => /^[1-9][0-9]*$/.test(role.oid) && role.name.length > 0) &&
    new Set(roots.map(role => role.oid)).size === roots.length, "SELECTION-INVALID");
  let transaction = false, ending = false, intentCommitted = false, lost = false;
  const onLoss = () => { lost = true; };
  client.on("error", onLoss); client.on("end", onLoss);
  const live = async () => { await beforeEffect(); need(!lost, "CONNECTION-LOST"); };
  const append = async (kind: string, payload: unknown) => {
    await live();
    await client.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
      select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb
      from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
    [`cevt_${randomUUID()}`, selection.runId, kind, JSON.stringify(payload)]);
  };
  try {
    const probe = pg.escapeIdentifier(`sql_fence_${randomUUID().replaceAll("-", "")}`);
    let outer = false;
    try { await client.query(`savepoint ${probe}`); outer = true; }
    catch (error) { need((error as { code?: string }).code === "25P01", "TRANSACTION-UNAVAILABLE"); }
    if (outer) { await client.query(`release savepoint ${probe}`); throw new LegacySqlPrivilegeFenceError("EXTERNAL-TRANSACTION"); }
    await assertManagement(client, selection.target); await live();
    transaction = true; await begin(client);
    await assertManagement(client, selection.target);
    const run = (await client.query(`select current_phase,state from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update`, [selection.runId])).rows[0];
    need(run?.current_phase === "P12" && run.state === "running", "P12-RUN-UNAVAILABLE");
    const prior = await client.query(`select id from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[])`, [selection.runId, [intentKind, appliedKind]]);
    need(prior.rowCount === 0, "ATTEMPT-REQUIRES-INSPECTION");
    const inventory = await observe(client, roots, selection.target), removed = changes(inventory);
    need(inventory.roles.every(role => recovered.some(saved => saved.name === role.name)), "ROLE-RECOVERY-UNSUPPORTED");
    const body = { contract: "pcat-legacy-sql-privileges-v1" as const, selection, runtimeRoles: roots, inventory };
    const intent: LegacySqlPrivilegeIntent = { ...body, intentDigest: digestOf(body) };
    await persistHostIntent(structuredClone(intent));
    await append(intentKind, intent);
    await live(); ending = true; await client.query("commit"); transaction = false; ending = false; intentCommitted = true;
    await live(); transaction = true; await begin(client); await assertManagement(client, selection.target);
    await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [selection.runId]);
    const retained = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[]) order by sequence_number`, [selection.runId, [intentKind, appliedKind]])).rows;
    need(retained.length === 1 && retained[0].event_kind === intentKind && isDeepStrictEqual(retained[0].payload, intent), "INTENT-DRIFT");
    need(isDeepStrictEqual(await observe(client, roots, selection.target), inventory), "INVENTORY-DRIFT");
    for (const { relation, entry } of removed) {
      const column = relation.columns.find(value => value.number === entry.column);
      need(!entry.column || column, "COLUMN-IDENTITY-DRIFT");
      await live();
      await client.query(`revoke ${entry.privilege}${column ? ` (${pg.escapeIdentifier(column.name)})` : ""} on table public.${pg.escapeIdentifier(relation.name)} from ${entry.grantee === "0" ? "PUBLIC" : pg.escapeIdentifier(entry.granteeName)} restrict`);
    }
    const after = await observe(client, roots, selection.target);
    need(isDeepStrictEqual(comparison(after), comparison(inventory, removed)), "UNEXPECTED-ACL-EFFECT");
    // Effective privileges include default/role capabilities without explicit ACLs.
    const effective = (await client.query<{ count: number }>(`${scope} select count(*)::int as count
      from reachable r cross join unnest($2::oid[]) relation(oid)
      where pg_catalog.has_table_privilege(r.oid,relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege(r.oid,relation.oid,'INSERT,UPDATE,REFERENCES')`, [roots.map(r => r.oid), inventory.relations.map(r => r.oid)])).rows[0];
    need(effective?.count === 0, "EFFECTIVE-PRIVILEGE-REMAINS");
    await append(appliedKind, { intentDigest: intent.intentDigest, after });
    await live(); ending = true; await client.query("commit"); transaction = false; ending = false;
    await live();
    // Fresh post-commit inspection and the host acknowledgment share these
    // seven locks. An earlier RR snapshot is not a current ACL observation.
    transaction = true; await begin(client); await assertManagement(client, selection.target);
    await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [selection.runId]);
    const readback = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[]) order by sequence_number`, [selection.runId, [intentKind, appliedKind]])).rows;
    need(isDeepStrictEqual(readback, [{ event_kind: intentKind, payload: intent },
      { event_kind: appliedKind, payload: { intentDigest: intent.intentDigest, after } }]), "COMMIT-READBACK-DRIFT");
    need(isDeepStrictEqual(await observe(client, roots, selection.target), after), "COMMIT-READBACK-DRIFT");
    await live(); await persistHostStep(intent.intentDigest); await live();
    await client.query("rollback"); transaction = false; await live();
    return { outcome: "legacy-sql-privileges-fenced-not-P13", intentDigest: intent.intentDigest };
  } catch (error) {
    if (transaction && !ending) { try { await client.query("rollback"); } catch { ending = true; } }
    if (ending || intentCommitted || lost) throw new LegacySqlPrivilegeFenceError("OUTCOME-UNKNOWN");
    if (error instanceof LegacySqlPrivilegeFenceError) throw error;
    throw new LegacySqlPrivilegeFenceError("UNAVAILABLE");
  } finally { client.removeListener("error", onLoss); client.removeListener("end", onLoss); }
}

/** Exact management inspection only. It never replays an effect or promotes a
 * host pending entry. Existing S7 ownership and the root's live boundary remain
 * required; no borrowed transaction or connection is committed/released. */
export async function inspectLegacySqlPrivilegeFence(input: {
  client: pg.PoolClient; selection: LegacySqlPrivilegeSelection; intentDigest: string;
  beforeEffect: () => Promise<void>;
}): Promise<{ outcome: "not-applied" | "intent-only" | "legacy-sql-privileges-fenced-not-P13" | "unknown"; intentDigest?: string }> {
  const { client, beforeEffect, intentDigest } = input, selection = structuredClone(input.selection);
  let transaction = false, lost = false;
  const onLoss = () => { lost = true; };
  client.on("error", onLoss); client.on("end", onLoss);
  const live = async () => { await beforeEffect(); need(!lost, "CONNECTION-LOST"); };
  try {
    need(/^sha256:[a-f0-9]{64}$/.test(intentDigest), "SELECTION-INVALID");
    const probe = pg.escapeIdentifier(`sql_inspect_${randomUUID().replaceAll("-", "")}`);
    let outer = false;
    try { await client.query(`savepoint ${probe}`); outer = true; }
    catch (error) { need((error as { code?: string }).code === "25P01", "TRANSACTION-UNAVAILABLE"); }
    if (outer) { await client.query(`release savepoint ${probe}`); throw new LegacySqlPrivilegeFenceError("EXTERNAL-TRANSACTION"); }
    await assertManagement(client, selection.target); await live();
    transaction = true; await begin(client); await assertManagement(client, selection.target);
    const run = (await client.query("select current_phase,state from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [selection.runId])).rows[0];
    need(run?.current_phase === "P12" && run.state === "running", "P12-RUN-UNAVAILABLE");
    const rows = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[]) order by sequence_number`, [selection.runId, [intentKind, appliedKind]])).rows;
    let outcome: "not-applied" | "intent-only" | "legacy-sql-privileges-fenced-not-P13" = "not-applied";
    if (rows.length) {
      need(rows.length <= 2 && rows[0].event_kind === intentKind, "INTENT-DRIFT");
      const intent = rows[0].payload as LegacySqlPrivilegeIntent;
      const { intentDigest: storedDigest, ...body } = intent;
      need(body.contract === "pcat-legacy-sql-privileges-v1" && storedDigest === intentDigest && digestOf(body) === intentDigest &&
        isDeepStrictEqual(body.selection, selection), "INTENT-DRIFT");
      const current = await observe(client, body.runtimeRoles, selection.target);
      if (rows.length === 1) {
        need(isDeepStrictEqual(current, body.inventory), "INVENTORY-DRIFT"); outcome = "intent-only";
      } else {
        need(rows[1].event_kind === appliedKind && rows[1].payload.intentDigest === intentDigest &&
          isDeepStrictEqual(rows[1].payload.after, current) &&
          isDeepStrictEqual(comparison(current), comparison(body.inventory, changes(body.inventory))), "COMMIT-READBACK-DRIFT");
        outcome = "legacy-sql-privileges-fenced-not-P13";
      }
    }
    await live(); await client.query("rollback"); transaction = false; await live();
    return { outcome, ...(outcome === "not-applied" ? {} : { intentDigest }) };
  } catch {
    return { outcome: "unknown" };
  } finally {
    if (transaction) { try { await client.query("rollback"); } catch { lost = true; } }
    client.removeListener("error", onLoss); client.removeListener("end", onLoss);
  }
}
