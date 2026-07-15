export type DtsValueType =
  | "u32-array"
  | "bytes"
  | "string-list"
  | "phandle-list"
  | "mixed"
  | "bool"
  | "empty";

export type DtsStructuralProperty = {
  name: string;
  valueType: DtsValueType;
  rawText: string;
  normalizedValue: string;
};

export type DtsStructuralPhandleRef = {
  fromProperty: string;
  targetLabel: string;
  resolvedTargetPath?: string;
};

export type DtsStructuralNode = {
  nodePath: string;
  name: string;
  unitAddress?: string;
  labels: string[];
  compatible?: string;
  status?: string;
  properties: DtsStructuralProperty[];
  phandleRefs: DtsStructuralPhandleRef[];
};

export type DtsStructureResult = {
  nodes: DtsStructuralNode[];
};

export type DtsSearchBy = "path" | "address" | "label" | "compatible" | "value";

export type DtsSearchQuery = {
  q: string;
  by?: DtsSearchBy;
};

export type DtsSearchHit = {
  fileId: string;
  fileName: string;
  versionId: string;
  nodePath: string;
  propertyName?: string;
  snippet?: string;
};

export type DtsSearchResult = {
  hits: DtsSearchHit[];
};

export type ConfigSetRole = "base" | "overlay" | "charging" | "thermal" | "misc";

export type DtsConfigSet = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description?: string;
  derivedFromId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateConfigSetInput = {
  name: string;
  description?: string;
  derivedFromId?: string;
};

export type DtsConfigSetFile = {
  configSetId: string;
  fileId: string;
  role: ConfigSetRole;
  sortOrder: number;
};

export type AddConfigSetFileInput = {
  fileId: string;
  role: ConfigSetRole;
  sortOrder?: number;
};

export type BaselineStatus = "draft" | "released";

export type DtsReleaseBaseline = {
  id: string;
  organizationId: string;
  configSetId: string;
  name: string;
  notes?: string;
  status: BaselineStatus;
  createdBy?: string;
  createdAt: string;
};

export type CreateBaselineInput = {
  name: string;
  notes?: string;
};

export type DtsStructuralChange =
  | { kind: "node_added" | "node_removed"; nodePath: string }
  | {
      kind: "prop_added" | "prop_removed" | "prop_changed";
      nodePath: string;
      prop: string;
      before?: string;
      after?: string;
    };

export type BaselineMemberCompareStatus = "unchanged" | "version_changed" | "file_added" | "file_removed";

export type DtsBaselineMemberComparison = {
  fileId: string;
  fileName?: string;
  status: BaselineMemberCompareStatus;
  baselineVersionId?: string;
  currentVersionId?: string;
  structuralDiff?: DtsStructuralChange[];
};

export type DtsCompareBaselineResult = {
  baselineId: string;
  members: DtsBaselineMemberComparison[];
};

export type DtsRollbackBaselineResult = {
  baselineId: string;
  restored: number;
};

export type DtsValidationGateResult = {
  ok: boolean;
  mode: "block" | "warn" | "off";
  requiresConfirmation: boolean;
  diagnostics: Array<{
    file?: string;
    line?: number;
    severity: "error" | "warning" | "info";
    message: string;
  }>;
  compiler: "dtc" | "unavailable";
};

export type DtsReleaseBaselineResult = {
  item: DtsReleaseBaseline;
  gate: DtsValidationGateResult;
};

export type DtsExportConfigSetManifestMember = {
  fileId: string;
  fileName: string;
  role: ConfigSetRole;
  sortOrder: number;
  versionNumber: number;
  format: "dts" | "json";
};

export type DtsExportConfigSetManifest = {
  configSetId: string;
  name: string;
  projectId: string;
  exportedAt: string;
  validation?: {
    ok: boolean;
    mode: "block" | "warn" | "off";
    compiler: "dtc" | "unavailable";
    requiresConfirmation: boolean;
  };
  members: DtsExportConfigSetManifestMember[];
};

export type DtsExportConfigSetFile = {
  name: string;
  format: "dts" | "json";
  content: string;
};

export type DtsExportConfigSetResult = {
  manifest: DtsExportConfigSetManifest;
  files: DtsExportConfigSetFile[];
};

/** One structured DTS property edit submitted through the existing change-request flow. */
export type DtsStructuredEditUnit = {
  fileId: string;
  nodePath: string;
  propertyName: string;
  /** CST-preserving property text; becomes CR targetValue / writeback payload. */
  rawText: string;
  reason?: string;
};

export type DtsSubmitStructuredEditsInput = {
  edits: DtsStructuredEditUnit[];
  reason?: string;
  assignees?: {
    hardwareCommitterId: string;
    softwareCommitterId: string;
    softwareUserId: string;
  };
};

export type DtsStructuredSubmissionItem = {
  requestId?: string;
  parameterId: string;
  name?: string;
  module?: string;
  currentValue?: string;
  targetValue: string;
  reason: string;
};

export type DtsStructuredSubmissionRound = {
  id: string;
  projectId: string;
  projectName?: string;
  submitter?: string;
  createdAt?: string;
  status: string;
  summary?: string;
  items: DtsStructuredSubmissionItem[];
};

/**
 * Structured DTS + config-set/baseline surface for P3 / P3.1.
 * New UI must consume this port; do not call HTTP clients directly from panels.
 */
export interface DtsStructuredRepository {
  getStructure(projectId: string, fileId: string, versionId: string): Promise<DtsStructureResult>;
  search(projectId: string, query: DtsSearchQuery): Promise<DtsSearchResult>;

  listConfigSets(projectId: string): Promise<DtsConfigSet[]>;
  createConfigSet(projectId: string, input: CreateConfigSetInput): Promise<DtsConfigSet>;
  addConfigSetFile(projectId: string, configSetId: string, input: AddConfigSetFileInput): Promise<DtsConfigSetFile>;
  removeConfigSetFile(projectId: string, configSetId: string, fileId: string): Promise<void>;

  listBaselines(projectId: string, configSetId: string): Promise<DtsReleaseBaseline[]>;
  createBaseline(projectId: string, configSetId: string, input: CreateBaselineInput): Promise<DtsReleaseBaseline>;
  compareBaseline(projectId: string, baselineId: string): Promise<DtsCompareBaselineResult>;
  rollbackBaseline(projectId: string, baselineId: string): Promise<DtsRollbackBaselineResult>;
  releaseBaseline(projectId: string, baselineId: string): Promise<DtsReleaseBaselineResult>;

  exportConfigSet(projectId: string, configSetId: string): Promise<DtsExportConfigSetResult>;

  /** Submit structured edits as a change-request round (rawText fidelity). */
  submitStructuredEdits(
    projectId: string,
    input: DtsSubmitStructuredEditsInput
  ): Promise<DtsStructuredSubmissionRound>;
}
