import { describe, expect, it } from "vitest";
import { createLogRecord, redactTelemetryValue } from "./logger";

describe("structured observability logger", () => {
  it("creates JSON-safe structured records with correlation fields", () => {
    const record = createLogRecord({
      level: "info",
      message: "parameter review advanced",
      timestamp: "2026-06-02T00:00:00.000Z",
      correlation: {
        requestId: "req-1",
        traceId: "trace-1",
        userId: "u-1",
        auditId: "audit-1",
        operationId: "parameter-review"
      },
      fields: {
        route: "/api/v1/parameter-change-requests/request-1/review",
        requestBody: {
          token: "secret-token",
          nested: {
            apiKey: "api-key-value"
          }
        }
      }
    });

    expect(record).toEqual({
      timestamp: "2026-06-02T00:00:00.000Z",
      level: "info",
      message: "parameter review advanced",
      requestId: "req-1",
      traceId: "trace-1",
      userId: "u-1",
      auditId: "audit-1",
      operationId: "parameter-review",
      route: "/api/v1/parameter-change-requests/request-1/review",
      requestBody: {
        token: "<redacted>",
        nested: {
          apiKey: "<redacted>"
        }
      }
    });
    expect(JSON.stringify(record)).toContain("\"requestId\":\"req-1\"");
  });

  it("redacts common secret-bearing telemetry keys", () => {
    expect(
      redactTelemetryValue({
        password: "pw",
        authorization: "Bearer x",
        accessToken: "token",
        refresh_token: "refresh",
        safe: "value"
      })
    ).toEqual({
      password: "<redacted>",
      authorization: "<redacted>",
      accessToken: "<redacted>",
      refresh_token: "<redacted>",
      safe: "value"
    });
  });
});
