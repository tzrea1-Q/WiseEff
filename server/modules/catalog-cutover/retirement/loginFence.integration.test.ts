import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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
  let docker: ReturnType<typeof createIsolatedUpgradeDocker>, network: string, first: string, second: string, app: string, hostnameApp: string;
  let firstUrl: string, secondUrl: string, originalUrl: string, ownerRunId: string, imageId: string, secondSystem: string;
  let registeredIds: string[];
  const label = "wiseeff.controlled-recovery-run";
  const originalQuery = (probe: string) => {
    const privateUrl = new URL(originalUrl), password = decodeURIComponent(privateUrl.password);
    privateUrl.password = "";
    return docker.command(["exec", "-i", probe, "sh", "-c",
      'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql "$1" -Atc "$2"', "--", privateUrl.href,
      "select system_identifier from pg_control_system()"], Buffer.from(password + "\n")).toString().trim();
  };
  beforeAll(async () => {
    // The outer fixture validates the same parent-issued private receipt.
    // The supervisor, not this child, creates and cleans the endpoint topology.
    const receipt = JSON.parse(readFileSync(process.env.UPG_TEST_TARGET_RECEIPT!, "utf8"));
    const endpoints = receipt.retirementEndpoints;
    if (!endpoints || endpoints.label !== label || !/^[a-f0-9]{24}$/.test(endpoints.ownerRunId) ||
        !/^sha256:[a-f0-9]{64}$/.test(endpoints.imageId) ||
        ![endpoints.networkId, endpoints.firstId, endpoints.secondId, endpoints.probeId, endpoints.hostnameProbeId]
          .every(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))) throw new Error("owned-retirement-endpoints-required");
    ({ ownerRunId, imageId, networkId: network, firstId: first, secondId: second, probeId: app,
      hostnameProbeId: hostnameApp, firstUrl, secondUrl } = endpoints);
    registeredIds = [first, second, app, hostnameApp];
    if (new Set(registeredIds).size !== 4) throw new Error("owned-retirement-endpoint-alias");
    docker = createIsolatedUpgradeDocker();
    expect(docker.daemonId).toBe(receipt.daemonId);
    for (const id of registeredIds) expect(docker.assertOwned(id, label, ownerRunId).Image).toBe(imageId);
    const networkInfo = JSON.parse(docker.command(["network", "inspect", network]).toString())[0];
    expect(networkInfo.Id).toBe(network); expect(networkInfo.Labels[label]).toBe(ownerRunId);
    for (const [id, url] of [[first, firstUrl], [second, secondUrl]]) {
      const parsed = new URL(url), info = docker.assertOwned(id, label, ownerRunId);
      if (parsed.hostname !== "127.0.0.1" || parsed.port !== info.NetworkSettings.Ports["5432/tcp"][0].HostPort)
        throw new Error("owned-retirement-private-endpoint-mismatch");
    }
    const original = new URL(firstUrl); original.hostname = "postgres"; original.port = "5432"; originalUrl = original.href;
    const originalSystem = originalQuery(app);
    const identities: string[] = [];
    for (const url of [firstUrl, secondUrl]) {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1000 });
      try { await client.connect(); identities.push((await client.query("select system_identifier::text as id from pg_control_system()")).rows[0].id); }
      finally { await client.end(); }
    }
    expect(identities[0]).toBe(originalSystem);
    expect(identities[1]).not.toBe(originalSystem); secondSystem = identities[1];
    docker.command(["stop", "--time", "1", app, hostnameApp]);
    console.info("RETIREMENT_ENDPOINT_COMPONENT", JSON.stringify({ ownerRunId, networkId: network, imageId,
      postgresIds: [first, second], probeIds: [app, hostnameApp], scope: "database-probe-not-api-worker", resourceOwner: "parent-supervisor" }));
  });
  const observe = (sourceUrl = originalUrl, administrativeUrl = firstUrl, applicationId = app) =>
    observeLegacySourceEndpoint({ docker, sourceUrl, administrativeUrl, applicationId, postgresId: first,
      registeredIds, ownerRunId });
  it("accepts only the actual original alias and the same container's published port", () => {
    expect(observe()).toMatchObject({ postgresId: first, sourceHost: "postgres" });
  });
  it("rejects a same-username URL for the other real owned database before connecting", () => {
    const other = new URL(originalUrl); other.hostname = "other";
    expect(() => observe(other.href)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
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
  it("rejects the stopped source after its real hosts file redirected the original URL to the second database", () => {
    docker.command(["start", app]);
    const originalHosts = docker.command(["exec", app, "cat", "/etc/hosts"]);
    try {
      const other = docker.assertOwned(second, label, ownerRunId);
      const address = (Object.values(other.NetworkSettings.Networks)[0] as { IPAddress: string }).IPAddress;
      docker.command(["exec", app, "sh", "-c", 'printf "%s postgres\\n" "$1" >> /etc/hosts', "--", address]);
      expect(originalQuery(app)).toBe(secondSystem);
      const info = docker.assertOwned(app, label, ownerRunId);
      expect(info.HostConfig.ExtraHosts ?? []).toHaveLength(0);
      expect(info.Mounts.some((mount: { Destination: string }) => mount.Destination === "/etc/hosts")).toBe(false);
      docker.command(["stop", "--time", "1", app]);
      expect(() => observe()).toThrow("SOURCE-ENDPOINT-UNPROVEN");
    } finally {
      docker.command(["start", app]);
      docker.command(["exec", "-i", app, "sh", "-c", "cat > /etc/hosts"], originalHosts);
      docker.command(["stop", "--time", "1", app]);
    }
  });
  it("rejects Docker's own hosts entry for a source hostname matching the database alias", () => {
    docker.command(["start", hostnameApp]);
    try { expect(() => originalQuery(hostnameApp)).toThrow("isolated-docker-operation-failed"); }
    finally { docker.command(["stop", "--time", "1", hostnameApp]); }
    expect(() => observe(undefined, undefined, hostnameApp)).toThrow("SOURCE-ENDPOINT-UNPROVEN");
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
