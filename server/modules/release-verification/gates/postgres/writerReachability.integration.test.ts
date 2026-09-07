import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMigratedSelfHostedPg16Database } from "../../../../testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../../shared/database/client";
import { createReleaseVerificationService } from "../../core/service";
import { VerificationGateId, type VerificationPlan } from "../../core/types";
import { validPrepare } from "../../report/fixtures";
import { createPostgresGateAdapters } from "./index";
import { LEGACY_STRUCTURAL_TABLES } from "../../../catalog-kernel/security/catalogRoleManifest";

// An owned cluster is necessary: PUBLIC and role membership are deliberately
// contaminated. These are actual gate/LOGIN probes, not P13 or passing reports.
const tables = [...LEGACY_STRUCTURAL_TABLES, "driver_schemas", "driver_schema_versions", "dts_property_specs"];
let target: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
let admin: RootDatabase, verifier: RootDatabase;
let plan: VerificationPlan;
const nonce = randomBytes(8).toString("hex"), secret = randomBytes(24).toString("hex");
const observerName = `v13_observer_${nonce}`;
const writerName = `v13_writer_${nonce}`;
const capabilityName = `v13_capability_${nonce}`;
let writer: pg.Client;

beforeAll(async () => {
  target = await createMigratedSelfHostedPg16Database("v13writer");
  admin = createPostgresDatabase(target.url);
  const prepared = await createReleaseVerificationService({ db: admin }).prepareVerification(validPrepare());
  if (!prepared.ok) throw new Error("v13-test-plan-unavailable");
  plan = prepared.value;
  await admin.query(`create role ${observerName} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${secret}';
    alter role ${observerName} set default_transaction_read_only=on;
    create role ${writerName} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit password '${secret}';
    create role ${capabilityName} nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;`);
  const loginUrl = (name: string) => { const url = new URL(target.url); url.username = name; url.password = secret; return url.href; };
  verifier = createPostgresDatabase(loginUrl(observerName));
  writer = new pg.Client({ connectionString: loginUrl(writerName) });
  writer.on("error", () => {});
  await writer.connect();
  await admin.query(`insert into public.parameter_specs(id,source_kind,specification_key) values ('v13-spec','dts','v13.driver');
    insert into public.driver_schemas(id,parameter_spec_id,schema_namespace) values ('v13-driver','v13-spec','before');`);
});
afterAll(async () => {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => writer?.end()), Promise.resolve().then(() => verifier?.close()),
    Promise.resolve().then(() => admin?.close()),
  ]);
  const removed = await Promise.allSettled([Promise.resolve().then(() => target?.close())]);
  if ([...results, ...removed].some(result => result.status === "rejected")) throw new Error("v13-test-cleanup-failed");
});
const runGate = () => createPostgresGateAdapters({ db: verifier }).get("PCAT-DB-V13")!({
  gateId: VerificationGateId("PCAT-DB-V13"), plan,
});
const expectBlocked = async () => expect(await runGate()).toMatchObject({
  status: "failed", failureCode: "PCAT-VRF-V13-LEGACY-WRITER-REACHABLE",
});

it("uses a genuinely read-only verification LOGIN and a separate restricted application LOGIN", async () => {
  for (const [query, name, readonly] of [[(sql: string) => verifier.query(sql), observerName, "on"], [(sql: string) => writer.query(sql), writerName, "off"]] as const) {
    expect((await query(`select session_user as name,current_user as effective,
      current_setting('transaction_read_only') as readonly,rolsuper or rolbypassrls or rolcreatedb or rolcreaterole as privileged
      from pg_catalog.pg_roles where rolname=session_user`)).rows).toEqual([{ name, effective: name, readonly, privileged: false }]);
  }
  expect(await runGate()).toMatchObject({ status: "passed" }); // Database submatrix only.
});

it("blocks the formal V13 gate after a real restricted LOGIN changes a legacy driver schema", async () => {
  await admin.query(`grant select(id),update(schema_namespace) on public.driver_schemas to ${writerName}`);
  try {
    const changed = await writer.query("update public.driver_schemas set schema_namespace='changed' where id='v13-driver'");
    expect(changed.rowCount).toBe(1);
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "changed" }]);
    await expectBlocked();
    // The verifier neither repairs the data nor removes the offending grant.
    expect((await admin.query("select schema_namespace from public.driver_schemas where id='v13-driver'")).rows)
      .toEqual([{ schema_namespace: "changed" }]);
  } finally { await admin.query(`revoke select(id),update(schema_namespace) on public.driver_schemas from ${writerName}`); }
});

it.each(tables)("detects PUBLIC column UPDATE on existing scoped table %s", async table => {
  const column = (await admin.query<{ attname: string }>(`select attname from pg_catalog.pg_attribute
    where attrelid=$1::regclass and attnum>0 and not attisdropped and attgenerated='' order by attnum limit 1`, [`public.${table}`])).rows[0].attname;
  const identifier = pg.escapeIdentifier(column), relation = `public.${pg.escapeIdentifier(table)}`;
  await admin.query(`grant update(${identifier}) on ${relation} to public`);
  try {
    expect((await writer.query(`update ${relation} set ${identifier}=null where false`)).rowCount).toBe(0);
    await expectBlocked();
  } finally { await admin.query(`revoke update(${identifier}) on ${relation} from public`); }
});

it.each(["direct", "inherited", "set-only"])("detects %s table mutation capability using actual LOGIN semantics", async mode => {
  const role = mode === "direct" ? writerName : capabilityName;
  await admin.query(`grant update on public.driver_schemas to ${role}`);
  if (mode !== "direct") await admin.query(`grant ${capabilityName} to ${writerName} with inherit ${mode === "inherited"},set ${mode === "set-only"},admin false`);
  try {
    if (mode === "set-only") await writer.query(`set role ${capabilityName}`);
    expect((await writer.query("update public.driver_schemas set schema_namespace='capability' where false")).rowCount).toBe(0);
    await expectBlocked();
  } finally {
    await writer.query("reset role");
    await admin.query(`revoke update on public.driver_schemas from ${role}`);
    if (mode !== "direct") await admin.query(`revoke ${capabilityName} from ${writerName}`);
  }
});
