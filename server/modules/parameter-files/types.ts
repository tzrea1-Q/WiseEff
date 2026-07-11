export type ParameterFileFormat = "dts" | "json";
export type ParameterFileVersionOrigin = "upload" | "writeback";

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
  checksum: string;
  sizeBytes: number;
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
