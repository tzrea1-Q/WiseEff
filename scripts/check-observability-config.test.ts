import { describe, expect, it } from "vitest";
import {
  buildObservabilityEvidence,
  evaluateObservabilityConfig,
  parseObservabilityArgs,
  requiredObservabilityDashboardFiles,
  requiredObservabilityFiles,
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
scrape_configs:
  - job_name: wiseeff-api
    metrics_path: /metrics
    static_configs:
      - targets: ["api:8787"]
  - job_name: wiseeff-worker
    static_configs:
      - targets: ["worker:8788"]
  - job_name: node-exporter
    static_configs:
      - targets: ["node-exporter:9100"]
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
    panels: [{ title: "Queue backlog", type: "timeseries" }]
  }),
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json": JSON.stringify({
    title: "WiseEff Security Operations",
    panels: [{ title: "Audit writes", type: "timeseries" }]
  })
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
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json"
    ]);
  });

  it("passes when self-hosted observability files are actionable and secret-free", () => {
    const result = evaluateObservabilityConfig({
      packageJson: validPackageJson,
      files: {
        "ops/self-hosted/observability/prometheus.yml": validPrometheus,
        "ops/self-hosted/observability/alerts.yml": validAlerts,
        ...validDashboards
      }
    });

    expect(result).toEqual({
      status: "passed",
      missingScripts: [],
      missingFiles: [],
      missingDashboardFiles: [],
      invalidDashboardFiles: [],
      alertsMissingRunbookUrl: [],
      forbiddenSecretMatches: [],
      missingPrometheusTokens: [],
      unknownMetricReferences: []
    });
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
      "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json"
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
        ...validDashboards,
        "ops/self-hosted/observability/grafana/dashboards/security.json": "high-risk-operations"
      }
    });

    expect(result.forbiddenSecretMatches).toEqual([]);
  });

  it("parses output path for generated release evidence", () => {
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
          ...validDashboards
        }
      })
    });

    expect(evidence).toContain("## M6.5 Observability Evidence");
    expect(evidence).toContain("- Status: `passed`");
    expect(evidence).toContain("- Missing scripts: none");
    expect(evidence).toContain("- Missing files: none");
    expect(evidence).not.toContain("sk-live-value");
  });
});
