import { describe, expect, it } from "vitest";
import { createMetricsRegistry } from "./metrics";

describe("Prometheus metrics registry", () => {
  it("records HTTP, dependency, queue, agent, and device metrics without exposing secrets", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordHttpRequest({ method: "GET", route: "/api/v1/me", status: 200, durationMs: 34 });
    registry.setDependencyHealth({ dependency: "database", ok: true });
    registry.setQueueStats({ queue: "log-analysis", queued: 4, processing: 1, deadLettered: 0, oldestQueuedAgeMs: 1200 });
    registry.setXiaozeLlmHealth({ ok: true });
    registry.recordDeviceGatewayOperation({ mode: "simulator", action: "write", status: "blocked" });

    const text = registry.renderPrometheus();

    expect(text).toContain("wiseeff_build_info{service=\"wiseeff-api\"} 1");
    expect(text).toContain("wiseeff_http_requests_total{method=\"GET\",route=\"/api/v1/me\",status=\"200\"} 1");
    expect(text).toContain("wiseeff_http_request_duration_ms_sum{method=\"GET\",route=\"/api/v1/me\",status=\"200\"} 34");
    expect(text).toContain("wiseeff_dependency_health{dependency=\"database\"} 1");
    expect(text).toContain("wiseeff_queue_backlog{queue=\"log-analysis\"} 4");
    expect(text).toContain("wiseeff_queue_dead_lettered{queue=\"log-analysis\"} 0");
    expect(text).toContain("wiseeff_xiaoze_llm_ready 1");
    expect(text).toContain("wiseeff_device_gateway_operations_total{mode=\"simulator\",action=\"write\",status=\"blocked\"} 1");
    expect(text).not.toMatch(/secret|password|token|authorization/i);
  });

  it("records Xiaoze LLM readiness without exposing secrets", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.setXiaozeLlmHealth({ ok: true });

    const text = registry.renderPrometheus();

    expect(text).toContain("wiseeff_xiaoze_llm_ready 1");
    expect(text).toContain('wiseeff_dependency_health{dependency="xiaozeLlm"} 1');
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

  it("records DTS pipeline, backlog, publish, and cutover gauges without secrets", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordDtsPipelineResult({ stage: "compile", status: "failed", durationMs: 120 });
    registry.setDtsToolchainReady({
      ok: false,
      dtcVersion: "1.7.2",
      fdtoverlayVersion: "1.7.2",
      dtschemaVersion: "2024.11"
    });
    registry.setIdentityMappingBacklog(3);
    registry.setParameterSpecReviewBacklog(1);
    registry.recordConfigPublishResult({ result: "bypassed" });
    registry.setParameterIdentityCutoverStatus("in_progress");
    registry.setParameterIdentityMigrationComplete(true);

    const text = registry.renderPrometheus();
    expect(text).toContain('wiseeff_dts_pipeline_duration_ms_sum{stage="compile",status="failed"} 120');
    expect(text).toContain('wiseeff_dts_pipeline_failures_total{stage="compile"} 1');
    expect(text).toContain("wiseeff_dts_toolchain_ready 0");
    expect(text).toContain("wiseeff_identity_mapping_tasks_open 3");
    expect(text).toContain("wiseeff_parameter_spec_review_tasks_open 1");
    expect(text).toContain('wiseeff_config_publish_results_total{result="bypassed"} 1');
    expect(text).toContain('wiseeff_parameter_identity_cutover_status{status="in_progress"} 1');
    expect(text).toContain("wiseeff_parameter_identity_migration_complete 1");
    expect(text).not.toMatch(/password|secret|token|authorization/i);
  });

  it("records low-cardinality Agent approval, tool, and audit failure metrics", () => {
    const registry = createMetricsRegistry({ serviceName: "wiseeff-api" });

    registry.recordAgentApproval({
      action: "requested",
      tool: "parameter.submitChangeDraft",
      kind: "preparation",
      requiresApproval: true
    });
    registry.recordAgentToolResult({
      tool: "parameter.submitChangeDraft",
      kind: "preparation",
      requiresApproval: true,
      status: "failed"
    });
    registry.recordAuditWriteFailure({
      kind: "agent-tool",
      action: "approval-executed",
      targetType: "agent_tool_call"
    });

    const text = registry.renderPrometheus();

    expect(text).toContain('wiseeff_agent_approvals_total{action="requested",tool="parameter.submitChangeDraft",kind="preparation",requires_approval="true"} 1');
    expect(text).toContain('wiseeff_agent_tool_results_total{tool="parameter.submitChangeDraft",kind="preparation",requires_approval="true",status="failed"} 1');
    expect(text).toContain('wiseeff_audit_write_failures_total{kind="agent-tool",action="approval-executed",target_type="agent_tool_call"} 1');
    expect(text).not.toMatch(/agent-session|agent-tool-|agent-approval-|approval-1|toolCallId|Draft service unavailable|authorization|password|secret|token/i);
  });
});
