import type { ConfigSetRole } from "../parameter-files/types";
import type { DtsSourceEffect } from "../dts";

export type ConfigRevisionStatus =
  | "draft"
  | "resolving"
  | "needs_mapping"
  | "invalid"
  | "resolved"
  | "validated"
  | "compiled"
  | "pending_approval"
  | "published";

export type ConfigRevisionMemberRole = ConfigSetRole | "base" | "overlay" | "include";

export type ConfigRevisionManifestMember = {
  fileId: string;
  fileVersionId: string;
  fileName: string;
  role: ConfigRevisionMemberRole;
  sortOrder: number;
  content: string;
};

/**
 * Complete config-set manifest required for semantic ingest.
 * Isolated DTS members without entry/overlays/includes must not call ingest.
 */
export type ConfigRevisionManifest = {
  organizationId: string;
  projectId: string;
  configSetId: string;
  entryFile: string;
  includeSearchPaths: string[];
  overlayOrder: string[];
  members: ConfigRevisionManifestMember[];
};

export type DtsConfigRevisionDto = {
  id: string;
  organizationId: string;
  projectId: string;
  configSetId: string;
  revisionNumber: number;
  status: ConfigRevisionStatus;
  createdByUserId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type LineColumn = {
  line: number;
  column: number;
};

export type PersistedNodeOccurrence = {
  id: string;
  fileVersionId: string;
  parentOccurrenceId: string | null;
  name: string;
  unitAddress?: string;
  labels: string[];
  refTarget?: string;
  isOverlayRoot: boolean;
  nodePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  rawText: string;
  astJson: unknown;
  sourceOrder: number;
  contentHash: string;
};

export type PersistedPropertyOccurrence = {
  id: string;
  nodeOccurrenceId: string;
  fileVersionId: string;
  propertyName: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  rawText: string;
  astJson: unknown;
  sourceOrder: number;
  contentHash: string;
};

export type PersistedOccurrenceEffect = {
  id: string;
  logicalNodeRevisionId: string;
  propertyName: string | null;
  effectKind: DtsSourceEffect;
  nodeOccurrenceId: string | null;
  propertyOccurrenceId: string | null;
  sourceOrder: number;
};

export type PersistedLogicalNodeRevision = {
  id: string;
  logicalNodeId: string;
  nodeLocator: string;
  name: string;
  unitAddress?: string;
  compatible?: string;
  driverSchemaVersionId?: string | null;
  parentLogicalNodeId: string | null;
};

export type PersistedValidationDiagnostic = {
  id: string;
  code: string;
  severity: "error" | "warning" | "info";
  stage: string;
  message: string;
  fileName: string;
  startLine?: number;
  startColumn?: number;
  guidance?: string;
};
