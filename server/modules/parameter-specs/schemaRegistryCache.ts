import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Queryable } from "../../shared/database/client";
import { loadSchemaRegistry } from "./schemaLoader";
import type { SchemaCatalog, SchemaRegistry } from "./types";

type PinnedCacheEntry = {
  contentHash: string;
  registry: SchemaRegistry;
};

const pinnedCacheByRoot = new Map<string, PinnedCacheEntry>();

function readCatalogContentHash(schemasRoot: string): string {
  const catalog = JSON.parse(readFileSync(join(schemasRoot, "catalog.json"), "utf8")) as SchemaCatalog;
  return catalog.vendorContentHash;
}

/**
 * Process-level schema registry cache keyed on catalog.vendorContentHash.
 * Ingest and parse-coverage lookups must share this instance so they cannot disagree (ADR-0007).
 */
export function getCachedSchemaRegistry(schemasRoot: string): SchemaRegistry {
  const contentHash = readCatalogContentHash(schemasRoot);
  const existing = pinnedCacheByRoot.get(schemasRoot);
  if (existing && existing.contentHash === contentHash) {
    return existing.registry;
  }
  const registry = loadSchemaRegistry(schemasRoot);
  pinnedCacheByRoot.set(schemasRoot, { contentHash, registry });
  return registry;
}

/**
 * Compatibility entry point for consumers of the shared pinned registry.
 * Historical organization and platform overlays are not runtime schema inputs.
 */
export async function getCachedOrganizationSchemaRegistry(
  _db: Queryable,
  input: {
    schemasRoot: string;
    organizationId: string;
    includeDrafts?: boolean;
  },
): Promise<SchemaRegistry> {
  return getCachedSchemaRegistry(input.schemasRoot);
}

export function invalidateOrganizationSchemaRegistryCache(_organizationId?: string): void {
  pinnedCacheByRoot.clear();
}

export async function invalidatePlatformSchemaRegistryCache(
  _db: Queryable,
  schemasRoot: string,
): Promise<void> {
  pinnedCacheByRoot.delete(schemasRoot);
}

export function clearSchemaRegistryCache(): void {
  pinnedCacheByRoot.clear();
}
