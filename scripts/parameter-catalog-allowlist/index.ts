import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  allowlistShardSchema,
  boundaryViolationFixtureSchema,
  type AllowlistEntry,
  type AllowlistShard,
} from "./schema";

export const consumerShardDefinitions = [
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
] as const;

export const allowlistShardDirectory = "scripts/parameter-catalog-allowlist/shards";
export const boundaryViolationFixturePath = "scripts/fixtures/parameter-catalog-allowlist/current-violations.json";

export type AllowlistIndex = {
  shards: AllowlistShard[];
  entries: AllowlistEntry[];
  entriesById: Map<string, AllowlistEntry>;
};

export async function loadAllowlistIndex(repoRoot: string): Promise<AllowlistIndex> {
  const shards: AllowlistShard[] = [];
  const entries: AllowlistEntry[] = [];
  const entriesById = new Map<string, AllowlistEntry>();

  for (const [family, root, file] of consumerShardDefinitions) {
    const relativePath = `${allowlistShardDirectory}/${file}`;
    const parsed = allowlistShardSchema.parse(await readJson(repoRoot, relativePath));
    if (parsed.family !== family || parsed.root !== root) {
      throw new Error(
        `Allow-list shard metadata mismatch for ${relativePath}: expected ${family} at ${root}, received ${parsed.family} at ${parsed.root}.`,
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

export async function loadBoundaryViolationFixture(repoRoot: string) {
  return boundaryViolationFixtureSchema.parse(await readJson(repoRoot, boundaryViolationFixturePath));
}

async function readJson(repoRoot: string, relativePath: string) {
  const absolutePath = resolve(repoRoot, relativePath);
  let contents: string;
  try {
    contents = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read required parameter-catalog allow-list artifact ${relativePath}.`, { cause: error });
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in parameter-catalog allow-list artifact ${relativePath}.`, { cause: error });
  }
}
