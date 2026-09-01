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
  it("maps the exact frozen production paths from the eleven consumer owner Issues", () => {
    expect(consumerShardDefinitions).toEqual([
      {
        family: "S12-CGH",
        paths: [
          { pattern: "server/modules/parameter-specs/**", required: true },
          { pattern: "src/infrastructure/http/parameterAdminClient.ts", required: true },
          { pattern: "server/modules/parameter-specs/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-cgh.json",
      },
      {
        family: "S12-TOP",
        paths: [
          { pattern: "server/modules/parameter-topology/**", required: true },
          { pattern: "src/application/ports/ParameterTopologyRepository.ts", required: true },
          { pattern: "src/infrastructure/http/parameterTopologyClient.ts", required: true },
          { pattern: "server/modules/parameter-topology/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-top.json",
      },
      {
        family: "S12-PRJ",
        paths: [
          { pattern: "server/modules/parameters/**", required: true },
          { pattern: "server/modules/parameter-drafts/**", required: true },
          { pattern: "src/application/ports/ParameterRepository.ts", required: true },
          { pattern: "src/infrastructure/http/parameterClient.ts", required: true },
          { pattern: "src/infrastructure/http/parameterDtos.ts", required: true },
          { pattern: "server/modules/parameters/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-prj.json",
      },
      {
        family: "S12-FIL",
        paths: [
          { pattern: "server/modules/parameter-files/**", required: true },
          { pattern: "src/application/ports/ParameterFileRepository.ts", required: true },
          { pattern: "src/infrastructure/http/parameterFileClient.ts", required: true },
          { pattern: "server/modules/parameter-files/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-fil.json",
      },
      {
        family: "S12-AGT",
        paths: [
          { pattern: "server/modules/agent/tools/actionTools.ts", required: true },
          { pattern: "server/modules/agent/toolRegistry.ts", required: true },
          { pattern: "server/modules/agent/toolMetadata.ts", required: true },
          { pattern: "server/modules/agent/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-agt.json",
      },
      {
        family: "S12-LOG",
        paths: [
          { pattern: "server/modules/logs/**", required: true },
          { pattern: "src/application/ports/LogAnalysisRepository.ts", required: true },
          { pattern: "src/infrastructure/http/logClient.ts", required: true },
          { pattern: "src/infrastructure/http/logDtos.ts", required: true },
          { pattern: "server/modules/logs/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-log.json",
      },
      {
        family: "S12-DBG",
        paths: [
          { pattern: "server/modules/debugging/**", required: true },
          { pattern: "src/application/ports/DebuggingGateway.ts", required: true },
          { pattern: "src/infrastructure/http/debuggingClient.ts", required: true },
          { pattern: "src/infrastructure/http/debuggingDtos.ts", required: true },
          { pattern: "server/modules/debugging/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-dbg.json",
      },
      {
        family: "S12-DTS",
        paths: [
          { pattern: "server/modules/dts-reload/**", required: true },
          { pattern: "src/application/ports/DtsReloadRepository.ts", required: true },
          { pattern: "src/infrastructure/http/dtsReloadClient.ts", required: true },
          { pattern: "server/modules/dts-reload/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-dts.json",
      },
      {
        family: "S12-KNW",
        paths: [
          { pattern: "server/modules/knowledge/**", required: true },
          { pattern: "server/modules/knowledge/relatedKnowledge.ts", required: true },
          { pattern: "src/application/ports/KnowledgeRepository.ts", required: true },
          { pattern: "src/infrastructure/http/knowledgeClient.ts", required: true },
          { pattern: "src/features/knowledge/**", required: true },
          { pattern: "server/modules/knowledge/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-knw.json",
      },
      {
        family: "S12-MOD",
        paths: [
          { pattern: "server/modules/parameter-modules/**", required: true },
          { pattern: "src/application/ports/ParameterModuleRegistryRepository.ts", required: true },
          { pattern: "src/infrastructure/http/parameterModuleRegistryClient.ts", required: true },
          { pattern: "server/modules/parameter-modules/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-mod.json",
      },
      {
        family: "S12-OPS",
        paths: [
          { pattern: "server/modules/operations/**", required: true },
          { pattern: "scripts/reconcile-parameter-definitions.ts", required: true },
          { pattern: "server/modules/operations/parameterCatalogComparisonContribution.ts", required: false },
        ],
        shardFile: "s12-ops.json",
      },
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
  entries: Partial<Record<(typeof consumerShardDefinitions)[number]["family"], unknown[]>>,
  options: { omit?: string; overrideFamily?: string } = {},
) {
  const shardRoot = join(root, "scripts/parameter-catalog-allowlist/shards");
  await mkdir(shardRoot, { recursive: true });
  for (const definition of consumerShardDefinitions) {
    if (definition.family === options.omit) continue;
    await writeJson(join(shardRoot, definition.shardFile), {
      schemaVersion: 1,
      family: definition.family === options.overrideFamily ? "S12-CGH" : definition.family,
      paths: definition.paths.map(({ pattern }) => pattern),
      entries: entries[definition.family] ?? [],
    });
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
