import type {
  DtsReloadCandidate as DomainDtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListResult,
  DtsReloadRunStatus,
  ReloadConfigurationAdminView,
  ReloadConfigurationContract
} from "@/domain/dtsReload/types";

export type DtsReloadProtectedReferencePin = {
  kind: "canonical-pin";
  bindingId: string;
  configRevisionId?: string | null;
  definitionRevisionId?: string;
  currentValueId?: string;
  catalogReleaseId?: string;
};

export type DtsReloadWritebackSourcePin = {
  kind: "source-writeback";
  sourceRef: string;
  configRevisionId?: string | null;
};

export type DtsReloadCandidate = DomainDtsReloadCandidate & {
  protectedReferencePin?: DtsReloadProtectedReferencePin;
  writebackSourcePin?: DtsReloadWritebackSourcePin;
};

export type StartDtsReloadRunInput = {
  projectId: string;
  targets: Array<{
    bindingId: string;
    debugValue: string;
    definitionRevisionId?: string;
    currentValueId?: string;
    catalogReleaseId?: string;
  }>;
  /** Required for critical-tier sensitive matches: `confirm-sensitive-reload`. */
  confirmationToken?: string;
};

export type RestoreDtsReloadBaselineInput = {
  projectId: string;
  deviceId: string;
  /** Required for critical-tier sensitive matches: `confirm-sensitive-reload`. */
  confirmationToken?: string;
};

export type DeployDtsReloadRunInput = {
  runId: string;
  deviceId: string;
  bridgeId: string;
  targetRef: string;
  protocol: "hdc" | "adb";
  /** Must include `confirm-dts-reload`. Never inject from runtime. */
  confirmationTokens: string[];
};

export type ListDtsReloadRunsInput = {
  projectId?: string;
  deviceId?: string;
  cursor?: string | null;
  limit?: number;
};

export type PromoteDtsReloadRunToDraftsInput = {
  runId: string;
  bindingIds: string[];
  unverifiableAcknowledged?: boolean;
};

export type PromotedDtsReloadDraft = {
  bindingId: string;
  draftId: string;
  outcome: "created" | "updated" | "unchanged";
};

export type PromoteDtsReloadRunToDraftsResult = {
  runId: string;
  status: DtsReloadRunStatus;
  drafts: PromotedDtsReloadDraft[];
  workbenchHref: string;
};

export interface DtsReloadRepository {
  listCandidates(projectId: string): Promise<{ items: DtsReloadCandidate[] }>;
  listRuns(input: ListDtsReloadRunsInput): Promise<DtsReloadRunListResult>;
  startRun(input: StartDtsReloadRunInput): Promise<DtsReloadRun>;
  restoreBaseline(input: RestoreDtsReloadBaselineInput): Promise<DtsReloadRun>;
  getResidue(deviceId: string): Promise<DtsReloadResidue | null>;
  deployRun(input: DeployDtsReloadRunInput): Promise<DtsReloadRun>;
  getRun(runId: string): Promise<DtsReloadRun>;
  downloadArtifact(runId: string): Promise<Blob>;
  promoteToDrafts(input: PromoteDtsReloadRunToDraftsInput): Promise<PromoteDtsReloadRunToDraftsResult>;
  getReloadConfiguration(): Promise<ReloadConfigurationAdminView>;
  updateOrganisationReloadConfiguration(
    contract: ReloadConfigurationContract
  ): Promise<ReloadConfigurationAdminView["organisation"]>;
}
