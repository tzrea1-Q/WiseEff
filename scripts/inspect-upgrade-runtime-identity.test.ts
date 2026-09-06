import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectRuntimeIdentity, runIdentityInspector } from "./inspect-upgrade-runtime-identity";
import { createIsolatedUpgradeDocker } from "./isolated-upgrade-docker";

describe("runtime identity CLI input", () => {
  it("rejects missing connection and unknown flags before connecting", async () => {
    expect((await runIdentityInspector([], {})).exitCode).toBe(2);
    expect((await runIdentityInspector(["--apply"], { DATABASE_URL: "secret" })).exitCode).toBe(2);
  });
  it("sanitizes driver failures", async () => {
    const result = await runIdentityInspector([], { DATABASE_URL: "invalid secret connection" });
    expect(result).toEqual({ exitCode: 1, output: { status: "blocked", reason: "runtime-identity-query-failure" } });
  });
});

// Explicit opt-in starts its own disposable cluster. Never consumes DATABASE_URL,
// the shared Catalog lane, a production target, or an externally supplied cluster.
describe.skipIf(process.env.UPG_IDENTITY_DOCKER_TEST !== "1")("real isolated PostgreSQL login inventory", () => {
  const container = `wiseeff-upg-identity-${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  let admin: pg.Client | undefined;
  let port = "";
  let id = "";
  let transport: ReturnType<typeof createIsolatedUpgradeDocker>;
  const url = (role: string) => `postgres://${role}:${password}@127.0.0.1:${port}/postgres`;
  function docker(args: string[]) {
    return transport.command(args).toString().trim();
  }
  beforeAll(async () => {
    transport = createIsolatedUpgradeDocker();
    id = docker(["run", "-d", "--name", container, "--label", `wiseeff.test=${container}`,
      "-e", `POSTGRES_PASSWORD=${password}`, "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
    transport.assertOwned(id, "wiseeff.test", container);
    port = docker(["inspect", "--format", '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', id]);
    for (let attempt = 0; attempt < 30; attempt++) {
      const probe = new pg.Client({ connectionString: url("postgres") });
      try { await probe.connect(); admin = probe; break; }
      catch { await probe.end().catch(() => undefined); await setTimeout(200); }
    }
    if (!admin) throw new Error("isolated PostgreSQL startup failed");
    await admin.query(`
      create role restricted login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role inherited login password '${password}' nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      create role bridge nologin noinherit;
      create role dangerous nologin createdb;
      grant dangerous to bridge;
      grant bridge to inherited with inherit false;
      create schema business;
      create table business.items(id integer);
      insert into business.items values (1);
      grant usage on schema business to restricted;
      grant select on business.items to restricted;
    `);
  }, 30000);
  afterAll(async () => {
    await admin?.end();
    if (id) { transport.assertOwned(id, "wiseeff.test", container); docker(["rm", "-f", "-v", id]); }
  });
  it("uses a real restricted login with successful business SELECT and denied write/SET ROLE", async () => {
    const login = new pg.Client({ connectionString: url("restricted") });
    await login.connect();
    try {
      expect((await login.query("select * from business.items")).rows).toEqual([{ id: 1 }]);
      await expect(login.query("insert into business.items values (2)")).rejects.toMatchObject({ code: "42501" });
      await expect(login.query("set role dangerous")).rejects.toMatchObject({ code: "42501" });
    } finally { await login.end(); }
    const result = await inspectRuntimeIdentity(url("restricted"));
    expect(result.status).toBe("inventory-collected");
    expect(result.capabilityAuditComplete).toBe(false);
    expect(result.releaseApproved).toBe(false);
  });
  it("detects recursive NOINHERIT/SET privilege paths", async () => {
    const result = await inspectRuntimeIdentity(url("inherited"));
    expect(result.inventory.reachable_roles).toBe(3);
    expect(result.reasons).toContain("privileged-role-reachable");
  });
  it("rejects the actual superuser and returns a real nonzero CLI exit", async () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", path.resolve("scripts/inspect-upgrade-runtime-identity.ts")], {
      env: { ...process.env, DATABASE_URL: url("postgres") }, encoding: "utf8", timeout: 20000,
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).reasons).toContain("privileged-role-reachable");
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout).not.toContain(url("postgres"));
  });
  it("inventories owned objects and executable DEFINER without exposing names or function bodies", async () => {
    await admin!.query(`
      create table business.private_customer_name(id integer);
      alter table business.private_customer_name owner to restricted;
      create function business.private_customer_function() returns integer language sql security definer as 'select 1';
      grant execute on function business.private_customer_function() to restricted;
    `);
    const result = await inspectRuntimeIdentity(url("restricted"));
    expect(result.reasons).toContain("application-object-ownership");
    expect(result.reasons).toContain("security-definer-review-required");
    expect(result.inventory.definers_requiring_search_path_review).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("private_customer");
  });
  it("detects Catalog DML and PUBLIC default ACL requiring capability review", async () => {
    await admin!.query(`
      create schema parameter_catalog;
      create table parameter_catalog.example(id integer);
      grant usage on schema parameter_catalog to restricted;
      grant insert on parameter_catalog.example to restricted;
      alter default privileges in schema business grant select on tables to public;
    `);
    const result = await inspectRuntimeIdentity(url("restricted"));
    expect(result.reasons).toContain("catalog-write-capability-review-required");
    expect(result.reasons).toContain("public-default-acl-review-required");
  });
});
