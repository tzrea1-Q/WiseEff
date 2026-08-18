import type { LogRunStatus, LogStage } from "../logs/status";

export type LogAnalysisJobKind = "log-analysis";
export type LogAnalysisJobStatus = LogRunStatus;

export type LogAnalysisJobDto = {
  id: string;
  kind: LogAnalysisJobKind;
  logId: string;
  runId: string;
  status: LogAnalysisJobStatus;
  progress: number;
  currentStage: LogStage;
  error: string | null;
  updatedAt: string;
};

export type ClaimedLogAnalysisJobDto = LogAnalysisJobDto & {
  organizationId: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
};

export type LogAnalysisJobSnapshotDto = LogAnalysisJobDto & {
  organizationId: string;
};

export type OverlayArtifactGcJobKind = "overlay-artifact-gc";
export type OverlayArtifactGcJobStatus = "queued" | "processing" | "complete" | "failed";

export type OverlayArtifactGcJobDto = {
  id: string;
  kind: OverlayArtifactGcJobKind;
  organizationId: string;
  status: OverlayArtifactGcJobStatus;
  progress: number;
  error: string | null;
  updatedAt: string;
};

export type ClaimedOverlayArtifactGcJobDto = OverlayArtifactGcJobDto & {
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
};
