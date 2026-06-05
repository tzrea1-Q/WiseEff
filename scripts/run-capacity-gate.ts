import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type CapacityProbeStatus = "passed" | "failed" | "pending";

export type CapacityGateInput = {
  metadata: {
    targetUrl: string;
    environment: string;
    profile: string;
    duration: string;
    vus: number;
    safeWritesEnabled: boolean;
  };
  thresholds: {
    p95LatencyMs: number;
    errorRate: number;
    minThroughputRps: number;
    maxCpuPercent: number;
    maxMemoryPercent: number;
    maxDbConnections: number;
    maxQueueBacklog: number;
    objectStoreProbeRequired: boolean;
  };
  observed: {
    p95LatencyMs: number | null;
    errorRate: number | null;
    throughputRps: number | null;
    cpuPercent: number | null;
    memoryPercent: number | null;
    dbConnections: number | null;
    queueBacklog: number | null;
    objectStoreProbeStatus: CapacityProbeStatus;
  };
  artifacts: {
    k6SummaryPath: string;
    metricsSnapshotPath: string;
  };
};

export type CapacityGateResult = {
  status: "passed" | "failed";
  blockers: string[];
  pending: string[];
};

type CapacityGateCliOptions = {
  targetUrl: string;
  environment: string;
  profile: string;
  duration: string;
  vus: number;
  authorization: string;
  safeWritesEnabled: boolean;
  output: string;
  k6SummaryPath: string;
  metricsSnapshotPath: string;
  scriptPath: string;
  runK6: boolean;
  thresholds: CapacityGateInput["thresholds"];
  observed: CapacityGateInput["observed"];
};

type RuntimeEnv = Record<string, string | undefined>;
type K6Runner = (command: ReturnType<typeof buildK6Command>) => { status: number; output: string };

export function evaluateCapacityGate(input: CapacityGateInput): CapacityGateResult {
  const blockers: string[] = [];
  const pending: string[] = [];

  if (!input.metadata.targetUrl.trim()) {
    blockers.push("Target URL is required for capacity evidence.");
  } else if (!isTargetCapacityUrl(input.metadata.targetUrl)) {
    blockers.push("Target URL must be a non-local http(s) URL for capacity evidence.");
  }
  if (!input.metadata.environment.trim()) {
    blockers.push("Capacity environment label is required.");
  } else if (!isTargetEnvironment(input.metadata.environment)) {
    blockers.push("Capacity environment must identify a configured target, staging, pilot, or self-hosted environment.");
  }
  if (input.metadata.vus <= 0) {
    blockers.push("Virtual users must be greater than zero.");
  }
  if (!input.metadata.duration.trim()) {
    blockers.push("Capacity duration is required.");
  }
  if (!input.artifacts.k6SummaryPath.trim()) {
    blockers.push("k6 summary artifact path is required.");
  }
  if (!input.artifacts.metricsSnapshotPath.trim()) {
    blockers.push("metrics snapshot artifact path is required.");
  }

  compareMax(input.observed.p95LatencyMs, input.thresholds.p95LatencyMs, "p95 latency", "ms", blockers, pending);
  compareMax(input.observed.errorRate, input.thresholds.errorRate, "error rate", "", blockers, pending);
  compareMin(input.observed.throughputRps, input.thresholds.minThroughputRps, "throughput", " rps", blockers, pending);
  compareMax(input.observed.cpuPercent, input.thresholds.maxCpuPercent, "CPU utilization", "%", blockers, pending);
  compareMax(input.observed.memoryPercent, input.thresholds.maxMemoryPercent, "memory utilization", "%", blockers, pending);
  compareMax(input.observed.dbConnections, input.thresholds.maxDbConnections, "database connection", "", blockers, pending);
  compareMax(input.observed.queueBacklog, input.thresholds.maxQueueBacklog, "queue backlog", "", blockers, pending);

  if (input.thresholds.objectStoreProbeRequired) {
    if (input.observed.objectStoreProbeStatus === "failed") {
      blockers.push("object-store probe did not pass.");
    }
    if (input.observed.objectStoreProbeStatus === "pending") {
      pending.push("object-store probe evidence is pending.");
    }
  }

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    blockers,
    pending
  };
}

export function buildCapacityGateEvidence(args: {
  date: string;
  input: CapacityGateInput;
  result: CapacityGateResult;
}): string {
  const lines = [
    "## M6.6 Capacity Gate Evidence",
    "",
    `- Date: ${args.date}`,
    `- Status: \`${args.result.status}\``,
    `- Target URL: \`${redactCapacitySecret(args.input.metadata.targetUrl)}\``,
    `- Environment: \`${redactCapacitySecret(args.input.metadata.environment)}\``,
    `- Profile: \`${args.input.metadata.profile}\``,
    `- Duration: \`${args.input.metadata.duration}\``,
    `- Virtual users: \`${args.input.metadata.vus}\``,
    `- Safe writes enabled: \`${args.input.metadata.safeWritesEnabled}\``,
    "",
    "### Threshold Results",
    "",
    "| Metric | Observed | Threshold |",
    "| --- | --- | --- |",
    `| p95 latency | ${formatObserved(args.input.observed.p95LatencyMs, "ms")} | <= ${args.input.thresholds.p95LatencyMs}ms |`,
    `| error rate | ${formatObserved(args.input.observed.errorRate, "")} | <= ${args.input.thresholds.errorRate} |`,
    `| throughput | ${formatObserved(args.input.observed.throughputRps, " rps")} | >= ${args.input.thresholds.minThroughputRps} rps |`,
    `| CPU utilization | ${formatObserved(args.input.observed.cpuPercent, "%")} | <= ${args.input.thresholds.maxCpuPercent}% |`,
    `| memory utilization | ${formatObserved(args.input.observed.memoryPercent, "%")} | <= ${args.input.thresholds.maxMemoryPercent}% |`,
    `| database connections | ${formatObserved(args.input.observed.dbConnections, "")} | <= ${args.input.thresholds.maxDbConnections} |`,
    `| queue backlog | ${formatObserved(args.input.observed.queueBacklog, "")} | <= ${args.input.thresholds.maxQueueBacklog} |`,
    `| object-store probe | ${args.input.observed.objectStoreProbeStatus} | ${args.input.thresholds.objectStoreProbeRequired ? "required" : "optional"} |`,
    "",
    "### Artifacts",
    "",
    `- k6 summary: \`${redactCapacitySecret(args.input.artifacts.k6SummaryPath)}\``,
    `- metrics snapshot: \`${redactCapacitySecret(args.input.artifacts.metricsSnapshotPath)}\``,
    "",
    "### Blockers",
    "",
    ...(args.result.blockers.length > 0 ? args.result.blockers.map((blocker) => `- ${redactCapacitySecret(blocker)}`) : ["- none"]),
    "",
    "### Pending Evidence",
    "",
    ...(args.result.pending.length > 0 ? args.result.pending.map((item) => `- ${redactCapacitySecret(item)}`) : ["- none"]),
    ""
  ];

  return lines.join("\n");
}

export function buildK6Command(args: {
  targetUrl: string;
  authorization: string;
  vus: number;
  duration: string;
  summaryPath: string;
  scriptPath: string;
}) {
  const env = {
    WISEEFF_CAPACITY_TARGET_URL: args.targetUrl,
    WISEEFF_CAPACITY_AUTHORIZATION: args.authorization,
    WISEEFF_CAPACITY_VUS: String(args.vus),
    WISEEFF_CAPACITY_DURATION: args.duration,
    WISEEFF_CAPACITY_SUMMARY_PATH: args.summaryPath
  };
  const cliArgs = ["run", "--summary-export", args.summaryPath, args.scriptPath];
  const displayEnv = Object.entries(env)
    .map(([key, value]) => `${key}=${redactCapacitySecret(value)}`)
    .join(" ");

  return {
    command: "k6",
    args: cliArgs,
    env,
    display: `${displayEnv} k6 ${cliArgs.join(" ")}`
  };
}

export function parseCapacityGateArgs(args: string[], env: RuntimeEnv = process.env): CapacityGateCliOptions {
  const getValue = (name: string, fallback: string) => {
    const index = args.indexOf(name);
    if (index === -1) {
      const envValue = env[`npm_config_${name.slice(2).replace(/-/g, "_")}`];
      return envValue && envValue !== "true" ? envValue : fallback;
    }
    return args[index + 1] ?? fallback;
  };
  const numberValue = (name: string, fallback: number) => {
    const value = Number(getValue(name, String(fallback)));
    if (Number.isNaN(value)) {
      throw new Error(`${name} must be a number.`);
    }
    return value;
  };
  const optionalNumberValue = (name: string): number | null => {
    const raw = getValue(name, "");
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) {
      throw new Error(`${name} must be a number.`);
    }
    return value;
  };
  const objectStoreProbe = getValue("--object-store-probe", "pending");
  if (!["passed", "failed", "pending"].includes(objectStoreProbe)) {
    throw new Error("--object-store-probe must be passed, failed, or pending.");
  }

  const positionals = args.filter((arg) => !arg.startsWith("--") && !isFlagValue(args, arg));
  const positionalTargetUrl = positionals.find((arg) => /^https?:\/\//i.test(arg)) ?? "";
  const positionalOutput = positionals.find((arg) => arg.endsWith(".md")) ?? "";

  return {
    targetUrl: getValue("--target-url", env.WISEEFF_CAPACITY_TARGET_URL ?? positionalTargetUrl),
    environment: getValue("--environment", "self-hosted-target"),
    profile: getValue("--profile", "pilot-smoke"),
    duration: getValue("--duration", "2m"),
    vus: numberValue("--vus", 10),
    authorization: getValue("--authorization", env.WISEEFF_CAPACITY_AUTHORIZATION ?? ""),
    safeWritesEnabled: args.includes("--enable-safe-writes"),
    output: getValue("--output", positionalOutput || "docs/generated/capacity-gate.md"),
    k6SummaryPath: getValue("--k6-summary", "test-results/capacity/k6-summary.json"),
    metricsSnapshotPath: getValue("--metrics-snapshot", "test-results/capacity/metrics-snapshot.json"),
    scriptPath: getValue("--script", "e2e/capacity/wiseeff-smoke.k6.js"),
    runK6: args.includes("--run-k6"),
    thresholds: {
      p95LatencyMs: numberValue("--p95-ms", 750),
      errorRate: numberValue("--error-rate", 0.01),
      minThroughputRps: numberValue("--min-rps", 5),
      maxCpuPercent: numberValue("--max-cpu", 80),
      maxMemoryPercent: numberValue("--max-memory", 85),
      maxDbConnections: numberValue("--max-db-connections", 40),
      maxQueueBacklog: numberValue("--max-queue-backlog", 25),
      objectStoreProbeRequired: !args.includes("--skip-object-store-probe")
    },
    observed: {
      p95LatencyMs: optionalNumberValue("--observed-p95-ms"),
      errorRate: optionalNumberValue("--observed-error-rate"),
      throughputRps: optionalNumberValue("--observed-rps"),
      cpuPercent: optionalNumberValue("--observed-cpu"),
      memoryPercent: optionalNumberValue("--observed-memory"),
      dbConnections: optionalNumberValue("--observed-db-connections"),
      queueBacklog: optionalNumberValue("--observed-queue-backlog"),
      objectStoreProbeStatus: objectStoreProbe as CapacityProbeStatus
    }
  };
}

function isFlagValue(args: string[], value: string) {
  const index = args.indexOf(value);
  if (index <= 0) {
    return false;
  }
  return args[index - 1].startsWith("--");
}

function isTargetCapacityUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return (
      hostname !== "localhost" &&
      hostname !== "0.0.0.0" &&
      hostname !== "::1" &&
      hostname !== "[::1]" &&
      !hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

function isTargetEnvironment(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !isPlaceholderEnvironment(normalized) &&
    !isLocalEnvironment(normalized) &&
    (normalized.includes("target") ||
      normalized.includes("staging") ||
      normalized.includes("pilot") ||
      normalized.includes("self-hosted"))
  );
}

function isPlaceholderEnvironment(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "n/a" ||
    normalized.includes("not-configured") ||
    normalized.includes("not_configured")
  );
}

function isLocalEnvironment(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "local" ||
    normalized.startsWith("local-") ||
    normalized.includes("localhost") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("::1")
  );
}

export function redactCapacitySecret(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(api_key|token|secret|key|password)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/(api_key|token|secret|key|password):([^@\s]+)/gi, "$1:<redacted>");
}

export function runCapacityGate(
  options = parseCapacityGateArgs(process.argv.slice(2)),
  k6Runner: K6Runner = runK6Command
): CapacityGateResult {
  const extraBlockers: string[] = [];

  if (options.runK6) {
    const command = buildK6Command({
      targetUrl: options.targetUrl,
      authorization: options.authorization,
      vus: options.vus,
      duration: options.duration,
      summaryPath: options.k6SummaryPath,
      scriptPath: options.scriptPath
    });
    const result = k6Runner(command);
    if (result.status !== 0) {
      extraBlockers.push("k6 capacity command failed.");
      console.error(redactCapacitySecret(`${command.display}\n${result.output}`));
    }
  }

  const input = buildCapacityInput(options);
  const result = evaluateCapacityGate(input);
  result.blockers.push(...extraBlockers);
  if (result.blockers.length > 0) {
    result.status = "failed";
  }
  const evidence = buildCapacityGateEvidence({
    date: new Date().toISOString(),
    input,
    result
  });

  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, evidence, "utf8");
  console.log(evidence);

  return result;
}

function runK6Command(command: ReturnType<typeof buildK6Command>) {
  const result = spawnSync(command.command, command.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...command.env }
  });

  return {
    status: result.status ?? 1,
    output: result.error?.message ?? result.stderr ?? result.stdout ?? ""
  };
}

export function buildCapacityInput(options: CapacityGateCliOptions): CapacityGateInput {
  return {
    metadata: {
      targetUrl: options.targetUrl,
      environment: options.environment,
      profile: options.profile,
      duration: options.duration,
      vus: options.vus,
      safeWritesEnabled: options.safeWritesEnabled
    },
    thresholds: options.thresholds,
    observed: options.observed,
    artifacts: {
      k6SummaryPath: options.k6SummaryPath,
      metricsSnapshotPath: options.metricsSnapshotPath
    }
  };
}

function compareMax(
  observed: number | null,
  threshold: number,
  label: string,
  unit: string,
  blockers: string[],
  pending: string[]
) {
  if (observed === null) {
    pending.push(`${label} evidence is pending.`);
    return;
  }
  if (observed > threshold) {
    blockers.push(`${label} ${observed}${unit} exceeds threshold ${threshold}${unit}.`);
  }
}

function compareMin(
  observed: number | null,
  threshold: number,
  label: string,
  unit: string,
  blockers: string[],
  pending: string[]
) {
  if (observed === null) {
    pending.push(`${label} evidence is pending.`);
    return;
  }
  if (observed < threshold) {
    blockers.push(`${label} ${observed}${unit} is below threshold ${threshold}${unit}.`);
  }
}

function formatObserved(value: number | null, unit: string) {
  return value === null ? "pending" : `${value}${unit}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCapacityGate();
  process.exit(result.status === "passed" ? 0 : 1);
}
