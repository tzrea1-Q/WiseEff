import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

type RuntimeEnv = Record<string, string | undefined>;

export type M6TargetEvidencePlanStatus = "ready" | "blocked";

export type M6TargetEvidencePlanStep = {
  phase: "M6.2" | "M6.3" | "M6.4" | "M6.5" | "M6.6";
  title: string;
  objective: string;
  requiredInputs: string[];
  commands: string[];
  evidencePaths: string[];
  successCriteria: string[];
  notes: string[];
};

export type M6TargetEvidencePlan = {
  status: M6TargetEvidencePlanStatus;
  targetBaseUrl: string;
  configuredInputs: Record<string, string>;
  blockers: string[];
  steps: M6TargetEvidencePlanStep[];
};

const defaultOutput = "docs/generated/m6-target-evidence-plan.md";
const targetPlanEnvKeys = [
  "WISEEFF_API_BASE_URL",
  "VITE_WISEEFF_API_BASE_URL",
  "AUTH_OIDC_ISSUER",
  "AUTH_OIDC_AUDIENCE",
  "M6_IDENTITY_AUTHORIZATION",
  "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION",
  "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION",
  "M6_IDENTITY_EXPIRED_AUTHORIZATION",
  "M6_IDENTITY_BROWSER_RUNTIME",
  "RESTORE_DATABASE_URL",
  "RESTORE_OBJECT_STORAGE_BUCKET",
  "RESTORE_OBJECT_STORAGE_PREFIX",
  "BACKUP_DATABASE_TARGET",
  "BACKUP_OBJECT_STORAGE_TARGET",
  "M6_SELFHOSTED_SMOKE_AUTHORIZATION",
  "WISEEFF_SMOKE_AUTHORIZATION",
  "M6_OBSERVABILITY_TARGET_ENVIRONMENT",
  "M6_OBSERVABILITY_CONFIG_STATUS",
  "M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE",
  "M6_OBSERVABILITY_ALERTMANAGER_ROUTING",
  "M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT",
  "M6_OBSERVABILITY_PROMETHEUS_QUERY",
  "M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE",
  "M6_OBSERVABILITY_GRAFANA_EVIDENCE",
  "WISEEFF_CAPACITY_TARGET_URL"
] as const;

export function buildM6TargetEvidencePlan({ env = process.env }: { env?: RuntimeEnv } = {}): M6TargetEvidencePlan {
  const targetBaseUrl = commandSafeUrl(firstSet(env.WISEEFF_API_BASE_URL, env.VITE_WISEEFF_API_BASE_URL));
  const capacityTargetUrl = commandSafeUrl(firstSet(env.WISEEFF_CAPACITY_TARGET_URL, targetBaseUrl));
  const blockers: string[] = [];

  requireValue(blockers, "M6.2", "AUTH_OIDC_ISSUER", env.AUTH_OIDC_ISSUER);
  requireValue(blockers, "M6.2", "AUTH_OIDC_AUDIENCE", env.AUTH_OIDC_AUDIENCE);
  requireValue(blockers, "M6.2", "M6_IDENTITY_AUTHORIZATION", env.M6_IDENTITY_AUTHORIZATION);
  requireValue(blockers, "M6.2", "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION", env.M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION);
  requireValue(blockers, "M6.2", "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION", env.M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION);
  requireValue(blockers, "M6.2", "M6_IDENTITY_EXPIRED_AUTHORIZATION", env.M6_IDENTITY_EXPIRED_AUTHORIZATION);
  requirePassedStatus(blockers, "M6.2", "M6_IDENTITY_BROWSER_RUNTIME", env.M6_IDENTITY_BROWSER_RUNTIME);

  requireValue(blockers, "M6.3", "RESTORE_DATABASE_URL", env.RESTORE_DATABASE_URL);
  requireValue(blockers, "M6.3", "RESTORE_OBJECT_STORAGE_BUCKET", env.RESTORE_OBJECT_STORAGE_BUCKET);
  requireValue(blockers, "M6.3", "RESTORE_OBJECT_STORAGE_PREFIX", env.RESTORE_OBJECT_STORAGE_PREFIX);
  requireValue(blockers, "M6.3", "BACKUP_DATABASE_TARGET", env.BACKUP_DATABASE_TARGET);
  requireValue(blockers, "M6.3", "BACKUP_OBJECT_STORAGE_TARGET", env.BACKUP_OBJECT_STORAGE_TARGET);

  if (!isTargetUrl(targetBaseUrl)) {
    blockers.push("M6.4 requires a non-local WISEEFF_API_BASE_URL or --base-url target.");
  }
  if (!firstSet(env.M6_SELFHOSTED_SMOKE_AUTHORIZATION, env.WISEEFF_SMOKE_AUTHORIZATION)) {
    blockers.push("M6.4 missing M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION.");
  }
  if (!env.M6_OBSERVABILITY_TARGET_ENVIRONMENT?.trim()) {
    blockers.push("M6.5 requires M6_OBSERVABILITY_TARGET_ENVIRONMENT.");
  } else if (!isTargetEnvironment(env.M6_OBSERVABILITY_TARGET_ENVIRONMENT)) {
    blockers.push("M6.5 requires M6_OBSERVABILITY_TARGET_ENVIRONMENT to identify a target, staging, pilot, or self-hosted environment.");
  }
  requirePassedStatus(blockers, "M6.5", "M6_OBSERVABILITY_CONFIG_STATUS", env.M6_OBSERVABILITY_CONFIG_STATUS);
  requirePassedStatus(
    blockers,
    "M6.5",
    "M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE",
    env.M6_OBSERVABILITY_PROMETHEUS_TARGET_SCRAPE
  );
  requirePassedStatus(blockers, "M6.5", "M6_OBSERVABILITY_ALERTMANAGER_ROUTING", env.M6_OBSERVABILITY_ALERTMANAGER_ROUTING);
  requirePassedStatus(
    blockers,
    "M6.5",
    "M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT",
    env.M6_OBSERVABILITY_GRAFANA_DASHBOARD_IMPORT
  );
  requireValue(blockers, "M6.5", "M6_OBSERVABILITY_PROMETHEUS_QUERY", env.M6_OBSERVABILITY_PROMETHEUS_QUERY);
  requireValue(blockers, "M6.5", "M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE", env.M6_OBSERVABILITY_ALERT_ROUTE_EVIDENCE);
  requireValue(blockers, "M6.5", "M6_OBSERVABILITY_GRAFANA_EVIDENCE", env.M6_OBSERVABILITY_GRAFANA_EVIDENCE);

  if (!isTargetUrl(capacityTargetUrl)) {
    blockers.push("M6.6 missing WISEEFF_CAPACITY_TARGET_URL or WISEEFF_API_BASE_URL.");
  }

  const steps: M6TargetEvidencePlanStep[] = [
    {
      phase: "M6.2",
      title: "Identity And User Governance Target Evidence",
      objective: "Prove the deployed WiseEff API trusts the target OIDC issuer and enforces DB-backed user governance.",
      requiredInputs: [
        "AUTH_OIDC_ISSUER",
        "AUTH_OIDC_AUDIENCE",
        "M6_IDENTITY_AUTHORIZATION",
        "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION",
        "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION",
        "M6_IDENTITY_EXPIRED_AUTHORIZATION",
        "M6_IDENTITY_BROWSER_RUNTIME=passed after browser refresh/logout proof"
      ],
      commands: ["npm run identity:check"],
      evidencePaths: ["docs/generated/m6-identity-evidence.md"],
      successCriteria: [
        "OIDC discovery/JWKS passes against the target issuer.",
        "/api/v1/me resolves the target Admin user through production OIDC.",
        "Wrong issuer, wrong audience, and expired token checks return 401.",
        "Browser token acquisition, refresh, and logout are recorded as passed."
      ],
      notes: [
        "docs/generated/m6-local-oidc-identity-evidence.md is local implementation proof only and is not accepted as target evidence."
      ]
    },
    {
      phase: "M6.3",
      title: "Self-Hosted Storage And Backup Target Evidence",
      objective: "Prove restore safety and cross-store recovery on isolated non-customer PostgreSQL/object-store targets.",
      requiredInputs: [
        "RESTORE_DATABASE_URL",
        "RESTORE_OBJECT_STORAGE_BUCKET",
        "RESTORE_OBJECT_STORAGE_PREFIX",
        "BACKUP_DATABASE_TARGET",
        "BACKUP_OBJECT_STORAGE_TARGET"
      ],
      commands: ["npm run restore:drill", "npm run backup:drill", "npm run backup:check"],
      evidencePaths: [
        "docs/generated/m6-backup-restore-evidence.md",
        "docs/generated/m6-backup-restore-evidence.json"
      ],
      successCriteria: [
        "Restore targets are isolated from live database and object-store locations.",
        "PostgreSQL restore validation and object-store checksum validation pass.",
        "Evidence is redacted and records the target environment label."
      ],
      notes: ["Local backup evidence proves shape only unless generated from the real target restore drill."]
    },
    {
      phase: "M6.4",
      title: "Durable Queue Target Evidence",
      objective: "Prove the target API is running durable queue mode with Redis/BullMQ transport and PostgreSQL job-state readiness.",
      requiredInputs: ["WISEEFF_API_BASE_URL", "M6_SELFHOSTED_SMOKE_AUTHORIZATION or WISEEFF_SMOKE_AUTHORIZATION"],
      commands: [`npm run queue:check -- --base-url ${targetBaseUrl || "<target-url>"}`],
      evidencePaths: ["docs/generated/m6-queue-readiness-evidence.md"],
      successCriteria: [
        "/health/ready exposes dependencies.durableQueue.",
        "Durable queue transport is ready.",
        "PostgreSQL job-state health is ready.",
        "The evidence base URL is a non-local target URL."
      ],
      notes: ["Queue pause/drain/resume release rehearsal should be attached to M6.6 rollback/release evidence."]
    },
    {
      phase: "M6.5",
      title: "Observability And Operations Target Evidence",
      objective: "Prove Prometheus scrape, Alertmanager routing, and Grafana dashboard import for the target runtime.",
      requiredInputs: [
        "Prometheus target scrape result",
        "Alertmanager routing exercise result",
        "Grafana dashboard import or screenshot evidence"
      ],
      commands: ["npm run observability:check", "npm run observability:target-evidence"],
      evidencePaths: [
        "docs/generated/m6-observability-config-evidence.md",
        "docs/generated/m6-observability-evidence.md"
      ],
      successCriteria: [
        "Prometheus target scrape is recorded as passed.",
        "Alertmanager routing is recorded as passed.",
        "Grafana dashboard import is recorded as passed.",
        "Runbook links and alert metadata remain valid."
      ],
      notes: ["Config validation alone is not target observability evidence; attach the scrape/routing/dashboard proof."]
    },
    {
      phase: "M6.6",
      title: "Release, Rollback And Capacity Target Evidence",
      objective: "Prove the self-hosted release candidate can be accepted, capacity-tested, synthetically checked, and rolled back.",
      requiredInputs: [
        "WISEEFF_CAPACITY_TARGET_URL",
        "Rollback candidate/previous artifact references",
        "Target synthetic acceptance artifact",
        "Queue evidence path",
        "Observability evidence path",
        "Environment fingerprint"
      ],
      commands: [
        `npm run capacity:gate -- --target-url ${capacityTargetUrl || "<target-url>"}`,
        "npm run rollback:rehearsal",
        "npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime",
        "npm run selfhost:release-gate",
        "npm run m6:target-evidence"
      ],
      evidencePaths: [
        "docs/generated/capacity-gate.md",
        "docs/generated/m6-rollback-rehearsal-evidence.md",
        "docs/generated/acceptance-browser-evidence.md",
        "docs/generated/m6-release-readiness.md",
        "docs/generated/m6-target-evidence-summary.md"
      ],
      successCriteria: [
        "Capacity evidence contains observed target metrics and no pending threshold rows.",
        "Rollback rehearsal records stop-writes, queue drain, artifact rollback, and post-rollback smoke.",
        "Target synthetic browser acceptance passes with --no-start-runtime.",
        "Release gate marks identity, backup/restore, rollback, capacity, queue, observability, and target synthetic readiness as passed.",
        "m6:target-evidence passes before M6.2-M6.6 plans move to completed."
      ],
      notes: ["Do not mark release readiness passed while any dependency evidence is pending or local-only."]
    }
  ];

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    targetBaseUrl,
    configuredInputs: buildConfiguredInputSnapshot(env),
    blockers,
    steps
  };
}

export function renderM6TargetEvidencePlanMarkdown(input: { date: string; plan: M6TargetEvidencePlan }): string {
  const lines = [
    "## M6 Target Evidence Execution Plan",
    "",
    `- Date: ${input.date}`,
    `- Status: \`${input.plan.status}\``,
    `- Target base URL: \`${sanitize(input.plan.targetBaseUrl || "not-configured")}\``,
    "",
    "### Configured Target Inputs",
    "",
    "| Key | Value |",
    "| --- | --- |",
    ...Object.entries(input.plan.configuredInputs).map(([key, value]) => `| ${key} | \`${sanitize(value || "not-configured")}\` |`),
    "",
    "### Blockers",
    "",
    ...formatItems(input.plan.blockers.map(sanitize)),
    "",
    "### Ordered Execution",
    ""
  ];

  for (const step of input.plan.steps) {
    lines.push(
      `#### ${step.phase} ${step.title}`,
      "",
      `- Objective: ${sanitize(step.objective)}`,
      "",
      "Required inputs:",
      "",
      ...formatItems(step.requiredInputs.map(sanitize)),
      "",
      "Commands:",
      "",
      ...step.commands.map((command) => `- \`${sanitize(command)}\``),
      "",
      "Evidence paths:",
      "",
      ...formatItems(step.evidencePaths.map((path) => `\`${sanitize(path)}\``)),
      "",
      "Success criteria:",
      "",
      ...formatItems(step.successCriteria.map(sanitize)),
      "",
      "Notes:",
      "",
      ...formatItems(step.notes.map(sanitize)),
      ""
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeM6TargetEvidencePlan({
  env = loadM6TargetEvidencePlanEnv(),
  output = defaultOutput
}: {
  env?: RuntimeEnv;
  output?: string;
} = {}) {
  const plan = buildM6TargetEvidencePlan({ env });
  const markdown = renderM6TargetEvidencePlanMarkdown({
    date: new Date().toISOString(),
    plan
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown, "utf8");
  console.log(markdown);

  return plan;
}

export function loadM6TargetEvidencePlanEnv({
  args = process.argv.slice(2),
  processEnv = process.env,
  exists = existsSync,
  readFile = (filePath: string) => readFileSync(filePath, "utf8")
}: {
  args?: readonly string[];
  processEnv?: RuntimeEnv;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
} = {}): RuntimeEnv {
  const envFile = parseEnvFileArg(args, processEnv);
  const env = pickTargetPlanEnv(processEnv);

  if (envFile && exists(envFile)) {
    return {
      ...env,
      ...parseTargetPlanEnvFile(readFile(envFile))
    };
  }

  return env;
}

function firstSet(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function buildConfiguredInputSnapshot(env: RuntimeEnv) {
  return Object.fromEntries(targetPlanEnvKeys.map((key) => [key, env[key]?.trim() ?? ""]));
}

function requireValue(blockers: string[], phase: string, name: string, value: string | undefined) {
  if (!value?.trim()) {
    blockers.push(`${phase} missing ${name}.`);
  }
}

function requirePassedStatus(blockers: string[], phase: string, name: string, value: string | undefined) {
  if (value?.trim().toLowerCase() !== "passed") {
    blockers.push(`${phase} requires ${name}=passed.`);
  }
}

function commandSafeUrl(value: string) {
  if (!value.trim()) {
    return "";
  }
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function isTargetUrl(value: string) {
  return /^https?:\/\//i.test(value) && !/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(value);
}

function isTargetEnvironment(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized.startsWith("local-") &&
    !normalized.includes("localhost") &&
    !normalized.includes("127.0.0.1") &&
    (normalized.includes("target") ||
      normalized.includes("staging") ||
      normalized.includes("pilot") ||
      normalized.includes("self-hosted"))
  );
}

function formatItems(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function parseEnvFileArg(args: readonly string[], env: RuntimeEnv) {
  const equalsArg = args.find((arg) => arg.startsWith("--env-file="));
  if (equalsArg) {
    return equalsArg.slice("--env-file=".length);
  }

  const index = args.indexOf("--env-file");
  if (index !== -1) {
    return args[index + 1] ?? "";
  }

  return env.M6_TARGET_EVIDENCE_ENV_FILE?.trim() || ".env";
}

function pickTargetPlanEnv(env: RuntimeEnv): RuntimeEnv {
  return Object.fromEntries(targetPlanEnvKeys.map((key) => [key, env[key]]));
}

function parseTargetPlanEnvFile(content: string): RuntimeEnv {
  const result: RuntimeEnv = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim();
    if (!isTargetPlanEnvKey(key)) {
      continue;
    }

    result[key] = unquoteEnvValue(rawValue.join("=").trim());
  }

  return result;
}

function isTargetPlanEnvKey(key: string): key is (typeof targetPlanEnvKeys)[number] {
  return targetPlanEnvKeys.includes(key as (typeof targetPlanEnvKeys)[number]);
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s`]+@/gi, "$1<redacted>@")
    .replace(secretAssignmentPattern("="), "$1<redacted>")
    .replace(secretAssignmentPattern(":"), "$1<redacted>");
}

function secretAssignmentPattern(separator: "=" | ":") {
  return new RegExp(`([A-Za-z0-9_.-]*(?:token|secret|key|password)[A-Za-z0-9_.-]*${separator})([^&\\s\`]+)`, "gi");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = writeM6TargetEvidencePlan();
  process.exit(plan.status === "ready" ? 0 : 1);
}
