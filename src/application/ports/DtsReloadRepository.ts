import type {
  DtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
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

export interface DtsReloadRepository {
  listCandidates(projectId: string): Promise<{ items: DtsReloadCandidate[] }>;
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
  upsertDeviceReloadConfiguration(
    deviceId: string,
    contract: ReloadConfigurationContract
  ): Promise<ReloadConfigurationAdminView["deviceOverrides"][number]>;
  deleteDeviceReloadConfiguration(deviceId: string): Promise<{ deviceId: string }>;
}
