import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { Queryable } from "../../shared/database/client";
import { loadSchemaRegistry } from "./schemaLoader";
import {
  mergePinnedRegistryWithOverlay,
  overlayDigest,
  platformOverlayDigest,
} from "./driverSchemaOverlayMaterialize";
import {
  listActivePlatformDriverSchemaOverlays,
  listOrganizationDriverSchemas,
} from "./driverSchemaOverlayRepository";
import type { SchemaCatalog, SchemaRegistry } from "./types";

type PinnedCacheEntry = {
  contentHash: string;
  registry: SchemaRegistry;
};

type OrgCacheEntry = {
  contentHash: string;
  platformOverlayDigest: string;
  overlayDigest: string;
  registry: SchemaRegistry;
};

const pinnedCacheByRoot = new Map<string, PinnedCacheEntry>();
const orgCacheByKey = new Map<string, OrgCacheEntry>();
let cachedPlatformOverlayDigest = "";
let cachedPlatformOverlaySchemasRoot: string | null = null;

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

async function loadPlatformOverlayDigest(db: Queryable, schemasRoot: string): Promise<string> {
  try {
    const overlays = await listActivePlatformDriverSchemaOverlays(db);
    return createHash("sha256").update(platformOverlayDigest(overlays)).digest("hex");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "42P01") return "";
    throw error;
  }
}

/**
 * Organization-aware registry: pinned schemas/dts plus active platform and org overlays.
 * Cache key is (organizationId, contentHash, platformOverlayDigest, orgOverlayDigest).
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

  let platformOverlays: Awaited<ReturnType<typeof listActivePlatformDriverSchemaOverlays>> = [];
  let orgOverlays: Awaited<ReturnType<typeof listOrganizationDriverSchemas>> = [];
  try {
    platformOverlays = await listActivePlatformDriverSchemaOverlays(db);
    orgOverlays = await listOrganizationDriverSchemas(db, {
      organizationId: input.organizationId,
      lifecycle: [...lifecycles],
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code !== "42P01") throw error;
    return pinned;
  }

  const platformDigest = createHash("sha256")
    .update(platformOverlayDigest(platformOverlays))
    .digest("hex");
  const orgDigest = createHash("sha256").update(overlayDigest(orgOverlays)).digest("hex");
  const key = orgCacheKey(input.schemasRoot, input.organizationId);
  const existing = orgCacheByKey.get(key);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.platformOverlayDigest === platformDigest &&
    existing.overlayDigest === orgDigest &&
    !input.includeDrafts
  ) {
    return existing.registry;
  }
  const merged = mergePinnedRegistryWithOverlay(pinned, [...platformOverlays, ...orgOverlays]);
  if (!input.includeDrafts) {
    orgCacheByKey.set(key, {
      contentHash,
      platformOverlayDigest: platformDigest,
      overlayDigest: orgDigest,
      registry: merged,
    });
  }
  cachedPlatformOverlayDigest = platformDigest;
  cachedPlatformOverlaySchemasRoot = input.schemasRoot;
  return merged;
}

export function invalidateOrganizationSchemaRegistryCache(organizationId?: string): void {
  if (!organizationId) {
    orgCacheByKey.clear();
    cachedPlatformOverlayDigest = "";
    cachedPlatformOverlaySchemasRoot = null;
    return;
  }
  for (const key of [...orgCacheByKey.keys()]) {
    if (key.endsWith(`\u0000${organizationId}`)) {
      orgCacheByKey.delete(key);
    }
  }
}

/** Platform-tier overlay changes invalidate every organization's cached registry. */
export async function invalidatePlatformSchemaRegistryCache(
  db: Queryable,
  schemasRoot: string,
): Promise<void> {
  const nextDigest = await loadPlatformOverlayDigest(db, schemasRoot);
  if (
    cachedPlatformOverlaySchemasRoot === schemasRoot &&
    cachedPlatformOverlayDigest === nextDigest &&
    orgCacheByKey.size > 0
  ) {
    orgCacheByKey.clear();
    cachedPlatformOverlayDigest = nextDigest;
    return;
  }
  orgCacheByKey.clear();
  cachedPlatformOverlayDigest = nextDigest;
  cachedPlatformOverlaySchemasRoot = schemasRoot;
}

export function clearSchemaRegistryCache(): void {
  pinnedCacheByRoot.clear();
  orgCacheByKey.clear();
  cachedPlatformOverlayDigest = "";
  cachedPlatformOverlaySchemasRoot = null;
}
