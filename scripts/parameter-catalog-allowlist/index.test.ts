import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  consumerShardDefinitions,
  loadAllowlistIndex,
  loadBoundaryViolationFixture,
} from "./index";

const sampleEntry = {
  id: "S12-CGH:legacy-catalog-sql-write:0123456789abcdef:1",
  rule: "legacy-catalog-sql-write",
  file: "server/modules/parameter-specs/repository.ts",
  reason: "Retained only until S12-CGH removes the legacy writer.",
};

describe("parameter catalog allow-list index", () => {
  it("maps exactly eleven independently owned shards to disjoint consumer roots", () => {
    expect(consumerShardDefinitions).toEqual([
      ["S12-CGH", "server/modules/parameter-specs", "s12-cgh.json"],
      ["S12-TOP", "server/modules/parameter-topology", "s12-top.json"],
      ["S12-PRJ", "server/modules/parameters", "s12-prj.json"],
      ["S12-FIL", "server/modules/parameter-files", "s12-fil.json"],
      ["S12-AGT", "server/modules/agent", "s12-agt.json"],
      ["S12-LOG", "server/modules/logs", "s12-log.json"],
      ["S12-DBG", "server/modules/debugging", "s12-dbg.json"],
      ["S12-DTS", "server/modules/dts-reload", "s12-dts.json"],
      ["S12-KNW", "server/modules/knowledge", "s12-knw.json"],
      ["S12-MOD", "server/modules/parameter-modules", "s12-mod.json"],
      ["S12-OPS", "server/modules/operations", "s12-ops.json"],
    ]);
  });

  it("loads all shards in index order and flattens their named entries", async () => {
    const root = await createFixtureRoot();
    await seedShards(root, { "S12-CGH": [sampleEntry] });

    const index = await loadAllowlistIndex(root);

    expect(index.shards).toHaveLength(11);
    expect(index.entries).toEqual([sampleEntry]);
    expect([...index.entriesById.keys()]).toEqual([sampleEntry.id]);
  });

  it("fails closed on a missing shard, metadata drift, or a cross-family entry", async () => {
    const missingRoot = await createFixtureRoot();
    await seedShards(missingRoot, {}, { omit: "S12-OPS" });
    await expect(loadAllowlistIndex(missingRoot)).rejects.toThrow(/s12-ops\.json/u);

    const driftRoot = await createFixtureRoot();
    await seedShards(driftRoot, {}, { overrideFamily: "S12-TOP" });
    await expect(loadAllowlistIndex(driftRoot)).rejects.toThrow(/metadata/u);

    const crossFamilyRoot = await createFixtureRoot();
    await seedShards(crossFamilyRoot, {
      "S12-CGH": [sampleEntry],
      "S12-TOP": [
        {
          ...sampleEntry,
          file: "server/modules/parameter-topology/service.ts",
        },
      ],
    });
    await expect(loadAllowlistIndex(crossFamilyRoot)).rejects.toThrow(/family/u);
  });

  it("loads the immutable baseline fixture without coupling it to the current shard contents", async () => {
    const root = await createFixtureRoot();
    const fixturePath = join(root, "scripts/fixtures/parameter-catalog-allowlist/current-violations.json");
    await mkdir(join(root, "scripts/fixtures/parameter-catalog-allowlist"), { recursive: true });
    await writeJson(fixturePath, {
      schemaVersion: 1,
      baselineSha: "e84ca078ab8f7b7006fa8e635d722297a287d2a5",
      violations: [
        {
          ...sampleEntry,
          family: "S12-CGH",
          line: 10,
          column: 5,
          evidence: "insert into parameter_specs",
        },
      ],
    });

    expect(await loadBoundaryViolationFixture(root)).toMatchObject({
      baselineSha: "e84ca078ab8f7b7006fa8e635d722297a287d2a5",
      violations: [{ id: sampleEntry.id }],
    });
  });
});

async function createFixtureRoot() {
  return mkdtemp(join(tmpdir(), "parameter-catalog-allowlist-"));
}

async function seedShards(
  root: string,
  entries: Partial<Record<(typeof consumerShardDefinitions)[number][0], unknown[]>>,
  options: { omit?: string; overrideFamily?: string } = {},
) {
  const shardRoot = join(root, "scripts/parameter-catalog-allowlist/shards");
  await mkdir(shardRoot, { recursive: true });
  for (const [family, familyRoot, file] of consumerShardDefinitions) {
    if (family === options.omit) continue;
    await writeJson(join(shardRoot, file), {
      schemaVersion: 1,
      family: family === options.overrideFamily ? "S12-CGH" : family,
      root: familyRoot,
      entries: entries[family] ?? [],
    });
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
