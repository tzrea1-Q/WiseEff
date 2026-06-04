import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

type RuntimeEnv = Record<string, string | undefined>;
type EvidenceStatus = "passed" | "failed" | "pending";

export type ObservabilityTargetEvidenceInput = {
  configStatus: EvidenceStatus;
  prometheusTargetScrape: EvidenceStatus;
  alertmanagerRouting: EvidenceStatus;
  grafanaDashboardImport: EvidenceStatus;
  targetEnvironment: string;
  prometheusQuery: string;
  alertRouteEvidence: string;
  grafanaEvidence: string;
};

export type ObservabilityTargetEvidenceResult = {
  status: "passed" | "failed";
  blockers: string[];
  pending: string[];
};

type ObservabilityTargetEvidenceCliOptions = ObservabilityTargetEvidenceInput & {
  output: string;
};

const defaultOutput = "docs/generated/m6-observability-evidence.md";

export function evaluateObservabilityTargetEvidence(
  input: ObservabilityTargetEvidenceInput
): ObservabilityTargetEvidenceResult {
  const blockers: string[] = [];
  const pending: string[] = [];

  if (!input.targetEnvironment.trim()) {
    blockers.push("Target environment label is required.");
  } else if (isPlaceholderEnvironment(input.targetEnvironment)) {
    blockers.push("Target environment label must identify a configured target, staging, pilot, or self-hosted environment.");
  } else if (!isTargetEnvironment(input.targetEnvironment)) {
    blockers.push("Target environment label must identify a target, staging, pilot, or self-hosted environment.");
  }

  collectStatus(input.configStatus, "Observability config check", blockers, pending);
  collectStatus(input.prometheusTargetScrape, "Prometheus target scrape", blockers, pending);
  collectStatus(input.alertmanagerRouting, "Alertmanager routing", blockers, pending);
  collectStatus(input.grafanaDashboardImport, "Grafana dashboard import", blockers, pending);

  if (input.prometheusTargetScrape === "passed" && !input.prometheusQuery.trim()) {
    blockers.push("Prometheus query or scrape evidence reference is required when target scrape is passed.");
  }
  if (input.alertmanagerRouting === "passed" && !input.alertRouteEvidence.trim()) {
    blockers.push("Alertmanager routing evidence reference is required when routing is passed.");
  }
  if (input.grafanaDashboardImport === "passed" && !input.grafanaEvidence.trim()) {
    blockers.push("Grafana import evidence reference is required when dashboard import is passed.");
  }

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    blockers,
    pending
  };
}

export function buildObservabilityTargetEvidenceMarkdown(args: {
  date: string;
  input: ObservabilityTargetEvidenceInput;
  result: ObservabilityTargetEvidenceResult;
}): string {
  const lines = [
    "## M6.5 Observability Evidence",
    "",
    `- Date: ${args.date}`,
    `- Status: \`${args.result.status}\``,
    "- Evidence scope: `target self-hosted observability`",
    `- Target environment: \`${sanitize(args.input.targetEnvironment || "not-configured")}\``,
    `- Config check: \`${args.input.configStatus}\``,
    `- Prometheus target scrape: \`${args.input.prometheusTargetScrape}\``,
    `- Alertmanager routing: \`${args.input.alertmanagerRouting}\``,
    `- Grafana dashboard import: \`${args.input.grafanaDashboardImport}\``,
    "",
    "### Proof",
    "",
    `- Prometheus query or scrape evidence: \`${sanitize(args.input.prometheusQuery || "pending")}\``,
    `- Alert route proof: \`${sanitize(args.input.alertRouteEvidence || "pending")}\``,
    `- Grafana dashboard proof: \`${sanitize(args.input.grafanaEvidence || "pending")}\``,
    "",
    "### Blockers",
    "",
    ...formatItems(args.result.blockers.map(sanitize)),
    "",
    "### Pending Evidence",
    "",
    ...formatItems(args.result.pending.map(sanitize)),
    ""
  ];

  return lines.join("\n");
}

export function parseObservabilityTargetEvidenceArgs(
  args: readonly string[],
  env: RuntimeEnv = process.env
): ObservabilityTargetEvidenceCliOptions {
  const positionalValues = [...args.filter((arg) => !arg.startsWith("--"))];
  const getValue = (name: string, envName: string, fallback = "") => {
    const equalsPrefix = `${name}=`;
    const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
    if (equalsArg) {
      return equalsArg.slice(equalsPrefix.length);
    }
    const index = args.indexOf(name);
    if (index !== -1) {
      return args[index + 1] ?? fallback;
    }
    const npmValue = env[`npm_config_${name.slice(2).replace(/-/g, "_")}`]?.trim();
    if (npmValue === "true") {
      return positionalValues.shift() ?? fallback;
    }
    return npmValue || env[envName]?.trim() || fallback;
  };

  return {
    targetEnvironment: getValue("--target-environment", "M6_OBSERVABILITY_TARGET_ENVIRONMENT"),
    configStatus: parseStatus(getValue("--config-status", "M6_OBSERVABILITY_CONFIG_STATUS", "pending"), "--config-status"),
    prometheusTargetScrape: parseStatus(
      getValue("--prometheus-target-scrape", "M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE", "pending"),
      "--prometheus-target-scrape"
    ),
    alertmanagerRouting: parseStatus(
      getValue("--alertmanager-routing", "M6_OBSERVABILITY_ALERTMANAGER_ROUTING", "pending"),
      "--alertmanager-routing"
    ),
    grafanaDashboardImport: parseStatus(
      getValue("--grafana-dashboard-import", "M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT", "pending"),
      "--grafana-dashboard-import"
    ),
    prometheusQuery: getValue("--prometheus-query", "M6_OBSERVABILITY_PROMETHEUS_QUERY"),
    alertRouteEvidence: getValue("--alert-route-evidence", "M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE"),
    grafanaEvidence: getValue("--grafana-evidence", "M6_OBSERVABILITY_GRAFANA_EVIDENCE"),
    output: getValue("--output", "M6_OBSERVABILITY_TARGET_EVIDENCE_OUT", defaultOutput)
  };
}

export function writeObservabilityTargetEvidence(
  options = parseObservabilityTargetEvidenceArgs(process.argv.slice(2))
): ObservabilityTargetEvidenceResult {
  const input: ObservabilityTargetEvidenceInput = {
    configStatus: options.configStatus,
    prometheusTargetScrape: options.prometheusTargetScrape,
    alertmanagerRouting: options.alertmanagerRouting,
    grafanaDashboardImport: options.grafanaDashboardImport,
    targetEnvironment: options.targetEnvironment,
    prometheusQuery: options.prometheusQuery,
    alertRouteEvidence: options.alertRouteEvidence,
    grafanaEvidence: options.grafanaEvidence
  };
  const result = evaluateObservabilityTargetEvidence(input);
  const evidence = buildObservabilityTargetEvidenceMarkdown({
    date: new Date().toISOString(),
    input,
    result
  });

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, evidence, "utf8");
  console.log(evidence);

  return result;
}

function collectStatus(status: EvidenceStatus, label: string, blockers: string[], pending: string[]) {
  if (status === "failed") {
    blockers.push(`${label} evidence failed.`);
  }
  if (status === "pending") {
    pending.push(`${label} evidence is pending.`);
  }
}

function parseStatus(value: string, label: string): EvidenceStatus {
  if (!["passed", "failed", "pending"].includes(value)) {
    throw new Error(`${label} must be passed, failed, or pending.`);
  }
  return value as EvidenceStatus;
}

function formatItems(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function isTargetEnvironment(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !isLocalEnvironment(normalized) &&
    (normalized.includes("target") ||
      normalized.includes("staging") ||
      normalized.includes("pilot") ||
      normalized.includes("self-hosted"))
  );
}

function isPlaceholderEnvironment(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "n/a" ||
    normalized.includes("not-configured") ||
    normalized.includes("not_configured")
  );
}

function isLocalEnvironment(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "local" ||
    normalized.startsWith("local-") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1")
  );
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s`]+@/gi, "$1<redacted>@")
    .replace(secretAssignmentPattern("="), "$1<redacted>")
    .replace(secretAssignmentPattern(":"), "$1<redacted>")
    .replace(/\bsk-[a-z0-9][a-z0-9_-]{6,}/gi, "sk-<redacted>");
}

function secretAssignmentPattern(separator: "=" | ":") {
  return new RegExp(`([A-Za-z0-9_.-]*(?:token|secret|key|password)[A-Za-z0-9_.-]*${separator})([^&\\s\`]+)`, "gi");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = writeObservabilityTargetEvidence();
  process.exit(result.status === "passed" ? 0 : 1);
}
