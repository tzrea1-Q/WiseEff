import pg from "pg";
import { pathToFileURL } from "node:url";

import type { Database } from "../server/shared/database/client";
import { loadSchemaRegistry } from "../server/modules/parameter-specs/schemaLoader";
import { upsertMatchedPropertySpec } from "../server/modules/parameter-specs/repository";

type Queryable = Pick<Database, "query"> | pg.Pool;

/** Refresh parameter_spec_versions / dts_property_specs from vendor YAML catalog. */
export async function syncVendorPropertyDocs(db: Queryable): Promise<number> {
  const registry = loadSchemaRegistry("schemas/dts");
  let updated = 0;
  for (const property of registry.properties) {
    await upsertMatchedPropertySpec(db, property);
    updated += 1;
  }
  return updated;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  });
  const updated = await syncVendorPropertyDocs(pool);
  const sample = await pool.query(
    `select psv.description, psv.example_value, dps.documentation
     from parameter_spec_versions psv
     left join dts_property_specs dps on dps.parameter_spec_id = psv.parameter_spec_id
     where psv.id = $1`,
    ["propspec:vendor/huawei,bypass_bst_hl7603:const_vout:v1"]
  );
  console.log(JSON.stringify({ updated, sample: sample.rows[0] }, null, 2));
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
