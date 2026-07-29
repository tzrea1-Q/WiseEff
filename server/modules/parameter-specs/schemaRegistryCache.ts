import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { loadSchemaRegistry } from "./schemaLoader";
import {
  mergePinnedRegistryWithOverlay,
  overlayDigest,
} from "./organizationDriverSchemaMaterialize";
import { listOrganizationDriverSchemas } from "./organizationDriverSchemaRepository";
import type { SchemaCatalog, SchemaRegistry } from "./types";

type PinnedCacheEntry = {
  contentHash: string;
  registry: SchemaRegistry;
};

type OrgCacheEntry = {
  contentHash: string;
  overlayDigest: string;
  registry: SchemaRegistry;
};

const pinnedCacheByRoot = new Map<string, PinnedCacheEntry>();
const orgCacheByKey = new Map<string, OrgCacheEntry>();

function readCatalogContentHash(schemasRoot: string): string {
  const catalog = JSON.parse(readFileSync(join(schemasRoot, "catalog.json"), "utf8")) as SchemaCatalog;
  return catalog.vendorContentHash;
}

function orgCacheKey(schemasRoot: string, organizationId: string): string {
  return `${schemasRoot}\u0000${organizationId}`;
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
 * Organization-aware registry: pinned schemas/dts plus active (and optionally
 * draft for read models that need them) org overlay drivers (ADR-0008).
 * Cache key is (organizationId, contentHash, overlayDigest).
 */
export async function getCachedOrganizationSchemaRegistry(
  db: Queryable,
  input: {
    schemasRoot: string;
    organizationId: string;
    /** Defaults to active-only — matching and coverage must ignore drafts. */
    includeDrafts?: boolean;
  },
): Promise<SchemaRegistry> {
  const pinned = getCachedSchemaRegistry(input.schemasRoot);
  const contentHash = pinned.catalog.vendorContentHash;
  const lifecycles = input.includeDrafts
    ? (["active", "draft"] as const)
    : (["active"] as const);
  let overlays: Awaited<ReturnType<typeof listOrganizationDriverSchemas>> = [];
  try {
    overlays = await listOrganizationDriverSchemas(db, {
      organizationId: input.organizationId,
      lifecycle: [...lifecycles],
    });
  } catch (error) {
    // Migration 0076 not applied yet — keep the modules page usable on pinned schemas only.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "42P01") throw error;
    return pinned;
  }
  const digest = createHash("sha256")
    .update(overlayDigest(overlays))
    .digest("hex");
  const key = orgCacheKey(input.schemasRoot, input.organizationId);
  const existing = orgCacheByKey.get(key);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.overlayDigest === digest &&
    !input.includeDrafts
  ) {
    return existing.registry;
  }
  const merged = mergePinnedRegistryWithOverlay(pinned, overlays);
  if (!input.includeDrafts) {
    orgCacheByKey.set(key, { contentHash, overlayDigest: digest, registry: merged });
  }
  return merged;
}

export function invalidateOrganizationSchemaRegistryCache(organizationId?: string): void {
  if (!organizationId) {
    orgCacheByKey.clear();
    return;
  }
  for (const key of [...orgCacheByKey.keys()]) {
    if (key.endsWith(`\u0000${organizationId}`)) {
      orgCacheByKey.delete(key);
    }
  }
}

export function clearSchemaRegistryCache(): void {
  pinnedCacheByRoot.clear();
  orgCacheByKey.clear();
}
