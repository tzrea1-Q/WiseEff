import { createHash } from "node:crypto";

import {
  serializeContract,
  type ContractJsonValue,
  type LegacyRowClass,
  type ReviewReason,
} from "../../parameter-catalog-contract/index";

import type {
  IngestEvidenceCommand,
  MatcherOutput,
  SourceLocator,
  SourceProvenance,
} from "./types";

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

export const evidenceIngestContract = deepFreeze({
  contractVersion: "1.0.0",
  digestAlgorithm: "sha256",
  canonicalSerialization: "parameter-catalog-contract-serialize",
  commandFamily: "evidence-ingest",
  replayKey: ["organization_id", "source_identity"],
  r6AndR8SamePropertyKeyRemainDistinct: true,
  weakMatchCreatesReviewEvidence: true,
} as const);

export const evidenceIngestContractFingerprint = `sha256:${createHash("sha256")
  .update(serializeContract(evidenceIngestContract as unknown as ContractJsonValue))
  .digest("hex")}`;

export const fingerprintCanonical = (value: ContractJsonValue): string =>
  `sha256:${createHash("sha256").update(serializeContract(value)).digest("hex")}`;

export type ObservationFingerprintModel = {
  readonly kind: "parameter-observation";
  readonly organizationId: string;
  readonly sourceIdentity: string;
  readonly catalogReleaseId: string;
  readonly matcherRevision: string;
  readonly matcherOutput: MatcherOutput;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly configRevisionId: string;
  readonly sourceLocator: SourceLocator;
};

export type ReviewEvidenceFingerprintModel = {
  readonly kind: "review-evidence";
  readonly organizationId: string;
  readonly sourceIdentity: string;
  readonly catalogReleaseId: string;
  readonly matcherRevision: string;
  readonly matcherOutput: MatcherOutput;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly sourceGraphRef: string | null;
  readonly payload: SourceLocator;
};

export const observationFingerprintModel = (
  command: IngestEvidenceCommand,
  provenance: SourceProvenance,
): ObservationFingerprintModel => ({
  kind: "parameter-observation",
  organizationId: command.organizationId,
  sourceIdentity: command.sourceIdentity,
  catalogReleaseId: command.catalogReleaseId,
  matcherRevision: command.matcherRevision,
  matcherOutput: command.matcherOutput,
  projectId: provenance.projectId,
  logicalNodeId: provenance.logicalNodeId,
  configRevisionId: provenance.configRevisionId,
  sourceLocator: provenance.sourceLocator,
});

export const reviewEvidenceFingerprintModel = (
  command: IngestEvidenceCommand,
  reason: ReviewReason,
  rClass: LegacyRowClass | null,
  sourceGraphRef: string | null,
  payload: SourceLocator,
): ReviewEvidenceFingerprintModel => ({
  kind: "review-evidence",
  organizationId: command.organizationId,
  sourceIdentity: command.sourceIdentity,
  catalogReleaseId: command.catalogReleaseId,
  matcherRevision: command.matcherRevision,
  matcherOutput: command.matcherOutput,
  reason,
  rClass,
  sourceGraphRef,
  payload,
});

export const storedReviewEvidence = (
  model: ReviewEvidenceFingerprintModel,
): SourceLocator => ({
  sourceIdentity: model.sourceIdentity,
  catalogReleaseId: model.catalogReleaseId,
  matcherRevision: model.matcherRevision,
  matcherOutput: model.matcherOutput.status,
  reason: model.reason,
  rClass: model.rClass,
  sourceGraphRef: model.sourceGraphRef,
  payload: model.payload,
});
