import { expect, it } from "vitest";
import { createPostgresDatabase, type Database } from "../../../shared/database/client";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createSourceAdminFixture, sourceAdminText } from "../../parameter-files/sourceAdministration.testHelpers";
import { setSourceRevisionRegistrationStatus } from "../../../testing/parameterCatalog/sourceRevision";

const visibility = "parameter_catalog.current_source_binding_is_suspended(text,text,text)";

async function functionBoundary(db: Database) {
  return (await db.query(`select p.oid,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,
    p.prosecdef,p.provolatile,p.proconfig
    from pg_proc p where p.oid=$1::regprocedure`, [visibility])).rows;
}

async function explainLookups(db: Database, scope: string[]) {
  const result = await db.query<{ "QUERY PLAN": Array<{ "Execution Time": number; Plan: { "Actual Rows": number } }> }>(`
    explain (analyze, buffers, format json)
    select n from generate_series(1,124) n
    where parameter_catalog.current_source_binding_is_suspended(
      $1,$2,$3 || repeat('',n))`, scope);
  const plan = result.rows[0]!["QUERY PLAN"][0]!;
  expect(plan.Plan["Actual Rows"]).toBe(124);
  return plan["Execution Time"];
}

it("upgrades suspension reads without changing existing runtime authority", async () => {
  await withTempDatabase({ prefix: "suspension_read_upgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { through: "0331_module_deletion_references.sql" });
    const token = `sr${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl);
    try {
      const boundary = await functionBoundary(db);
      const query = "select parameter_catalog.current_source_binding_is_suspended('org','project','absent') as suspended";
      expect((await api.query(query)).rows).toEqual([{ suspended: false }]);
      await applyMigrations(db, migrationsDir);
      expect(await functionBoundary(db)).toEqual(boundary);
      expect((await api.query(query)).rows).toEqual([{ suspended: false }]);
      expect((await api.query(`select
        has_table_privilege(current_user,'parameter_catalog.source_binding_suspension_receipts','SELECT,INSERT,UPDATE,DELETE') as receipts,
        has_function_privilege(current_user,$1,'EXECUTE') as visibility`, [visibility])).rows)
        .toEqual([{ receipts: false, visibility: true }]);
      for (const role of [runtime.workerRole, runtime.managerRole]) {
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as visibility", [role, visibility])).rows)
          .toEqual([{ visibility: false }]);
      }
    } finally {
      await api.close();
      expect((await dropLabRuntimeLogins(connectionString, token)).failed).toEqual([]);
    }
  });
}, 120_000);

it("reuses proof planning for an existing binding with an approved suspension receipt", async () => {
  const f = await createSourceAdminFixture("susp-read-perf", createUserInvocation);
  try {
    const binding = (await f.api.query<{ id: string; registration_id: string }>(`select id,registration_id from parameter_catalog.current_project_parameter_bindings
      where organization_id=$1 and project_id=$2 order by id limit 1`, [f.organizationId, f.projectId])).rows[0];
    expect(binding).toBeDefined();
    expect((await f.db.query(`select count(*)::integer as count from parameter_catalog.source_binding_suspension_receipts`)).rows)
      .toEqual([{ count: 0 }]);
    const scope = [f.organizationId, f.projectId, binding!.id];
    const optimized = (await f.db.query<{ definition: string }>("select pg_get_functiondef($1::regprocedure) as definition", [visibility])).rows[0]!.definition;
    // Reinstall the exact historical implementation in this disposable fixture,
    // then restore 0332 on the same API connection and populated schema.
    const historicalMigration = await readFile(join(migrationsDir, "0326_source_managed_scope_receipts.sql"), "utf8");
    const historical = historicalMigration.match(/create function parameter_catalog\.current_source_binding_is_suspended[\s\S]+?\$\$;/)?.[0];
    if (!historical) throw new Error("Historical suspension function was not found");
    const definitions = [historical.replace("create function", "create or replace function"), optimized];
    const lookup = "select parameter_catalog.current_source_binding_is_suspended($1,$2,$3) as suspended";
    for (const definition of definitions) {
      await f.db.query(definition);
      expect((await f.api.query(lookup, scope)).rows).toEqual([{ suspended: false }]);
    }
    // Create genuine immutable evidence through the source workflow. An empty
    // receipt table does not exercise the costly nested proof path: both old
    // and new implementations already finish that case in milliseconds.
    const registration = { organizationId: f.organizationId, registrationId: binding!.registration_id };
    await setSourceRevisionRegistrationStatus(f.db, { ...registration, status: "retired" });
    await (await f.stage(sourceAdminText.replace("<36>", "<42>"), "susp-perf-approval")).apply();
    await setSourceRevisionRegistrationStatus(f.db, { ...registration, status: "active" });
    expect((await f.db.query(`select count(*)::integer as count from parameter_catalog.source_binding_suspension_receipts`)).rows)
      .toEqual([{ count: 1 }]);
    const timings: number[] = [];
    for (const definition of definitions) {
      await f.db.query(definition);
      timings.push(await f.api.transaction(async tx => {
        await tx.query("set local jit=off");
        // The row-dependent empty suffix prevents a one-time stable-function
        // evaluation while retaining the exact existing binding identity.
        return explainLookups(tx, scope);
      }));
    }
    const [beforeMs, afterMs] = timings as [number, number];
    console.info("Suspension lookup upgrade (124 approved-receipt reads)", { beforeMs, afterMs });
    // Compare on the same server instead of imposing a fixed hardware budget.
    expect(afterMs).toBeLessThan(beforeMs / 2);
  } finally {
    await f.close();
  }
}, 120_000);
