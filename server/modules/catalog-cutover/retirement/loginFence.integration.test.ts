import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { readBindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { applyLegacyLoginFence, retiringRolesSql } from "./loginFence";
import type { RetiringRole } from "./roleRecovery";

// Database-effect evidence only. No fake P12 checkpoint/report, mocked verifier,
// or claim that these focused cases execute the full self-hosted adapter.
let fixture: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let pool: pg.Pool;
beforeAll(async () => {
  fixture = await createSelfHostedPg16Database("retirement");
  pool = new pg.Pool({ connectionString: fixture.url, max: 3 });
});
afterAll(async () => { await pool?.end(); await fixture?.close(); });

async function prepare() {
  const nonce = randomBytes(7).toString("hex"), password = randomBytes(24).toString("hex");
  const name = `old_${nonce}`, member = `job_${nonce}`, table = `fence_${nonce}`;
  const admin = await pool.connect();
  await admin.query(`create role ${pg.escapeIdentifier(name)} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication password '${password}';
    create role ${pg.escapeIdentifier(member)} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit noreplication password '${password}';
    grant ${pg.escapeIdentifier(name)} to ${pg.escapeIdentifier(member)} with inherit false,set true,admin false;
    create table public.${pg.escapeIdentifier(table)}(value text);
    alter table public.${pg.escapeIdentifier(table)} owner to ${pg.escapeIdentifier(name)};`);
  const connect = async (role = name) => {
    const url = new URL(fixture.url); url.username = role; url.password = password;
    const client = new pg.Client({ connectionString: url.href });
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => undefined); throw error; }
  };
  const old = await connect();
  await old.query(`insert into public.${pg.escapeIdentifier(table)} values('synthetic-before-fence')`);
  await old.end();
  const expectedRoles = (await admin.query<RetiringRole>(retiringRolesSql, [[name]])).rows;
  const recoveryRoles = [{ name, login: true, inherit: false, members: [{ name: member, inherit: false, set: true }] },
    { name: member, login: true, inherit: false, members: [] }];
  const target = await readBindingDatabaseIdentity(admin);
  const input = { client: admin, target, expectedRoles, recoveryRoles };
  const begin = async (lock = true) => {
    await admin.query("begin");
    if (lock) await admin.query("select pg_advisory_xact_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
  };
  return { admin, name, member, table, connect, input, begin };
}

it("disables the real old LOGIN and SET ROLE entry while retaining source owner, ACL and rows", async () => {
  const state = await prepare();
  try {
    await state.begin(); await applyLegacyLoginFence(state.input); await state.admin.query("commit");
    await expect(state.connect()).rejects.toMatchObject({ code: "28000" });
    const member = await state.connect(state.member);
    try { await expect(member.query(`set role ${pg.escapeIdentifier(state.name)}`)).rejects.toMatchObject({ code: "42501" }); }
    finally { await member.end(); }
    expect((await state.admin.query(`table public.${pg.escapeIdentifier(state.table)}`)).rows).toEqual([{ value: "synthetic-before-fence" }]);
    expect((await state.admin.query(`select pg_get_userbyid(relowner) as owner from pg_class where oid=$1::regclass`, [`public.${state.table}`])).rows[0].owner).toBe(state.name);
    expect((await state.admin.query(`select has_table_privilege($1,$2,'INSERT') as original_acl`, [state.name, `public.${state.table}`])).rows[0].original_acl).toBe(true);
    expect(state.input.recoveryRoles[0]).toMatchObject({ login: true, members: [{ name: state.member, inherit: false, set: true }] });
  } finally { await state.admin.query("rollback"); state.admin.release(); }
});

it.each(["wrong-target", "unlocked", "active-session", "member-session", "transitive-member-session", "changed-role", "missing-recovery", "foreign-database"])("refuses %s before changing LOGIN", async fault => {
  const state = await prepare(); let live: pg.Client | undefined;
  let other: Awaited<ReturnType<typeof createSelfHostedPg16Database>> | undefined;
  let otherDb: pg.Client | undefined;
  try {
    if (fault === "wrong-target") state.input.target = { ...state.input.target, systemIdentifier: "1" };
    if (fault === "active-session") live = await state.connect();
    if (fault === "transitive-member-session") {
      const middle = `mid_${randomBytes(7).toString("hex")}`;
      await state.admin.query(`create role ${pg.escapeIdentifier(middle)} nologin noinherit;
        revoke ${pg.escapeIdentifier(state.name)} from ${pg.escapeIdentifier(state.member)};
        grant ${pg.escapeIdentifier(state.name)} to ${pg.escapeIdentifier(middle)} with inherit false,set true,admin false;
        grant ${pg.escapeIdentifier(middle)} to ${pg.escapeIdentifier(state.member)} with inherit false,set true,admin false;`);
      state.input.expectedRoles = (await state.admin.query<RetiringRole>(retiringRolesSql, [[state.name]])).rows;
      state.input.recoveryRoles[0].members = [{ name: middle, inherit: false, set: true }];
      state.input.recoveryRoles.push({ name: middle, login: false, inherit: false, members: [{ name: state.member, inherit: false, set: true }] });
      live = await state.connect(state.member);
      await live.query(`set role ${pg.escapeIdentifier(state.name)}`);
      expect((await live.query("select session_user<>current_user as switched")).rows[0].switched).toBe(true);
    }
    if (fault === "member-session") {
      live = await state.connect(state.member);
      await live.query(`set role ${pg.escapeIdentifier(state.name)}`);
      expect((await live.query("select session_user<>current_user as switched")).rows[0].switched).toBe(true);
    }
    if (fault === "changed-role") state.input.expectedRoles[0].oid = "1";
    if (fault === "missing-recovery") state.input.recoveryRoles.length = 0;
    if (fault === "foreign-database") {
      other = await createSelfHostedPg16Database("fenceforeign");
      otherDb = new pg.Client({ connectionString: other.url }); await otherDb.connect();
      await otherDb.query(`create table public.foreign_owned(value text); alter table public.foreign_owned owner to ${pg.escapeIdentifier(state.name)}`);
    }
    await state.begin(fault !== "unlocked");
    await expect(applyLegacyLoginFence(state.input)).rejects.toThrow(/^legacy-login-fence-/);
    await state.admin.query("rollback");
    expect((await state.admin.query("select rolcanlogin as login from pg_roles where rolname=$1", [state.name])).rows[0].login).toBe(true);
  } finally {
    await state.admin.query("rollback"); state.admin.release();
    await live?.end(); await otherDb?.end(); await other?.close();
  }
});
