import { findRegistryGate } from "../../core/gateRegistry";
import type { GateAdapter, GateResult, VerificationPlan } from "../../core/types";
import { captureCatalogBrowserEvidence, evaluateCatalogBrowserGate } from "./capture";
import { CATALOG_BROWSER_GATE_IDS } from "./probes";
import type {
  CatalogBrowserCandidateDriver,
  CatalogBrowserEvidenceBundle,
  CatalogBrowserEvidenceQuery,
  CatalogBrowserEvidenceRefusal,
  CatalogBrowserRuntimeKind,
} from "./types";

export type CatalogBrowserEvidenceAdapterOptions = {
  readonly driver: CatalogBrowserCandidateDriver;
  readonly database: CatalogBrowserEvidenceQuery;
  readonly principal: {
    readonly principalId: string;
    readonly organizationId: string;
    readonly actorKind: string;
  };
  readonly runtime: {
    readonly kind: CatalogBrowserRuntimeKind;
    readonly candidateId: string;
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

export const createCatalogBrowserEvidenceAdapters = (
  options: CatalogBrowserEvidenceAdapterOptions,
): Map<string, GateAdapter> => {
  let bundlePromise: Promise<
    | { readonly ok: true; readonly value: CatalogBrowserEvidenceBundle }
    | { readonly ok: false; readonly error: CatalogBrowserEvidenceRefusal }
  > | null = null;

  const captureFor = (plan: VerificationPlan) => {
    bundlePromise ??= captureCatalogBrowserEvidence({
      plan,
      runtime: options.runtime,
      driver: options.driver,
      database: options.database,
      principal: options.principal,
    });
    return bundlePromise;
  };

  const adapters = new Map<string, GateAdapter>();
  for (const gateId of CATALOG_BROWSER_GATE_IDS) {
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
      const evaluated = evaluateCatalogBrowserGate(record);
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
