import pg from "pg";
import { pathToFileURL } from "node:url";

import { getRootPostgresPool, type Database } from "../server/shared/database/client";
import { seedPublishedCatalog } from "../server/testing/parameterCatalog/seedPublishedCatalog";
import { isStructuralPropertyKey } from "../src/domain/parameter-topology/parameterSurface";

export function isSyncableVendorProperty(property: { propertyKey: string }): boolean {
  return !isStructuralPropertyKey(property.propertyKey);
}

export async function syncVendorPropertyDocs(db: Database | pg.Pool): Promise<number> {
  const pool = db instanceof pg.Pool ? db : getRootPostgresPool(db);
  if (!pool) throw new Error("Vendor documentation sync requires the root PostgreSQL database.");
  const release = await seedPublishedCatalog(pool);
  const definitions = await pool.query<{ count: number }>(
    `select count(*)::int as count from parameter_catalog.catalog_release_definition_heads where release_id = $1`,
    [release.id],
  );
  return definitions.rows[0]!.count;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  });
  try {
    const updated = await syncVendorPropertyDocs(pool);
    const sample = await pool.query(
      `select revision.content from parameter_catalog.parameter_definitions definition
       join parameter_catalog.definition_revisions revision on revision.id = definition.current_revision_id
       where definition.id = $1`,
      ["pdef_drv_huawei_bypass_bst_hl7603_const_vout"]
    );
    console.log(JSON.stringify({ updated, sample: sample.rows[0] }, null, 2));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
