import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
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
    await seedCoreGraph(db, {
      organization: { id: "org-struct", name: "Struct" },
      projects: [{ id: "proj-struct", name: "P", code: "P" }],
    });
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
  it("persists source spans for nodes and properties from CST locators", async () => {
    const source = `/dts-v1/;\n\n/ {\n  demo {\n    temp = <85>;\n  };\n};\n`;
    const versionId = randomUUID();
    await db!.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-struct', 1, 'k', 'c', 1, '{}'::jsonb, 'upload')`,
      [versionId],
    );

    await ingestDtsFileVersion(db!, versionId, source);

    const node = await db!.query<{
      node_path: string;
      start_offset: number | null;
      end_offset: number | null;
      start_line: number | null;
      start_column: number | null;
      end_line: number | null;
      end_column: number | null;
    }>(
      `select node_path, start_offset, end_offset, start_line, start_column, end_line, end_column
       from dts_nodes
       where file_version_id = $1 and node_path = 'demo'`,
      [versionId],
    );
    expect(node.rows).toHaveLength(1);
    const demo = node.rows[0]!;
    expect(demo.start_offset).not.toBeNull();
    expect(demo.end_offset).not.toBeNull();
    expect(demo.start_offset!).toBeLessThan(demo.end_offset!);
    expect(demo.start_line).toBeGreaterThanOrEqual(1);
    expect(demo.start_column).toBeGreaterThanOrEqual(1);
    expect(demo.end_line).toBeGreaterThanOrEqual(demo.start_line!);
    expect(source.slice(demo.start_offset!, demo.end_offset!)).toContain("demo");

    const prop = await db!.query<{
      name: string;
      start_offset: number | null;
      end_offset: number | null;
      start_line: number | null;
      start_column: number | null;
      end_line: number | null;
      end_column: number | null;
    }>(
      `select p.name, p.start_offset, p.end_offset, p.start_line, p.start_column, p.end_line, p.end_column
       from dts_properties p
       join dts_nodes n on n.id = p.node_id
       where n.file_version_id = $1 and n.node_path = 'demo' and p.name = 'temp'`,
      [versionId],
    );
    expect(prop.rows).toHaveLength(1);
    const temp = prop.rows[0]!;
    expect(temp.start_offset).not.toBeNull();
    expect(temp.end_offset).not.toBeNull();
    expect(temp.start_offset!).toBeLessThan(temp.end_offset!);
    // Property CST spans cover the value expression (matching topology occurrence locators).
    expect(source.slice(temp.start_offset!, temp.end_offset!)).toContain("85");
    expect(temp.start_line).toBeGreaterThanOrEqual(1);
    expect(temp.start_column).toBeGreaterThanOrEqual(1);
  });
});
