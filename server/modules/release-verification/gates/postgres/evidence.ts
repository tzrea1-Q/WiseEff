import { digestOf } from "../../core/digest";
import { VerificationGateId, type GateResult } from "../../core/types";

export type GateEvidence = {
  readonly [key: string]: unknown;
};

export const asInt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

export const asStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

export const orderedChecksum = (ids: readonly string[]): string => digestOf([...ids].sort());

export const evidenceDigestOf = (gateId: string, evidence: GateEvidence): string =>
  digestOf({ evidence, gateId });

export const passedResult = (gateId: string, evidence: GateEvidence): GateResult => ({
  gateId: VerificationGateId(gateId),
  status: "passed",
  failureCode: null,
  evidenceDigest: evidenceDigestOf(gateId, evidence),
  successorPurpose: null,
  notApplicableProof: null,
});

export const failedResult = (
  gateId: string,
  failureCode: string,
  evidence: GateEvidence,
): GateResult => ({
  gateId: VerificationGateId(gateId),
  status: "failed",
  failureCode,
  evidenceDigest: evidenceDigestOf(gateId, evidence),
  successorPurpose: null,
  notApplicableProof: null,
});

export const countedResult = (
  gateId: string,
  failureCode: string,
  violationCount: number,
  evidence: GateEvidence,
): GateResult => {
  const payload = { ...evidence, violationCount };
  return violationCount === 0
    ? passedResult(gateId, payload)
    : failedResult(gateId, failureCode, payload);
};
