import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "./metrics";

describe("Prometheus metrics registry", () => {
  it("records HTTP, dependency, queue, agent, and device metrics without exposing secrets", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordHttpRequest({ method: "GET", route: "/api/v1/me", status: 200, durationMs: 34 });
    registry.setDependencyHealth({ dependency: "database", ok: true });
    registry.setQueueStats({ queue: "log-analysis", queued: 4, processing: 1, deadLettered: 0, oldestQueuedAgeMs: 1200 });
    registry.recordAgentProviderCall({ provider: "live", status: "failed", durationMs: 800 });
    registry.recordDeviceGatewayOperation({ mode: "simulator", action: "write", status: "blocked" });

    const text = registry.renderPrometheus();

    expect(text).toContain("wiseeff_build_info{service=\"wiseeff-api\"} 1");
    expect(text).toContain("wiseeff_http_requests_total{method=\"GET\",route=\"/api/v1/me\",status=\"200\"} 1");
    expect(text).toContain("wiseeff_http_request_duration_ms_sum{method=\"GET\",route=\"/api/v1/me\",status=\"200\"} 34");
    expect(text).toContain("wiseeff_dependency_health{dependency=\"database\"} 1");
    expect(text).toContain("wiseeff_queue_backlog{queue=\"log-analysis\"} 4");
    expect(text).toContain("wiseeff_queue_dead_lettered{queue=\"log-analysis\"} 0");
    expect(text).toContain("wiseeff_agent_provider_calls_total{provider=\"live\",status=\"failed\"} 1");
    expect(text).toContain("wiseeff_device_gateway_operations_total{mode=\"simulator\",action=\"write\",status=\"blocked\"} 1");
    expect(text).not.toMatch(/secret|password|token|authorization/i);
  });

  it("sanitizes dynamic label values to keep metrics cardinality bounded", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordHttpRequest({
      method: "post",
      route: "/api/v1/debugging/sessions/session-abc/operations/op-123",
      status: 500,
      durationMs: 5
    });

    expect(registry.renderPrometheus()).toContain(
      'wiseeff_http_requests_total{method="POST",route="/api/v1/debugging/sessions/:id/operations/:id",status="500"} 1'
    );
  });

  it("records low-cardinality log-analysis terminal metrics without leaking job details", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordLogAnalysisJobResult({
      status: "dead_lettered",
      stage: "parse",
      durationMs: 250,
      failureReason: "parse_error"
    });
    registry.recordLogAnalysisJobResult({
      status: "dead_lettered",
      stage: "parse",
      durationMs: 750,
      failureReason: "parse_error"
    });

    const text = registry.renderPrometheus();

    expect(text).toContain('wiseeff_log_analysis_job_duration_ms_sum{stage="parse",status="dead_lettered"} 1000');
    expect(text).toContain('wiseeff_log_analysis_job_duration_ms_count{stage="parse",status="dead_lettered"} 2');
    expect(text).toContain('wiseeff_log_analysis_job_failures_total{reason="parse_error",stage="parse"} 2');
    expect(text).not.toMatch(/job-1|run-1|Input appears|authorization|password|secret|token/i);
  });
});
