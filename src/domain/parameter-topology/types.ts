/**
 * Frontend semantic contracts for topology-aware parameter management.
 * Property identity is parameterSpecId + immutable parameterSpecVersionId.
 * Project identity is projectParameterBindingId. Paths are locators only.
 *
 * Value fields stay separate: exampleValue / schemaDefault / policyTarget / effectiveValue.
 * Never invent or alias recommendedValue.
 */

export type ParameterSourceKind = "dts" | "json" | "manual";

export type SpecLifecycle = "draft" | "active" | "deprecated";

export type DtsCell =
  | { kind: "integer"; raw: string; value: string }
  | { kind: "phandle"; label: string };

export type DtsValueSegment =
  | { kind: "string"; raw: string; value: string }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; cells: DtsCell[] };

export type DtsValue =
  | { kind: "boolean"; present: true }
  | { kind: "empty" }
  | { kind: "strings"; values: string[]; items?: Array<{ value: string; raw: string }> }
  | { kind: "cells"; bits: 8 | 16 | 32 | 64; groups: DtsCell[][] }
  | { kind: "bytes"; values: number[] }
  | { kind: "mixed"; segments: DtsValueSegment[] };

export type MappingDecision<T> =
  | { kind: "matched"; value: T; evidence: string[] }
  | { kind: "unmatched"; evidence: string[] }
  | { kind: "ambiguous"; candidates: T[]; evidence: string[] };

export type SpecQuery = {
  q?: string;
  sourceKind?: ParameterSourceKind;
  lifecycle?: SpecLifecycle;
  driverModule?: string;
  propertyKey?: string;
};

export type ParameterSpecSummary = {
  id: string;
  /** Null for platform-global specs (readable/bindable; not org-admin mutable). */
  organizationId?: string | null;
  sourceKind: ParameterSourceKind;
  specificationKey: string;
  propertyKey: string | null;
  driverModule: string | null;
  lifecycle: SpecLifecycle;
  currentVersionId: string | null;
  currentVersion: number | null;
};

export type ParameterSpecDetail = ParameterSpecSummary & {
  displayName: string | null;
  description: string | null;
  valueShape: unknown | null;
  /** From pinned schema version — not a recommendation. */
  schemaDefault: unknown | null;
  /** Illustrative only — must not be treated as enforced default. */
  exampleValue: unknown | null;
  schemaNamespace: string | null;
  units: string | null;
  constraints: Record<string, unknown> | null;
  documentation: string | null;
  compatiblePatterns: string[] | null;
  /** Organization/product policy target — may participate in compliance. */
  policyTarget: unknown | null;
};

export type BindingSchemaState = "valid" | "invalid" | "unreviewed";
export type BindingPolicyState = "pass" | "fail" | "not_applicable";

/**
 * Project property binding — identity is never path-derived.
 * locator/instanceName are display/location aids only.
 */
export type ProjectParameterBinding = {
  id: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  driverModule: string | null;
  logicalNodeId: string | null;
  instanceName: string | null;
  locator: string | null;
  effectiveValue: DtsValue;
  rawValue: string;
  schemaState: BindingSchemaState;
  policyState: BindingPolicyState;
  /** Durable v1 business module (phase 2, §5.1 read path) — browse source of truth. */
  moduleId: string;
};

/**
 * One per-binding change entry, sourced from binding revisions only.
 * Adjacent revision raw values are mapped into from→to; newest-first.
 */
export type BindingHistoryEntry = {
  id: string;
  changedAt: string;
  actor?: string | null;
  fromRawValue?: string | null;
  toRawValue?: string | null;
  reason?: string | null;
};

export type TopologyView = "source" | "effective";

export type SourceTopologyProperty = {
  id: string;
  propertyName: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  contentHash: string;
  sourceOrder: number;
};

export type SourceTopologyNode = {
  id: string;
  fileVersionId: string;
  /** Present when the topology API joins revision members / project files. */
  fileName?: string;
  parentOccurrenceId: string | null;
  name: string;
  unitAddress?: string;
  labels: string[];
  refTarget?: string;
  isOverlayRoot: boolean;
  nodePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  contentHash: string;
  sourceOrder: number;
  properties: SourceTopologyProperty[];
};

export type EffectiveTopologyEffect = {
  id: string;
  propertyName: string | null;
  effectKind: "set" | "override" | "delete";
  nodeOccurrenceId: string | null;
  propertyOccurrenceId: string | null;
  sourceOrder: number;
};

export type EffectiveTopologyNode = {
  id: string;
  logicalNodeId: string;
  locator: string;
  name: string;
  unitAddress?: string;
  compatible?: string;
  parentLogicalNodeId: string | null;
  effects: EffectiveTopologyEffect[];
};

export type TopologyTree =
  | {
      view: "source";
      revisionId: string;
      configSetId: string;
      projectId: string;
      status?: string;
      incompleteBase?: boolean;
      diagnostics?: TopologyDiagnostic[];
      nodes: SourceTopologyNode[];
    }
  | {
      view: "effective";
      revisionId: string;
      configSetId: string;
      projectId: string;
      status?: string;
      incompleteBase?: boolean;
      diagnostics?: TopologyDiagnostic[];
      nodes: EffectiveTopologyNode[];
    };

export type IdentityMappingTaskStatus = "open" | "resolved" | "dismissed";

export type IdentityMappingCandidate = {
  logicalNodeId: string;
  nodeLocator?: string;
  name?: string;
  unitAddress?: string;
};

/**
 * Structured evidence from identity_mapping_tasks.evidence JSON.
 * `risk` may be omitted — UI derives high risk when candidates are ambiguous.
 */
export type IdentityMappingEvidence = {
  previousLogicalNodeId?: string | null;
  previousNodeLocator?: string | null;
  evidence?: string[];
  candidates?: IdentityMappingCandidate[];
  risk?: string | null;
};

export type IdentityMappingTask = {
  id: string;
  projectId: string;
  configRevisionId: string;
  previousLogicalNodeId: string | null;
  candidateLogicalNodeIds: string[];
  evidence?: IdentityMappingEvidence | Record<string, unknown> | null;
  status: IdentityMappingTaskStatus;
  reason?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
};

export type SpecReviewTaskStatus = "open" | "resolved" | "dismissed";

export type SpecReviewTaskQuery = {
  status?: SpecReviewTaskStatus;
  limit?: number;
  cursor?: string;
};

export type SpecReviewTaskCandidate = {
  id: string;
  label: string;
  propertyKey?: string | null;
  driverModule?: string | null;
};

export type SpecReviewTask = {
  id: string;
  status: SpecReviewTaskStatus;
  parameterSpecId?: string | null;
  propertyKey: string | null;
  driverModule: string | null;
  evidence: string[];
  candidates: SpecReviewTaskCandidate[];
  ambiguous: boolean;
  projectCount: number;
  createdAt: string;
  resolvedAt?: string | null;
  reason?: string | null;
};

export type SpecReviewTaskListResult = {
  items: SpecReviewTask[];
  nextCursor: string | null;
};

export type ResolveSpecReviewInput = {
  decision: "resolved" | "dismissed";
  parameterSpecId?: string;
  reason: string;
  confirmPropertyMismatch?: boolean;
  createSpec?: boolean;
};

export type ResolveMappingInput = {
  decision: "resolved" | "dismissed";
  selectedLogicalNodeId?: string;
  reason: string;
};

export type ValidationRunStatus = "passed" | "failed" | "running";

export type ValidationRun = {
  id: string;
  status: ValidationRunStatus;
  stage: string;
  artifactHashes?: Record<string, unknown>;
  diagnostics?: TopologyDiagnostic[];
};

export type TopologyDiagnostic = {
  severity?: string;
  code?: string;
  message: string;
  path?: string;
  startLine?: number;
  startColumn?: number;
  guidance?: string;
};

/**
 * Prefer policyTarget, else schemaDefault. Never treat exampleValue as enforced.
 */
export type InitializationSuggestion = {
  suggestion: unknown | null;
  source: "policyTarget" | "schemaDefault" | null;
  exampleValue: unknown | null;
  exampleEnforced: false;
};

export function buildInitializationSuggestion(input: {
  policyTarget?: unknown;
  schemaDefault?: unknown;
  exampleValue?: unknown;
}): InitializationSuggestion {
  if (input.policyTarget != null) {
    return {
      suggestion: input.policyTarget,
      source: "policyTarget",
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false
    };
  }
  if (input.schemaDefault != null) {
    return {
      suggestion: input.schemaDefault,
      source: "schemaDefault",
      exampleValue: input.exampleValue ?? null,
      exampleEnforced: false
    };
  }
  return {
    suggestion: null,
    source: null,
    exampleValue: input.exampleValue ?? null,
    exampleEnforced: false
  };
}
