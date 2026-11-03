import { pathToFileURL } from "node:url";

import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { seedCurrentDemoCatalog } from "../server/testing/parameterCatalog/seedCurrentDemoCatalog";

export async function ensurePublishedVendorCatalog(db: Database): Promise<number> {
  const release = await seedCurrentDemoCatalog(db);
  const definitions = await db.query<{ count: number }>(
    `select count(*)::int as count from parameter_catalog.catalog_release_definition_heads where release_id = $1`,
    [release.id],
  );
  return definitions.rows[0]!.count;
}

async function main() {
  const db = createPostgresDatabase(process.env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff");
  try {
    const releaseDefinitionCount = await ensurePublishedVendorCatalog(db);
    const sample = await db.query(
      `select revision.content from parameter_catalog.parameter_definitions definition
       join parameter_catalog.definition_revisions revision on revision.id = definition.current_revision_id
       where definition.id = $1`,
      ["pdef_drv_huawei_bypass_bst_hl7603_const_vout"]
    );
    console.log(JSON.stringify({ releaseDefinitionCount, sample: sample.rows[0] }, null, 2));
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
