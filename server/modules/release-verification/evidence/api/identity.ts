import { digestOf } from "../../core/digest";
import type { VerificationPins } from "../../core/types";
import { catalogApiEvidenceRefusal } from "./errors";
import type {
  CatalogApiDispatchOutput,
  CatalogApiEvidenceQuery,
  CatalogApiEvidenceRefusal,
  CatalogApiRuntimeKind,
} from "./types";

const FORBIDDEN_CONTROL_KEYS = new Set([
  "gates",
  "gateIds",
  "gateList",
  "gateSelection",
  "waiver",
  "waive",
  "waived",
  "skip",
  "skipped",
  "skippedAsWaived",
]);

export type CatalogDatabaseIdentity = {
  readonly databaseName: string;
  readonly serverVersion: string;
  readonly serverAddr: string | null;
  readonly serverPort: number | null;
};

export const headerValue = (
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null => {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) {
      continue;
    }
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

export const readDatabaseIdentity = async (
  query: CatalogApiEvidenceQuery,
): Promise<CatalogDatabaseIdentity> => {
  const result = await query<CatalogDatabaseIdentity>(
    `select
       current_database() as "databaseName",
       current_setting('server_version') as "serverVersion",
       inet_server_addr()::text as "serverAddr",
       inet_server_port() as "serverPort"`,
  );
  const row = result.rows[0];
  if (!row?.databaseName) {
    throw new Error("database identity query returned no row");
  }
  return {
    databaseName: row.databaseName,
    serverVersion: row.serverVersion,
    serverAddr: row.serverAddr,
    serverPort: row.serverPort,
  };
};

export const databaseIdentityDigest = (identity: CatalogDatabaseIdentity): string => digestOf(identity);

export const readLiveCatalogPin = async (
  query: CatalogApiEvidenceQuery,
): Promise<{ readonly releaseId: string; readonly releaseDigest: string } | null> => {
  const result = await query<{
    current_catalog_release_id: string;
    release_digest: string;
  }>(
    `select
       state.current_catalog_release_id,
       release.release_digest
     from parameter_catalog.catalog_state state
     join parameter_catalog.catalog_releases release
       on release.id = state.current_catalog_release_id`,
  );
  const row = result.rows[0];
  if (!row?.current_catalog_release_id) {
    return null;
  }
  return { releaseId: row.current_catalog_release_id, releaseDigest: row.release_digest };
};

export const inspectMockRuntime = (
  kind: CatalogApiRuntimeKind,
): CatalogApiEvidenceRefusal | null => {
  const envMode = process.env.VITE_WISEEFF_RUNTIME_MODE?.trim().toLowerCase();
  if (kind === "mock" || envMode === "mock") {
    return catalogApiEvidenceRefusal("mock-runtime", "API evidence rejects mock runtime");
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const collectForbiddenKeys = (value: unknown, found: string[]): void => {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_CONTROL_KEYS.has(key)) {
      found.push(key);
    }
    collectForbiddenKeys(record[key], found);
  }
};

export const inspectCallerControl = (input: unknown): CatalogApiEvidenceRefusal | null => {
  const found: string[] = [];
  collectForbiddenKeys(input, found);
  if (found.length === 0) {
    return null;
  }
  return catalogApiEvidenceRefusal(
    "gate-selection-forbidden",
    `caller supplied ${found.join(",")}`,
  );
};

export const inspectPins = (
  pins: VerificationPins,
  liveCatalog: { readonly releaseId: string; readonly releaseDigest: string } | null,
  liveDatabaseDigest: string,
): CatalogApiEvidenceRefusal | null => {
  if (!liveCatalog) {
    return catalogApiEvidenceRefusal("stale-pins", "catalog pointer is not installed");
  }
  if (pins.catalog.releaseId !== liveCatalog.releaseId || pins.catalog.releaseDigest !== liveCatalog.releaseDigest) {
    return catalogApiEvidenceRefusal(
      "stale-pins",
      `catalog pin ${pins.catalog.releaseId}@${pins.catalog.releaseDigest} != live ${liveCatalog.releaseId}@${liveCatalog.releaseDigest}`,
    );
  }
  if (pins.database.targetIdentity !== liveDatabaseDigest) {
    return catalogApiEvidenceRefusal(
      "stale-pins",
      "database targetIdentity does not match live PostgreSQL identity",
    );
  }
  return null;
};

const bodyRequestId = (body: unknown): string | null => {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const requestId = error?.requestId;
  return typeof requestId === "string" && requestId.trim() ? requestId.trim() : null;
};

export const echoedRequestId = (output: CatalogApiDispatchOutput): string | null =>
  headerValue(output.headers, "X-Request-Id") ?? bodyRequestId(output.body);

export const inspectRequestId = (
  sent: string,
  output: CatalogApiDispatchOutput,
): CatalogApiEvidenceRefusal | null => {
  if (!sent.trim()) {
    return catalogApiEvidenceRefusal("missing-request-id", "capture request id is empty");
  }
  const echoed = echoedRequestId(output);
  if (!echoed) {
    return catalogApiEvidenceRefusal("missing-request-id", "response omitted request id");
  }
  if (echoed !== sent) {
    return catalogApiEvidenceRefusal(
      "missing-request-id",
      `response request id ${echoed} != capture ${sent}`,
    );
  }
  return null;
};

export const jsonReason = (body: unknown): string | null => {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const details = asRecord(error?.details);
  return typeof details?.reason === "string" ? details.reason : null;
};
