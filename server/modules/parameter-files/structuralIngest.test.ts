import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { buildDtsParsedIndex } from "./parseIndex";
import { ingestDtsFileVersion } from "./structuralIngest";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

const databaseAvailable = await isTestDatabaseAvailable();

describe("buildDtsParsedIndex (structural)", () => {
  it("uses merged nodePath keys and normalized values", () => {
    const index = buildDtsParsedIndex(sample);
    expect(index["board_id"]?.value).toBe("<0>");
    expect(index["demo_integer/single_value"]?.value).toBe("<42>");
    expect(index["amba/i2c@XXXX0000/chip@6E/reg"]?.value).toBe("<0x6e>");
    expect(index["demo_multi_instance/battery_checker@0/status"]?.value).toBe('"ok"');
    expect(index["demo_multi_instance/battery_checker@1/status"]?.value).toBe('"ok"');
    // Hex case / whitespace equivalence
    const hexA = buildDtsParsedIndex(`&n { x = <0xB 0x4b>; };`);
    const hexB = buildDtsParsedIndex(`&n { x = <0xb 0x4B>; };`);
    expect(hexA["n/x"]?.value).toBe(hexB["n/x"]?.value);
    // Multi-group flatten
    const g = buildDtsParsedIndex(`&n { x = <1 2>,<3 4>; };`);
    expect(g["n/x"]?.value).toBe("<1 2 3 4>");
    // Bool is captured (not omitted as P0 flat parser did)
    expect(index["demo_bool/weak_source_sleep_enabled"]?.value).toBe("true");
  });

  it("still maps simple nested blocks for M1 compatibility tests", () => {
    const index = buildDtsParsedIndex("battery {\n  temp_max = <85>;\n};");
    expect(index["battery/temp_max"]?.value).toBe("<85>");
  });
});

describe.skipIf(!databaseAvailable)("ingestDtsFileVersion", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(
      `insert into organizations (id, name) values ('org-struct', 'Struct')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into projects (id, organization_id, name, code, status)
       values ('proj-struct', 'org-struct', 'P', 'P', 'initialized')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
       values ('file-struct', 'org-struct', 'proj-struct', 'sample.dts', 'dts', true)`,
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("persists nodes, properties, and phandle refs for the teaching fixture", async () => {
    const versionId = randomUUID();
    await db!.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-struct', 1, 'k', 'c', 1, '{}'::jsonb, 'upload')`,
      [versionId],
    );

    const { parsedIndex, counts } = await ingestDtsFileVersion(db!, versionId, sample);

    expect(counts.nodes).toBeGreaterThan(10);
    expect(counts.properties).toBeGreaterThan(20);
    expect(counts.phandleRefs).toBeGreaterThan(2);

    const nodes = await db!.query<{ node_path: string }>(
      `select node_path from dts_nodes where file_version_id = $1`,
      [versionId],
    );
    const paths = nodes.rows.map((r) => r.node_path);
    expect(paths).toContain("amba/i2c@XXXX0000/chip@6E");
    expect(paths).toContain("demo_multi_instance/battery_checker@0");
    expect(paths).toContain("demo_multi_instance/battery_checker@1");

    const ph = await db!.query<{ target_label: string }>(
      `select target_label from dts_phandle_refs r
       join dts_properties p on p.id = r.from_property_id
       join dts_nodes n on n.id = p.node_id
       where n.file_version_id = $1 and p.name = 'matchable' and n.node_path = 'demo_phandle_list'`,
      [versionId],
    );
    expect(ph.rows.map((r) => r.target_label).sort()).toEqual(["demo_ic_a", "demo_ic_b"]);

    expect(parsedIndex["amba/i2c@XXXX0000/chip@6E/reg"]?.value).toBe("<0x6e>");

    const refreshed = await ingestDtsFileVersion(db!, versionId, sample);
    expect(refreshed.counts).toEqual(counts);
    const refreshedNodes = await db!.query<{ count: number }>(
      `select count(*)::int as count from dts_nodes where file_version_id = $1`,
      [versionId]
    );
    expect(refreshedNodes.rows[0]?.count).toBe(counts.nodes);
  });
});
