import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { readBindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { applyLegacyLoginFence, retiringRolesSql } from "./loginFence";
import type { RetiringRole } from "./roleRecovery";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { observeLegacySourceEndpoint } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterSource";

// Database-effect evidence only. No fake P12 checkpoint/report, mocked verifier,
// or claim that these focused cases execute the full self-hosted adapter.
let fixture: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let foreignFixture: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let pool: pg.Pool;
let foreignDb: pg.Client;
beforeAll(async () => {
  fixture = await createSelfHostedPg16Database("retirement");
  pool = new pg.Pool({ connectionString: fixture.url, max: 3 });
  // Database preparation belongs to setup, not the bounded role-effect test.
  foreignFixture = await createSelfHostedPg16Database("fenceforeign");
  foreignDb = new pg.Client({ connectionString: foreignFixture.url }); await foreignDb.connect();
});
afterAll(async () => { await foreignDb?.end(); await foreignFixture?.close(); await pool?.end(); await fixture?.close(); });

describe("owned Docker source endpoint observation, not an old API/worker startup", () => {
  const ownerRunId = randomBytes(12).toString("hex"), label = "wiseeff.controlled-recovery-run";
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>, network: string, first: string, second: string, app: string;
  let firstUrl: string, secondUrl: string;
  const created: string[] = [];
  let imageId: string;
  beforeAll(async () => {
    // The outer fixture has already verified the mandatory owned PG receipt.
    // All additional resources here are newly created and carry this nonce.
    docker = createIsolatedUpgradeDocker();
    imageId = JSON.parse(docker.command(["image", "inspect", "postgres:16-alpine"]).toString())[0].Id;
    network = docker.command(["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
      "--label", `${label}=${ownerRunId}`, `retirement-endpoint-${ownerRunId}`]).toString().trim();
    const create = (alias: string, database: boolean) => {
      const args = ["create", "--network", network, "--network-alias", alias, "--label", `${label}=${ownerRunId}`];
      if (database) args.push("--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=268435456", "--env", "POSTGRES_HOST_AUTH_METHOD=trust");
      else args.push("--entrypoint", "sleep");
      args.push(imageId);
      if (!database) args.push("300");
      const id = docker.command(args).toString().trim(); created.push(id);
      docker.command(["start", id]); return id;
    };
    first = create("postgres", true); second = create("other", true); app = create("api", false);
    const endpoint = (id: string) => {
      const info = docker.assertOwned(id, label, ownerRunId);
      return `postgres://postgres@127.0.0.1:${info.NetworkSettings.Ports["5432/tcp"][0].HostPort}/postgres`;
    };
    firstUrl = endpoint(first); secondUrl = endpoint(second);
    for (const id of created) expect(docker.assertOwned(id, label, ownerRunId).Image).toBe(imageId);
    for (const url of [firstUrl, secondUrl]) {
      let ready = false;
      for (let attempt = 0; attempt < 40 && !ready; attempt++) {
        const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
        try { await client.connect(); await client.query("select 1"); ready = true; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        finally { await client.end(); }
      }
      if (!ready) throw new Error("owned-endpoint-postgres-not-ready");
    }
    // Use the ORIGINAL URL inside the actual shared network, then independently
    // read the system identity through Docker's published port before stopping
    // this psql-only probe. It is not an old application image or authz proof.
    const original = docker.command(["exec", app, "psql", "postgres://postgres@postgres/postgres", "-Atc", "select system_identifier from pg_control_system()"]).toString().trim();
    const client = new pg.Client({ connectionString: firstUrl });
    try { await client.connect(); expect((await client.query("select system_identifier::text as id from pg_control_system()")).rows[0].id).toBe(original); }
    finally { await client.end(); }
    docker.command(["stop", "--time", "1", app]);
    console.info("RETIREMENT_ENDPOINT_COMPONENT", JSON.stringify({ ownerRunId, networkId: network, imageId,
      postgresIds: [first, second], probeId: app, scope: "database-probe-not-api-worker" }));
  }, 30_000);
  afterAll(() => {
    for (const id of [...created].reverse()) { docker.assertOwned(id, label, ownerRunId); docker.command(["rm", "-f", id]); }
    if (network) {
      const info = JSON.parse(docker.command(["network", "inspect", network]).toString())[0];
      expect(info.Id).toBe(network); expect(info.Labels[label]).toBe(ownerRunId);
      docker.command(["network", "rm", network]);
    }
    expect(docker.command(["ps", "-a", "-q", "--filter", `label=${label}=${ownerRunId}`]).toString().trim()).toBe("");
    expect(docker.command(["network", "ls", "-q", "--filter", `label=${label}=${ownerRunId}`]).toString().trim()).toBe("");
    console.info("RETIREMENT_ENDPOINT_CLEANUP", JSON.stringify({ ownerRunId, cleanupVerified: true }));
  });
  const observe = (sourceUrl = "postgres://postgres@postgres/postgres", administrativeUrl = firstUrl) =>
    observeLegacySourceEndpoint({ docker, sourceUrl, administrativeUrl, applicationId: app, postgresId: first,
      registeredIds: [app, first, second], ownerRunId });
  it("accepts only the actual original alias and the same container's published port", () => {
    expect(observe()).toMatchObject({ postgresId: first, sourceHost: "postgres" });
  });
  it("rejects a same-username URL for the other real owned database before connecting", () => {
    expect(() => observe("postgres://postgres@other/postgres")).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    expect(() => observe(undefined, secondUrl)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
  });
  it("rejects an actual duplicate network alias", () => {
    docker.command(["network", "disconnect", network, second]);
    try {
      docker.command(["network", "connect", "--alias", "postgres", network, second]);
      expect(() => observe()).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    } finally {
      docker.command(["network", "disconnect", network, second]);
      docker.command(["network", "connect", "--alias", "other", network, second]);
    }
  });
});

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

it("refuses a shared advisory lock without changing LOGIN, membership, owner or ACL", async () => {
  const state = await prepare();
  const readTable = () => state.admin.query("select relowner::text,relacl from pg_catalog.pg_class where oid=$1::regclass", [`public.${state.table}`]);
  try {
    const beforeTable = (await readTable()).rows;
    await state.begin(false);
    await state.admin.query("select pg_advisory_xact_lock_shared(hashtext('s7-orc-cutover-target'),hashtext(current_database()))");
    await expect(applyLegacyLoginFence(state.input)).rejects.toThrow("legacy-login-fence-management-lock-required");
    // Observe inside the transaction: rollback must not hide an earlier effect.
    expect((await state.admin.query<RetiringRole>(retiringRolesSql, [[state.name]])).rows).toEqual(state.input.expectedRoles);
    expect((await readTable()).rows).toEqual(beforeTable);
  } finally { await state.admin.query("rollback"); state.admin.release(); }
});

it.each(["wrong-target", "unlocked", "active-session", "member-session", "transitive-member-session", "changed-role", "missing-recovery", "foreign-database"])("refuses %s before changing LOGIN", async fault => {
  const state = await prepare(); let live: pg.Client | undefined;
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
      await foreignDb.query(`create table public.foreign_owned(value text); alter table public.foreign_owned owner to ${pg.escapeIdentifier(state.name)}`);
    }
    await state.begin(fault !== "unlocked");
    await expect(applyLegacyLoginFence(state.input)).rejects.toThrow(/^legacy-login-fence-/);
    await state.admin.query("rollback");
    expect((await state.admin.query("select rolcanlogin as login from pg_roles where rolname=$1", [state.name])).rows[0].login).toBe(true);
  } finally {
    await state.admin.query("rollback"); state.admin.release();
    await live?.end();
  }
});
