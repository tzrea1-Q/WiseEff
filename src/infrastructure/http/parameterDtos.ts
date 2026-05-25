import type {
  ChangeRequest,
  ImpactItem,
  ParameterHistoryEntry,
  ParameterRecord,
  ParameterSubmissionRound,
  ParameterSubmissionItem,
  RequestStatus,
  RiskLevel
} from "@/domain/parameters/types";
import type { ParameterDraftDto as PortParameterDraftDto, ParameterImportBatchDto as PortParameterImportBatchDto, ProjectSummary } from "@/application/ports/ParameterRepository";

export type BackendRiskLevel = "high" | "medium" | "low";

export type BackendRequestStatus =
  | "submitted"
  | "hardware_review"
  | "software_review"
  | "software_merge"
  | "merged"
  | "rejected"
  | "withdrawn"
  | "stashed";

export type ProjectDto = ProjectSummary;

export type ParameterHistoryEntryDto = ParameterHistoryEntry;

export type ParameterRecordDto = Omit<ParameterRecord, "risk" | "history"> & {
  risk: BackendRiskLevel;
  history: ParameterHistoryEntryDto[];
};

export type ParameterDraftDto = PortParameterDraftDto;

export type ImpactItemDto = Omit<ImpactItem, "risk"> & {
  risk: BackendRiskLevel;
};

export type ChangeRequestDto = Omit<ChangeRequest, "status" | "impact"> & {
  status: BackendRequestStatus;
  impact: ImpactItemDto[];
};

export type ParameterSubmissionItemDto = Omit<ParameterSubmissionItem, "risk"> & {
  risk: BackendRiskLevel;
};

export type ParameterSubmissionRoundDto = Omit<ParameterSubmissionRound, "status" | "items"> & {
  status: BackendRequestStatus;
  items: ParameterSubmissionItemDto[];
};

export type ParameterImportBatchDto = PortParameterImportBatchDto;

const riskLabels: Record<BackendRiskLevel, RiskLevel> = {
  high: "High",
  medium: "Medium",
  low: "Low"
};

const requestStatusLabels: Record<BackendRequestStatus, ParameterSubmissionRound["status"]> = {
  submitted: "待审阅",
  hardware_review: "硬件Committer检视",
  software_review: "软件Committer检视",
  software_merge: "软件User合入",
  merged: "已合入",
  rejected: "已打回",
  withdrawn: "已撤回",
  stashed: "已暂存"
};

export function projectFromDto(dto: ProjectDto): ProjectSummary {
  return { ...dto };
}

export function parameterHistoryEntryFromDto(dto: ParameterHistoryEntryDto): ParameterHistoryEntry {
  return { ...dto };
}

export function parameterRecordFromDto(dto: ParameterRecordDto): ParameterRecord {
  return {
    ...dto,
    risk: riskLabels[dto.risk],
    history: dto.history.map(parameterHistoryEntryFromDto)
  };
}

export function parameterDraftFromDto(dto: ParameterDraftDto): PortParameterDraftDto {
  return { ...dto };
}

export function changeRequestFromDto(dto: ChangeRequestDto): ChangeRequest {
  return {
    ...dto,
    status: requestStatusLabels[dto.status] as RequestStatus,
    impact: dto.impact.map((item) => ({
      ...item,
      risk: riskLabels[item.risk]
    }))
  };
}

export function submissionRoundFromDto(dto: ParameterSubmissionRoundDto): ParameterSubmissionRound {
  return {
    ...dto,
    status: requestStatusLabels[dto.status],
    items: dto.items.map((item) => ({
      ...item,
      risk: riskLabels[item.risk]
    }))
  };
}

export function importBatchFromDto(dto: ParameterImportBatchDto): PortParameterImportBatchDto {
  return {
    ...dto,
    summary: { ...dto.summary },
    items: dto.items.map((item) => ({ ...item }))
  };
}
