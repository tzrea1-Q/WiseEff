import { describe, expect, it } from "vitest";
import {
  buildObservabilityEvidence,
  evaluateObservabilityConfig,
  parseObservabilityArgs,
  requiredObservabilityDashboardFiles,
  requiredObservabilityFiles,
  requiredObservabilityRuntimeFiles,
  requiredObservabilityScripts
} from "./check-observability-config";

const validPackageJson = {
  scripts: {
    "observability:check": "tsx scripts/check-observability-config.ts"
  }
};

const validPrometheus = `
global:
  scrape_interval: 15s
alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]
scrape_configs:
  - job_name: wiseeff-api
    metrics_path: /metrics
    static_configs:
      - targets: ["api:8787"]
  - job_name: wiseeff-worker
    static_configs:
      - targets: ["worker:8788", "blackbox-exporter:9115"]
  - job_name: node-exporter
    static_configs:
      - targets: ["node-exporter:9100"]
  - job_name: postgres-exporter
    static_configs:
      - targets: ["postgres-exporter:9187"]
  - job_name: redis-exporter
    static_configs:
      - targets: ["redis-exporter:9121"]
  - job_name: wiseeff-service-http
    static_configs:
      - targets:
          - http://api:8787/health/live
          - http://worker:8788/health/live
          - http://web:5173/
          - http://proxy/health/live
          - http://minio:9000/minio/health/live
          - http://prometheus:9090/-/ready
          - http://alertmanager:9093/-/ready
          - http://grafana:3000/api/health
  - job_name: wiseeff-service-tcp
    static_configs:
      - targets: ["postgres:5432", "redis:6379"]
`;

const validAlerts = `
groups:
  - name: wiseeff-api
    rules:
      - alert: WiseEffApiDown
        expr: up{job="wiseeff-api"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: WiseEff API is down
          runbook_url: docs/runbooks/observability-operations.md#wiseeffapidown
      - alert: WiseEffQueueBacklogHigh
        expr: wiseeff_queue_backlog > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: WiseEff queue backlog is high
          runbook_url: docs/runbooks/observability-operations.md#wiseeffqueuebackloghigh
`;

const validDashboards = {
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json": JSON.stringify({
    title: "WiseEff Overview",
    panels: [{ title: "API availability", type: "stat" }]
  }),
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json": JSON.stringify({
    title: "WiseEff Jobs",
    panels: [
      { title: "Queue backlog", type: "timeseries" },
      { targets: [{ expr: "sum(rate(wiseeff_log_analysis_job_duration_ms_sum[5m])) / clamp_min(sum(rate(wiseeff_log_analysis_job_duration_ms_count[5m])), 0.001)" }] },
      { targets: [{ expr: "sum(rate(wiseeff_log_analysis_job_failures_total[5m])) by (reason, stage)" }] }
    ]
  }),
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json": JSON.stringify({
    title: "WiseEff Security Operations",
    panels: [{ title: "Audit writes", type: "timeseries" }]
  }),
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-services.json": JSON.stringify({
    title: "WiseEff Services",
    panels: [
      { title: "Service status", type: "table", targets: [{ expr: "probe_success" }] },
      { title: "Disk free", type: "stat", targets: [{ expr: "node_filesystem_avail_bytes" }] }
    ]
  })
};

const validRuntimeFiles = {
  "ops/self-hosted/compose.yaml": `
services:
  prometheus:
    profiles: ["observability"]
    ports: ["127.0.0.1:\${WISEEFF_PROMETHEUS_PORT:-9090}:9090"]
  alertmanager:
    profiles: ["observability"]
    ports: ["127.0.0.1:\${WISEEFF_ALERTMANAGER_PORT:-9093}:9093"]
  grafana:
    profiles: ["observability"]
    ports: ["127.0.0.1:\${WISEEFF_GRAFANA_PORT:-3000}:3000"]
  blackbox-exporter:
    profiles: ["observability"]
  node-exporter:
    profiles: ["observability"]
  postgres-exporter:
    profiles: ["observability"]
  redis-exporter:
    profiles: ["observability"]
  worker:
    environment:
      LOG_WORKER_OBSERVABILITY_HOST: 0.0.0.0
volumes:
  wiseeff-prometheus-data:
  wiseeff-grafana-data:
  wiseeff-alertmanager-data:
`,
  "ops/self-hosted/scripts/observability":
    "Usage: observability <up|down|restart|status|logs>\ncompose --profile observability",
  "ops/self-hosted/observability/alertmanager.yml": "route:\n  receiver: local-dashboard\nreceivers:\n  - name: local-dashboard\n",
  "ops/self-hosted/observability/blackbox.yml": "modules:\n  http_2xx:\n    prober: http\n  tcp_connect:\n    prober: tcp\n",
  "ops/self-hosted/observability/grafana/provisioning/datasources/prometheus.yml":
    "apiVersion: 1\ndatasources:\n  - name: Prometheus\n    uid: prometheus\n    url: http://prometheus:9090\n",
  "ops/self-hosted/observability/grafana/provisioning/dashboards/wiseeff.yml":
    "apiVersion: 1\nproviders:\n  - name: WiseEff\n    options:\n      path: /var/lib/grafana/dashboards\n"
};

describe("M6.5 observability configuration metadata", () => {
  it("requires observability config files, dashboards, and package script", () => {
    expect(requiredObservabilityScripts).toEqual(["observability:check"]);
    expect(requiredObservabilityFiles).toEqual([
      "ops/self-hosted/observability/prometheus.yml",
      "ops/self-hosted/observability/alerts.yml"
    ]);
    expect(requiredObservabilityDashboardFiles).toEqual([
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json",
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json",
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json",
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-services.json"
    ]);
    expect(requiredObservabilityRuntimeFiles).toEqual([
      "ops/self-hosted/compose.yaml",
      "ops/self-hosted/scripts/observability",
      "ops/self-hosted/observability/alertmanager.yml",
      "ops/self-hosted/observability/blackbox.yml",
      "ops/self-hosted/observability/grafana/provisioning/datasources/prometheus.yml",
      "ops/self-hosted/observability/grafana/provisioning/dashboards/wiseeff.yml"
    ]);
  });

  it("passes when self-hosted observability files are actionable and secret-free", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validRuntimeFiles,
        ...validDashboards
      }
    });

    expect(result).toEqual({
      status: "passed",
      missingScripts: [],
      missingFiles: [],
      missingRuntimeFiles: [],
      missingRuntimeTokens: [],
      missingDashboardFiles: [],
      invalidDashboardFiles: [],
      alertsMissingRunbookUrl: [],
      forbiddenSecretMatches: [],
      missingPrometheusTokens: [],
      unknownMetricReferences: []
    });
  });

  it("fails when the one-command runtime and automatic provisioning files are absent", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validDashboards
      }
    });

    expect(result.status).toBe("failed");
    expect(result.missingRuntimeFiles).toEqual(requiredObservabilityRuntimeFiles);
  });

  it("rejects a monitoring runtime that omits loopback UI binding or automatic Grafana provisioning", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validRuntimeFiles,
        ...validDashboards,
        "ops/self-hosted/compose.yaml": "services:\n  grafana:\n    profiles: [observability]\n    ports: [\"0.0.0.0:3000:3000\"]\n",
        "ops/self-hosted/observability/grafana/provisioning/datasources/prometheus.yml": "apiVersion: 1\n"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.missingRuntimeTokens).toEqual(
      expect.arrayContaining([
        "ops/self-hosted/compose.yaml:127.0.0.1:${WISEEFF_GRAFANA_PORT:-3000}:3000",
        "ops/self-hosted/observability/grafana/provisioning/datasources/prometheus.yml:url: http://prometheus:9090"
      ])
    );
  });

  it("requires graphical probes for every self-hosted application and data service", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus.replace(
          "http://minio:9000/minio/health/live",
          "http://missing-object-store:9000/health"
        ),
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validRuntimeFiles,
        ...validDashboards
      }
    });

    expect(result.status).toBe("failed");
    expect(result.missingPrometheusTokens).toContain("http://minio:9000/minio/health/live");
  });

  it("fails when alerts or dashboards reference WiseEff metrics that are not produced by the M6.5 runtime", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": `${validAlerts}
      - alert: UnknownMetric
        expr: wiseeff_future_metric_total > 0
        annotations:
          runbook_url: docs/runbooks/observability-operations.md#unknownmetric
`,
        ...validRuntimeFiles,
        ...validDashboards,
        "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json": JSON.stringify({
          title: "WiseEff Jobs",
          panels: [
            {
              targets: [{ expr: "histogram_quantile(0.95, sum(rate(wiseeff_job_duration_seconds_bucket[5m])) by (le, stage))" }]
            }
          ]
        })
      }
    });

    expect(result.status).toBe("failed");
    expect(result.unknownMetricReferences).toEqual([
      {
        file: "ops/self-hosted/observability/alerts.yml",
        metric: "wiseeff_future_metric_total"
      },
      {
        file: "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json",
        metric: "wiseeff_job_duration_seconds_bucket"
      }
    ]);
  });

  it("allows Xiaoze and device terminal metrics produced by the M6.5 runtime", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": `${validAlerts}
      - alert: WiseEffXiaozeLlmFailure
        expr: wiseeff_xiaoze_llm_ready == 0
        annotations:
          runbook_url: docs/runbooks/observability-operations.md#wiseeffxiaozellmfailure
`,
        ...validRuntimeFiles,
        ...validDashboards,
        "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json": JSON.stringify({
          title: "WiseEff Security Operations",
          panels: [
            { targets: [{ expr: "wiseeff_xiaoze_llm_ready" }] },
            { targets: [{ expr: "wiseeff_agent_approvals_total" }] },
            { targets: [{ expr: "wiseeff_agent_tool_results_total" }] },
            { targets: [{ expr: "wiseeff_audit_write_failures_total" }] },
            { targets: [{ expr: "wiseeff_device_gateway_operations_total" }] }
          ]
        })
      }
    });

    expect(result.unknownMetricReferences).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it("fails when required scripts, files, runbooks, dashboards, or metrics scrape targets are missing", () => {
    const result = evaluateObservabilityConfig({
      packageJson: { scripts: {} },
      files: {
        "ops/self-hosted/observability/prometheus.yml": "scrape_configs: []",
        "ops/self-hosted/observability/alerts.yml": `
groups:
  - name: broken
    rules:
      - alert: MissingRunbook
        annotations:
          summary: missing runbook
`,
        "ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json": "{not-json"
      }
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual(["observability:check"]);
    expect(result.missingFiles).toEqual([]);
    expect(result.missingDashboardFiles).toEqual([
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json",
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json",
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-services.json"
    ]);
    expect(result.invalidDashboardFiles).toEqual([
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json"
    ]);
    expect(result.alertsMissingRunbookUrl).toEqual(["MissingRunbook"]);
    expect(result.missingPrometheusTokens).toEqual(expect.arrayContaining(["wiseeff-api", "/metrics"]));
  });

  it("fails when observability files appear to contain secrets", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": `${validPrometheus}\napi_key: sk-live-value`,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validRuntimeFiles,
        ...validDashboards
      }
    });

    expect(result.status).toBe("failed");
    expect(result.forbiddenSecretMatches).toEqual([
      {
        file: "ops/self-hosted/observability/prometheus.yml",
        pattern: "api_key"
      },
      {
        file: "ops/self-hosted/observability/prometheus.yml",
        pattern: "sk-"
      }
    ]);
  });

  it("does not treat ordinary high-risk anchors as OpenAI-style key material", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validRuntimeFiles,
        ...validDashboards,
        "ops/self-hosted/observability/grafana/dashboards/security.json": "high-risk-operations"
      }
    });

    expect(result.forbiddenSecretMatches).toEqual([]);
  });

  it("parses output path for generated release evidence", () => {
    expect(parseObservabilityArgs([], {})).toEqual({
      output: "docs/generated/m6-observability-config-evidence.md"
    });
    expect(parseObservabilityArgs(["--output=docs/generated/observability.md"], {})).toEqual({
      output: "docs/generated/observability.md"
    });
    expect(parseObservabilityArgs([], { npm_config_output: "docs/generated/npm-observability.md" })).toEqual({
      output: "docs/generated/npm-observability.md"
    });
  });

  it("builds redacted markdown evidence for release records", () => {
    const evidence = buildObservabilityEvidence({
      date: "2026-06-03T00:00:00.000Z",
      result: evaluateObservabilityConfig({
        packageJson: validPackageJson,
        files: {
          "ops/self-hosted/observability/prometheus.yml": validPrometheus,
          "ops/self-hosted/observability/alerts.yml": validAlerts,
          ...validRuntimeFiles,
          ...validDashboards
        }
      })
    });

    expect(evidence).toContain("## M6.5 Observability Config Evidence");
    expect(evidence).toContain("- Status: `passed`");
    expect(evidence).toContain("- Missing scripts: none");
    expect(evidence).toContain("- Missing files: none");
    expect(evidence).toContain("- Missing runtime files: none");
    expect(evidence).toContain("- Missing runtime tokens: none");
    expect(evidence).not.toContain("sk-live-value");
  });
});
