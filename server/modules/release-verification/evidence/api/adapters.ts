import { findRegistryGate } from "../../core/gateRegistry";
import type { GateAdapter, GateResult, VerificationPlan } from "../../core/types";
import { captureCatalogApiEvidence, evaluateCatalogApiGate } from "./capture";
import { CATALOG_API_GATE_IDS } from "./probes";
import type {
  CatalogApiCandidateDriver,
  CatalogApiEvidenceBundle,
  CatalogApiEvidenceQuery,
  CatalogApiEvidenceRefusal,
  CatalogApiPrincipalMode,
} from "./types";

export type CatalogApiEvidenceAdapterOptions = {
  readonly driver: CatalogApiCandidateDriver;
  readonly database: CatalogApiEvidenceQuery;
  readonly principal: {
    readonly principalId: string;
    readonly organizationId: string;
    readonly actorKind: string;
  };
  readonly runtime: {
    readonly kind: "candidate" | "mock";
    readonly candidateId: string;
  };
  readonly probeContext?: {
    readonly subjectId?: string;
    readonly definitionId?: string;
    readonly revisionId?: string;
    readonly projectId?: string;
  };
};

const failed = (gateId: string, failureCode: string, evidenceDigest: string | null): GateResult => ({
  gateId: findRegistryGate(gateId)?.id ?? (gateId as GateResult["gateId"]),
  status: "failed",
  failureCode,
  evidenceDigest,
  successorPurpose: null,
  notApplicableProof: null,
});

const applicabilityResult = (gateId: string, plan: VerificationPlan): GateResult | null => {
  const entry = plan.applicabilityProfile.find((item) => item.gateId === gateId);
  if (!entry) {
    return failed(gateId, "PCAT-VRF-APPLICABLE-GATE-MISSING", null);
  }
  if (entry.applicability.status === "not-yet-executable") {
    return {
      gateId: entry.gateId,
      status: "not-yet-executable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: entry.applicability.successorPurpose,
      notApplicableProof: null,
    };
  }
  if (entry.applicability.status === "not-applicable") {
    return {
      gateId: entry.gateId,
      status: "not-applicable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: null,
      notApplicableProof: entry.applicability.proof,
    };
  }
  return null;
};

export const createCatalogApiEvidenceAdapters = (
  options: CatalogApiEvidenceAdapterOptions,
): Map<string, GateAdapter> => {
  let bundlePromise: Promise<
    | { readonly ok: true; readonly value: CatalogApiEvidenceBundle }
    | { readonly ok: false; readonly error: CatalogApiEvidenceRefusal }
  > | null = null;

  const captureFor = (plan: VerificationPlan) => {
    bundlePromise ??= captureCatalogApiEvidence({
      plan,
      runtime: options.runtime,
      driver: options.driver,
      database: options.database,
      principal: options.principal,
      probeContext: options.probeContext,
    });
    return bundlePromise;
  };

  const adapters = new Map<string, GateAdapter>();
  for (const gateId of CATALOG_API_GATE_IDS) {
    adapters.set(gateId, async ({ gateId: id, plan }) => {
      const skipped = applicabilityResult(id, plan);
      if (skipped) {
        return skipped;
      }
      const captured = await captureFor(plan);
      if (!captured.ok) {
        return failed(id, `${id}-FAILED`, null);
      }
      const record = captured.value.records.find((item) => item.gateId === id);
      const ref = captured.value.evidenceRefs.find((item) => item.gateId === id);
      if (!record || !ref) {
        return failed(id, `${id}-FAILED`, null);
      }
      const evaluated = evaluateCatalogApiGate(record);
      return {
        gateId: ref.gateId,
        status: evaluated.passed ? "passed" : "failed",
        failureCode: evaluated.failureCode,
        evidenceDigest: ref.digest,
        successorPurpose: null,
        notApplicableProof: null,
      };
    });
  }
  return adapters;
};

export type { CatalogApiPrincipalMode };
