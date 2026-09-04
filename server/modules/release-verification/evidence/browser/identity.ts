import { digestOf } from "../../core/digest";
import type { VerificationLineage, VerificationPins } from "../../core/types";
import { catalogBrowserEvidenceRefusal } from "./errors";
import type { CatalogBrowserViewportId } from "./probes";
import type {
  CatalogBrowserEvidenceQuery,
  CatalogBrowserEvidenceRefusal,
  CatalogBrowserRuntimeKind,
  CatalogBrowserViewportObservation,
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

const PRE_P13_PHASE = /^(P1[0-3]([a-z].*)?|pre-activation)$/i;

export type CatalogDatabaseIdentity = {
  readonly databaseName: string;
  readonly serverVersion: string;
  readonly serverAddr: string | null;
  readonly serverPort: number | null;
};

export const readDatabaseIdentity = async (
  query: CatalogBrowserEvidenceQuery,
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
  query: CatalogBrowserEvidenceQuery,
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
  kind: CatalogBrowserRuntimeKind,
): CatalogBrowserEvidenceRefusal | null => {
  const envMode = process.env.VITE_WISEEFF_RUNTIME_MODE?.trim().toLowerCase();
  if (kind === "mock" || envMode === "mock") {
    return catalogBrowserEvidenceRefusal("mock-runtime", "browser evidence rejects mock runtime");
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

export const inspectCallerControl = (input: unknown): CatalogBrowserEvidenceRefusal | null => {
  const found: string[] = [];
  collectForbiddenKeys(input, found);
  if (found.length === 0) {
    return null;
  }
  return catalogBrowserEvidenceRefusal("gate-selection-forbidden", `caller supplied ${found.join(",")}`);
};

export const inspectPins = (
  pins: VerificationPins,
  liveCatalog: { readonly releaseId: string; readonly releaseDigest: string } | null,
  liveDatabaseDigest: string,
  candidateId: string,
): CatalogBrowserEvidenceRefusal | null => {
  if (!liveCatalog) {
    return catalogBrowserEvidenceRefusal("stale-pins", "catalog pointer is not installed");
  }
  if (pins.catalog.releaseId !== liveCatalog.releaseId || pins.catalog.releaseDigest !== liveCatalog.releaseDigest) {
    return catalogBrowserEvidenceRefusal(
      "stale-pins",
      `catalog pin ${pins.catalog.releaseId}@${pins.catalog.releaseDigest} != live ${liveCatalog.releaseId}@${liveCatalog.releaseDigest}`,
    );
  }
  if (pins.database.targetIdentity !== liveDatabaseDigest) {
    return catalogBrowserEvidenceRefusal(
      "stale-pins",
      "database targetIdentity does not match live PostgreSQL identity",
    );
  }
  if (candidateId !== pins.artifact.webImageDigest) {
    return catalogBrowserEvidenceRefusal(
      "stale-pins",
      `web candidate ${candidateId} != pin ${pins.artifact.webImageDigest}`,
    );
  }
  return null;
};

export const inspectPreP13 = (
  lineage: Pick<
    VerificationLineage,
    | "p12State"
    | "p13State"
    | "writerRetirementFingerprint"
    | "phaseSnapshot"
    | "trafficIsolationState"
    | "runtimePinGeneration"
  >,
): CatalogBrowserEvidenceRefusal | null => {
  if (lineage.p12State !== "retired" || lineage.p13State !== "retired") {
    return catalogBrowserEvidenceRefusal(
      "pre-p13",
      `P13 is not retired (p12=${lineage.p12State}, p13=${lineage.p13State})`,
    );
  }
  if (!lineage.writerRetirementFingerprint?.trim()) {
    return catalogBrowserEvidenceRefusal("pre-p13", "writer retirement fingerprint is missing");
  }
  if (!lineage.runtimePinGeneration?.trim()) {
    return catalogBrowserEvidenceRefusal("pre-p13", "post-retirement runtime pin generation is missing");
  }
  if (PRE_P13_PHASE.test(lineage.phaseSnapshot.trim())) {
    return catalogBrowserEvidenceRefusal("pre-p13", `phase ${lineage.phaseSnapshot} is pre-P13 traffic`);
  }
  if (lineage.trafficIsolationState !== "isolated") {
    return catalogBrowserEvidenceRefusal("pre-p13", "public traffic is not isolated candidate acceptance");
  }
  return null;
};

const REDACTED = "[redacted]";

const unredactedSecret = (text: string): string | null => {
  if (/\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/-]+=*/i.test(text)) {
    return "bearer-token";
  }
  if (/\bauthorization\s*[:=]\s*(?!\[redacted\])\S+/i.test(text)) {
    return "authorization-header";
  }
  if (/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*(?!\[redacted\])\S+/i.test(text)) {
    return "secret-field";
  }
  if (/postgres:\/\/[^\s]+/i.test(text)) {
    return "postgres-url";
  }
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._~+/-]+/i.test(text)) {
    return "jwt";
  }
  if (text.includes(REDACTED)) {
    return null;
  }
  return null;
};

const observationCorpus = (observation: CatalogBrowserViewportObservation): readonly string[] => [
  ...observation.console.errors,
  ...observation.console.pageErrors,
  ...observation.network.exchanges.map((exchange) => exchange.summary),
  ...observation.interactions.map((interaction) => `${interaction.name} ${interaction.outcome}`),
];

export const inspectRedaction = (
  gateId: string,
  viewport: CatalogBrowserViewportId,
  observation: CatalogBrowserViewportObservation,
): CatalogBrowserEvidenceRefusal | null => {
  if (observation.redaction.status !== "passed") {
    return catalogBrowserEvidenceRefusal(
      "redaction-failed",
      `${gateId} ${viewport} redaction status is ${observation.redaction.status}`,
    );
  }
  for (const text of observationCorpus(observation)) {
    const secret = unredactedSecret(text);
    if (secret) {
      return catalogBrowserEvidenceRefusal(
        "redaction-failed",
        `${gateId} ${viewport} leaked ${secret}`,
      );
    }
  }
  return null;
};

export const inspectViewportDiagnostics = (
  gateId: string,
  viewport: CatalogBrowserViewportId,
  observation: CatalogBrowserViewportObservation,
  catalogReleaseId: string,
): CatalogBrowserEvidenceRefusal | null => {
  const hasScreenshot = Boolean(observation.screenshotDigest.trim());
  const hasSnapshot = Boolean(observation.snapshotDigest.trim());
  const hasConsole = Boolean(observation.console);
  const hasNetwork = observation.network.exchanges.length > 0;
  if (hasScreenshot && (!hasSnapshot || !hasConsole || !hasNetwork)) {
    return catalogBrowserEvidenceRefusal(
      "screenshot-only",
      `${gateId} ${viewport} is screenshot-only`,
    );
  }
  if (!hasScreenshot || !hasSnapshot || !hasConsole || !hasNetwork) {
    return catalogBrowserEvidenceRefusal(
      "incomplete-bundle",
      `${gateId} ${viewport} missing snapshot, screenshot, console, or network`,
    );
  }
  if (observation.network.exchanges.some((exchange) => exchange.runtimeKind === "mock")) {
    return catalogBrowserEvidenceRefusal("mock-runtime", `${gateId} ${viewport} network bound to mock runtime`);
  }
  const candidate = observation.network.exchanges.find(
    (exchange) =>
      exchange.runtimeKind === "candidate" &&
      Boolean(exchange.requestId?.trim()) &&
      Boolean(exchange.catalogReleaseId?.trim()),
  );
  if (!candidate) {
    return catalogBrowserEvidenceRefusal(
      "incomplete-bundle",
      `${gateId} ${viewport} missing candidate API identity`,
    );
  }
  if (candidate.catalogReleaseId !== catalogReleaseId) {
    return catalogBrowserEvidenceRefusal(
      "stale-pins",
      `${gateId} ${viewport} catalog release ${candidate.catalogReleaseId} != pin ${catalogReleaseId}`,
    );
  }
  return inspectRedaction(gateId, viewport, observation);
};
