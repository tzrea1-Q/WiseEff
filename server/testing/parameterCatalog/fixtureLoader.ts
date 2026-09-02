import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { assertCheckedEmptyCatalog, assertRealPostgresUrl } from "./database";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const rehearsalSqlDir = path.join(projectRoot, "scripts/wayfinder/sql");

/**
 * Exact S0-FIX source-lock SHA-256 digests for scripts/wayfinder/sql.
 * This harness consumes those files and must not edit them.
 */
export const REHEARSAL_SQL_CHECKSUMS = {
  "columns.sql": "12cae0640df2a468958b0ccf8efec6b4cb88c5c54e10fe490be92e5a51dd20fb",
  "constraints.sql": "fc578e4545aa2b3c879527b3a0e00e05a2995fec7be66ff5ad99993aec98694f",
  "indexes.sql": "2fcafd583c31d9b080dbbc5f12413afcaba6034a74c42112df5f207eae69bcf0",
  "invariant-counts.sql":
    "397a8ecfe1557dadb31e97c1389c67f833e1d626a323cfb64c2051b587213b24",
  "migration-inventory.sql":
    "6232cccb7d178bdb899df6ed5804d094590f2c591364491c7b4240c9d5e34e15",
  "profile-schema.sql": "e84bac11a87ff0b9aaa1ed84bdbba601fb498d1c86b1f3b4a53f4e3e6e40cdd8",
  "relations.sql": "d2936881f7bcaf203f38154cbbaeaf5427b7e2d452bc5dfe691b9c3ef14b7195",
  "row-classes.sql": "091eb031ed20a65d73f1160138fb07d1300f07d73c1a6d3e6bf291b9a321a6ff",
  "row-counts.sql": "6ec554005e107220f3decee258838e76f4fb71e13835bcfceefa7c195f575bcc",
  "synthetic-fixture-verify.sql":
    "abff392122a7703f1d701611aebfabeba05b589e5de3dca443b17c6669602df0",
  "synthetic-fixture.sql":
    "d8dcc92d0d42c4586df872afc5550f0175a68d1e17ca1229b8af11fe0ecf3b82",
  "triggers.sql": "b01b0df98e4d16434cba786e5188373cef9a6e92671c0eda9f8eb67458f563f7",
} as const;

const POPULATED_FIXTURE_CASES = [
  "binding-module-identity-mismatch",
  "driver-schema-root",
  "formal-platform-driver-definition",
  "formal-platform-node-type-definition",
  "inactive-definition-binding",
  "legacy-twin-r6-r8",
  "organization-manual-node-type-draft",
  "organization-registration-placement",
  "pinned-binding-revision",
  "platform-subjectless-dts-draft",
] as const;

const ZERO_INVENTORY_SQL = `
select coalesce(sum(row_count), 0)::bigint as inventory
from (
  select count(*)::bigint as row_count from projects
  union all select count(*) from parameter_specs
  union all select count(*) from parameter_spec_versions
  union all select count(*) from attribution_subjects
  union all select count(*) from driver_registrations
  union all select count(*) from node_type_definitions
  union all select count(*) from driver_schemas
  union all select count(*) from driver_schema_versions
  union all select count(*) from dts_property_specs
  union all select count(*) from parameter_modules
  union all select count(*) from parameter_module_mappings
  union all select count(*) from driver_registration_placements
  union all select count(*) from dts_config_set
  union all select count(*) from dts_config_revisions
  union all select count(*) from dts_logical_nodes
  union all select count(*) from project_parameter_bindings
  union all select count(*) from project_parameter_binding_revisions
  union all select count(*) from parameter_drafts
  union all select count(*) from parameter_change_requests
  union all select count(*) from parameter_history_entries
  union all select count(*) from parameter_spec_review_tasks
  union all select count(*) from identity_mapping_tasks
  union all select count(*) from legacy_parameter_migration_evidence
  union all select count(*) from driver_schema_overlays
  union all select count(*) from driver_schema_overlay_properties
) inventory
`;

export type ParameterCatalogFixtureMode = "populated" | "zero";

export type LoadedParameterCatalogFixture = {
  mode: ParameterCatalogFixtureMode;
  fixtureCases: number;
  legacyTwinRows: number;
  zeroInventory: number;
};

export function assertLockedChecksum(
  bytes: Uint8Array,
  expectedSha256: string,
  sourcePath: string,
): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(
      `Checksum-locked rehearsal fixture drifted: ${sourcePath} expected ${expectedSha256} got ${actual}`,
    );
  }
}

export async function verifyRehearsalFixtureChecksums(): Promise<void> {
  for (const [fileName, expected] of Object.entries(REHEARSAL_SQL_CHECKSUMS)) {
    const sourcePath = path.join(rehearsalSqlDir, fileName);
    const bytes = await readFile(sourcePath);
    assertLockedChecksum(bytes, expected, `scripts/wayfinder/sql/${fileName}`);
  }
}

async function readLockedSql(fileName: keyof typeof REHEARSAL_SQL_CHECKSUMS): Promise<string> {
  const sourcePath = path.join(rehearsalSqlDir, fileName);
  const bytes = await readFile(sourcePath);
  assertLockedChecksum(bytes, REHEARSAL_SQL_CHECKSUMS[fileName], `scripts/wayfinder/sql/${fileName}`);
  return bytes.toString("utf8");
}

async function verifyLoadedFixture(
  client: pg.Client,
  mode: ParameterCatalogFixtureMode,
): Promise<LoadedParameterCatalogFixture> {
  const cases = await client.query<{ case_name: string }>(
    `select case_name from wayfinder_rehearsal.fixture_cases order by case_name`,
  );
  const twin = await client.query<{ n: string }>(
    `select count(*)::bigint as n from parameter_specs where property_key = 'synthetic.legacy-twin'`,
  );
  const inventory = await client.query<{ inventory: string }>(ZERO_INVENTORY_SQL);
  const fixtureCases = cases.rows.length;
  const legacyTwinRows = Number(twin.rows[0]?.n ?? 0);
  const zeroInventory = Number(inventory.rows[0]?.inventory ?? 0);

  if (mode === "populated") {
    const names = cases.rows.map((row) => row.case_name);
    if (fixtureCases !== 10 || names.join("\0") !== POPULATED_FIXTURE_CASES.join("\0")) {
      throw new Error(
        `Populated rehearsal fixture cases drifted: ${JSON.stringify(names)}`,
      );
    }
    if (legacyTwinRows !== 2) {
      throw new Error(
        `Wayfinder R6/R8 legacy twin: expected 2 same-key rows, got ${legacyTwinRows}`,
      );
    }
  } else {
    if (fixtureCases !== 0) {
      throw new Error(
        `Wayfinder zero fixture case registry: expected 0 rows, got ${fixtureCases}`,
      );
    }
    if (legacyTwinRows !== 0) {
      throw new Error(
        `Wayfinder zero fixture must not contain the R6/R8 twin, got ${legacyTwinRows}`,
      );
    }
    if (zeroInventory !== 0) {
      throw new Error(
        `Wayfinder zero fixture inventory: expected 0 rows, got ${zeroInventory}`,
      );
    }
  }

  return { mode, fixtureCases, legacyTwinRows, zeroInventory };
}

export async function loadParameterCatalogFixture(
  connectionString: string,
  mode: ParameterCatalogFixtureMode,
): Promise<LoadedParameterCatalogFixture> {
  assertRealPostgresUrl(connectionString);
  if (mode !== "populated" && mode !== "zero") {
    throw new Error(`Unsupported Wayfinder fixture mode: ${String(mode)}`);
  }

  await verifyRehearsalFixtureChecksums();
  await assertCheckedEmptyCatalog(connectionString);

  const profileSchema = await readLockedSql("profile-schema.sql");
  const syntheticFixture =
    mode === "populated" ? await readLockedSql("synthetic-fixture.sql") : null;

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    await client.query("begin");
    try {
      await client.query(profileSchema);
      if (syntheticFixture) {
        await client.query(syntheticFixture);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    return await verifyLoadedFixture(client, mode);
  } finally {
    await client.end().catch(() => undefined);
  }
}
