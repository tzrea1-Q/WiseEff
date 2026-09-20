import type {
  ContractJsonValue,
  LegacyRowClass,
  ReviewReason,
} from "../../parameter-catalog-contract/index";

import {
  fingerprintCanonical,
  observationFingerprintModel,
  reviewEvidenceFingerprintModel,
  storedReviewEvidence,
  type ObservationFingerprintModel,
  type ReviewEvidenceFingerprintModel,
} from "./fingerprint";
import type {
  IngestEvidenceCommand,
  IngestEvidenceFailure,
  Result,
  SourceLocator,
  SourceProvenance,
} from "./types";

const tokenFields = [
  "organizationId",
  "sourceIdentity",
  "catalogReleaseId",
  "matcherRevision",
] as const;

const provenanceFields = ["projectId", "configRevisionId"] as const;

const exactLocatorKeys = (
  value: SourceLocator,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected.slice().sort()[index]);
};

const isExactParameterLocator = (value: SourceLocator): boolean => {
  const kind = value.kind;
  if (kind === "dts-property") {
    return (
      exactLocatorKeys(value, [
        "kind",
        "propertyOccurrenceId",
        "nodeOccurrenceId",
        "fileVersionId",
        "propertyName",
      ]) &&
      isUsableToken(value.propertyOccurrenceId) &&
      isUsableToken(value.nodeOccurrenceId) &&
      isUsableToken(value.fileVersionId) &&
      isUsableToken(value.propertyName)
    );
  }
  if (kind === "json-pointer") {
    return (
      exactLocatorKeys(value, ["kind", "fileVersionId", "pointer"]) &&
      isUsableToken(value.fileVersionId) &&
      typeof value.pointer === "string" &&
      /^(?:\/(?:[^~/]|~0|~1)*)*$/.test(value.pointer)
    );
  }
  return false;
};

const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const isPlainObject = (value: unknown): value is SourceLocator => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
};

const matcherStatuses = new Set([
  "matched",
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed",
]);

const reviewReasonFor = (command: IngestEvidenceCommand): ReviewReason => {
  const status = command.matcherOutput?.status;
  if (
    status === "unknown" ||
    status === "ambiguous" ||
    status === "placement-conflict" ||
    status === "retired-registration-observed"
  ) {
    return status;
  }
  return "unknown";
};

export type PlannedObservation = {
  readonly kind: "observation";
  readonly fingerprint: string;
  readonly parameterLocatorDigest: string;
  readonly model: ObservationFingerprintModel;
  readonly provenance: SourceProvenance;
};

export type PlannedReviewEvidence = {
  readonly kind: "review-evidence";
  readonly fingerprint: string;
  readonly model: ReviewEvidenceFingerprintModel;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly sourceGraphRef: string | null;
  readonly evidence: SourceLocator;
};

export type PlannedIngest = PlannedObservation | PlannedReviewEvidence;

const missingProvenance = (
  missing: readonly string[],
): Result<never, IngestEvidenceFailure> => ({
  ok: false,
  error: { kind: "missing-source-provenance", missing },
});

export const planEvidenceIngest = (
  command: IngestEvidenceCommand,
): Result<PlannedIngest, IngestEvidenceFailure> => {
  const missing: string[] = [];
  for (const field of tokenFields) {
    if (!isUsableToken(command[field])) missing.push(field);
  }
  if (!command.matcherOutput || !matcherStatuses.has(command.matcherOutput.status)) {
    missing.push("matcherOutput");
  }

  const classification = command.classification ?? null;
  const rClass = classification?.rClass ?? null;
  const classified = rClass != null;
  const weak = command.matcherOutput?.status !== "matched";
  const reviewPath = classified || weak;

  if (!reviewPath) {
    const provenance = command.provenance ?? null;
    if (provenance == null) {
      missing.push("provenance");
    } else {
      for (const field of provenanceFields) {
        if (!isUsableToken(provenance[field])) missing.push(`provenance.${field}`);
      }
      if (!isUsableToken(provenance.sourceOccurrenceId)) {
        missing.push("provenance.sourceOccurrenceId");
      }
      if (!isPlainObject(provenance.sourceLocator) || !isExactParameterLocator(provenance.sourceLocator)) {
        missing.push("provenance.sourceLocator");
      }
      if (provenance.sourceLocator?.kind === "dts-property" && !isUsableToken(provenance.logicalNodeId)) {
        missing.push("provenance.logicalNodeId");
      }
      if (provenance.sourceLocator?.kind === "json-pointer" && provenance.logicalNodeId !== null) {
        missing.push("provenance.logicalNodeId");
      }
    }
  } else if (command.evidence != null && !isPlainObject(command.evidence)) {
    missing.push("evidence");
  }

  if (missing.length > 0) {
    return missingProvenance(missing);
  }

  if (reviewPath) {
    const sourceGraphRef =
      classification?.sourceGraphRef && isUsableToken(classification.sourceGraphRef)
        ? classification.sourceGraphRef
        : null;
    const payload = command.evidence ?? {};
    const reason = reviewReasonFor(command);
    const model = reviewEvidenceFingerprintModel(
      command,
      reason,
      rClass,
      sourceGraphRef,
      payload,
    );
    return {
      ok: true,
      value: {
        kind: "review-evidence",
        fingerprint: fingerprintCanonical(model as unknown as ContractJsonValue),
        model,
        reason,
        rClass,
        sourceGraphRef,
        evidence: storedReviewEvidence(model),
      },
    };
  }

  const provenance = command.provenance!;
  const model = observationFingerprintModel(command, provenance);
  return {
    ok: true,
    value: {
        kind: "observation",
        fingerprint: fingerprintCanonical(model as unknown as ContractJsonValue),
        model,
        provenance,
        parameterLocatorDigest: fingerprintCanonical(provenance.sourceLocator),
      },
  };
};
