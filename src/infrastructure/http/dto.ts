import type { LogRecord } from "@/domain/logs/types";
import type { ParameterRecord } from "@/domain/parameters/types";

export type ParameterRecordDto = {
  id: ParameterRecord["id"];
  name: ParameterRecord["name"];
  description: ParameterRecord["description"];
  explanation: ParameterRecord["explanation"];
  configFormat: ParameterRecord["configFormat"];
  module: ParameterRecord["module"];
  projectId: ParameterRecord["projectId"];
  currentValue: ParameterRecord["currentValue"];
  recommendedValue: ParameterRecord["recommendedValue"];
  range: ParameterRecord["range"];
  unit: ParameterRecord["unit"];
  risk: ParameterRecord["risk"];
  updatedAt: ParameterRecord["updatedAt"];
  updatedAtTs: ParameterRecord["updatedAtTs"];
  history: ParameterRecord["history"];
};

export type LogRecordDto = {
  id: LogRecord["id"];
  reportId: LogRecord["reportId"];
  fileName: LogRecord["fileName"];
  projectId: LogRecord["projectId"];
  source: LogRecord["source"];
  fileSizeMB: LogRecord["fileSizeMB"];
  status: LogRecord["status"];
  stage: LogRecord["stage"];
  confidence: LogRecord["confidence"];
  conclusion: LogRecord["conclusion"];
  impact: LogRecord["impact"];
  evidence: LogRecord["evidence"];
  suggestedActions: LogRecord["suggestedActions"];
  severity: LogRecord["severity"];
  rawLines: LogRecord["rawLines"];
  capturedAt: LogRecord["capturedAt"];
  updatedAt: LogRecord["updatedAt"];
  updatedAtIso: LogRecord["updatedAtIso"];
  submittedBy: LogRecord["submittedBy"];
  relatedParameterId?: LogRecord["relatedParameterId"];
  device?: LogRecord["device"];
  failureReason?: LogRecord["failureReason"];
  analysisQuestion?: LogRecord["analysisQuestion"];
};

export function parameterRecordFromDto(dto: ParameterRecordDto): ParameterRecord {
  return { ...dto };
}

export function parameterRecordToDto(record: ParameterRecord): ParameterRecordDto {
  return { ...record };
}

export function logRecordFromDto(dto: LogRecordDto): LogRecord {
  return { ...dto };
}

export function logRecordToDto(record: LogRecord): LogRecordDto {
  return { ...record };
}
