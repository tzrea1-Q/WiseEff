import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildDtsPowerSeed } from "../../../scripts/dts-power-seed";
import { seedM1DtsFiles } from "../../../scripts/seed-m1-parameters";
import type { ObjectStore } from "../../modules/logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";

const root = path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
const baseSource = await readFile(path.join(root, "src/config/dts-seed/aurora-board.dts"), "utf8");

function createHarness() {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const puts: Array<{ organizationId: string; fileName: string; bytes: Buffer }> = [];
  const tx: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      queries.push({ text, values });
      if (text.includes("insert into dts_config_set")) {
        return { rows: [{ id: values[0] } as Row], rowCount: 1 };
      }
      if (text.includes("insert into project_parameter_files")) {
        return { rows: [{ id: values[0] } as Row], rowCount: 1 };
      }
      if (text.includes("select id, version_number") && text.includes("project_parameter_file_versions")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("next_version_number")) {
        return { rows: [{ next_version_number: 1 } as Row], rowCount: 1 };
      }
      if (text.includes("insert into dts_release_baseline")) {
        return { rows: [{ id: values[0] } as Row], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  const db: Database = {
    query: tx.query,
    transaction: async (fn) => fn(tx)
  };
  const objectStore: ObjectStore = {
    async put(input) {
      puts.push(input);
      const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
      return {
        storageKey: `${input.organizationId}/${checksumSha256}-${input.fileName}`,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.length,
        checksumSha256
      };
    },
    async get() {
      throw new Error("not used");
    }
  };
  return { db, objectStore, puts, queries };
}

describe("seedM1DtsFiles", () => {
  it("persists each project file, full structural model, and released seed baseline", async () => {
    const seed = buildDtsPowerSeed(baseSource);
    const { db, objectStore, puts, queries } = createHarness();

    await seedM1DtsFiles(db, objectStore, seed.projectFiles);

    expect(puts).toHaveLength(3);
    expect(puts.map((put) => put.fileName)).toEqual([
      "aurora-board.dts",
      "nebula-board.dts",
      "atlas-board.dts"
    ]);
    expect(queries.filter((call) => call.text.includes("insert into dts_config_set"))).toHaveLength(3);
    expect(queries.filter((call) => call.text.includes("insert into project_parameter_files"))).toHaveLength(3);
    expect(queries.filter((call) => call.text.includes("insert into project_parameter_file_versions"))).toHaveLength(3);
    expect(queries.filter((call) => call.text.includes("insert into dts_nodes"))).toHaveLength(150);
    expect(queries.filter((call) => call.text.includes("insert into dts_properties"))).toHaveLength(528);
    expect(queries.filter((call) => call.text.includes("insert into dts_phandle_refs"))).toHaveLength(54);
    expect(queries.filter((call) => call.text.includes("insert into dts_release_baseline ("))).toHaveLength(3);
    expect(queries.filter((call) => call.text.includes("insert into dts_release_baseline_members"))).toHaveLength(3);

    const versionInsert = queries.find((call) => call.text.includes("insert into project_parameter_file_versions"));
    expect(versionInsert?.values[6]).toContain('"charging_core/ichg_max"');
    const fileInsert = queries.find((call) => call.text.includes("insert into project_parameter_files"));
    expect(fileInsert?.values).toEqual(expect.arrayContaining(["base", "aurora-board.dts"]));
  });
});
