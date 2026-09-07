import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../testing/upgradeComponents";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../parameter-bindings/cutoverImport/sourceBoundary";
import { captureManagementStructureDigest } from "./managementStructure";

// Run only through the parent's owned-target vitest.upgrade-cutover.config.ts.
// These metadata counterexamples supplement the actual 823 -> candidate managed
// migration/committed journal/P4 integration in sourceSnapshot.test.ts.
describe("actual management structure continuity", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let target: BindingDatabaseIdentity;
  const ddl = `create schema parameter_catalog;
    create table parameter_catalog.parent(id bigint generated always as identity primary key,value text default 'structural default');
    create table parameter_catalog.child(id bigint primary key,parent_id bigint references parameter_catalog.parent(id));
    create index child_parent on parameter_catalog.child(parent_id);
    create function parameter_catalog.read_marker() returns integer language sql as 'select 1';
    create type parameter_catalog.lifecycle as enum ('draft','active');`;
  async function digest(connection: pg.Pool = pool): Promise<string> {
    const client = await connection.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const identity = await readBindingDatabaseIdentity(client);
      return await captureManagementStructureDigest({ client, target: identity });
    } finally { await client.query("rollback"); client.release(); }
  }
  beforeAll(async () => {
    database = await createCheckedEmptyDatabase("managedshape");
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    const client = await pool.connect();
    try { target = await readBindingDatabaseIdentity(client); await client.query(ddl); }
    finally { client.release(); }
  });
  afterAll(async () => { await pool?.end(); await database?.close(); });

  it("has the same digest after equivalent DDL with different relation, constraint, trigger and database OIDs", async () => {
    const other = await createCheckedEmptyDatabase("managedshape2");
    const second = new pg.Pool({ connectionString: other.url });
    try {
      await second.query(ddl);
      const firstOid = (await pool.query("select 'parameter_catalog.parent'::regclass::oid::text as oid")).rows[0].oid;
      const secondOid = (await second.query("select 'parameter_catalog.parent'::regclass::oid::text as oid")).rows[0].oid;
      expect(firstOid).not.toBe(secondOid);
      expect(await digest(second)).toBe(await digest());
    } finally { await second.end(); await other.close(); }
  });

  it("does not read application rows or sequence current values into the structural receipt", async () => {
    const before = await digest();
    await pool.query("insert into parameter_catalog.parent(value) values('private synthetic business value')");
    expect(await digest()).toBe(before);
    await pool.query("delete from parameter_catalog.parent");
    expect(await digest()).toBe(before);
  });

  it.each([
    ["column definition", "alter table parameter_catalog.parent alter column value set default 'changed structural default'"],
    ["constraint", "alter table parameter_catalog.child drop constraint child_parent_id_fkey"],
    ["index", "drop index parameter_catalog.child_parent"],
    ["RLS", "alter table parameter_catalog.parent enable row level security"],
    ["forced RLS", "alter table parameter_catalog.parent force row level security"],
    ["internal trigger enforcement", "alter table parameter_catalog.child disable trigger all"],
    ["owner", "alter table parameter_catalog.child owner to pg_monitor"],
    ["function definer", "alter function parameter_catalog.read_marker() security definer"],
    ["function search path", "alter function parameter_catalog.read_marker() set search_path=public"],
    ["function EXECUTE", "revoke execute on function parameter_catalog.read_marker() from public"],
    ["table grant", "grant select on parameter_catalog.child to public"],
    ["column grant", "grant select(parent_id) on parameter_catalog.child to public"],
    ["default grant", "alter default privileges in schema parameter_catalog grant select on tables to public"],
    ["enum", "alter type parameter_catalog.lifecycle add value 'unapproved'"],
    ["role membership", "grant pg_monitor to current_user"],
    ["role attribute", "alter role current_user nocreatedb"],
    ["parameter SET privilege", "grant set on parameter session_replication_role to pg_monitor"],
    ["builtin function privilege", "grant execute on function pg_catalog.pg_read_file(text) to pg_monitor"],
  ])("invalidates the receipt after %s drift", async (_kind, sql) => {
    const before = await digest();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      expect(await captureManagementStructureDigest({ client, target })).not.toBe(before);
    } finally { await client.query("rollback"); client.release(); }
    expect(await digest()).toBe(before);
  });

  it("distinguishes default function ACL from an explicit empty ACL", async () => {
    const before = await digest();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("revoke all on function parameter_catalog.read_marker() from public,current_user");
      const actual = (await client.query("select proacl::text as acl from pg_catalog.pg_proc where oid='parameter_catalog.read_marker()'::regprocedure")).rows[0];
      expect(actual.acl).toBe("{}");
      expect(await captureManagementStructureDigest({ client, target })).not.toBe(before);
    } finally { await client.query("rollback"); client.release(); }
  });

  it("detects privileged role settings even when a settings row already exists", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("alter role current_user set work_mem='4MB'");
      const before = await captureManagementStructureDigest({ client, target });
      await client.query("alter role current_user set session_replication_role=replica");
      expect(await captureManagementStructureDigest({ client, target })).not.toBe(before);
    } finally { await client.query("rollback"); client.release(); }
  });

  it("refuses another actual target before collecting its structure", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await expect(captureManagementStructureDigest({ client, target: { ...target, databaseOid: "0" } }))
        .rejects.toThrow("management-structure-unavailable");
    } finally { await client.query("rollback"); client.release(); }
  });
});
