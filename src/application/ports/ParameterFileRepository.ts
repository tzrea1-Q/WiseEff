export type ParameterFileFormat = "dts" | "json";
export type ParameterFileVersionOrigin = "upload" | "writeback";

export type ParameterFileParsedIndexEntry = {
  value: string;
  line?: number;
};

export type ParameterFileParsedIndex = Record<string, ParameterFileParsedIndexEntry>;

export type ProjectParameterFile = {
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

export type ProjectParameterFileVersion = {
  id: string;
  fileId: string;
  versionNumber: number;
  checksum: string;
  sizeBytes: number;
  parsedIndex: ParameterFileParsedIndex;
  origin: ParameterFileVersionOrigin;
  createdAt: string;
  createdByUserId?: string;
};

export type UploadParameterFileInput = {
  fileName: string;
  contentBase64: string;
};

export type FileSyncSummary = {
  draftsCreated: number;
  unchanged: number;
  unmatched: number;
  skipped: boolean;
  /** Count of sync keys matched via (name, module) fallback rather than source_* bind. */
  identityFallbackUses?: number;
};

export type ParameterFileConflictStatus = "open" | "resolved_file" | "resolved_ui";

export type ParameterFileSyncConflict = {
  id: string;
  organizationId: string;
  projectId: string;
  projectParameterValueId: string;
  parameterDefinitionId: string;
  parameterName?: string;
  parameterModule?: string;
  fileVersionId: string;
  fileDraftId: string;
  uiDraftId: string;
  fileValue: string;
  uiDraftValue: string;
  status: ParameterFileConflictStatus;
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
};

export type DownloadParameterFileVersionResult = {
  contentType: string;
  fileName?: string;
  bytes: Uint8Array;
};

export type ParameterFileConflictResolution = "file" | "ui";

/** One-shot DTS upload comparison against registered drivers (ADR-0007). */
export type IngestDriverSummary = {
  matchedRegistered: string[];
  newUnregistered: string[];
  matchedRegisteredCount: number;
  newUnregisteredCount: number;
};

export type UploadParameterFileResult = {
  item: ProjectParameterFile;
  version: ProjectParameterFileVersion;
  driverSummary?: IngestDriverSummary;
};

export type UploadParameterFileVersionResult = {
  item: ProjectParameterFileVersion;
  driverSummary?: IngestDriverSummary;
};

export type ParameterFileCandidateStatus =
  | "uploading"
  | "parsing"
  | "ready"
  | "blocked"
  | "failed"
  | "abandoned";

export type ParameterFileCandidateDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
};

export type ParameterFileCandidateBlocker = {
  code: string;
  message: string;
};

export type ParameterFileCandidateStructuralChange =
  | { kind: "node_added" | "node_removed"; nodePath: string }
  | {
      kind: "prop_added" | "prop_removed" | "prop_changed";
      nodePath: string;
      prop: string;
      before?: string;
      after?: string;
    };

export type ParameterFileCandidateImpact = {
  textDiff?: string;
  structuralDiff?: ParameterFileCandidateStructuralChange[];
  diagnostics?: ParameterFileCandidateDiagnostic[];
  coverage?: IngestDriverSummary;
  conflicts?: Array<{
    id: string;
    parameterName?: string;
    parameterModule?: string;
    status: string;
    fileValue?: string;
    uiDraftValue?: string;
  }>;
  blockers?: ParameterFileCandidateBlocker[];
};

export type ParameterFileCandidate = {
  id: string;
  organizationId?: string;
  projectId: string;
  fileId?: string;
  fileName: string;
  format: ParameterFileFormat;
  status: ParameterFileCandidateStatus;
  baseVersionId?: string;
  checksum?: string;
  sizeBytes?: number;
  parsedIndex?: ParameterFileParsedIndex;
  diagnostics: ParameterFileCandidateDiagnostic[];
  impact: ParameterFileCandidateImpact;
  blockers: ParameterFileCandidateBlocker[];
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  abandonedAt?: string;
  abandonedByUserId?: string;
};

export type CreateParameterFileCandidateInput = {
  fileName: string;
  contentBase64: string;
  fileId?: string;
};

export type DownloadParameterFileCandidateResult = {
  contentType: string;
  fileName?: string;
  bytes: Uint8Array;
};


export interface ParameterFileRepository {
  listFiles(projectId: string): Promise<ProjectParameterFile[]>;
  uploadFile(projectId: string, input: UploadParameterFileInput): Promise<UploadParameterFileResult>;
  uploadVersion(
    projectId: string,
    fileId: string,
    input: UploadParameterFileInput
  ): Promise<UploadParameterFileVersionResult>;
  listVersions(projectId: string, fileId: string): Promise<ProjectParameterFileVersion[]>;
  downloadVersion(projectId: string, fileId: string, versionId: string): Promise<DownloadParameterFileVersionResult>;
  syncFile(projectId: string, fileId: string): Promise<FileSyncSummary>;
  listConflicts(projectId: string): Promise<ParameterFileSyncConflict[]>;
  resolveConflict(projectId: string, conflictId: string, resolution: ParameterFileConflictResolution): Promise<ParameterFileSyncConflict>;
  listCandidates(projectId: string, options?: { fileId?: string; includeAbandoned?: boolean }): Promise<ParameterFileCandidate[]>;
  createCandidate(projectId: string, input: CreateParameterFileCandidateInput): Promise<ParameterFileCandidate>;
  getCandidate(projectId: string, candidateId: string): Promise<ParameterFileCandidate>;
  getCandidateImpact(projectId: string, candidateId: string): Promise<{ item: ParameterFileCandidate; impact: ParameterFileCandidateImpact }>;
  downloadCandidate(projectId: string, candidateId: string): Promise<DownloadParameterFileCandidateResult>;
  abandonCandidate(projectId: string, candidateId: string): Promise<ParameterFileCandidate>;
  recomputeCandidate(projectId: string, candidateId: string): Promise<ParameterFileCandidate>;
}
