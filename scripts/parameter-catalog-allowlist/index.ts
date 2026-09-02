import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  allowlistShardSchema,
  boundaryViolationFixtureSchema,
  type AllowlistEntry,
  type AllowlistShard,
} from "./schema";

export const consumerShardDefinitions = [
  {
    family: "S12-CGH",
    paths: [
      { pattern: "server/modules/parameter-specs/**", required: true },
      { pattern: "src/infrastructure/http/parameterAdminClient.ts", required: true },
      { pattern: "server/modules/parameter-specs/parameterCatalogComparisonContribution.ts", required: false },
      { pattern: "e2e/acceptance/parameter-import-wizard.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/parameterTopologyClient.test.ts", required: true },
      { pattern: "e2e/acceptance/parameter-topology.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/parameterClient.test.ts", required: true },
      { pattern: "src/infrastructure/http/parameterDtos.test.ts", required: true },
      { pattern: "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/parameterFileClient.test.ts", required: true },
      { pattern: "e2e/acceptance/parameter-files.acceptance.spec.ts", required: true },
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
      { pattern: "server/modules/agent/tools/actionTools.test.ts", required: true },
      { pattern: "server/modules/agent/tools/actionTools.integration.test.ts", required: true },
      { pattern: "server/modules/agent/toolRegistry.test.ts", required: true },
      { pattern: "server/modules/agent/parameterCatalogComparisonContribution.test.ts", required: false },
      { pattern: "e2e/acceptance/xiaoze-action.acceptance.spec.ts", required: true },
      { pattern: "server/modules/agent/tools/perceptionTools.ts", required: true },
      { pattern: "server/modules/agent/tools/perceptionTools.test.ts", required: true },
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
      { pattern: "src/infrastructure/http/logClient.test.ts", required: true },
      { pattern: "src/infrastructure/http/logDtos.test.ts", required: true },
      { pattern: "e2e/acceptance/log-analysis.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/debuggingClient.test.ts", required: true },
      { pattern: "src/infrastructure/http/debuggingDtos.test.ts", required: true },
      { pattern: "e2e/acceptance/debugging-admin.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/dtsReloadClient.test.ts", required: false },
      { pattern: "e2e/acceptance/dts-reload-deploy.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/knowledgeClient.test.ts", required: true },
      { pattern: "e2e/acceptance/knowledge.acceptance.spec.ts", required: true },
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
      { pattern: "src/infrastructure/http/parameterModuleRegistryClient.test.ts", required: false },
      { pattern: "e2e/acceptance/hierarchical-modules.acceptance.spec.ts", required: true },
    ],
    shardFile: "s12-mod.json",
  },
  {
    family: "S12-OPS",
    paths: [
      { pattern: "server/modules/operations/**", required: true },
      { pattern: "scripts/reconcile-parameter-definitions.ts", required: true },
      { pattern: "server/modules/operations/parameterCatalogComparisonContribution.ts", required: false },
      { pattern: "scripts/reconcile-parameter-definitions.test.ts", required: false },
    ],
    shardFile: "s12-ops.json",
  },
] as const;

export const allowlistShardDirectory = "scripts/parameter-catalog-allowlist/shards";
export const boundaryViolationFixturePath = "scripts/fixtures/parameter-catalog-allowlist/current-violations.json";

export type AllowlistIndex = {
  shards: AllowlistShard[];
  entries: AllowlistEntry[];
  entriesById: Map<string, AllowlistEntry>;
};

export type BoundaryFixtureIntegrity = {
  trustedBaseSha: string;
  fixtureSha256: string;
};

export async function loadAllowlistIndex(repoRoot: string): Promise<AllowlistIndex> {
  const shards: AllowlistShard[] = [];
  const entries: AllowlistEntry[] = [];
  const entriesById = new Map<string, AllowlistEntry>();

  for (const definition of consumerShardDefinitions) {
    const relativePath = `${allowlistShardDirectory}/${definition.shardFile}`;
    const parsed = allowlistShardSchema.parse(await readJson(repoRoot, relativePath));
    const expectedPaths = definition.paths.map(({ pattern }) => pattern);
    if (parsed.family !== definition.family || JSON.stringify(parsed.paths) !== JSON.stringify(expectedPaths)) {
      throw new Error(
        `Allow-list shard metadata mismatch for ${relativePath}: expected ${definition.family} at ${expectedPaths.join(", ")}.`,
      );
    }

    shards.push(parsed);
    for (const entry of parsed.entries) {
      if (entriesById.has(entry.id)) {
        throw new Error(`Duplicate allow-list violation ID across shards: ${entry.id}.`);
      }
      entriesById.set(entry.id, entry);
      entries.push(entry);
    }
  }

  return { shards, entries, entriesById };
}

export async function loadBoundaryViolationFixture(repoRoot: string, integrity?: BoundaryFixtureIntegrity) {
  const document = await readJsonDocument(repoRoot, boundaryViolationFixturePath);
  const fixture = boundaryViolationFixtureSchema.parse(document.value);
  if (integrity) {
    const actualDigest = createHash("sha256").update(document.contents).digest("hex");
    if (actualDigest !== integrity.fixtureSha256) {
      throw new Error(
        `Parameter-catalog baseline fixture digest mismatch: expected ${integrity.fixtureSha256}, received ${actualDigest}.`,
      );
    }
    if (fixture.trustedBaseSha !== integrity.trustedBaseSha) {
      throw new Error(
        `Parameter-catalog baseline fixture SHA mismatch: expected ${integrity.trustedBaseSha}, received ${fixture.trustedBaseSha}.`,
      );
    }
  }
  return fixture;
}

async function readJson(repoRoot: string, relativePath: string) {
  return (await readJsonDocument(repoRoot, relativePath)).value;
}

async function readJsonDocument(repoRoot: string, relativePath: string) {
  const absolutePath = resolve(repoRoot, relativePath);
  let contents: string;
  try {
    contents = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read required parameter-catalog allow-list artifact ${relativePath}.`, { cause: error });
  }

  try {
    return { contents, value: JSON.parse(contents) as unknown };
  } catch (error) {
    throw new Error(`Invalid JSON in parameter-catalog allow-list artifact ${relativePath}.`, { cause: error });
  }
}
