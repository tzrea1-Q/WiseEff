import type {
  DtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListResult,
  ReloadConfigurationAdminView,
  ReloadConfigurationContract
} from "@/domain/dtsReload/types";

export type StartDtsReloadRunInput = {
  projectId: string;
  targets: Array<{ bindingId: string; debugValue: string }>;
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

export interface DtsReloadRepository {
  listCandidates(projectId: string): Promise<{ items: DtsReloadCandidate[] }>;
  listRuns(input: ListDtsReloadRunsInput): Promise<DtsReloadRunListResult>;
  startRun(input: StartDtsReloadRunInput): Promise<DtsReloadRun>;
  restoreBaseline(input: RestoreDtsReloadBaselineInput): Promise<DtsReloadRun>;
  getResidue(deviceId: string): Promise<DtsReloadResidue | null>;
  deployRun(input: DeployDtsReloadRunInput): Promise<DtsReloadRun>;
  getRun(runId: string): Promise<DtsReloadRun>;
  downloadArtifact(runId: string): Promise<Blob>;
  getReloadConfiguration(): Promise<ReloadConfigurationAdminView>;
  updateOrganisationReloadConfiguration(
    contract: ReloadConfigurationContract
  ): Promise<ReloadConfigurationAdminView["organisation"]>;
}
