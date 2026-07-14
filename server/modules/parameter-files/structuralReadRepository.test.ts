import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ingestDtsFileVersion } from "./structuralIngest";
import { readDtsStructuralModel } from "./structuralReadRepository";
import { getParameterFileVersionStructure } from "./structuralReadService";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("readDtsStructuralModel", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(
      `insert into organizations (id, name) values ('org-struct-read', 'StructRead')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into projects (id, organization_id, name, code, status)
       values ('proj-struct-read', 'org-struct-read', 'P', 'P', 'initialized')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
       values ('file-struct-read', 'org-struct-read', 'proj-struct-read', 'sample.dts', 'dts', true)`,
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("returns nodes, properties, and phandle refs from dts_* tables after ingest", async () => {
    const versionId = randomUUID();
    await db!.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-struct-read', 1, 'k', 'c', 1, '{}'::jsonb, 'upload')`,
      [versionId],
    );

    await ingestDtsFileVersion(db!, versionId, sample);

    const { nodes } = await readDtsStructuralModel(db!, versionId);

    const chip = nodes.find((n) => n.nodePath === "amba/i2c@XXXX0000/chip@6E");
    expect(chip).toBeDefined();
    expect(chip!.name).toBe("chip");
    expect(chip!.unitAddress).toBe("6E");
    expect(chip!.compatible).toBe("vendor,chip123");

    const battery0 = nodes.find((n) => n.nodePath === "demo_multi_instance/battery_checker@0");
    expect(battery0).toBeDefined();
    expect(battery0!.unitAddress).toBe("0");

    const demoBool = nodes.find((n) => n.nodePath === "demo_bool");
    expect(demoBool).toBeDefined();
    const weakSleep = demoBool!.properties.find((p) => p.name === "weak_source_sleep_enabled");
    expect(weakSleep).toMatchObject({
      valueType: "bool",
      normalizedValue: "true",
    });

    const phandleList = nodes.find((n) => n.nodePath === "demo_phandle_list");
    expect(phandleList).toBeDefined();
    const matchableRefs = phandleList!.phandleRefs.filter((r) => r.fromProperty === "matchable");
    expect(matchableRefs.map((r) => r.targetLabel).sort()).toEqual(["demo_ic_a", "demo_ic_b"]);
    expect(matchableRefs.find((r) => r.targetLabel === "demo_ic_a")?.resolvedTargetPath).toBe("demo_ic_a");
    // demo_ic_b is referenced but never defined in the teaching fixture, so resolution stays unset.
    expect(matchableRefs.find((r) => r.targetLabel === "demo_ic_b")?.resolvedTargetPath).toBeUndefined();

    const viaService = await getParameterFileVersionStructure(db!, versionId);
    expect(viaService.nodes).toEqual(nodes);
    expect(viaService.nodes.some((n) => n.name === "/" && n.nodePath === "")).toBe(true);
  });
});
