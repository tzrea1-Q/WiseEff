import { randomUUID } from "node:crypto";

import {
  CATALOG_DEPRECATION_HEADER,
  CATALOG_ETAG_HEADER,
  CATALOG_LINK_HEADER,
  CATALOG_RELEASE_HEADER,
  CATALOG_SUNSET_HEADER,
  parameterCatalogKernelReadByRouteId,
} from "../../../contracts/dtoSchemas/parameterCatalog";
import type { Result } from "../../../parameter-catalog-contract/index";
import { digestOf } from "../../core/digest";
import { VerificationGateId, type TypedEvidenceRef } from "../../core/types";
import { catalogApiEvidenceRefusal } from "./errors";
import {
  databaseIdentityDigest,
  headerValue,
  inspectCallerControl,
  inspectMockRuntime,
  inspectPins,
  inspectRequestId,
  jsonReason,
  readDatabaseIdentity,
  readLiveCatalogPin,
} from "./identity";
import { CATALOG_API_GATE_IDS, CATALOG_API_PROBE_CONTEXT, kernelReadRouteIds, probesFor } from "./probes";
import type {
  CatalogApiAuditRef,
  CatalogApiEvidenceBundle,
  CatalogApiEvidenceCaptureInput,
  CatalogApiEvidenceRefusal,
  CatalogApiGateEvidence,
  CatalogApiHttpExchange,
} from "./types";

const PRODUCER = "s10-api";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const itemRecord = (body: unknown): Record<string, unknown> | null => {
  const record = asRecord(body);
  return asRecord(record?.item);
};

const containsKey = (value: unknown, key: string): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsKey(entry, key));
  }
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, key)) {
    return true;
  }
  return Object.values(record).some((entry) => containsKey(entry, key));
};

const readAuditRefs = async (
  input: CatalogApiEvidenceCaptureInput,
): Promise<readonly CatalogApiAuditRef[]> => {
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

const readRegistrationPair = async (
  input: CatalogApiEvidenceCaptureInput,
): Promise<{ registrations: number; placements: number }> => {
  const result = await input.database<{ registrations: string; placements: string }>(
    `select
       (select count(*)::text
          from parameter_catalog.organization_subject_registrations
         where organization_id = $1) as registrations,
       (select count(*)::text
          from parameter_catalog.subject_placements
         where organization_id = $1) as placements`,
    [input.principal.organizationId],
  );
  const row = result.rows[0];
  return {
    registrations: Number(row?.registrations ?? 0),
    placements: Number(row?.placements ?? 0),
  };
};

const observationsFor = (
  gateId: string,
  exchanges: readonly CatalogApiHttpExchange[],
  bodyByExchange: ReadonlyMap<string, unknown>,
  pair: { registrations: number; placements: number },
  auditRefs: readonly CatalogApiAuditRef[],
): Record<string, unknown> => {
  const byId = new Map(exchanges.map((exchange) => [exchange.exchangeId, exchange]));
  const bodyOf = (id: string) => bodyByExchange.get(id);
  switch (gateId) {
    case "PCAT-API-01": {
      const ready = byId.get("catalog-ready");
      const item = itemRecord(bodyOf("catalog-ready"));
      return {
        readyStatus: ready?.status ?? null,
        catalogStatus: item?.status ?? null,
        digest: item?.digest ?? null,
        materializationFingerprint: item?.materializationFingerprint ?? null,
        releaseHeader: ready?.catalogReleaseId ?? null,
        unauthenticatedStatus: byId.get("catalog-unauthenticated")?.status ?? null,
      };
    }
    case "PCAT-API-02":
      return {
        listStatus: byId.get("list-subjects")?.status ?? null,
        hiddenStatus: byId.get("hidden-subject")?.status ?? null,
        hiddenReason: byId.get("hidden-subject")?.reason ?? null,
        spoofStatus: byId.get("spoof-list-subjects")?.status ?? null,
      };
    case "PCAT-API-03":
      return {
        revisionsStatus: byId.get("list-revisions")?.status ?? null,
        missingRevisionStatus: byId.get("missing-revision")?.status ?? null,
        timelineStatus: byId.get("timeline")?.status ?? null,
      };
    case "PCAT-API-04":
      return {
        createStatus: byId.get("create-registration")?.status ?? null,
        etag: byId.get("create-registration")?.etag ?? null,
        registrations: pair.registrations,
        placements: pair.placements,
        auditIds: auditRefs.map((ref) => ref.id),
      };
    case "PCAT-API-05":
      return {
        listStatus: byId.get("list-review-items")?.status ?? null,
        unauthenticatedStatus: byId.get("review-unauthenticated")?.status ?? null,
      };
    case "PCAT-API-06":
      return {
        createStatus: byId.get("create-proposal")?.status ?? null,
        etag: byId.get("create-proposal")?.etag ?? null,
        proposalAudit: auditRefs.filter((ref) => ref.action.startsWith("proposal-")).map((ref) => ref.id),
      };
    case "PCAT-API-07":
      return {
        lookupStatus: byId.get("legacy-lookup")?.status ?? null,
        lookupReason: byId.get("legacy-lookup")?.reason ?? null,
      };
    case "PCAT-API-08":
      return {
        writeStatus: byId.get("legacy-write-gone")?.status ?? null,
        writeReason: byId.get("legacy-write-gone")?.reason ?? null,
        deprecation: byId.get("legacy-write-gone")?.deprecation ?? byId.get("legacy-read-headers")?.deprecation,
        sunset: byId.get("legacy-read-headers")?.sunset ?? null,
        link: byId.get("legacy-write-gone")?.link ?? byId.get("legacy-read-headers")?.link,
      };
    case "PCAT-API-09":
      return {
        agentReadStatus: byId.get("agent-read")?.status ?? null,
        agentWriteStatus: byId.get("agent-write")?.status ?? null,
        spoofStatus: byId.get("spoof-write")?.status ?? null,
      };
    case "PCAT-API-10":
      return {
        driftStatus: byId.get("release-drift")?.status ?? null,
        driftReason: byId.get("release-drift")?.reason ?? null,
        missingIdempotencyStatus: byId.get("missing-idempotency")?.status ?? null,
        staleIfMatchStatus: byId.get("stale-if-match")?.status ?? null,
      };
    case "PCAT-API-11":
      return {
        kernelRouteIds: kernelReadRouteIds,
        kernelRouteCount: Object.keys(parameterCatalogKernelReadByRouteId).length,
        capturedRouteIds: exchanges.map((exchange) => exchange.exchangeId),
      };
    case "PCAT-API-12": {
      const listBody = bodyOf("list-bindings");
      return {
        listStatus: byId.get("list-bindings")?.status ?? null,
        historyStatus: byId.get("binding-history")?.status ?? null,
        unauthenticatedStatus: byId.get("binding-unauthenticated")?.status ?? null,
        legacySpecIdentityPresent: containsKey(listBody, "parameterSpecId"),
        definitionIdPresent: containsKey(listBody, "definitionId"),
        effectiveRevisionIdPresent: containsKey(listBody, "effectiveRevisionId"),
        currentValueIdPresent: containsKey(listBody, "currentValueId"),
      };
    }
    default:
      return {};
  }
};

export const captureCatalogApiEvidence = async (
  input: CatalogApiEvidenceCaptureInput,
): Promise<Result<CatalogApiEvidenceBundle, CatalogApiEvidenceRefusal>> => {
  const callerControl = inspectCallerControl(input);
  if (callerControl) {
    return { ok: false, error: callerControl };
  }
  const mock = inspectMockRuntime(input.runtime.kind);
  if (mock) {
    return { ok: false, error: mock };
  }
  if (input.driver.kind !== "candidate") {
    return { ok: false, error: catalogApiEvidenceRefusal("mock-runtime", "driver is not a candidate") };
  }

  let liveDatabase;
  try {
    liveDatabase = await readDatabaseIdentity(input.database);
  } catch (error) {
    return {
      ok: false,
      error: catalogApiEvidenceRefusal(
        "stale-pins",
        error instanceof Error ? error.message : "database identity query failed",
      ),
    };
  }
  const liveDatabaseDigest = databaseIdentityDigest(liveDatabase);
  const liveCatalog = await readLiveCatalogPin(input.database);
  const pinMismatch = inspectPins(input.plan.pins, liveCatalog, liveDatabaseDigest);
  if (pinMismatch) {
    return { ok: false, error: pinMismatch };
  }

  const probeContext = {
    organizationId: input.principal.organizationId,
    catalogReleaseId: input.plan.pins.catalog.releaseId,
    subjectId: input.probeContext?.subjectId ?? CATALOG_API_PROBE_CONTEXT.subjectId,
    definitionId: input.probeContext?.definitionId ?? CATALOG_API_PROBE_CONTEXT.definitionId,
    revisionId: input.probeContext?.revisionId ?? CATALOG_API_PROBE_CONTEXT.revisionId,
    projectId: input.probeContext?.projectId ?? CATALOG_API_PROBE_CONTEXT.projectId,
  };
  const probes = probesFor(probeContext);
  const records: CatalogApiGateEvidence[] = [];
  const evidenceRefs: TypedEvidenceRef[] = [];
  const bodyByGate = new Map<string, Map<string, unknown>>();

  for (const gateId of CATALOG_API_GATE_IDS) {
    const exchanges: CatalogApiHttpExchange[] = [];
    const bodies = new Map<string, unknown>();
    for (const probe of probes[gateId]) {
      const requestId = `s10api_${gateId}_${probe.exchangeId}_${randomUUID()}`;
      const output = await input.driver.dispatch({
        method: probe.method,
        path: probe.path,
        headers: probe.headers,
        body: probe.body,
        requestId,
        principal: probe.principal,
      });
      const requestIdError = inspectRequestId(requestId, output);
      if (requestIdError) {
        return { ok: false, error: requestIdError };
      }
      const exchange: CatalogApiHttpExchange = {
        exchangeId: probe.exchangeId,
        requestId,
        method: probe.method,
        path: probe.path,
        principal: probe.principal,
        status: output.status,
        headers: output.headers,
        bodyDigest: digestOf(output.body ?? null),
        catalogReleaseId: headerValue(output.headers, CATALOG_RELEASE_HEADER),
        etag: headerValue(output.headers, CATALOG_ETAG_HEADER) ?? headerValue(output.headers, "etag"),
        deprecation: headerValue(output.headers, CATALOG_DEPRECATION_HEADER),
        sunset: headerValue(output.headers, CATALOG_SUNSET_HEADER),
        link: headerValue(output.headers, CATALOG_LINK_HEADER),
        reason: jsonReason(output.body),
      };
      exchanges.push(exchange);
      bodies.set(probe.exchangeId, output.body);
    }
    bodyByGate.set(gateId, bodies);
    const authorizationNegatives = exchanges.filter(
      (exchange) =>
        exchange.principal !== "authorized" ||
        exchange.status === 401 ||
        exchange.status === 403,
    );
    records.push({
      gateId,
      exchanges,
      authorizationNegatives,
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

  const auditRefs = await readAuditRefs(input);
  const pair = await readRegistrationPair(input);
  const completed: CatalogApiGateEvidence[] = records.map((record) => {
    const observations = observationsFor(
      record.gateId,
      record.exchanges,
      bodyByGate.get(record.gateId) ?? new Map(),
      pair,
      auditRefs,
    );
    const gateAudit =
      record.gateId === "PCAT-API-06"
        ? auditRefs.filter((ref) => ref.action.startsWith("proposal-"))
        : record.gateId === "PCAT-API-04" || record.gateId === "PCAT-API-05" || record.gateId === "PCAT-API-08"
          ? auditRefs
          : [];
    const completedRecord: CatalogApiGateEvidence = {
      ...record,
      auditRefs: gateAudit,
      observations,
    };
    evidenceRefs.push({
      gateId: VerificationGateId(record.gateId),
      digest: digestOf({
        producer: PRODUCER,
        gateId: record.gateId,
        exchanges: completedRecord.exchanges,
        observations,
        auditRefs: gateAudit,
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

  if (completed.length !== CATALOG_API_GATE_IDS.length) {
    return { ok: false, error: catalogApiEvidenceRefusal("incomplete-bundle", "missing API gate records") };
  }

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

export const evaluateCatalogApiGate = (
  record: CatalogApiGateEvidence,
): { readonly passed: boolean; readonly failureCode: string | null } => {
  const failure = `${record.gateId}-FAILED`;
  const obs = record.observations;
  const passed = (() => {
    switch (record.gateId) {
      case "PCAT-API-01":
        return (
          obs.readyStatus === 200 &&
          obs.catalogStatus === "ready" &&
          typeof obs.digest === "string" &&
          String(obs.digest).startsWith("sha256:") &&
          typeof obs.materializationFingerprint === "string" &&
          String(obs.materializationFingerprint).length > 0 &&
          typeof obs.releaseHeader === "string" &&
          obs.unauthenticatedStatus === 401
        );
      case "PCAT-API-02":
        return obs.listStatus === 200 && obs.hiddenStatus === 404 && obs.spoofStatus === 200;
      case "PCAT-API-03":
        return (
          obs.revisionsStatus === 200 &&
          obs.missingRevisionStatus === 404 &&
          obs.timelineStatus === 200
        );
      case "PCAT-API-04":
        return (
          obs.createStatus === 201 &&
          Number(obs.registrations) >= 1 &&
          Number(obs.placements) === Number(obs.registrations)
        );
      case "PCAT-API-05":
        return obs.listStatus === 200 && obs.unauthenticatedStatus === 401;
      case "PCAT-API-06":
        return obs.createStatus === 201 && Array.isArray(obs.proposalAudit) && obs.proposalAudit.length > 0;
      case "PCAT-API-07":
        return [200, 404, 409, 410].includes(Number(obs.lookupStatus));
      case "PCAT-API-08":
        return obs.writeStatus === 410 && (obs.deprecation === "true" || typeof obs.link === "string");
      case "PCAT-API-09":
        return (
          (obs.agentReadStatus === 200 || obs.agentReadStatus === 403) &&
          obs.agentWriteStatus === 403 &&
          obs.spoofStatus === 200
        );
      case "PCAT-API-10":
        return obs.driftStatus === 409 && obs.driftReason === "release-drift" && obs.missingIdempotencyStatus === 409;
      case "PCAT-API-11":
        return (
          Array.isArray(obs.capturedRouteIds) &&
          obs.capturedRouteIds.length === kernelReadRouteIds.length &&
          kernelReadRouteIds.every((id) => (obs.capturedRouteIds as string[]).includes(id))
        );
      case "PCAT-API-12":
        return (
          obs.listStatus === 200 &&
          obs.legacySpecIdentityPresent === false &&
          obs.definitionIdPresent === true &&
          obs.effectiveRevisionIdPresent === true &&
          obs.currentValueIdPresent === true
        );
      default:
        return false;
    }
  })();
  return { passed, failureCode: passed ? null : failure };
};
