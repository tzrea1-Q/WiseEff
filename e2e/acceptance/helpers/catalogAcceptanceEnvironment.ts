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
const allowedIssues = new Set(["810", "815", "819", "820", "847", "853"]);

function catalogAcceptanceUrl(connectionString: string): URL {
  const inputUrl = new URL(connectionString);
  if (inputUrl.search || inputUrl.hash) {
    throw new Error("Catalog lane URLs cannot contain query parameters or a fragment.");
  }
  const url = assertCatalogLaneEvidenceUrl(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Catalog acceptance requires a loopback PostgreSQL server.");
  }
  return url;
}

async function verifyOwnedCatalogDatabase(
  url: URL,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  if (env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim()) {
    const descriptor = loadOwnedRuntimeDescriptorFromEnv(env);
    if (!descriptor) throw new Error("Catalog owned runtime descriptor is unavailable.");
    await verifyOwnedRuntimeOwnership(descriptor, env);
    if (url.pathname.slice(1) !== descriptor.database.name) {
      throw new Error("Catalog database differs from its verified owned runtime.");
    }
    return true;
  }
  if (env.WISEEFF_ACCEPTANCE_OWNED_RUNTIME === "true") {
    throw new Error("Catalog owned runtime requires a verifiable descriptor.");
  }
  return false;
}

export async function canonicalLaneConnectionString(
  issue: 898 | 905,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const connectionString = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (connectionString && env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim()) {
    await verifyOwnedCatalogDatabase(catalogAcceptanceUrl(connectionString), {
      ...env,
      DATABASE_URL: connectionString,
    });
    return connectionString;
  }
  if (env.WISEEFF_ACCEPTANCE_OWNED_RUNTIME === "true") {
    throw new Error("Catalog owned runtime requires a verifiable descriptor.");
  }
  if (!connectionString || new URL(connectionString).port !== String(DEFAULT_LANE_PORT)) {
    throw new Error(`Issue ${issue} requires the dedicated Catalog PostgreSQL lane on port 55438.`);
  }
  return connectionString;
}

/** Manual lanes are Issue-bound; Gate0 must prove its complete existing ownership contract. */
export async function catalogLaneConnectionString(
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const issue = env[CATALOG_ACCEPTANCE_ISSUE_ENV]?.trim() || "810";
  if (!allowedIssues.has(issue)) {
    throw new Error("Catalog acceptance requires an explicitly supported Issue lane (810, 815, 819, 820, 847, or 853).");
  }
  const connectionString = env.DATABASE_URL?.trim() || env.TEST_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Catalog acceptance requires a dedicated PostgreSQL lane URL.");
  // node-postgres accepts routing overrides in query parameters. Lane scripts
  // emit plain URLs; reject extensions before any ownership probe can connect.
  const url = catalogAcceptanceUrl(connectionString);
  if (await verifyOwnedCatalogDatabase(url, env)) return connectionString;
  if (Number(url.port) !== DEFAULT_LANE_PORT) {
    throw new Error("Catalog acceptance requires the dedicated loopback pgvector server on port 55438.");
  }
  const database = url.pathname.slice(1);
  if (database !== laneDatabaseName(Number(issue))) {
    throw new Error(`Catalog acceptance requires the exact dedicated lane for Issue ${issue}.`);
  }
  return connectionString;
}
