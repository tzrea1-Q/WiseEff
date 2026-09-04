import type { Result } from "../../../parameter-catalog-contract/index";
import { catalogBrowserEvidenceRefusal } from "./errors";
import {
  CATALOG_BROWSER_GATE_IDS,
  CATALOG_BROWSER_VIEWPORT_IDS,
  type CatalogBrowserViewportId,
} from "./probes";
import type {
  CatalogBrowserEvidenceRefusal,
  CatalogBrowserEvidenceSource,
  CatalogBrowserInteraction,
  CatalogBrowserNetworkExchange,
  CatalogBrowserRuntimeKind,
  CatalogBrowserSourceRecord,
  CatalogBrowserViewportObservation,
} from "./types";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const parseRuntimeKind = (value: unknown): CatalogBrowserRuntimeKind | null =>
  value === "candidate" || value === "mock" ? value : null;

const parseStringArray = (value: unknown): readonly string[] | null => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return value;
};

const parseExchanges = (value: unknown): readonly CatalogBrowserNetworkExchange[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const exchanges: CatalogBrowserNetworkExchange[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      return null;
    }
    const method = asString(record.method);
    const path = asString(record.path);
    const runtimeKind = parseRuntimeKind(record.runtimeKind);
    const summary = asString(record.summary);
    if (!method || !path || !runtimeKind || summary === null || typeof record.status !== "number") {
      return null;
    }
    exchanges.push({
      method,
      path,
      status: record.status,
      requestId: asString(record.requestId),
      catalogReleaseId: asString(record.catalogReleaseId),
      runtimeKind,
      summary,
    });
  }
  return exchanges;
};

const parseObservation = (value: unknown): CatalogBrowserViewportObservation | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const snapshotDigest = asString(record.snapshotDigest);
  const screenshotDigest = asString(record.screenshotDigest);
  const consoleRecord = asRecord(record.console);
  const networkRecord = asRecord(record.network);
  const redactionRecord = asRecord(record.redaction);
  const browserRecord = asRecord(record.browser);
  if (
    snapshotDigest === null ||
    screenshotDigest === null ||
    !consoleRecord ||
    !networkRecord ||
    !redactionRecord ||
    !browserRecord
  ) {
    return null;
  }
  const errors = parseStringArray(consoleRecord.errors);
  const pageErrors = parseStringArray(consoleRecord.pageErrors);
  const exchanges = parseExchanges(networkRecord.exchanges);
  const browserName = asString(browserRecord.name);
  const browserVersion = asString(browserRecord.version);
  const redactionStatus = redactionRecord.status === "passed" || redactionRecord.status === "failed"
    ? redactionRecord.status
    : null;
  const policy = asString(redactionRecord.policy);
  const version = asString(redactionRecord.version);
  if (
    !errors ||
    !pageErrors ||
    !exchanges ||
    !browserName ||
    !browserVersion ||
    !redactionStatus ||
    !policy ||
    !version ||
    !Array.isArray(record.interactions)
  ) {
    return null;
  }
  const interactions: CatalogBrowserInteraction[] = [];
  for (const entry of record.interactions) {
    const interaction = asRecord(entry);
    const name = asString(interaction?.name);
    const outcome = asString(interaction?.outcome);
    if (!name || !outcome) {
      return null;
    }
    interactions.push({ name, outcome });
  }
  const parityRecord = record.parity === undefined ? undefined : asRecord(record.parity);
  if (record.parity !== undefined && !parityRecord) {
    return null;
  }
  const apiStates = parityRecord ? parseStringArray(parityRecord.apiStates) : undefined;
  const mockStates = parityRecord ? parseStringArray(parityRecord.mockStates) : undefined;
  if (parityRecord && (apiStates === undefined || mockStates === undefined || typeof parityRecord.mockHasExtraPower !== "boolean")) {
    return null;
  }
  return {
    snapshotDigest,
    screenshotDigest,
    console: { errors, pageErrors },
    network: { exchanges },
    interactions,
    redaction: { status: redactionStatus, policy, version },
    browser: { name: browserName, version: browserVersion },
    catalogPageMounted: record.catalogPageMounted === true,
    parity: parityRecord
      ? {
          mockHasExtraPower: parityRecord.mockHasExtraPower as boolean,
          apiStates: apiStates ?? [],
          mockStates: mockStates ?? [],
        }
      : undefined,
  };
};

const parseViewports = (
  value: unknown,
): Readonly<Record<CatalogBrowserViewportId, CatalogBrowserViewportObservation>> | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const viewports = {} as Record<CatalogBrowserViewportId, CatalogBrowserViewportObservation>;
  for (const viewport of CATALOG_BROWSER_VIEWPORT_IDS) {
    const observation = parseObservation(record[viewport]);
    if (!observation) {
      return null;
    }
    viewports[viewport] = observation;
  }
  return viewports;
};

export const parseCatalogBrowserEvidenceSource = (
  value: unknown,
): Result<CatalogBrowserEvidenceSource, CatalogBrowserEvidenceRefusal> => {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "S9-BRW source is not an object") };
  }
  if (record.producer !== "s9-brw") {
    return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "S9-BRW producer is required") };
  }
  const runtimeKind = parseRuntimeKind(record.runtimeKind);
  const candidateId = asString(record.candidateId);
  if (!runtimeKind || !candidateId) {
    return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "S9-BRW runtime identity is missing") };
  }
  if (!Array.isArray(record.records)) {
    return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "S9-BRW records are missing") };
  }
  const records: CatalogBrowserSourceRecord[] = [];
  for (const entry of record.records) {
    const item = asRecord(entry);
    const gateId = asString(item?.gateId);
    const operationId = asString(item?.operationId);
    const viewports = parseViewports(item?.viewports);
    if (!gateId || !operationId || !viewports) {
      return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "S9-BRW record is malformed") };
    }
    if (!(CATALOG_BROWSER_GATE_IDS as readonly string[]).includes(gateId)) {
      return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", `unknown gate ${gateId}`) };
    }
    records.push({ gateId, operationId, viewports });
  }
  return {
    ok: true,
    value: {
      producer: "s9-brw",
      runtimeKind,
      candidateId,
      records,
    },
  };
};
