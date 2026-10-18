export const WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS = 300;

export type LogAnalysisResultWebhookInput = {
  organizationId: string;
  logDomainId: string;
  logId: string;
  runId: string;
  fileName: string;
  status: "complete" | "failed";
  analysisSource?: string;
  degradedReason?: string;
  severity?: string;
  confidence?: number;
  conclusion?: string;
  occurredAt: string;
};

function truncateSummary(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  return trimmed.length > WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS
    ? `${trimmed.slice(0, WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS - 1)}…`
    : trimmed;
}

/** Compact result payload; NEVER includes raw log lines or evidence text. */
export function buildLogResultWebhookPayload(input: LogAnalysisResultWebhookInput) {
  return {
    eventId: `log-result:${input.runId}`,
    event: input.status === "complete" ? "log-analysis.completed" : "log-analysis.failed",
    recordId: input.logId,
    runId: input.runId,
    fileName: input.fileName,
    logDomainId: input.logDomainId,
    status: input.status,
    analysisSource: input.analysisSource,
    degradedReason: input.degradedReason,
    severity: input.severity,
    confidence: input.confidence,
    conclusionSummary: truncateSummary(input.conclusion),
    occurredAt: input.occurredAt,
    productPath: input.status === "complete" ? `/logs?id=${encodeURIComponent(`report-${input.runId}`)}` : "/logs"
  };
}
