import { describe, expect, it } from "vitest";
import { createTracingBoundary } from "./tracing";

describe("OpenTelemetry tracing boundary", () => {
  it("can be disabled for local tests without changing business results", async () => {
    const tracing = createTracingBoundary({ enabled: false, serviceName: "wiseeff-api" });

    const result = await tracing.withSpan("api.request", { route: "/health/live" }, async () => "ok");

    expect(result).toBe("ok");
    expect(tracing.isEnabled()).toBe(false);
    expect(tracing.getTraceId({ requestId: "req-1" })).toBe("req-1");
  });

  it("isolates exporter or instrumentation failures from business requests", async () => {
    const tracing = createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: async () => {
        throw new Error("collector unavailable");
      }
    });

    await expect(tracing.withSpan("agent.provider.call", { provider: "live" }, async () => "response")).resolves.toBe("response");
    expect(tracing.getDroppedExportCount()).toBe(1);
  });
});
