import { describe, expect, it } from "vitest";
import { buildCorrelationContext, mergeCorrelationMetadata } from "./correlation";

describe("observability correlation context", () => {
  it("builds a traceable context from request, job, audit, and operation identifiers", () => {
    const context = buildCorrelationContext({
      requestId: "req-1",
      traceId: "trace-1",
      userId: "u-1",
      operationId: "debug-op-1",
      auditId: "audit-1",
      jobId: "job-1",
      queueId: "queue-log-analysis",
      runId: "run-1",
      retryCount: 2,
      approvalId: "approval-1",
      sessionId: "session-1",
      targetId: "target-1"
    });

    expect(context).toEqual({
      requestId: "req-1",
      traceId: "trace-1",
      userId: "u-1",
      operationId: "debug-op-1",
      auditId: "audit-1",
      jobId: "job-1",
      queueId: "queue-log-analysis",
      runId: "run-1",
      retryCount: 2,
      approvalId: "approval-1",
      sessionId: "session-1",
      targetId: "target-1"
    });
  });

  it("uses the request ID as the default trace ID and removes empty fields", () => {
    expect(
      buildCorrelationContext({
        requestId: "req-2",
        traceId: "",
        userId: undefined,
        operationId: "  "
      })
    ).toEqual({
      requestId: "req-2",
      traceId: "req-2"
    });
  });

  it("merges correlation fields into audit metadata without overwriting business metadata", () => {
    const metadata = mergeCorrelationMetadata(
      {
        operationId: "business-operation",
        targetId: "business-target",
        reason: "manual approval"
      },
      buildCorrelationContext({
        requestId: "req-3",
        traceId: "trace-3",
        operationId: "observability-operation",
        auditId: "audit-3",
        userId: "u-3"
      })
    );

    expect(metadata).toEqual({
      operationId: "business-operation",
      targetId: "business-target",
      reason: "manual approval",
      requestId: "req-3",
      traceId: "trace-3",
      auditId: "audit-3",
      userId: "u-3"
    });
  });
});
