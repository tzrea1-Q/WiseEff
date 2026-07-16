import { randomUUID } from "node:crypto";

import { isReleasableDriver, isReleasableProperty } from "./schemaLoader";
import type {
  DriverSchema,
  GoldenCoverage,
  MappingDecision,
  MatchableNode,
  PropertyBinding,
  PropertySpec,
  SchemaRegistry,
  SpecReviewTaskDraft,
} from "./types";
import { SCHEMA_SOURCE_PRECEDENCE } from "./types";

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return false;
}

function driverMatchesNode(driver: DriverSchema, node: MatchableNode): boolean {
  for (const compatible of node.compatible) {
    for (const pattern of driver.compatiblePatterns) {
      if (patternMatches(pattern, compatible)) return true;
    }
  }
  if (node.compatible.length === 0) {
    for (const pattern of driver.nodenamePatterns) {
      if (patternMatches(pattern, node.name)) return true;
    }
  }
  return false;
}

function evidenceForDriver(driver: DriverSchema, node: MatchableNode): string[] {
  const evidence: string[] = [];
  for (const compatible of node.compatible) {
    if (driver.compatiblePatterns.some((pattern) => patternMatches(pattern, compatible))) {
      evidence.push(`compatible=${compatible}`);
    }
  }
  if (evidence.length === 0 && node.compatible.length === 0) {
    for (const pattern of driver.nodenamePatterns) {
      if (patternMatches(pattern, node.name)) {
        evidence.push(`nodename=${node.name}`);
      }
    }
  }
  evidence.push(`source=${driver.source}`);
  evidence.push(`schema=${driver.schemaNamespace}`);
  return evidence;
}

function matchingReleasableDrivers(node: MatchableNode, registry: SchemaRegistry): DriverSchema[] {
  return registry.drivers.filter(
    (driver) => isReleasableDriver(driver) && driverMatchesNode(driver, node),
  );
}

/**
 * Strict driver match: releasable schemas only (inferred drafts never match).
 * Multiple candidates at the same precedence tier → ambiguous (never highest-score auto-pick).
 * Across tiers, Linux is base; a unique Vendor extension may be returned as the effective match
 * when it uniquely specializes the node (Vendor may add/narrow). Manual fills gaps only when
 * no linux/vendor driver matches.
 */
export function matchDriver(
  node: MatchableNode,
  registry: SchemaRegistry,
): MappingDecision<DriverSchema> {
  const evidenceBase =
    node.compatible.length > 0
      ? node.compatible.map((value) => `compatible=${value}`)
      : [`nodename=${node.name}`];

  const candidates = matchingReleasableDrivers(node, registry);

  if (candidates.length === 0) {
    return { kind: "unmatched", evidence: evidenceBase };
  }

  if (candidates.length === 1) {
    return {
      kind: "matched",
      value: candidates[0],
      evidence: evidenceForDriver(candidates[0], node),
    };
  }

  const bySource = {
    linux: candidates.filter((driver) => driver.source === "linux"),
    vendor: candidates.filter((driver) => driver.source === "vendor"),
    manual: candidates.filter((driver) => driver.source === "manual"),
  };

  // Same-tier multiplicity is always ambiguous.
  for (const tier of ["linux", "vendor", "manual"] as const) {
    if (bySource[tier].length > 1) {
      return {
        kind: "ambiguous",
        candidates: bySource[tier],
        evidence: [
          ...evidenceBase,
          `tier=${tier}`,
          `candidates=${bySource[tier].map((driver) => driver.id).join(",")}`,
        ],
      };
    }
  }

  // Unique vendor specialization wins as the effective matched driver (linux remains base for props).
  if (bySource.vendor.length === 1) {
    return {
      kind: "matched",
      value: bySource.vendor[0],
      evidence: evidenceForDriver(bySource.vendor[0], node),
    };
  }
  if (bySource.linux.length === 1) {
    return {
      kind: "matched",
      value: bySource.linux[0],
      evidence: evidenceForDriver(bySource.linux[0], node),
    };
  }
  if (bySource.manual.length === 1) {
    return {
      kind: "matched",
      value: bySource.manual[0],
      evidence: evidenceForDriver(bySource.manual[0], node),
    };
  }

  return {
    kind: "ambiguous",
    candidates,
    evidence: [...evidenceBase, `candidates=${candidates.map((driver) => driver.id).join(",")}`],
  };
}

function propertiesForDriver(
  driver: DriverSchema,
  registry: SchemaRegistry,
): PropertySpec[] {
  const fromDriver = driver.propertyIds
    .map((id) => registry.propertiesById.get(id))
    .filter((property): property is PropertySpec => Boolean(property));

  const fromCommon: PropertySpec[] = [];
  for (const ref of driver.commonRefs) {
    const wantsCommon = ref.includes("common");
    for (const property of registry.properties) {
      if (property.driverSchemaId !== null) continue;
      if (wantsCommon && !property.schemaNamespace.includes("common")) continue;
      if (!fromCommon.some((existing) => existing.id === property.id)) {
        fromCommon.push(property);
      }
    }
  }

  return [...fromDriver, ...fromCommon];
}

/**
 * Compose property candidates across matching releasable drivers:
 * Linux base → Vendor add/narrow → reviewed manual gap-fill.
 * Inferred drafts never count as releasable matches.
 */
export function matchProperty(
  node: MatchableNode,
  propertyKey: string,
  registry: SchemaRegistry,
): MappingDecision<PropertySpec> {
  const driverDecision = matchDriver(node, registry);

  if (driverDecision.kind === "unmatched") {
    return {
      kind: "unmatched",
      evidence: [...driverDecision.evidence, `property=${propertyKey}`],
    };
  }

  if (driverDecision.kind === "ambiguous") {
    const propertyCandidates: PropertySpec[] = [];
    for (const driver of driverDecision.candidates) {
      for (const property of propertiesForDriver(driver, registry)) {
        if (property.propertyKey === propertyKey && isReleasableProperty(property)) {
          propertyCandidates.push(property);
        }
      }
    }
    if (propertyCandidates.length === 1) {
      return {
        kind: "matched",
        value: propertyCandidates[0],
        evidence: [...driverDecision.evidence, `property=${propertyKey}`],
      };
    }
    if (propertyCandidates.length > 1) {
      return {
        kind: "ambiguous",
        candidates: propertyCandidates,
        evidence: [...driverDecision.evidence, `property=${propertyKey}`],
      };
    }
    return {
      kind: "unmatched",
      evidence: [...driverDecision.evidence, `property=${propertyKey}`, "no-property-on-candidates"],
    };
  }

  // Compose across all matching drivers (linux base + vendor + manual), not only the effective one.
  const matchingDrivers = matchingReleasableDrivers(node, registry).sort(
    (left, right) =>
      SCHEMA_SOURCE_PRECEDENCE[left.source] - SCHEMA_SOURCE_PRECEDENCE[right.source],
  );

  const byKey: PropertySpec[] = [];
  for (const driver of matchingDrivers) {
    for (const property of propertiesForDriver(driver, registry)) {
      if (property.propertyKey !== propertyKey) continue;
      if (!isReleasableProperty(property)) continue;
      byKey.push(property);
    }
  }

  if (byKey.length === 0) {
    return {
      kind: "unmatched",
      evidence: [...driverDecision.evidence, `property=${propertyKey}`],
    };
  }

  // Prefer driver-local specs over common $ref copies; vendor narrows linux; manual fills gaps.
  const linux = byKey.filter((property) => property.source === "linux");
  const vendorLocal = byKey.filter(
    (property) => property.source === "vendor" && property.driverSchemaId !== null,
  );
  const vendorCommon = byKey.filter(
    (property) => property.source === "vendor" && property.driverSchemaId === null,
  );
  const manual = byKey.filter((property) => property.source === "manual");

  let chosen: PropertySpec[];
  if (vendorLocal.length > 0) {
    chosen = vendorLocal;
  } else if (vendorCommon.length > 0) {
    chosen = vendorCommon;
  } else if (linux.length > 0) {
    chosen = linux;
  } else {
    chosen = manual;
  }

  if (chosen.length === 1) {
    return {
      kind: "matched",
      value: chosen[0],
      evidence: [...driverDecision.evidence, `property=${propertyKey}`],
    };
  }

  // Deduplicate identical parameter identities before declaring ambiguity.
  const uniqueIds = new Set(chosen.map((property) => property.id));
  if (uniqueIds.size === 1) {
    return {
      kind: "matched",
      value: chosen[0],
      evidence: [...driverDecision.evidence, `property=${propertyKey}`],
    };
  }

  return {
    kind: "ambiguous",
    candidates: chosen,
    evidence: [...driverDecision.evidence, `property=${propertyKey}`],
  };
}

export type SpecReviewLocateContext = {
  organizationId: string;
  projectId: string;
  configRevisionId: string;
  propertyOccurrenceId: string | null;
  logicalNodeId: string | null;
};

export function reviewTasksForDecision(
  decision: MappingDecision<PropertySpec> | MappingDecision<DriverSchema>,
  node: MatchableNode,
  propertyKey?: string,
  locate?: SpecReviewLocateContext,
): SpecReviewTaskDraft[] {
  if (decision.kind === "matched") return [];

  const locateEvidence = locate
    ? {
        organizationId: locate.organizationId,
        projectId: locate.projectId,
        configRevisionId: locate.configRevisionId,
        propertyOccurrenceId: locate.propertyOccurrenceId,
        logicalNodeId: locate.logicalNodeId,
      }
    : {};

  if (decision.kind === "ambiguous") {
    return [
      {
        id: randomUUID(),
        projectId: locate?.projectId,
        configRevisionId: locate?.configRevisionId,
        propertyOccurrenceId: locate?.propertyOccurrenceId ?? undefined,
        blockerScope: "revision",
        sourceEvidence: {
          ...locateEvidence,
          nodeLocator: node.nodeLocator,
          compatible: node.compatible,
          propertyKey,
          evidence: decision.evidence,
          matcherCandidates: decision.candidates.map((candidate) =>
            "parameterSpecId" in candidate ? candidate.parameterSpecId : candidate.id,
          ),
        },
        candidateSchemas: decision.candidates.map((candidate) =>
          "propertyKey" in candidate
            ? {
                id: candidate.parameterSpecId,
                parameterSpecId: candidate.parameterSpecId,
                parameterSpecVersionId: candidate.id,
                propertyKey: candidate.propertyKey,
                schemaNamespace: candidate.schemaNamespace,
                source: candidate.source,
              }
            : {
                id: candidate.id,
                compatible: candidate.compatible,
                schemaNamespace: candidate.schemaNamespace,
                source: candidate.source,
              },
        ),
        projectCount: 1,
        status: "open",
      },
    ];
  }

  return [
    {
      id: randomUUID(),
      projectId: locate?.projectId,
      configRevisionId: locate?.configRevisionId,
      propertyOccurrenceId: locate?.propertyOccurrenceId ?? undefined,
      blockerScope: "revision",
      sourceEvidence: {
        ...locateEvidence,
        nodeLocator: node.nodeLocator,
        compatible: node.compatible,
        propertyKey,
        evidence: decision.evidence,
        matcherCandidates: [],
        inferred: true,
      },
      candidateSchemas: [],
      projectCount: 1,
      status: "open",
    },
  ];
}

/** Open review-task drafts for unmatched/ambiguous property matches (persist via repository). */
export function collectOpenReviewTasks(
  nodes: MatchableNode[],
  registry: SchemaRegistry,
): SpecReviewTaskDraft[] {
  const drafts: SpecReviewTaskDraft[] = [];
  for (const node of nodes) {
    for (const propertyKey of Object.keys(node.properties)) {
      const decision = matchProperty(node, propertyKey, registry);
      drafts.push(...reviewTasksForDecision(decision, node, propertyKey));
    }
  }
  return drafts;
}

export function bindGoldenOverlayProperties(
  nodes: MatchableNode[],
  registry: SchemaRegistry,
): GoldenCoverage {
  const bindings: PropertyBinding[] = [];
  const unmatched: GoldenCoverage["unmatched"] = [];
  const ambiguous: GoldenCoverage["ambiguous"] = [];
  let totalProperties = 0;

  for (const node of nodes) {
    for (const propertyKey of Object.keys(node.properties)) {
      totalProperties += 1;
      const decision = matchProperty(node, propertyKey, registry);
      if (decision.kind === "matched") {
        bindings.push({
          nodeLocator: node.nodeLocator,
          propertyKey,
          propertySpecId: decision.value.id,
          driverSchemaId: decision.value.driverSchemaId,
          evidence: decision.evidence,
        });
      } else if (decision.kind === "ambiguous") {
        ambiguous.push({
          nodeLocator: node.nodeLocator,
          propertyKey,
          candidates: decision.candidates.map((candidate) => candidate.id),
        });
      } else {
        unmatched.push({
          nodeLocator: node.nodeLocator,
          propertyKey,
          evidence: decision.evidence,
        });
      }
    }
  }

  return {
    totalProperties,
    matchedProperties: bindings.length,
    bindings,
    unmatched,
    ambiguous,
  };
}
