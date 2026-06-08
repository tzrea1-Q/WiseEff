export type CorrelationContext = {
  requestId?: string;
  traceId?: string;
  userId?: string;
  operationId?: string;
  auditId?: string;
  jobId?: string;
  queueId?: string;
  runId?: string;
  retryCount?: number;
  approvalId?: string;
  sessionId?: string;
  targetId?: string;
};

function cleanString(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function cleanNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function buildCorrelationContext(input: CorrelationContext): CorrelationContext {
  const requestId = cleanString(input.requestId);
  const traceId = cleanString(input.traceId) ?? requestId;
  const context: CorrelationContext = {
    requestId,
    traceId,
    userId: cleanString(input.userId),
    operationId: cleanString(input.operationId),
    auditId: cleanString(input.auditId),
    jobId: cleanString(input.jobId),
    queueId: cleanString(input.queueId),
    runId: cleanString(input.runId),
    retryCount: cleanNumber(input.retryCount),
    approvalId: cleanString(input.approvalId),
    sessionId: cleanString(input.sessionId),
    targetId: cleanString(input.targetId)
  };

  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined)) as CorrelationContext;
}

export function mergeCorrelationMetadata(metadata: Record<string, unknown>, correlation: CorrelationContext) {
  return {
    ...Object.fromEntries(Object.entries(correlation).filter(([key, value]) => value !== undefined && metadata[key] === undefined)),
    ...metadata
  };
}
