/**
 * Deterministic logical-node continuity matching.
 * Ambiguity → MappingDecision.ambiguous (callers persist identity_mapping_tasks).
 * No fuzzy scoring; label-alone and locator-alone never prove continuity.
 */

import type { MappingDecision } from "../parameter-specs/types";

/** Prior-revision logical node snapshot used as the continuity source. */
export type LogicalNodeSnapshot = {
  logicalNodeId: string;
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  parentLogicalNodeId: string | null;
  driverSchemaVersionId?: string | null;
  /** Raw `reg` property text when present. */
  reg?: string;
  /** Schema-declared unique identity keys (never invented by the matcher). */
  uniqueKeys?: Record<string, string>;
  /** Stable topology relation key (e.g. child-of:<parentLogicalId>). */
  topologyRelation?: string;
  labels?: string[];
  /** Explicit reviewed continuity mapping to a candidate logical node id. */
  reviewedMappingTo?: string;
};

export type LogicalNodeCandidate = LogicalNodeSnapshot & {
  /**
   * When true, the candidate only shares a locator with the previous node.
   * Locator alone is never deterministic evidence → unmatched.
   */
  locatorOnlyMatch?: boolean;
};

function sharedUniqueKeyEvidence(
  previous: LogicalNodeSnapshot,
  candidate: LogicalNodeCandidate,
): string[] {
  const evidence: string[] = [];
  const previousKeys = previous.uniqueKeys ?? {};
  const candidateKeys = candidate.uniqueKeys ?? {};
  for (const [key, value] of Object.entries(previousKeys)) {
    if (value !== undefined && candidateKeys[key] === value) {
      evidence.push(`unique-key=${key}`);
    }
  }
  return evidence;
}

/**
 * Collect deterministic continuity evidence between previous and candidate.
 * Deliberately ignores: locator equality, label equality, fuzzy scores.
 */
export function collectIdentityEvidence(
  previous: LogicalNodeSnapshot,
  candidate: LogicalNodeCandidate,
): string[] {
  if (candidate.locatorOnlyMatch) {
    return [];
  }

  const evidence: string[] = [];

  if (
    previous.reviewedMappingTo &&
    previous.reviewedMappingTo === candidate.logicalNodeId
  ) {
    evidence.push("reviewed-mapping");
  }
  if (
    candidate.reviewedMappingTo &&
    candidate.reviewedMappingTo === previous.logicalNodeId
  ) {
    evidence.push("reviewed-mapping");
  }

  if (
    previous.parentLogicalNodeId &&
    candidate.parentLogicalNodeId &&
    previous.parentLogicalNodeId === candidate.parentLogicalNodeId
  ) {
    evidence.push("parent-logical-id");
  }

  if (
    previous.driverSchemaVersionId &&
    candidate.driverSchemaVersionId &&
    previous.driverSchemaVersionId === candidate.driverSchemaVersionId
  ) {
    evidence.push("driver-schema-version");
  }

  if (previous.reg && candidate.reg && previous.reg === candidate.reg) {
    evidence.push("reg");
  }

  if (
    previous.unitAddress !== undefined &&
    candidate.unitAddress !== undefined &&
    previous.unitAddress === candidate.unitAddress
  ) {
    evidence.push("unit-address");
  }

  evidence.push(...sharedUniqueKeyEvidence(previous, candidate));

  if (
    previous.topologyRelation &&
    candidate.topologyRelation &&
    previous.topologyRelation === candidate.topologyRelation
  ) {
    evidence.push("topology-relation");
  }

  return evidence;
}

/**
 * Deterministic continuity requires reviewed mapping, or a unique identity
 * combination (parent/topology + address/reg/unique-key, optionally with driver).
 * Label-alone and locator-alone never qualify.
 */
export function isDeterministicIdentityEvidence(evidence: string[]): boolean {
  if (evidence.includes("reviewed-mapping")) {
    return true;
  }

  const hasParent = evidence.includes("parent-logical-id");
  const hasDriver = evidence.includes("driver-schema-version");
  const hasReg = evidence.includes("reg");
  const hasUnit = evidence.includes("unit-address");
  const hasTopo = evidence.includes("topology-relation");
  const hasUnique = evidence.some((item) => item.startsWith("unique-key="));
  const hasAddress = hasReg || hasUnit;

  if (hasUnique && (hasParent || hasDriver || hasTopo)) {
    return true;
  }
  if (hasParent && hasAddress) {
    return true;
  }
  if (hasTopo && hasAddress && hasDriver) {
    return true;
  }
  if (hasDriver && hasAddress && hasParent) {
    return true;
  }
  return false;
}

export function matchLogicalNode(
  previous: LogicalNodeSnapshot,
  candidates: LogicalNodeCandidate | LogicalNodeCandidate[],
): MappingDecision<LogicalNodeCandidate> {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const matches: Array<{ candidate: LogicalNodeCandidate; evidence: string[] }> = [];

  for (const candidate of list) {
    const evidence = collectIdentityEvidence(previous, candidate);
    if (isDeterministicIdentityEvidence(evidence)) {
      matches.push({ candidate, evidence });
    }
  }

  if (matches.length === 1) {
    return {
      kind: "matched",
      value: matches[0].candidate,
      evidence: matches[0].evidence,
    };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      candidates: matches.map((entry) => entry.candidate),
      evidence: [
        `previous=${previous.logicalNodeId}`,
        ...matches.flatMap((entry) => entry.evidence),
      ],
    };
  }

  return {
    kind: "unmatched",
    evidence: [
      `previous=${previous.logicalNodeId}`,
      "no-deterministic-identity-evidence",
    ],
  };
}
