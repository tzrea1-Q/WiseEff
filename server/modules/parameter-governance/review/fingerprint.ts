import { createHash } from "node:crypto";

import {
  serializeContract,
  type ContractJsonValue,
  type LegacyRowClass,
  type ReviewReason,
} from "../../parameter-catalog-contract/index";

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

export const reviewQueueContract = deepFreeze({
  contractVersion: "1.0.0",
  digestAlgorithm: "sha256",
  canonicalSerialization: "parameter-catalog-contract-serialize",
  commandFamily: "review-queue-read",
  groupsOpenItemsBy: [
    "organization_id",
    "matcher_revision",
    "evidence_fingerprint",
  ],
  redactsRawEvidenceByDefault: true,
  staleCapturedPinFailsClosed: true,
} as const);

export const reviewQueueContractFingerprint = `sha256:${createHash("sha256")
  .update(serializeContract(reviewQueueContract as unknown as ContractJsonValue))
  .digest("hex")}`;

export const fingerprintCanonical = (value: ContractJsonValue): string =>
  `sha256:${createHash("sha256").update(serializeContract(value)).digest("hex")}`;

export type ReviewGroupFingerprintModel = {
  readonly kind: "review-item-group";
  readonly organizationId: string;
  readonly matcherRevision: string;
  readonly catalogReleaseId: string;
  readonly reason: ReviewReason;
  readonly rClass: LegacyRowClass | null;
  readonly identityKey: string;
};

export const groupingIdentityKey = (
  sourceIdentity: string,
  payload: { readonly [key: string]: unknown },
): string => {
  const propertyKey = payload.propertyKey;
  if (typeof propertyKey === "string" && propertyKey.trim() === propertyKey && propertyKey.length > 0) {
    return `property:${propertyKey}`;
  }
  return `source:${sourceIdentity}`;
};

export const reviewGroupFingerprintModel = (
  input: Omit<ReviewGroupFingerprintModel, "kind">,
): ReviewGroupFingerprintModel => ({
  kind: "review-item-group",
  ...input,
});
