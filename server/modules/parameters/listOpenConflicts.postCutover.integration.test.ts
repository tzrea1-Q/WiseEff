/**
 * CW-T2: listOpenConflicts must execute real SQL against the post-cutover schema.
 * Fake-db unit tests cannot catch joins to renamed tables; this guard does.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { listOpenConflicts } from "./fileSyncConflictRepository";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("listOpenConflicts post-cutover SQL", () => {
  let db: InMemoryTestDatabase | null = null;

  afterEach(async () => {
    setParameterIdentityMode(null);
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("runs against migrated schema without legacy project_parameter_values", async () => {
    db = await createInMemoryTestDatabase();

    const columns = await db.query<{ column_name: string }>(
      `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'parameter_file_sync_conflicts'
        and column_name in ('project_parameter_binding_id', 'project_parameter_value_id')
      order by column_name
      `
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("project_parameter_binding_id");
    // After local post-cutover this column is gone; if still present the query must still avoid it.
    const legacyTable = await db.query<{ exists: boolean }>(
      `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'project_parameter_values'
      ) as exists
      `
    );

    setParameterIdentityMode("semantic");
    const items = await listOpenConflicts(db, {
      organizationId: "org-chargelab",
      projectId: "atlas"
    });
    expect(Array.isArray(items)).toBe(true);

    if (!legacyTable.rows[0]?.exists) {
      expect(names).not.toContain("project_parameter_value_id");
    }
  });
});
