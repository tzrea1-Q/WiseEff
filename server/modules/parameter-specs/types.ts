/**
 * Versioned DTS schema registry types.
 * MappingDecision is locked by the active topology plan.
 */

export type MappingDecision<T> =
  | { kind: "matched"; value: T; evidence: string[] }
  | { kind: "unmatched"; evidence: string[] }
  | { kind: "ambiguous"; candidates: T[]; evidence: string[] };

export type SchemaSource = "linux" | "vendor" | "manual" | "inferred";

export type SpecLifecycle = "draft" | "active" | "deprecated";

/** Precedence for releasable matches: linux base → vendor add/narrow → reviewed manual gap-fill. */
export const SCHEMA_SOURCE_PRECEDENCE: Record<SchemaSource, number> = {
  linux: 0,
  vendor: 1,
  manual: 2,
  inferred: 99,
};

export type PropertyValueShape =
  | { kind: "bool" }
  | { kind: "empty" }
  | { kind: "string-list" }
  | { kind: "u32-array" }
  | { kind: "phandle-list" }
  | { kind: "bytes" }
  | { kind: "mixed" }
  | { kind: "unknown" };

export type DriverSchema = {
  id: string;
  /** Primary compatible used in matcher evidence / golden assertions. */
  compatible: string;
  compatiblePatterns: string[];
  /** Optional nodename selectors for child nodes without compatible. */
  nodenamePatterns: string[];
  source: SchemaSource;
  schemaNamespace: string;
  version: number;
  lifecycle: SpecLifecycle;
  propertyIds: string[];
  /** Referenced common schema ids loaded alongside this driver. */
  commonRefs: string[];
};

export type PropertySpec = {
  id: string;
  parameterSpecId: string;
  driverSchemaId: string | null;
  propertyKey: string;
  schemaNamespace: string;
  source: SchemaSource;
  lifecycle: SpecLifecycle;
  valueShape: PropertyValueShape;
  units?: string;
  constraints: Record<string, unknown>;
  /** Illustrative only — never enforced as default or policy. */
  exampleValue?: unknown;
  /** Only when present in a pinned schema; never invented by the matcher. */
  schemaDefault?: unknown;
  documentation?: string;
};

export type SchemaCatalog = {
  linuxDtSchemaRevision: string;
  dtschemaVersion: string;
  vendorContentHash: string;
  importedAt: string;
  schemaPaths: string[];
};

export type SchemaRegistry = {
  catalog: SchemaCatalog;
  drivers: DriverSchema[];
  properties: PropertySpec[];
  propertiesById: Map<string, PropertySpec>;
  driversById: Map<string, DriverSchema>;
};

export type MatchableNode = {
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  compatible: string[];
  properties: Record<string, { rawText: string }>;
};

export type SpecReviewBlockerScope = "revision" | "project" | "platform";

export type SpecReviewTaskDraft = {
  id: string;
  parameterSpecId?: string;
  projectId?: string;
  configRevisionId?: string;
  propertyOccurrenceId?: string;
  blockerScope?: SpecReviewBlockerScope;
  sourceEvidence: Record<string, unknown>;
  candidateSchemas: unknown[];
  projectCount: number;
  status: "open" | "resolved" | "dismissed";
};

export type PropertyBinding = {
  nodeLocator: string;
  propertyKey: string;
  propertySpecId: string;
  driverSchemaId: string | null;
  evidence: string[];
};

export type GoldenCoverage = {
  totalProperties: number;
  matchedProperties: number;
  bindings: PropertyBinding[];
  unmatched: Array<{ nodeLocator: string; propertyKey: string; evidence: string[] }>;
  ambiguous: Array<{ nodeLocator: string; propertyKey: string; candidates: string[] }>;
};

/** On-disk vendor / linux schema document (YAML). */
export type SchemaDocument = {
  $id: string;
  title?: string;
  source: SchemaSource;
  lifecycle?: SpecLifecycle;
  version?: number;
  schemaNamespace: string;
  compatible?: string[];
  nodename?: string[];
  commonRefs?: string[];
  properties?: Record<string, SchemaPropertyDocument>;
};

export type SchemaPropertyDocument = {
  valueShape?: PropertyValueShape["kind"] | PropertyValueShape;
  units?: string;
  constraints?: Record<string, unknown>;
  exampleValue?: unknown;
  schemaDefault?: unknown;
  documentation?: string;
  source?: SchemaSource;
  lifecycle?: SpecLifecycle;
};
