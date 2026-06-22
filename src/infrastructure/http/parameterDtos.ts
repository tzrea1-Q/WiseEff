import type {
  ChangeRequest,
  ImpactItem,
  ParameterHistoryEntry,
  ParameterRecord,
  ParameterSubmissionRound,
  ParameterSubmissionItem,
  RiskLevel
} from "@/domain/parameters/types";
import type { ParameterDraftDto as PortParameterDraftDto, ParameterImportBatchDto as PortParameterImportBatchDto, ProjectSummary } from "@/application/ports/ParameterRepository";

export type BackendRiskLevel = RiskLevel;

export type BackendChangeRequestStatus =
  | "submitted"
  | "hardware_review"
  | "software_review"
  | "software_merge"
  | "merged"
  | "rejected";

export type BackendSubmissionRoundStatus =
  | BackendChangeRequestStatus
  | "withdrawn"
  | "stashed";

export type ProjectDto = ProjectSummary;

export type ParameterHistoryEntryDto = ParameterHistoryEntry;

export type ParameterRecordDto = Omit<ParameterRecord, "risk" | "history" | "valueKind"> & {
  risk: BackendRiskLevel;
  valueKind?: ParameterRecord["valueKind"];
  history: ParameterHistoryEntryDto[];
};

export type ParameterDraftDto = PortParameterDraftDto;

export type ImpactItemDto = Omit<ImpactItem, "risk"> & {
  risk: BackendRiskLevel;
};

export type ChangeRequestDto = Omit<ChangeRequest, "status" | "impact"> & {
  status: BackendChangeRequestStatus;
  impact: ImpactItemDto[];
};

export type ParameterSubmissionItemDto = Omit<ParameterSubmissionItem, "risk" | "valueKind"> & {
  risk: BackendRiskLevel;
  valueKind?: ParameterSubmissionItem["valueKind"];
};

export type ParameterSubmissionRoundDto = Omit<ParameterSubmissionRound, "status" | "items"> & {
  status: BackendSubmissionRoundStatus;
  items: ParameterSubmissionItemDto[];
};

export type ParameterImportBatchDto = PortParameterImportBatchDto;

const riskLabels: Record<BackendRiskLevel, RiskLevel> = {
  High: "High",
  Medium: "Medium",
  Low: "Low"
};

const changeRequestStatusLabels: Record<BackendChangeRequestStatus, ChangeRequest["status"]> = {
  submitted: "待审阅",
  hardware_review: "硬件Committer检视",
  software_review: "软件Committer检视",
  software_merge: "软件User合入",
  merged: "已合入",
  rejected: "已打回"
};

const submissionRoundStatusLabels: Record<BackendSubmissionRoundStatus, ParameterSubmissionRound["status"]> = {
  ...changeRequestStatusLabels,
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
    valueKind: dto.valueKind ?? "scalar",
    history: dto.history.map(parameterHistoryEntryFromDto)
  };
}

export function parameterDraftFromDto(dto: ParameterDraftDto): PortParameterDraftDto {
  return { ...dto };
}

export function changeRequestFromDto(dto: ChangeRequestDto): ChangeRequest {
  return {
    ...dto,
    status: changeRequestStatusLabels[dto.status],
    impact: dto.impact.map((item) => ({
      ...item,
      risk: riskLabels[item.risk]
    }))
  };
}

export function submissionRoundFromDto(dto: ParameterSubmissionRoundDto): ParameterSubmissionRound {
  return {
    ...dto,
    status: submissionRoundStatusLabels[dto.status],
    items: dto.items.map((item) => ({
      ...item,
      risk: riskLabels[item.risk],
      valueKind: item.valueKind ?? "scalar"
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
