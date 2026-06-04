import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildObservabilityTargetEvidenceMarkdown,
  evaluateObservabilityTargetEvidence,
  parseObservabilityTargetEvidenceArgs
} from "./write-observability-target-evidence";

describe("M6.5 target observability evidence writer", () => {
  it("passes only when config and all target proofs are explicit passed", () => {
    const result = evaluateObservabilityTargetEvidence({
      configStatus: "passed",
      prometheusTargetScrape: "passed",
      alertmanagerRouting: "passed",
      grafanaDashboardImport: "passed",
      targetEnvironment: "self-hosted-staging",
      prometheusQuery: 'up{job="wiseeff-api"}',
      alertRouteEvidence: "ops-evidence/alertmanager-route-2026-06-04.md",
      grafanaEvidence: "ops-evidence/grafana-dashboard-2026-06-04.png"
    });

    expect(result).toEqual({
      status: "passed",
      blockers: [],
      pending: []
    });
  });

  it("keeps target evidence failed while local config passes but target proofs are pending", () => {
    const result = evaluateObservabilityTargetEvidence({
      configStatus: "passed",
      prometheusTargetScrape: "pending",
      alertmanagerRouting: "pending",
      grafanaDashboardImport: "pending",
      targetEnvironment: "self-hosted-staging",
      prometheusQuery: "",
      alertRouteEvidence: "",
      grafanaEvidence: ""
    });

    expect(result.status).toBe("failed");
    expect(result.pending).toEqual([
      "Prometheus target scrape evidence is pending.",
      "Alertmanager routing evidence is pending.",
      "Grafana dashboard import evidence is pending."
    ]);
  });

  it("requires a target environment label and evidence references before accepting passed proofs", () => {
    const result = evaluateObservabilityTargetEvidence({
      configStatus: "passed",
      prometheusTargetScrape: "passed",
      alertmanagerRouting: "passed",
      grafanaDashboardImport: "passed",
      targetEnvironment: "",
      prometheusQuery: "",
      alertRouteEvidence: "",
      grafanaEvidence: ""
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual([
      "Target environment label is required.",
      "Prometheus query or scrape evidence reference is required when target scrape is passed.",
      "Alertmanager routing evidence reference is required when routing is passed.",
      "Grafana import evidence reference is required when dashboard import is passed."
    ]);
  });

  it("does not accept local-only environment labels as target observability evidence", () => {
    const result = evaluateObservabilityTargetEvidence({
      configStatus: "passed",
      prometheusTargetScrape: "passed",
      alertmanagerRouting: "passed",
      grafanaDashboardImport: "passed",
      targetEnvironment: "local",
      prometheusQuery: 'up{job="wiseeff-api"}',
      alertRouteEvidence: "ops-evidence/alertmanager-route-2026-06-04.md",
      grafanaEvidence: "ops-evidence/grafana-dashboard-2026-06-04.png"
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Target environment label must identify a target, staging, pilot, or self-hosted environment."
    );
  });

  it("does not accept placeholder target environment labels as real target evidence", () => {
    const result = evaluateObservabilityTargetEvidence({
      configStatus: "passed",
      prometheusTargetScrape: "passed",
      alertmanagerRouting: "passed",
      grafanaDashboardImport: "passed",
      targetEnvironment: "target-not-configured",
      prometheusQuery: 'up{job="wiseeff-api"}',
      alertRouteEvidence: "ops-evidence/alertmanager-route-2026-06-04.md",
      grafanaEvidence: "ops-evidence/grafana-dashboard-2026-06-04.png"
    });

    expect(result.status).toBe("failed");
    expect(result.blockers).toContain(
      "Target environment label must identify a configured target, staging, pilot, or self-hosted environment."
    );
  });

  it("renders m6 target-gate-compatible redacted markdown", () => {
    const input = {
      configStatus: "passed" as const,
      prometheusTargetScrape: "passed" as const,
      alertmanagerRouting: "passed" as const,
      grafanaDashboardImport: "passed" as const,
      targetEnvironment: "self-hosted-staging",
      prometheusQuery: 'https://prom.example.test/api/v1/query?access_token=prom-secret&query=up{job="wiseeff-api"}',
      alertRouteEvidence: "https://alerts.example.test/evidence?id_token=alert-secret",
      grafanaEvidence: "https://grafana.example.test/d/wiseeff?api_key=grafana-secret"
    };
    const result = evaluateObservabilityTargetEvidence(input);
    const markdown = buildObservabilityTargetEvidenceMarkdown({
      date: "2026-06-04T00:00:00.000Z",
      input,
      result
    });

    expect(markdown).toContain("## M6.5 Observability Evidence");
    expect(markdown).toContain("- Status: `passed`");
    expect(markdown).toContain("- Config check: `passed`");
    expect(markdown).toContain("- Prometheus target scrape: `passed`");
    expect(markdown).toContain("- Alertmanager routing: `passed`");
    expect(markdown).toContain("- Grafana dashboard import: `passed`");
    expect(markdown).toContain("access_token=<redacted>");
    expect(markdown).toContain("id_token=<redacted>");
    expect(markdown).toContain("api_key=<redacted>");
    expect(markdown).not.toContain("prom-secret");
    expect(markdown).not.toContain("alert-secret");
    expect(markdown).not.toContain("grafana-secret");
  });

  it("parses cli and npm config status flags", () => {
    expect(
      parseObservabilityTargetEvidenceArgs([
        "--target-environment",
        "staging",
        "--config-status",
        "passed",
        "--prometheus-target-scrape",
        "passed",
        "--alertmanager-routing",
        "failed",
        "--grafana-dashboard-import",
        "pending",
        "--prometheus-query",
        'up{job="wiseeff-api"}',
        "--alert-route-evidence",
        "alert.md",
        "--grafana-evidence",
        "grafana.png",
        "--output",
        "docs/generated/custom-observability.md"
      ])
    ).toMatchObject({
      targetEnvironment: "staging",
      configStatus: "passed",
      prometheusTargetScrape: "passed",
      alertmanagerRouting: "failed",
      grafanaDashboardImport: "pending",
      prometheusQuery: 'up{job="wiseeff-api"}',
      alertRouteEvidence: "alert.md",
      grafanaEvidence: "grafana.png",
      output: "docs/generated/custom-observability.md"
    });
  });

  it("parses npm positional values when npm converts flags into true config entries", () => {
    expect(
      parseObservabilityTargetEvidenceArgs(
        ["target-env", "passed", "pending"],
        {
          npm_config_target_environment: "true",
          npm_config_config_status: "true",
          npm_config_prometheus_target_scrape: "true"
        }
      )
    ).toMatchObject({
      targetEnvironment: "target-env",
      configStatus: "passed",
      prometheusTargetScrape: "pending"
    });
  });

  it("exposes the target evidence writer as a package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "observability:target-evidence": "tsx scripts/write-observability-target-evidence.ts"
    });
  });
});
