import type { LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import type {
  LogDomain,
  LogDomainKnowledgeLink,
  LogDomainWebhookSummary,
  LogEvidence,
  LogFeedbackInsight,
  LogRecord,
  LogWebhookDelivery
} from "@/domain/logs/types";

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
  logDomainId?: string;
  logDomainName?: string;
  analysisSource?: "agent" | "rules-fallback";
  degradedReason?: "provider-unavailable" | "token-budget-exhausted";
};

export type LogDomainDto = {
  id: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  formatProfile?: unknown;
  modelOverride?: string;
  webhook?: LogDomainWebhookSummary;
  createdAt: string;
  updatedAt: string;
};

export type LogWebhookDeliveryDto = LogWebhookDelivery;

export function logWebhookDeliveryFromDto(dto: LogWebhookDeliveryDto): LogWebhookDelivery {
  return { ...dto };
}

export type LogJobDto = LogJobSnapshot;

const statusLabels: Record<LogRecordDto["status"], LogRecord["status"]> = {
  uploaded: "Processing",
  processing: "Processing",
  complete: "Complete",
  failed: "Failed"
};

/**
 * The analyzer reports confidence as a 0-1 ratio while the UI (and mock data)
 * renders 0-100 percent values with a literal `%` suffix. Normalize at the DTO
 * seam: ratios (<= 1) are scaled to percent, values above 1 are already
 * percentages and pass through untouched.
 */
export function confidencePercentFromDto(confidence: number): number {
  return confidence <= 1 ? Math.round(confidence * 100) : confidence;
}

export function logRecordFromDto(dto: LogRecordDto): LogRecord {
  return {
    id: dto.id,
    reportId: dto.reportId,
    fileName: dto.fileName,
    source: dto.source,
    fileSizeMB: Math.round((dto.fileSizeBytes / 1024 / 1024) * 10) / 10,
    status: statusLabels[dto.status],
    stage: dto.stage,
    confidence: confidencePercentFromDto(dto.confidence),
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
    archiveState: dto.archiveState,
    logDomainId: dto.logDomainId,
    logDomainName: dto.logDomainName,
    analysisSource: dto.analysisSource,
    degradedReason: dto.degradedReason
  };
}

export function logListFromDto(response: { items: LogRecordDto[] }): LogRecord[] {
  return response.items.map(logRecordFromDto);
}

export function logDomainFromDto(dto: LogDomainDto): LogDomain {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    status: dto.status,
    formatProfile: dto.formatProfile,
    modelOverride: dto.modelOverride,
    webhook: dto.webhook,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt
  };
}

export function logDomainListFromDto(response: { items: LogDomainDto[] }): LogDomain[] {
  return response.items.map(logDomainFromDto);
}

export type LogDomainKnowledgeLinkDto = {
  id: string;
  logDomainId: string;
  knowledgeEntryId: string;
  entryTitle: string;
  entryStatus: "draft" | "published" | "archived";
  entryTags: string[];
  linkedAt: string;
};

export function logDomainKnowledgeLinkFromDto(dto: LogDomainKnowledgeLinkDto): LogDomainKnowledgeLink {
  return { ...dto };
}

export function jobSnapshotFromDto(dto: LogJobDto): LogJobSnapshot {
  return { ...dto };
}

export type LogFeedbackInsightDto = {
  logDomainId: string | null;
  logDomainName: string | null;
  analysisSource: "agent" | "rules-fallback" | null;
  promptVersion: string | null;
  totalCount: number;
  helpfulCount: number;
  helpfulRate: number;
  lastFeedbackAt: string;
};

export function logFeedbackInsightFromDto(dto: LogFeedbackInsightDto): LogFeedbackInsight {
  return { ...dto };
}
