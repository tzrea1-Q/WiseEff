import pg from "pg";
import { pathToFileURL } from "node:url";

import type { Database } from "../server/shared/database/client";
import { loadSchemaRegistry } from "../server/modules/parameter-specs/schemaLoader";
import {
  upsertMatchedDriverSchema,
  upsertMatchedPropertySpec,
} from "../server/modules/parameter-specs/repository";
import type { PropertySpec } from "../server/modules/parameter-specs/types";
import { isStructuralPropertyKey } from "../src/domain/parameter-topology/parameterSurface";

type Queryable = Pick<Database, "query"> | pg.Pool;

export function isSyncableVendorProperty(property: Pick<PropertySpec, "propertyKey">): boolean {
  return !isStructuralPropertyKey(property.propertyKey);
}

/**
 * Refresh the complete schema graph from the pinned YAML catalog. Driver roots
 * are materialized first so every property can inherit the same canonical
 * DriverRegistration subject; a property-only sync must never create a
 * subjectless platform definition.
 */
async function syncVendorPropertyDocsInTransaction(db: Pick<Database, "query">): Promise<number> {
  const registry = loadSchemaRegistry("schemas/dts");
  for (const driver of registry.drivers) {
    await upsertMatchedDriverSchema(db, driver);
  }
  let updated = 0;
  for (const property of registry.properties) {
    if (!isSyncableVendorProperty(property)) continue;
    await upsertMatchedPropertySpec(db, property);
    updated += 1;
  }
  return updated;
}

/**
 * Refresh the catalog atomically when called with the server database root.
 * Callers that already own a transaction may pass its query handle directly;
 * the CLI below always uses one checked-out pool client so retiring an old
 * active version cannot commit without its replacement.
 */
export async function syncVendorPropertyDocs(db: Queryable | Database): Promise<number> {
  if ("transaction" in db && typeof db.transaction === "function") {
    return db.transaction((tx) => syncVendorPropertyDocsInTransaction(tx));
  }
  return syncVendorPropertyDocsInTransaction(db);
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const updated = await syncVendorPropertyDocsInTransaction(client);
    const sample = await client.query(
      `select psv.description, psv.example_value, dps.documentation
       from parameter_spec_versions psv
       left join dts_property_specs dps on dps.parameter_spec_id = psv.parameter_spec_id
       where psv.id = $1`,
      ["propspec:vendor/huawei,bypass_bst_hl7603:const_vout:v1"]
    );
    await client.query("commit");
    console.log(JSON.stringify({ updated, sample: sample.rows[0] }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
