import type { LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import type { LogEvidence, LogRecord } from "@/domain/logs/types";

export type LogEvidenceDto = {
  id: string;
  stageId: LogEvidence["stageId"];
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit?: string;
};

export type LogRecordDto = {
  id: string;
  reportId: string;
  fileName: string;
  source: string;
  fileSizeBytes: number;
  status: "uploaded" | "processing" | "complete" | "failed";
  archiveState: "active" | "archived";
  stage: "parse" | "pattern" | "rootcause" | "report";
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidenceDto[];
  suggestedActions: string[];
  severity: "Critical" | "Warning" | "Info";
  rawLines: string[];
  capturedAt: string;
  updatedAt: string;
  submittedBy: string;
  relatedParameterId?: string;
  device?: string;
  failureReason?: string;
  analysisQuestion?: string;
};

export type LogJobDto = LogJobSnapshot;

const statusLabels: Record<LogRecordDto["status"], LogRecord["status"]> = {
  uploaded: "Processing",
  processing: "Processing",
  complete: "Complete",
  failed: "Failed"
};

export function logRecordFromDto(dto: LogRecordDto): LogRecord {
  return {
    id: dto.id,
    reportId: dto.reportId,
    fileName: dto.fileName,
    source: dto.source,
    fileSizeMB: Math.round((dto.fileSizeBytes / 1024 / 1024) * 10) / 10,
    status: statusLabels[dto.status],
    stage: dto.stage,
    confidence: dto.confidence,
    conclusion: dto.conclusion,
    impact: dto.impact,
    evidence: dto.evidence.map((item) => ({ ...item, lineNumbers: [...item.lineNumbers] })),
    suggestedActions: [...dto.suggestedActions],
    severity: dto.severity,
    rawLines: [...dto.rawLines],
    capturedAt: dto.capturedAt,
    updatedAt: dto.updatedAt,
    updatedAtIso: dto.updatedAt,
    submittedBy: dto.submittedBy,
    relatedParameterId: dto.relatedParameterId,
    device: dto.device,
    failureReason: dto.failureReason,
    analysisQuestion: dto.analysisQuestion,
    archiveState: dto.archiveState
  };
}

export function logListFromDto(response: { items: LogRecordDto[] }): LogRecord[] {
  return response.items.map(logRecordFromDto);
}

export function jobSnapshotFromDto(dto: LogJobDto): LogJobSnapshot {
  return { ...dto };
}
