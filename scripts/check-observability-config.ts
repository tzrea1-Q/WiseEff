import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredObservabilityScripts = ["observability:check"] as const;

export const requiredObservabilityFiles = [
  "ops/self-hosted/observability/prometheus.yml",
  "ops/self-hosted/observability/alerts.yml"
] as const;

export const requiredObservabilityDashboardFiles = [
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-overview.json",
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-jobs.json",
  "ops/self-hosted/observability/grafana/dashboards/wiseeff-security-operations.json"
] as const;

const requiredPrometheusTokens = ["wiseeff-api", "/metrics", "wiseeff-worker", "node-exporter"] as const;
const allowedWiseEffMetricNames = new Set([
  "wiseeff_agent_provider_ready",
  "wiseeff_build_info",
  "wiseeff_database_ready",
  "wiseeff_dependency_health",
  "wiseeff_http_request_duration_ms_count",
  "wiseeff_http_request_duration_ms_sum",
  "wiseeff_http_request_duration_seconds_bucket",
  "wiseeff_http_requests_total",
  "wiseeff_object_store_ready",
  "wiseeff_queue_backlog",
  "wiseeff_queue_dead_lettered",
  "wiseeff_queue_oldest_queued_age_ms",
  "wiseeff_queue_processing",
  "wiseeff_readiness_status"
]);
const forbiddenSecretPatterns = [
  { name: "api_key", pattern: /\bapi[_-]?key\b/i },
  { name: "secret_access_key", pattern: /\bsecret[_-]?access[_-]?key\b/i },
  { name: "password", pattern: /\bpassword\b/i },
  { name: "bearer ", pattern: /\bbearer\s+[a-z0-9._-]+/i },
  { name: "sk-", pattern: /\bsk-[a-z0-9][a-z0-9_-]{6,}/i }
] as const;

export type ObservabilityConfigInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  files: Record<string, string | undefined>;
};

export type ForbiddenSecretMatch = {
  file: string;
  pattern: string;
};

export type UnknownMetricReference = {
  file: string;
  metric: string;
};

export type ObservabilityConfigResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingFiles: string[];
  missingDashboardFiles: string[];
  invalidDashboardFiles: string[];
  alertsMissingRunbookUrl: string[];
  forbiddenSecretMatches: ForbiddenSecretMatch[];
  missingPrometheusTokens: string[];
  unknownMetricReferences: UnknownMetricReference[];
};

function hasRunbookUrl(ruleText: string) {
  return /runbook_url\s*:/i.test(ruleText);
}

function findAlertsMissingRunbookUrl(alertsText: string | undefined) {
  if (!alertsText) {
    return [];
  }

  const alertMatches = [...alertsText.matchAll(/^\s*-\s*alert:\s*([A-Za-z0-9_:-]+)/gim)];
  return alertMatches
    .filter((match, index) => {
      const nextMatch = alertMatches[index + 1];
      const ruleText = alertsText.slice(match.index ?? 0, nextMatch?.index ?? alertsText.length);
      return !hasRunbookUrl(ruleText);
    })
    .map((match) => match[1]);
}

function findInvalidDashboards(files: Record<string, string | undefined>) {
  return requiredObservabilityDashboardFiles.filter((file) => {
    const content = files[file];
    if (content === undefined) {
      return false;
    }

    try {
      const dashboard = JSON.parse(content) as { title?: unknown; panels?: unknown };
      return typeof dashboard.title !== "string" || !Array.isArray(dashboard.panels);
    } catch {
      return true;
    }
  });
}

function findForbiddenSecretMatches(files: Record<string, string | undefined>) {
  return Object.entries(files).flatMap(([file, content]) => {
    if (!content) {
      return [];
    }

    return forbiddenSecretPatterns
      .filter(({ pattern }) => pattern.test(content))
      .map(({ name }) => ({
        file,
        pattern: name
      }));
  });
}

function findUnknownMetricReferences(files: Record<string, string | undefined>) {
  const relevantFiles = [
    "ops/self-hosted/observability/alerts.yml",
    ...requiredObservabilityDashboardFiles
  ];
  const seen = new Set<string>();
  const references: UnknownMetricReference[] = [];

  for (const file of relevantFiles) {
    const content = files[file];
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(/\bwiseeff_[a-zA-Z0-9_:]+/g)) {
      const metric = match[0];
      const key = `${file}:${metric}`;
      if (seen.has(key) || allowedWiseEffMetricNames.has(metric)) {
        continue;
      }
      seen.add(key);
      references.push({ file, metric });
    }
  }

  return references;
}

export function evaluateObservabilityConfig(input: ObservabilityConfigInput): ObservabilityConfigResult {
  const scripts = input.packageJson.scripts ?? {};
  const missingScripts = requiredObservabilityScripts.filter((scriptName) => !scripts[scriptName]);
  const missingFiles = requiredObservabilityFiles.filter((file) => input.files[file] === undefined);
  const missingDashboardFiles = requiredObservabilityDashboardFiles.filter((file) => input.files[file] === undefined);
  const invalidDashboardFiles = findInvalidDashboards(input.files);
  const alertsMissingRunbookUrl = findAlertsMissingRunbookUrl(input.files["ops/self-hosted/observability/alerts.yml"]);
  const forbiddenSecretMatches = findForbiddenSecretMatches(input.files);
  const prometheusText = input.files["ops/self-hosted/observability/prometheus.yml"] ?? "";
  const missingPrometheusTokens = requiredPrometheusTokens.filter((token) => !prometheusText.includes(token));
  const unknownMetricReferences = findUnknownMetricReferences(input.files);
  const status =
    missingScripts.length === 0 &&
    missingFiles.length === 0 &&
    missingDashboardFiles.length === 0 &&
    invalidDashboardFiles.length === 0 &&
    alertsMissingRunbookUrl.length === 0 &&
    forbiddenSecretMatches.length === 0 &&
    missingPrometheusTokens.length === 0 &&
    unknownMetricReferences.length === 0
      ? "passed"
      : "failed";

  return {
    status,
    missingScripts,
    missingFiles,
    missingDashboardFiles,
    invalidDashboardFiles,
    alertsMissingRunbookUrl,
    forbiddenSecretMatches,
    missingPrometheusTokens,
    unknownMetricReferences
  };
}

function readFileIfPresent(file: string) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

export function runObservabilityConfigCheck() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as ObservabilityConfigInput["packageJson"];
  const files = Object.fromEntries(
    [...requiredObservabilityFiles, ...requiredObservabilityDashboardFiles].map((file) => [file, readFileIfPresent(file)])
  );
  const result = evaluateObservabilityConfig({ packageJson, files });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runObservabilityConfigCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
