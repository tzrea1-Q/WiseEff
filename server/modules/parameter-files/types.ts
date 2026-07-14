export type ParameterFileFormat = "dts" | "json";
export type ParameterFileVersionOrigin = "upload" | "writeback" | "rollback";

export type { UnsupportedConstruct, UnsupportedConstructCode } from "./unsupported";

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

export type ConfigSetRole = "base" | "overlay" | "charging" | "thermal" | "misc";

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

export type BaselineStatus = "draft" | "released";

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
  fileId: string;
  fileName: string;
  currentVersionId?: string;
  currentVersionNumber?: number;
};
