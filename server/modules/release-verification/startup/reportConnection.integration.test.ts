import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createVerificationReportService } from "../report/index";
import { openStartupReportDatabase } from "./reportConnection";

// Mandatory owned-cluster receipt is checked before connecting. This test does
// not probe ambient DATABASE_URL or turn an unavailable cluster into a skip.
let target: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let admin: RootDatabase;
const name = `report_login_${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("hex");
const role = pg.escapeIdentifier(name);
let url: string;
beforeAll(async () => {
  target = await createSelfHostedPg16Database("reportlogin");
  admin = createPostgresDatabase(target.url);
  await applyMigrations(admin, path.resolve("server/migrations"));
  await admin.query(`create role ${role} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}'`);
  await admin.query(`grant catalog_verifier_role to ${role} with inherit true, set false, admin false`);
  const parsed = new URL(target.url); parsed.username = name; parsed.password = password; url = parsed.href;
}, 60_000);
afterAll(async () => {
  await admin?.close(); await target?.close();
  // The nonce LOGIN belongs to this disposable cluster, destroyed by its owner.
  // Do not run a broad role cleanup on another cluster.
});

it("opens a real restricted LOGIN for the formal report projection without startup recursion", async () => {
  const db = await openStartupReportDatabase({ connectionString: url });
  try {
    expect((await db.query("select session_user as login,current_user as effective")).rows).toEqual([{ login: name, effective: name }]);
    expect(await createVerificationReportService({ db }).readReport("synthetic-absent-report"))
      .toEqual({ kind: "absent", reason: "missing" });
    const membership = await admin.query(`select inherit_option,set_option,admin_option from pg_auth_members
      where member=$1::regrole and roleid='catalog_verifier_role'::regrole`, [name]);
    expect(membership.rows).toEqual([{ inherit_option: true, set_option: false, admin_option: false }]);
    for (const statement of [
      "delete from parameter_catalog.verification_reports where false",
      "create table parameter_catalog.report_login_forbidden(id int)",
      "set role catalog_verifier_role", "set role catalog_verification_writer_role",
      "select * from parameter_catalog.catalog_state",
    ]) await expect(db.query(statement)).rejects.toMatchObject({ code: "42501" });
  } finally { await db.close(); }
});

it("keeps ordinary PUBLIC reads without converting them to report or startup authority", async () => {
  await admin.query("create table public.report_public_read_probe(id int); grant select on public.report_public_read_probe to public");
  try {
    const db = await openStartupReportDatabase({ connectionString: url });
    await db.close();
  } finally { await admin.query("drop table public.report_public_read_probe"); }
});

it.each(["superuser", "bypassrls", "createdb", "createrole", "replication"])("refuses actual %s privilege", async attribute => {
  await admin.query(`alter role ${role} ${attribute}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`alter role ${role} no${attribute}`); }
});

it.each(["catalog_migration_owner", "catalog_synchronizer_role", "catalog_verification_writer_role", "parameter_governance_writer_role", "catalog_runtime_reader_role"])("refuses a mixed %s capability", async extra => {
  await admin.query(`grant ${pg.escapeIdentifier(extra)} to ${role} with inherit false, set false, admin false`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`revoke ${pg.escapeIdentifier(extra)} from ${role}`); }
});

it.each(["set true", "admin true", "inherit false"])("refuses incorrect PG16 membership option %s", async option => {
  await admin.query(`grant catalog_verifier_role to ${role} with ${option}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-ROLE-REJECTED" }); }
  finally { await admin.query(`grant catalog_verifier_role to ${role} with inherit true, set false, admin false`); }
});

it("refuses owned application objects", async () => {
  await admin.query(`create table public.report_owner_probe(id int); alter table public.report_owner_probe owner to ${role}`);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-OBJECT-OWNER" }); }
  finally { await admin.query("drop table public.report_owner_probe"); }
});

it.each([
  ["direct application SELECT", `grant select on public.organizations to ${role}`, `revoke select on public.organizations from ${role}`],
  ["PUBLIC application write", "grant update on public.organizations to public", "revoke update on public.organizations from public"],
  ["column-only application write", `grant update(name) on public.organizations to ${role}`, `revoke update(name) on public.organizations from ${role}`],
  ["report grant option", `grant select on parameter_catalog.verification_reports to ${role} with grant option`, `revoke select on parameter_catalog.verification_reports from ${role}`],
  ["system function EXECUTE", `grant execute on function pg_catalog.pg_read_file(text) to ${role}`, `revoke execute on function pg_catalog.pg_read_file(text) from ${role}`],
  ["PUBLIC privileged parameter", "grant set on parameter session_replication_role to public", "revoke set on parameter session_replication_role from public"],
])("refuses %s outside its read contract", async (_name, setup, cleanup) => {
  await admin.query(setup);
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" }); }
  finally { await admin.query(cleanup); }
});

it("refuses a PUBLIC definer that delegates owner write capability", async () => {
  await admin.query("create function public.report_write_proxy() returns void language sql security definer set search_path=pg_catalog as 'delete from public.organizations where false'");
  try { await expect(openStartupReportDatabase({ connectionString: url })).rejects.toMatchObject({ code: "PCAT-REPORT-LOGIN-CAPABILITY-REJECTED" }); }
  finally { await admin.query("drop function public.report_write_proxy()"); }
});
