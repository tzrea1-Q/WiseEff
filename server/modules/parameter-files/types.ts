export type ParameterFileFormat = "dts" | "json";
export type ParameterFileVersionOrigin = "upload" | "writeback" | "rollback";

export type ParsedIndexEntry = {
  value: string;
  line?: number;
};

export type ParsedIndex = Record<string, ParsedIndexEntry>;

export type ProjectParameterFileDto = {
  id: string;
  projectId: string;
  fileName: string;
  format: ParameterFileFormat;
  moduleHint?: string;
  enabled: boolean;
  currentVersionId?: string;
  currentVersionNumber?: number;
  updatedAt: string;
};

export type ProjectParameterFileVersionDto = {
  id: string;
  fileId: string;
  versionNumber: number;
  storageKey: string;
  checksum: string;
  sizeBytes: number;
  parsedIndex: ParsedIndex;
  origin: ParameterFileVersionOrigin;
  createdAt: string;
  createdByUserId?: string;
};

export type InsertProjectParameterFileInput = {
  id: string;
  organizationId: string;
  projectId: string;
  fileName: string;
  format: ParameterFileFormat;
  moduleHint?: string;
  enabled?: boolean;
};

export type InsertFileVersionInput = {
  id: string;
  fileId: string;
  versionNumber: number;
  storageKey: string;
  checksum: string;
  sizeBytes: number;
  parsedIndex?: ParsedIndex;
  origin: ParameterFileVersionOrigin;
  createdByUserId?: string;
};

/** Staged candidate lifecycle states (ADR-0018 / #232). */
export type CandidateStatus =
  | "uploading"
  | "parsing"
  | "ready"
  | "blocked"
  | "failed"
  | "abandoned"
  | "stale"
  | "active";

export type CandidateDiagnosticSeverity = "error" | "warning" | "info";

export type CandidateDiagnostic = {
  severity: CandidateDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
};

export type CandidateBlocker = {
  code: string;
  message: string;
};

export type CandidateStructuralChange =
  | { kind: "node_added" | "node_removed"; nodePath: string }
  | {
      kind: "prop_added" | "prop_removed" | "prop_changed";
      nodePath: string;
      prop: string;
      before?: string;
      after?: string;
    };

export type CandidateCoverageEffect = {
  matchedRegistered: string[];
  newUnregistered: string[];
  matchedRegisteredCount: number;
  newUnregisteredCount: number;
};

export type CandidateConflictEvidence = {
  id: string;
  parameterName?: string;
  parameterModule?: string;
  status: string;
  fileValue?: string;
  uiDraftValue?: string;
};

export type CandidateImpact = {
  textDiff?: string;
  structuralDiff?: CandidateStructuralChange[];
  diagnostics?: CandidateDiagnostic[];
  coverage?: CandidateCoverageEffect;
  conflicts?: CandidateConflictEvidence[];
  blockers?: CandidateBlocker[];
};

export type ProjectParameterFileCandidateDto = {
  id: string;
  organizationId: string;
  projectId: string;
  fileId?: string;
  fileName: string;
  format: ParameterFileFormat;
  status: CandidateStatus;
  baseVersionId?: string;
  storageKey?: string;
  checksum?: string;
  sizeBytes?: number;
  parsedIndex: ParsedIndex;
  diagnostics: CandidateDiagnostic[];
  impact: CandidateImpact;
  blockers: CandidateBlocker[];
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  abandonedAt?: string;
  abandonedByUserId?: string;
  activatedAt?: string;
  activatedByUserId?: string;
  activatedVersionId?: string;
};

export type InsertParameterFileCandidateInput = {
  id: string;
  organizationId: string;
  projectId: string;
  fileId?: string;
  fileName: string;
  format: ParameterFileFormat;
  status: CandidateStatus;
  baseVersionId?: string;
  storageKey?: string;
  checksum?: string;
  sizeBytes?: number;
  parsedIndex?: ParsedIndex;
  diagnostics?: CandidateDiagnostic[];
  impact?: CandidateImpact;
  blockers?: CandidateBlocker[];
  createdByUserId?: string;
};

export type UpdateParameterFileCandidateParseResultInput = {
  candidateId: string;
  status: CandidateStatus;
  storageKey?: string;
  checksum?: string;
  sizeBytes?: number;
  parsedIndex?: ParsedIndex;
  diagnostics?: CandidateDiagnostic[];
  impact?: CandidateImpact;
  blockers?: CandidateBlocker[];
};

export type ConfigSetRole = "base" | "overlay" | "charging" | "thermal" | "misc";

/**
 * Roles applied on top of the `base` entry when a config set is compiled. The
 * config-revision assembly and the DTS validation gate must use the same set,
 * or a functional-role file (charging/thermal/misc) would be released without
 * ever being dtc-compiled.
 */
export const OVERLAY_ROLES: ReadonlySet<ConfigSetRole> = new Set<ConfigSetRole>([
  "overlay",
  "charging",
  "thermal",
  "misc"
]);

export type ConfigSetDto = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description?: string;
  derivedFromId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConfigSetFileDto = {
  configSetId: string;
  fileId: string;
  role: ConfigSetRole;
  sortOrder: number;
};

export type InsertConfigSetInput = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description?: string;
  derivedFromId?: string;
};

export type UpdateConfigSetInput = {
  id: string;
  name: string;
  description?: string;
  derivedFromId?: string;
};

export type SetFileConfigSetMembershipInput = {
  fileId: string;
  configSetId: string;
  role: ConfigSetRole;
  sortOrder: number;
};

export type FileConfigSetMembershipDto = {
  fileId: string;
  organizationId: string;
  projectId: string;
  configSetId?: string;
  configSetRole?: ConfigSetRole;
  configSetSortOrder: number;
};

export type BaselineStatus = "draft" | "released" | "historical";

export type ReleaseBaselineDto = {
  id: string;
  organizationId: string;
  configSetId: string;
  name: string;
  notes?: string;
  status: BaselineStatus;
  createdBy?: string;
  createdAt: string;
};

export type ReleaseBaselineMemberDto = {
  baselineId: string;
  fileId: string;
  fileVersionId: string;
  versionNumber: number;
};

export type InsertReleaseBaselineInput = {
  id: string;
  organizationId: string;
  configSetId: string;
  name: string;
  notes?: string;
  createdByUserId?: string;
};

export type InsertReleaseBaselineMemberInput = {
  id: string;
  baselineId: string;
  fileId: string;
  fileVersionId: string;
  versionNumber: number;
};

export type ConfigSetMemberFileDto = {
  configSetId: string;
  fileId: string;
  fileName: string;
  format: ParameterFileFormat;
  role: ConfigSetRole;
  sortOrder: number;
  currentVersionId?: string;
  currentVersionNumber?: number;
};
