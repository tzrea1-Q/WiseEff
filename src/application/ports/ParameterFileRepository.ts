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

export interface ParameterFileRepository {
  listFiles(projectId: string): Promise<ProjectParameterFile[]>;
  uploadFile(projectId: string, input: UploadParameterFileInput): Promise<{ item: ProjectParameterFile; version: ProjectParameterFileVersion }>;
  uploadVersion(projectId: string, fileId: string, input: UploadParameterFileInput): Promise<ProjectParameterFileVersion>;
  listVersions(projectId: string, fileId: string): Promise<ProjectParameterFileVersion[]>;
  downloadVersion(projectId: string, fileId: string, versionId: string): Promise<DownloadParameterFileVersionResult>;
  syncFile(projectId: string, fileId: string): Promise<FileSyncSummary>;
  listConflicts(projectId: string): Promise<ParameterFileSyncConflict[]>;
  resolveConflict(projectId: string, conflictId: string, resolution: ParameterFileConflictResolution): Promise<ParameterFileSyncConflict>;
}
