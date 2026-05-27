export const logStages = ["parse", "pattern", "rootcause", "report"] as const;
export const logRunStatuses = ["queued", "processing", "complete", "failed"] as const;
export const logRecordStatuses = ["uploaded", "processing", "complete", "failed"] as const;
export const supportedLogExtensions = [".log", ".txt", ".csv"] as const;

export type LogStage = (typeof logStages)[number];
export type LogRunStatus = (typeof logRunStatuses)[number];
export type LogRecordStatus = (typeof logRecordStatuses)[number];
export type SupportedLogExtension = (typeof supportedLogExtensions)[number];
