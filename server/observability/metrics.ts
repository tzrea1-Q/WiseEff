import type { AgentProviderEvidence } from "../modules/agent/providerEvidence";
import { toMetricLabels } from "../modules/agent/providerEvidence";

type LabelSet = Record<string, string | number | boolean>;

type CounterSample = {
  kind: "counter";
  name: string;
  help: string;
  labels: LabelSet;
  value: number;
};

type GaugeSample = {
  kind: "gauge";
  name: string;
  help: string;
  labels: LabelSet;
  value: number;
};

export type LogAnalysisJobMetricStatus = "complete" | "retry" | "dead_lettered" | "failed";
export type LogAnalysisJobMetricStage = "parse" | "pattern" | "rootcause" | "report";
export type LogAnalysisJobFailureReason = "parse_error" | "object_store_error" | "stale_run" | "unknown";
export type AgentToolMetricKind = "read" | "preparation" | "mutating";
export type AgentApprovalMetricAction = "requested" | "approved" | "rejected";
export type AgentToolMetricStatus = "succeeded" | "failed" | "rejected";

const dynamicSegmentPattern =
  /\/(?:[a-z]+-)?[0-9a-f]{6,}(?=\/|$)|\/(?:request|session|operation|job|log|audit|approval|snapshot|target|run|op)-[^/]+/gi;
const httpDurationBucketsSeconds = [0.05, 0.1, 0.25, 0.5, 0.8, 1, 2.5, 5, Number.POSITIVE_INFINITY] as const;
const dependencyMetricNames: Record<string, string> = {
  database: "wiseeff_database_ready",
  objectStore: "wiseeff_object_store_ready",
  agentProvider: "wiseeff_agent_provider_ready"
};

function escapeLabel(value: string | number | boolean) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function normalizeRoute(route: string) {
  return route.replace(dynamicSegmentPattern, "/:id");
}

function normalizeMethod(method: string) {
  return method.toUpperCase();
}

function labelsKey(labels: LabelSet) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("|");
}

function renderLabels(labels: LabelSet) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function renderSample(sample: CounterSample | GaugeSample) {
  return `${sample.name}${renderLabels(sample.labels)} ${sample.value}`;
}

export type MetricsRegistry = ReturnType<typeof createMetricsRegistry>;

export function createMetricsRegistry(options: { serviceName: string }) {
  const counters = new Map<string, CounterSample>();
  const gauges = new Map<string, GaugeSample>();

  function incrementCounter(name: string, help: string, labels: LabelSet, amount = 1) {
    const key = `${name}:${labelsKey(labels)}`;
    const existing = counters.get(key);
    if (existing) {
      existing.value += amount;
      return;
    }
    counters.set(key, { kind: "counter", name, help, labels, value: amount });
  }

  function setGauge(name: string, help: string, labels: LabelSet, value: number) {
    gauges.set(`${name}:${labelsKey(labels)}`, { kind: "gauge", name, help, labels, value });
  }

  setGauge("wiseeff_build_info", "WiseEff process build and service metadata.", { service: options.serviceName }, 1);

  return {
    recordHttpRequest(input: { method: string; route: string; status: number; durationMs: number }) {
      const labels = {
        method: normalizeMethod(input.method),
        route: normalizeRoute(input.route),
        status: input.status
      };
      const durationSeconds = input.durationMs / 1000;
      incrementCounter("wiseeff_http_requests_total", "Total WiseEff HTTP requests.", labels);
      incrementCounter("wiseeff_http_request_duration_ms_sum", "Total WiseEff HTTP request duration in milliseconds.", labels, input.durationMs);
      incrementCounter("wiseeff_http_request_duration_ms_count", "Count of WiseEff HTTP request duration samples.", labels);
      for (const bucket of httpDurationBucketsSeconds) {
        if (durationSeconds <= bucket) {
          incrementCounter(
            "wiseeff_http_request_duration_seconds_bucket",
            "WiseEff HTTP request duration histogram buckets in seconds.",
            { ...labels, le: bucket === Number.POSITIVE_INFINITY ? "+Inf" : bucket }
          );
        }
      }
    },
    setReadinessStatus(status: "ready" | "not_ready" | "blocked") {
      for (const candidate of ["ready", "not_ready", "blocked"] as const) {
        setGauge("wiseeff_readiness_status", "WiseEff readiness status as one-hot gauges.", { status: candidate }, candidate === status ? 1 : 0);
      }
    },
    setDependencyHealth(input: { dependency: string; ok: boolean }) {
      setGauge("wiseeff_dependency_health", "WiseEff dependency health, 1 for healthy and 0 for unhealthy.", { dependency: input.dependency }, input.ok ? 1 : 0);
      const metricName = dependencyMetricNames[input.dependency];
      if (metricName) {
        setGauge(metricName, `WiseEff ${input.dependency} readiness, 1 for ready and 0 for not ready.`, {}, input.ok ? 1 : 0);
      }
    },
    setAgentProviderHealth(input: { ok: boolean; evidence?: AgentProviderEvidence }) {
      setGauge("wiseeff_dependency_health", "WiseEff dependency health, 1 for healthy and 0 for unhealthy.", { dependency: "agentProvider" }, input.ok ? 1 : 0);
      setGauge("wiseeff_agent_provider_ready", "WiseEff agentProvider readiness, 1 for ready and 0 for not ready.", {}, input.ok ? 1 : 0);
      if (input.evidence) {
        setGauge(
          "wiseeff_agent_provider_ready",
          "WiseEff agentProvider readiness, 1 for ready and 0 for not ready.",
          toMetricLabels(input.evidence),
          input.ok ? 1 : 0
        );
      }
    },
    setQueueStats(input: { queue: string; queued: number; processing: number; deadLettered: number; oldestQueuedAgeMs: number | null }) {
      setGauge("wiseeff_queue_backlog", "WiseEff queue backlog by queue.", { queue: input.queue }, input.queued);
      setGauge("wiseeff_queue_processing", "WiseEff queue processing count by queue.", { queue: input.queue }, input.processing);
      setGauge("wiseeff_queue_dead_lettered", "WiseEff queue dead-letter count by queue.", { queue: input.queue }, input.deadLettered);
      if (input.oldestQueuedAgeMs !== null) {
        setGauge("wiseeff_queue_oldest_queued_age_ms", "WiseEff oldest queued job age in milliseconds.", { queue: input.queue }, input.oldestQueuedAgeMs);
      }
    },
    recordAgentProviderCall(input: { provider: string; status: string; durationMs: number }) {
      incrementCounter("wiseeff_agent_provider_calls_total", "WiseEff Agent provider calls by provider and status.", {
        provider: input.provider,
        status: input.status
      });
      incrementCounter("wiseeff_agent_provider_duration_ms_sum", "Total WiseEff Agent provider call duration in milliseconds.", {
        provider: input.provider,
        status: input.status
      }, input.durationMs);
    },
    recordAgentApproval(input: { action: AgentApprovalMetricAction; tool: string; kind: AgentToolMetricKind; requiresApproval: boolean }) {
      incrementCounter("wiseeff_agent_approvals_total", "WiseEff Agent approvals by action and tool class.", {
        action: input.action,
        tool: input.tool,
        kind: input.kind,
        requires_approval: input.requiresApproval
      });
    },
    recordAgentToolResult(input: { tool: string; kind: AgentToolMetricKind; requiresApproval: boolean; status: AgentToolMetricStatus }) {
      incrementCounter("wiseeff_agent_tool_results_total", "WiseEff Agent tool terminal results by tool class and status.", {
        tool: input.tool,
        kind: input.kind,
        requires_approval: input.requiresApproval,
        status: input.status
      });
    },
    recordAuditWriteFailure(input: { kind: string; action: string; targetType: string }) {
      incrementCounter("wiseeff_audit_write_failures_total", "WiseEff audit write failures by event shape.", {
        kind: input.kind,
        action: input.action,
        target_type: input.targetType
      });
    },
    recordDeviceGatewayOperation(input: { mode: string; action: string; status: string }) {
      incrementCounter("wiseeff_device_gateway_operations_total", "WiseEff device gateway operations by mode, action, and status.", {
        mode: input.mode,
        action: input.action,
        status: input.status
      });
    },
    recordLogAnalysisJobResult(input: {
      status: LogAnalysisJobMetricStatus;
      stage: LogAnalysisJobMetricStage;
      durationMs: number;
      failureReason?: LogAnalysisJobFailureReason;
    }) {
      const labels = { stage: input.stage, status: input.status };
      incrementCounter("wiseeff_log_analysis_job_duration_ms_sum", "Total WiseEff log-analysis job duration in milliseconds.", labels, input.durationMs);
      incrementCounter("wiseeff_log_analysis_job_duration_ms_count", "Count of WiseEff log-analysis job duration samples.", labels);
      if (input.failureReason) {
        incrementCounter("wiseeff_log_analysis_job_failures_total", "WiseEff log-analysis terminal failures by reason and stage.", {
          reason: input.failureReason,
          stage: input.stage
        });
      }
    },
    renderPrometheus() {
      const allSamples = [...gauges.values(), ...counters.values()].sort((left, right) => left.name.localeCompare(right.name) || labelsKey(left.labels).localeCompare(labelsKey(right.labels)));
      const helpLines = new Set<string>();
      const lines: string[] = [];
      for (const sample of allSamples) {
        const helpKey = `${sample.name}:${sample.help}:${sample.kind}`;
        if (!helpLines.has(helpKey)) {
          helpLines.add(helpKey);
          lines.push(`# HELP ${sample.name} ${sample.help}`);
          lines.push(`# TYPE ${sample.name} ${sample.kind}`);
        }
        lines.push(renderSample(sample));
      }
      return `${lines.join("\n")}\n`;
    }
  };
}

export const defaultMetricsRegistry = createMetricsRegistry({ serviceName: "wiseeff-api" });
