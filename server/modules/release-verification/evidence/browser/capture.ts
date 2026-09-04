import { digestOf } from "../../core/digest";
import { VerificationGateId, type TypedEvidenceRef } from "../../core/types";
import type { Result } from "../../../parameter-catalog-contract/index";
import { catalogBrowserEvidenceRefusal } from "./errors";
import {
  databaseIdentityDigest,
  inspectCallerControl,
  inspectMockRuntime,
  inspectPins,
  inspectPreP13,
  inspectViewportDiagnostics,
  readDatabaseIdentity,
  readLiveCatalogPin,
} from "./identity";
import {
  CATALOG_BROWSER_GATE_IDS,
  CATALOG_BROWSER_OPERATIONS,
  CATALOG_BROWSER_VIEWPORTS,
} from "./probes";
import type {
  CatalogBrowserAuditRef,
  CatalogBrowserEvidenceBundle,
  CatalogBrowserEvidenceCaptureInput,
  CatalogBrowserEvidenceRefusal,
  CatalogBrowserGateEvidence,
  CatalogBrowserViewportRecord,
} from "./types";

const PRODUCER = "s10-ui";

const readAuditRefs = async (
  input: CatalogBrowserEvidenceCaptureInput,
): Promise<readonly CatalogBrowserAuditRef[]> => {
  const result = await input.database<{ id: string; action: string }>(
    `select id, action
       from public.audit_events
      where organization_id = $1
      order by created_at desc
      limit 50`,
    [input.principal.organizationId],
  );
  return result.rows
    .filter((row): row is { id: string; action: string } => typeof row.id === "string" && typeof row.action === "string")
    .map((row) => ({ id: row.id, action: row.action }));
};

const observationsFor = (
  gateId: string,
  viewports: readonly CatalogBrowserViewportRecord[],
  auditRefs: readonly CatalogBrowserAuditRef[],
): Record<string, unknown> => {
  const catalogReleaseIds = viewports.flatMap((record) =>
    record.observation.network.exchanges
      .map((exchange) => exchange.catalogReleaseId)
      .filter((value): value is string => Boolean(value)),
  );
  const parity = viewports.map((record) => record.observation.parity).find((value) => value);
  return {
    viewportIds: viewports.map((record) => record.viewport),
    snapshotDigests: viewports.map((record) => record.observation.snapshotDigest),
    screenshotDigests: viewports.map((record) => record.observation.screenshotDigest),
    consoleErrorCount: viewports.reduce((sum, record) => sum + record.observation.console.errors.length, 0),
    pageErrorCount: viewports.reduce((sum, record) => sum + record.observation.console.pageErrors.length, 0),
    networkExchangeCount: viewports.reduce((sum, record) => sum + record.observation.network.exchanges.length, 0),
    candidateNetworkCount: viewports.reduce(
      (sum, record) =>
        sum + record.observation.network.exchanges.filter((exchange) => exchange.runtimeKind === "candidate").length,
      0,
    ),
    redactionStatus: viewports.every((record) => record.observation.redaction.status === "passed") ? "passed" : "failed",
    catalogReleaseIds,
    interactionCount: viewports.reduce((sum, record) => sum + record.observation.interactions.length, 0),
    catalogPageMounted: viewports.some((record) => record.observation.catalogPageMounted === true),
    operationId: CATALOG_BROWSER_OPERATIONS[gateId as keyof typeof CATALOG_BROWSER_OPERATIONS] ?? null,
    auditIds: auditRefs.map((ref) => ref.id),
    mockHasExtraPower: parity?.mockHasExtraPower ?? false,
    parityStatesRecorded: Boolean(parity),
  };
};

export const captureCatalogBrowserEvidence = async (
  input: CatalogBrowserEvidenceCaptureInput,
): Promise<Result<CatalogBrowserEvidenceBundle, CatalogBrowserEvidenceRefusal>> => {
  const callerControl = inspectCallerControl(input);
  if (callerControl) {
    return { ok: false, error: callerControl };
  }
  const mock = inspectMockRuntime(input.runtime.kind);
  if (mock) {
    return { ok: false, error: mock };
  }
  if (input.driver.kind !== "candidate") {
    return { ok: false, error: catalogBrowserEvidenceRefusal("mock-runtime", "driver is not a candidate") };
  }
  const preP13 = inspectPreP13(input.plan.lineage);
  if (preP13) {
    return { ok: false, error: preP13 };
  }

  let liveDatabase;
  try {
    liveDatabase = await readDatabaseIdentity(input.database);
  } catch (error) {
    return {
      ok: false,
      error: catalogBrowserEvidenceRefusal(
        "stale-pins",
        error instanceof Error ? error.message : "database identity query failed",
      ),
    };
  }
  const liveDatabaseDigest = databaseIdentityDigest(liveDatabase);
  const liveCatalog = await readLiveCatalogPin(input.database);
  const pinMismatch = inspectPins(input.plan.pins, liveCatalog, liveDatabaseDigest, input.runtime.candidateId);
  if (pinMismatch) {
    return { ok: false, error: pinMismatch };
  }

  const records: CatalogBrowserGateEvidence[] = [];
  const evidenceRefs: TypedEvidenceRef[] = [];

  for (const gateId of CATALOG_BROWSER_GATE_IDS) {
    const viewports: CatalogBrowserViewportRecord[] = [];
    for (const viewport of CATALOG_BROWSER_VIEWPORTS) {
      let observation;
      try {
        observation = await input.driver.collect({ gateId, viewport: viewport.id });
      } catch (error) {
        const detail =
          typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string"
            ? error.detail
            : error instanceof Error
              ? error.message
              : `missing ${gateId} ${viewport.id}`;
        return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", detail) };
      }
      const diagnosticError = inspectViewportDiagnostics(
        gateId,
        viewport.id,
        observation,
        input.plan.pins.catalog.releaseId,
      );
      if (diagnosticError) {
        return { ok: false, error: diagnosticError };
      }
      viewports.push({
        viewport: viewport.id,
        width: viewport.width,
        height: viewport.height,
        observation,
      });
    }
    records.push({
      gateId,
      operationId: CATALOG_BROWSER_OPERATIONS[gateId],
      viewports,
      databaseIdentity: liveDatabaseDigest,
      principalId: input.principal.principalId,
      organizationId: input.principal.organizationId,
      auditRefs: [],
      observations: {},
      pins: input.plan.pins,
      subject: input.plan.subject,
      phaseSnapshot: input.plan.lineage.phaseSnapshot,
      purpose: input.plan.purpose,
    });
  }

  if (records.length !== CATALOG_BROWSER_GATE_IDS.length) {
    return { ok: false, error: catalogBrowserEvidenceRefusal("incomplete-bundle", "missing UI gate records") };
  }

  const auditRefs = await readAuditRefs(input);
  const completed: CatalogBrowserGateEvidence[] = records.map((record) => {
    const observations = observationsFor(record.gateId, record.viewports, auditRefs);
    const completedRecord: CatalogBrowserGateEvidence = {
      ...record,
      auditRefs,
      observations,
    };
    evidenceRefs.push({
      gateId: VerificationGateId(record.gateId),
      digest: digestOf({
        producer: PRODUCER,
        gateId: record.gateId,
        operationId: record.operationId,
        viewports: completedRecord.viewports.map((viewport) => ({
          viewport: viewport.viewport,
          width: viewport.width,
          height: viewport.height,
          snapshotDigest: viewport.observation.snapshotDigest,
          screenshotDigest: viewport.observation.screenshotDigest,
          console: viewport.observation.console,
          network: viewport.observation.network,
          interactions: viewport.observation.interactions,
          redaction: viewport.observation.redaction,
        })),
        observations,
        auditRefs,
        databaseIdentity: liveDatabaseDigest,
        principalId: input.principal.principalId,
        pins: input.plan.pins,
      }),
      producer: PRODUCER,
      purpose: input.plan.purpose,
      subject: input.plan.subject,
      phaseSnapshot: input.plan.lineage.phaseSnapshot,
      pins: input.plan.pins,
    });
    return completedRecord;
  });

  return {
    ok: true,
    value: {
      candidateId: input.runtime.candidateId,
      targetIdentity: input.plan.pins.target.deploymentId,
      runtimeId: input.runtime.candidateId,
      databaseIdentity: liveDatabaseDigest,
      principalId: input.principal.principalId,
      organizationId: input.principal.organizationId,
      records: completed,
      evidenceRefs,
    },
  };
};

export const evaluateCatalogBrowserGate = (
  record: CatalogBrowserGateEvidence,
): { readonly passed: boolean; readonly failureCode: string | null } => {
  const failure = `${record.gateId}-FAILED`;
  const obs = record.observations;
  const viewportIds = Array.isArray(obs.viewportIds) ? (obs.viewportIds as string[]) : [];
  const snapshotDigests = Array.isArray(obs.snapshotDigests) ? (obs.snapshotDigests as string[]) : [];
  const screenshotDigests = Array.isArray(obs.screenshotDigests) ? (obs.screenshotDigests as string[]) : [];
  const catalogReleaseIds = Array.isArray(obs.catalogReleaseIds) ? (obs.catalogReleaseIds as string[]) : [];
  const passed =
    viewportIds.length === CATALOG_BROWSER_VIEWPORTS.length &&
    CATALOG_BROWSER_VIEWPORTS.every((viewport) => viewportIds.includes(viewport.id)) &&
    snapshotDigests.length === CATALOG_BROWSER_VIEWPORTS.length &&
    snapshotDigests.every((digest) => digest.startsWith("sha256:")) &&
    screenshotDigests.length === CATALOG_BROWSER_VIEWPORTS.length &&
    screenshotDigests.every((digest) => digest.startsWith("sha256:")) &&
    Number(obs.consoleErrorCount) === 0 &&
    Number(obs.pageErrorCount) === 0 &&
    Number(obs.networkExchangeCount) >= CATALOG_BROWSER_VIEWPORTS.length &&
    Number(obs.candidateNetworkCount) === Number(obs.networkExchangeCount) &&
    obs.redactionStatus === "passed" &&
    catalogReleaseIds.length > 0 &&
    catalogReleaseIds.every((id) => id === record.pins.catalog.releaseId) &&
    Number(obs.interactionCount) >= CATALOG_BROWSER_VIEWPORTS.length &&
    (record.gateId !== "PCAT-UI-13" || obs.mockHasExtraPower === false);
  return { passed, failureCode: passed ? null : failure };
};
