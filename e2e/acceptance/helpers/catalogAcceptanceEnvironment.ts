import {
  assertCatalogLaneEvidenceUrl,
  DEFAULT_LANE_PORT,
  laneDatabaseName,
} from "../../../scripts/catalog-lane-env";
import {
  loadOwnedRuntimeDescriptorFromEnv,
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  verifyOwnedRuntimeOwnership,
} from "./ownedRuntimeDescriptor";

export const CATALOG_ACCEPTANCE_ISSUE_ENV = "WISEEFF_CATALOG_ACCEPTANCE_ISSUE";
const allowedIssues = new Set(["810", "819", "820"]);

/** Manual lanes are Issue-bound; Gate0 must prove its complete existing ownership contract. */
export async function catalogLaneConnectionString(
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const issue = env[CATALOG_ACCEPTANCE_ISSUE_ENV]?.trim() || "810";
  if (!allowedIssues.has(issue)) {
    throw new Error("Catalog acceptance requires an explicitly supported Issue lane (810, 819, or 820).");
  }
  const connectionString = env.DATABASE_URL?.trim() || env.TEST_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Catalog acceptance requires a dedicated PostgreSQL lane URL.");
  const url = assertCatalogLaneEvidenceUrl(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || Number(url.port) !== DEFAULT_LANE_PORT) {
    throw new Error("Catalog acceptance requires the dedicated loopback pgvector server on port 55438.");
  }
  const database = url.pathname.slice(1);
  if (env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim()) {
    const descriptor = loadOwnedRuntimeDescriptorFromEnv(env);
    if (!descriptor) throw new Error("Catalog owned runtime descriptor is unavailable.");
    await verifyOwnedRuntimeOwnership(descriptor, env);
    if (database !== descriptor.database.name) throw new Error("Catalog database differs from its verified owned runtime.");
    return connectionString;
  }
  if (env.WISEEFF_ACCEPTANCE_OWNED_RUNTIME === "true") {
    throw new Error("Catalog owned runtime requires a verifiable descriptor.");
  }
  if (database !== laneDatabaseName(Number(issue))) {
    throw new Error(`Catalog acceptance requires the exact dedicated lane for Issue ${issue}.`);
  }
  return connectionString;
}
