/**
 * Replay coverage for 0109_repair_module_parent_id_from_path.sql (#415): rows
 * whose parent_id was desynced from their materialized path by the unguarded
 * move UPDATE are recomputed from the path (authoritative), in both
 * parameter_modules and debug_node_modules. Rows whose parent-prefix row is
 * missing, or whose repaired slot collides with an existing sibling name, are
 * left untouched for manual triage. The repair is idempotent.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";

const migration0109 = "0109_repair_module_parent_id_from_path.sql";

const ORG = "org-mig-0109";

const databaseAvailable = await isTestDatabaseAvailable();

type ModuleRow = {
  id: string;
  parent_id: string | null;
  updated_at: Date;
};

async function listTreeRows(db: Database, table: "parameter_modules" | "debug_node_modules") {
  const result = await db.query<ModuleRow>(
    `select id, parent_id, updated_at from ${table} where organization_id = $1 order by id`,
    [ORG]
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

/**
 * Seed one corrupted tree per table. `pm-b` was moved under `pm-x` by the
 * pre-#415 UPDATE, which stamped `parent_id = pm-x` onto its descendants while
 * re-prefixing their paths correctly:
 *   - `<p>-c` / `<p>-d`: corrupted pair — repairable from the path;
 *   - `<p>-orphan`: its parent-prefix row (`<p>-gone`) does not exist — must
 *     stay untouched;
 *   - `<p>-dup`: repair target slot (parent `<p>-b`, name "Taken") is already
 *     occupied by the clean `<p>-taken` — must stay untouched.
 */
async function seedCorruptedTree(
  db: Database,
  table: "parameter_modules" | "debug_node_modules",
  prefix: string
) {
  const rows: Array<[id: string, parentId: string | null, name: string, treePath: string, depth: number]> = [
    [`${prefix}-x`, null, "Charging", `${prefix}-x`, 1],
    [`${prefix}-b`, `${prefix}-x`, "Battery", `${prefix}-x/${prefix}-b`, 2],
    [`${prefix}-c`, `${prefix}-x`, "Cells", `${prefix}-x/${prefix}-b/${prefix}-c`, 3],
    [`${prefix}-d`, `${prefix}-x`, "Balancing", `${prefix}-x/${prefix}-b/${prefix}-c/${prefix}-d`, 4],
    [`${prefix}-orphan`, `${prefix}-x`, "Orphan", `${prefix}-gone/${prefix}-orphan`, 2],
    [`${prefix}-taken`, `${prefix}-b`, "Taken", `${prefix}-x/${prefix}-b/${prefix}-taken`, 3],
    [`${prefix}-dup`, `${prefix}-x`, "Taken", `${prefix}-x/${prefix}-b/${prefix}-dup`, 3]
  ];
  for (const [id, parentId, name, treePath, depth] of rows) {
    await db.query(
      `insert into ${table} (id, organization_id, parent_id, name, path, depth)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, ORG, parentId, name, treePath, depth]
    );
  }
}

function assertRepairedTree(rows: Map<string, ModuleRow>, seeded: Map<string, ModuleRow>, prefix: string) {
  // The corrupted pair is recomputed from the path: the child points at the
  // moved node, the grandchild at the child.
  expect(rows.get(`${prefix}-c`)?.parent_id).toBe(`${prefix}-b`);
  expect(rows.get(`${prefix}-d`)?.parent_id).toBe(`${prefix}-c`);
  // Already-consistent rows keep their parent and are not rewritten.
  expect(rows.get(`${prefix}-x`)).toEqual(seeded.get(`${prefix}-x`));
  expect(rows.get(`${prefix}-b`)).toEqual(seeded.get(`${prefix}-b`));
  expect(rows.get(`${prefix}-taken`)).toEqual(seeded.get(`${prefix}-taken`));
  // Unrepairable rows are left exactly as they were (updated_at included):
  // the orphan's parent-prefix row is missing, and the duplicate's repaired
  // slot is taken by an existing sibling name.
  expect(rows.get(`${prefix}-orphan`)).toEqual(seeded.get(`${prefix}-orphan`));
  expect(rows.get(`${prefix}-dup`)).toEqual(seeded.get(`${prefix}-dup`));
}

describe.skipIf(!databaseAvailable)("0109 module parent_id repair", () => {
  it("recomputes parent_id from the path for both trees, skipping unrepairable rows", async () => {
    await withTempDatabase({ prefix: "mig0109", migrate: false }, async ({ db }) => {
      const beforeRepair = await applyMigrations(db, migrationsDir, { before: migration0109 });
      expect(beforeRepair.at(-1)).toBe("0108_log_domain_webhooks_and_model_override.sql");

      await db.query(`insert into organizations (id, name) values ($1, 'Mig 0109 Org')`, [ORG]);
      await seedCorruptedTree(db, "parameter_modules", "pm");
      await seedCorruptedTree(db, "debug_node_modules", "dm");

      const seededParams = await listTreeRows(db, "parameter_modules");
      const seededDebug = await listTreeRows(db, "debug_node_modules");
      // The seeded state is corrupted: descendants claim the move target.
      expect(seededParams.get("pm-c")?.parent_id).toBe("pm-x");
      expect(seededParams.get("pm-d")?.parent_id).toBe("pm-x");

      // Later migrations (0110+) may follow in the sequence; the repair under
      // test must be the first pending migration after the 0108 stop point.
      const pending = await applyMigrations(db, migrationsDir);
      expect(pending[0]).toBe(migration0109);

      const repairedParams = await listTreeRows(db, "parameter_modules");
      const repairedDebug = await listTreeRows(db, "debug_node_modules");
      assertRepairedTree(repairedParams, seededParams, "pm");
      assertRepairedTree(repairedDebug, seededDebug, "dm");

      // Idempotent: replaying the repair statements changes nothing, not even
      // updated_at on already-repaired rows.
      const sql = await fs.readFile(path.join(migrationsDir, migration0109), "utf8");
      await db.query(sql);
      await expect(listTreeRows(db, "parameter_modules")).resolves.toEqual(repairedParams);
      await expect(listTreeRows(db, "debug_node_modules")).resolves.toEqual(repairedDebug);
    });
  });
});
