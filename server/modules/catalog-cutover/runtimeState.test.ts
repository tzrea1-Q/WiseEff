import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../scripts/upgrade-test-target";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog/database";
import { createDatabase, createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogReleaseDigest } from "../parameter-catalog-contract/index";
import { createStartupRuntimePin } from "../release-verification/report/index";
import { reportPins } from "../release-verification/report/fixtures";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../parameter-bindings/cutoverImport/sourceBoundary";
import { observeCutoverRuntimeState } from "./runtimeState";

// Only the parent's explicitly owned component cluster is acceptable. This file
// has no ambient isTestDatabaseAvailable probe, fallback database or skip mode.
let database: ParameterCatalogDatabase | undefined;
let source: pg.Pool | undefined;
let reports: pg.Pool | undefined;
let target: BindingDatabaseIdentity;
let migrations: { name: string; checksum: string }[];
const login = `runtime_reports_${randomUUID().replaceAll("-", "")}`;
let roleCreated = false;
const input = () => ({ target, runId: "no-cutover-run", expectedMigrations: migrations });

beforeAll(async () => {
  assertOwnedUpgradeTestTarget();
  const directory = path.resolve("server/migrations");
  const names = (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  migrations = await Promise.all(names.map(async name => ({ name, checksum: createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex") })));
  database = await createCheckedEmptyDatabase("runtimeobserve");
  const db = createPostgresDatabase(database.url);
  try { await applyMigrations(db, directory); } finally { await db.close(); }
  source = new pg.Pool({ connectionString: database.url, max: 2 });
  const client = await source.connect();
  try { target = await readBindingDatabaseIdentity(client); } finally { client.release(); }
  const password = randomBytes(24).toString("hex");
  await source.query(`create role ${pg.escapeIdentifier(login)} login password ${pg.escapeLiteral(password)} nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit`);
  roleCreated = true;
  await source.query(`grant catalog_verifier_role to ${pg.escapeIdentifier(login)}`);
  const url = new URL(database.url); url.username = login; url.password = password;
  reports = new pg.Pool({ connectionString: url.toString(), max: 1 });
}, 120000);

afterAll(async () => {
  await reports?.end();
  if (source && roleCreated) await source.query(`drop role ${pg.escapeIdentifier(login)}`);
  await source?.end(); await database?.close();
});

it("observes newly created canonical schema without treating it as installed or runtime approved", async () => {
  const observed = await observeCutoverRuntimeState(source!, input());
  expect(observed.catalog).toBeNull();
  expect(observed.run).toBeNull();
  expect(observed.approvalState).toBe("not-produced");
  expect(observed.database).toEqual(target);
  expect(observed.migrations).toEqual(migrations);
});

it("reads a real installed Kernel projection and the full independent ledger on one management snapshot", async () => {
  const full = validCatalogReleaseBundle(); const release = full.releases[0].manifest.release;
  const bundle = { ...full, targetReleaseId: release.id, releases: [full.releases[0]] };
  const installed = await installPublishedRelease(source!, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: CatalogReleaseDigest(release.digest) });
  expect(installed.ok).toBe(true);
  const first = await observeCutoverRuntimeState(source!, input());
  const second = await observeCutoverRuntimeState(source!, input());
  expect(first).toEqual(second);
  expect(first.catalog).toMatchObject({ releaseId: release.id, releaseDigest: release.digest });
  expect(first.catalog?.compiledFingerprint).toBe(first.catalog?.databaseFingerprint);
  expect(first.approvalState).toBe("not-produced");
});

it("rejects wrong target and packaged ledger drift without changing the real ledger", async () => {
  await expect(observeCutoverRuntimeState(source!, { ...input(), target: { ...target, databaseOid: "0" } })).rejects.toThrow("target-mismatch");
  await expect(observeCutoverRuntimeState(source!, { ...input(), expectedMigrations: migrations.slice(1) })).rejects.toThrow("migration-inventory-mismatch");
  await expect(observeCutoverRuntimeState(source!, { ...input(), expectedMigrations: migrations.map((row,index) => index ? row : { ...row, checksum: "0".repeat(64) }) })).rejects.toThrow("migration-inventory-mismatch");
  expect((await observeCutoverRuntimeState(source!, input())).migrations).toEqual(migrations);
});

it("uses a real NOINHERIT verifier login for report reads while refusing report writes and management role assumption", async () => {
  const client = await reports!.connect();
  try {
    const role = (await client.query("select session_user,current_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=session_user")).rows[0];
    expect(role).toMatchObject({ session_user: login, current_user: login, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    await client.query("begin isolation level read committed read only");
    await client.query("set local role catalog_verifier_role");
    const reader = createStartupRuntimePin({ db: createDatabase(client) });
    expect(await reader.readApprovedRuntimePin({ p13State: "retired", writerRetirementFingerprint: "synthetic-lookup-only", runtimePinGeneration: "synthetic-lookup-only", pins: reportPins(), subject: { targetId: "lookup", deploymentClass: "self-hosted", environmentId: "isolated" } })).toEqual({ kind: "absent", reason: "missing" });
    await client.query("rollback");
    await client.query("set role catalog_verifier_role");
    // Run outside READ ONLY so SQLSTATE 42501 proves the role ACL, not 25006.
    for (const sql of ["delete from parameter_catalog.verification_reports where false",
      "update parameter_catalog.verification_reports set id=id where false",
      "insert into parameter_catalog.verification_reports select * from parameter_catalog.verification_reports where false"]) {
      await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
    }
    for (const roleName of ["catalog_verification_writer_role", "catalog_migration_owner", "catalog_synchronizer_role", "parameter_governance_writer_role"]) {
      await expect(client.query(`set role ${roleName}`)).rejects.toMatchObject({ code: "42501" });
    }
  } finally { await client.query("rollback"); await client.query("reset role"); client.release(); }
});

it("does not borrow the report reader's connection for management inventory reads", async () => {
  await expect(observeCutoverRuntimeState(reports!, input())).rejects.toThrow("query-failed");
});

it("destroys the actual management session after an unknown rollback response without retrying rollback", async () => {
  const client = await source!.connect(); let destroyed = false; let rollbacks = 0;
  const wrapped = new Proxy(client, { get(owner, key) {
    if (key === "query") return async (...args: unknown[]) => {
      const value = await (owner.query as (...args: unknown[]) => Promise<unknown>).apply(owner, args);
      if (args[0] === "rollback") { rollbacks += 1; throw new Error("synthetic rollback reply loss"); }
      return value;
    };
    if (key === "release") return (destroy?: boolean) => { destroyed = destroy === true; owner.release(destroy); };
    return Reflect.get(owner, key);
  } });
  const pool = new Proxy(source!, { get(owner, key) { return key === "connect" ? async () => wrapped : Reflect.get(owner, key); } });
  await expect(observeCutoverRuntimeState(pool, input())).rejects.toThrow("transaction-close-unknown");
  expect(destroyed).toBe(true); expect(rollbacks).toBe(1);
});
