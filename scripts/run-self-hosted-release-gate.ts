import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type GateStatus = "passed" | "failed" | "pending";
export type HdcReleaseStatus = "unavailable" | "skipped_by_scope" | "enabled";
export type SyntheticAcceptanceMode = "local-non-hdc" | "target-non-hdc" | "full-pilot";

export const requiredReleaseGateCommands = [
  "docs:check",
  "contract:check",
  "test:all",
  "build",
  "acceptance:coverage",
  "acceptance:operations",
  "acceptance:evidence",
  "selfhost:check",
  "git diff --check"
] as const;

export type ReleaseGateCommandName = (typeof requiredReleaseGateCommands)[number];

export type ReleaseGateCommandResult = {
  name: ReleaseGateCommandName;
  status: "passed" | "failed" | "pending";
  detail: string;
};

export type ReleaseGateInput = {
  metadata: {
    branch: string;
    commit: string;
    version: string;
    dirty: boolean;
    targetEnvironment: string;
    artifactRef: string;
    migrations: string[];
    envFingerprint: string;
    syntheticAcceptanceMode: SyntheticAcceptanceMode;
    hdc: {
      status: HdcReleaseStatus;
      evidencePath: string | null;
    };
  };
  evidence: {
    backupEvidencePath: string;
    rollbackPlanPath: string;
    rollbackRehearsalEvidencePath: string;
    targetSyntheticEvidencePath: string;
    capacityEvidencePath: string;
  };
  commands: ReleaseGateCommandResult[];
  dependencies: {
    selfHostedConfig: GateStatus;
    backupRestore: GateStatus;
    queueReadiness: GateStatus;
    observability: GateStatus;
  };
};

export type ReleaseGateResult = {
  status: "passed" | "failed";
  blockers: string[];
  pending: string[];
};

type ReleaseGateCliOptions = {
  version: string;
  targetEnvironment: string;
  artifactRef: string;
  envFingerprint: string;
  syntheticAcceptanceMode: SyntheticAcceptanceMode;
  hdcStatus: HdcReleaseStatus;
  hdcEvidencePath: string | null;
  backupEvidencePath: string;
  rollbackPlanPath: string;
  rollbackRehearsalEvidencePath: string;
  targetSyntheticEvidencePath: string;
  capacityEvidencePath: string;
  output: string;
  runCommands: boolean;
  backupRestoreStatus: GateStatus | null;
  queueReadinessStatus: GateStatus;
  observabilityStatus: GateStatus;
};

type RuntimeEnv = Record<string, string | undefined>;

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const blockers: string[] = [];
  const pending: string[] = [];

  if (!input.metadata.branch.trim()) {
    blockers.push("Git branch is required.");
  }
  if (!input.metadata.commit.trim()) {
    blockers.push("Git commit SHA is required.");
  }
  if (!input.metadata.version.trim()) {
    blockers.push("Release version label is required.");
  }
  if (input.metadata.dirty) {
    blockers.push("Release worktree must be clean before producing final evidence.");
  }
  if (!input.metadata.targetEnvironment.trim()) {
    blockers.push("Target environment label is required.");
  }
  if (!input.metadata.artifactRef.trim()) {
    blockers.push("Release artifact reference is required.");
  }
  if (input.metadata.migrations.length === 0) {
    blockers.push("At least one migration entry or explicit no-op marker is required.");
  }
  if (!input.metadata.envFingerprint.trim()) {
    blockers.push("Environment file fingerprint is required.");
  }
  if (input.metadata.hdc.status === "enabled" && !input.metadata.hdc.evidencePath) {
    blockers.push("HDC enabled releases require an HDC evidence path.");
  }

  if (!input.evidence.backupEvidencePath.trim()) {
    blockers.push("Backup evidence path is required.");
  }
  if (!input.evidence.rollbackPlanPath.trim()) {
    blockers.push("Rollback plan path is required.");
  }
  if (!input.evidence.rollbackRehearsalEvidencePath.trim()) {
    pending.push("Rollback rehearsal evidence is pending.");
  }
  if (!input.evidence.targetSyntheticEvidencePath.trim()) {
    pending.push("Target synthetic acceptance evidence is pending.");
  }
  if (!input.evidence.capacityEvidencePath.trim()) {
    pending.push("Capacity gate evidence is pending.");
  }

  for (const requiredCommand of requiredReleaseGateCommands) {
    const command = input.commands.find((candidate) => candidate.name === requiredCommand);
    if (!command) {
      blockers.push(`Command gate is missing: ${requiredCommand}.`);
    } else if (command.status === "failed") {
      blockers.push(`Command gate failed: ${requiredCommand}.`);
    } else if (command.status === "pending") {
      pending.push(`Command gate not run: ${requiredCommand}.`);
    }
  }

  collectDependencyStatus(input.dependencies.selfHostedConfig, "Self-hosted config", blockers, pending);
  collectDependencyStatus(input.dependencies.backupRestore, "Backup/restore", blockers, pending);
  collectDependencyStatus(input.dependencies.queueReadiness, "Queue readiness", blockers, pending);
  collectDependencyStatus(input.dependencies.observability, "Observability", blockers, pending);

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    blockers,
    pending
  };
}

export function buildReleaseGateEvidence(args: {
  date: string;
  input: ReleaseGateInput;
  result: ReleaseGateResult;
}): string {
  const metadata = args.input.metadata;
  const hdcEvidence = metadata.hdc.evidencePath ? sanitize(metadata.hdc.evidencePath) : "n/a";
  const lines = [
    "## M6.6 Self-Hosted Release Gate Evidence",
    "",
    `- Date: ${args.date}`,
    `- Status: \`${args.result.status}\``,
    `- Branch: \`${sanitize(metadata.branch)}\``,
    `- Commit: \`${sanitize(metadata.commit)}\``,
    `- Version: \`${sanitize(metadata.version)}\``,
    `- Dirty worktree: \`${metadata.dirty}\``,
    `- Target environment: \`${sanitize(metadata.targetEnvironment)}\``,
    `- Artifact: \`${sanitize(metadata.artifactRef)}\``,
    `- Environment fingerprint: \`${sanitize(metadata.envFingerprint)}\``,
    `- Synthetic acceptance mode: \`${metadata.syntheticAcceptanceMode}\``,
    `- HDC status: \`${metadata.hdc.status}\``,
    `- HDC evidence: \`${hdcEvidence}\``,
    "",
    "### Migration Set",
    "",
    ...metadata.migrations.map((migration) => `- \`${sanitize(migration)}\``),
    "",
    "### Evidence Paths",
    "",
    `- Backup evidence: \`${sanitize(args.input.evidence.backupEvidencePath)}\``,
    `- Rollback plan: \`${sanitize(args.input.evidence.rollbackPlanPath)}\``,
    `- Rollback rehearsal: \`${sanitize(args.input.evidence.rollbackRehearsalEvidencePath || "pending")}\``,
    `- Target synthetic acceptance: \`${sanitize(args.input.evidence.targetSyntheticEvidencePath || "pending")}\``,
    `- Capacity gate: \`${sanitize(args.input.evidence.capacityEvidencePath || "pending")}\``,
    "",
    "### Command Gates",
    "",
    "| Command | Status | Detail |",
    "| --- | --- | --- |",
    ...args.input.commands.map(
      (command) => `| ${command.name} | ${command.status} | ${markdownCell(sanitize(command.detail))} |`
    ),
    "",
    "### Dependency Gates",
    "",
    "| Dependency | Status |",
    "| --- | --- |",
    `| self-hosted config | ${args.input.dependencies.selfHostedConfig} |`,
    `| backup/restore | ${args.input.dependencies.backupRestore} |`,
    `| queue readiness | ${args.input.dependencies.queueReadiness} |`,
    `| observability | ${args.input.dependencies.observability} |`,
    "",
    "### Blockers",
    "",
    ...(args.result.blockers.length > 0 ? args.result.blockers.map((blocker) => `- ${sanitize(blocker)}`) : ["- none"]),
    "",
    "### Pending Evidence",
    "",
    ...(args.result.pending.length > 0 ? args.result.pending.map((item) => `- ${sanitize(item)}`) : ["- none"]),
    ""
  ];

  return lines.join("\n");
}

export function runSelfHostedReleaseGate(options = parseReleaseGateArgs(process.argv.slice(2))): ReleaseGateResult {
  const input = buildReleaseGateInput(options);
  const result = evaluateReleaseGate(input);
  const evidence = buildReleaseGateEvidence({
    date: new Date().toISOString(),
    input,
    result
  });

  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, evidence, "utf8");
  console.log(evidence);

  return result;
}

function buildReleaseGateInput(options: ReleaseGateCliOptions): ReleaseGateInput {
  const commands = options.runCommands ? runRequiredCommands() : buildVerifiedCommandResults();

  return {
    metadata: {
      branch: gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown",
      commit: gitOutput(["rev-parse", "HEAD"]) || "unknown",
      version: options.version,
      dirty: gitOutput(["status", "--short"]).trim().length > 0,
      targetEnvironment: options.targetEnvironment,
      artifactRef: options.artifactRef,
      migrations: collectMigrations(),
      envFingerprint: options.envFingerprint,
      syntheticAcceptanceMode: options.syntheticAcceptanceMode,
      hdc: {
        status: options.hdcStatus,
        evidencePath: options.hdcEvidencePath
      }
    },
    evidence: {
      backupEvidencePath: options.backupEvidencePath,
      rollbackPlanPath: options.rollbackPlanPath,
      rollbackRehearsalEvidencePath: options.rollbackRehearsalEvidencePath,
      targetSyntheticEvidencePath: options.targetSyntheticEvidencePath,
      capacityEvidencePath: options.capacityEvidencePath
    },
    commands,
    dependencies: {
      selfHostedConfig: commandStatus(commands, "selfhost:check"),
      backupRestore: options.backupRestoreStatus ?? pathExistsStatus(options.backupEvidencePath),
      queueReadiness: options.queueReadinessStatus,
      observability: options.observabilityStatus
    }
  };
}

export function parseReleaseGateArgs(args: string[], env: RuntimeEnv = process.env): ReleaseGateCliOptions {
  const getValue = (name: string, fallback: string) => {
    const equalsPrefix = `${name}=`;
    const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
    if (equalsArg) {
      return equalsArg.slice(equalsPrefix.length);
    }
    const index = args.indexOf(name);
    if (index === -1) {
      const envValue = env[`npm_config_${name.slice(2).replace(/-/g, "_")}`];
      return envValue && envValue !== "true" ? envValue : fallback;
    }
    return args[index + 1] ?? fallback;
  };
  const positionals = args.filter((arg) => !arg.startsWith("--") && !isFlagValue(args, arg));
  const positionalOutput = positionals.find((arg) => arg.endsWith("m6-release-readiness.md")) ?? "";
  const positionalCapacityEvidence = positionals.find((arg) => arg.endsWith("capacity-gate.md")) ?? "";

  const syntheticAcceptanceMode = getValue("--synthetic-mode", "target-non-hdc") as SyntheticAcceptanceMode;
  if (!["local-non-hdc", "target-non-hdc", "full-pilot"].includes(syntheticAcceptanceMode)) {
    throw new Error(`Unsupported synthetic acceptance mode: ${syntheticAcceptanceMode}`);
  }

  const hdcStatus = getValue("--hdc-status", "skipped_by_scope") as HdcReleaseStatus;
  if (!["unavailable", "skipped_by_scope", "enabled"].includes(hdcStatus)) {
    throw new Error(`Unsupported HDC release status: ${hdcStatus}`);
  }
  const backupRestoreStatus = optionalGateStatus(getValue("--backup-restore", ""));
  const queueReadinessStatus = requiredGateStatus(getValue("--queue-readiness", "pending"), "--queue-readiness");
  const observabilityStatus = requiredGateStatus(getValue("--observability", "pending"), "--observability");

  return {
    version: getValue("--version", readPackageVersion()),
    targetEnvironment: getValue("--target-environment", "local-self-hosted"),
    artifactRef: getValue("--artifact-ref", "local-build"),
    envFingerprint: getValue("--env-fingerprint", "sha256:local-env-not-committed"),
    syntheticAcceptanceMode,
    hdcStatus,
    hdcEvidencePath: getValue("--hdc-evidence", ""),
    backupEvidencePath: getValue("--backup-evidence", "docs/generated/m6-backup-restore-evidence.md"),
    rollbackPlanPath: getValue("--rollback-plan", "docs/runbooks/release-rollback.md"),
    rollbackRehearsalEvidencePath: getValue("--rollback-evidence", ""),
    targetSyntheticEvidencePath: getValue("--target-synthetic-evidence", ""),
    output: getValue("--output", positionalOutput || "docs/generated/m6-release-readiness.md"),
    capacityEvidencePath: getValue("--capacity-evidence", positionalCapacityEvidence || "docs/generated/capacity-gate.md"),
    runCommands: args.includes("--run-command-gates"),
    backupRestoreStatus,
    queueReadinessStatus,
    observabilityStatus
  };
}

function optionalGateStatus(value: string): GateStatus | null {
  if (!value) {
    return null;
  }
  return requiredGateStatus(value, "gate status");
}

function requiredGateStatus(value: string, label: string): GateStatus {
  if (!["passed", "failed", "pending"].includes(value)) {
    throw new Error(`${label} must be passed, failed, or pending.`);
  }
  return value as GateStatus;
}

function isFlagValue(args: string[], value: string) {
  const index = args.indexOf(value);
  if (index <= 0) {
    return false;
  }
  return args[index - 1].startsWith("--");
}

function runRequiredCommands(): ReleaseGateCommandResult[] {
  return requiredReleaseGateCommands.map((name) => {
    const invocation = releaseGateInvocation(name);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: invocation.shell
    });

    return {
      name,
      status: result.status === 0 ? "passed" : "failed",
      detail: compactDetail(result.stdout, result.stderr, result.error?.message)
    };
  });
}

function buildVerifiedCommandResults(): ReleaseGateCommandResult[] {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  return buildConfiguredCommandResults(packageJson);
}

export function buildConfiguredCommandResults(packageJson: { scripts?: Record<string, string> }): ReleaseGateCommandResult[] {
  return requiredReleaseGateCommands.map((name) => ({
    name,
    status: packageJson.scripts?.[name] || name === "git diff --check" ? "pending" : "failed",
    detail: packageJson.scripts?.[name] || name === "git diff --check" ? "configured_not_run" : "missing package script"
  }));
}

function releaseGateInvocation(name: ReleaseGateCommandName) {
  if (name === "git diff --check") {
    return { command: "git", args: ["diff", "--check"], shell: false };
  }

  return { command: "npm", args: ["run", name], shell: process.platform === "win32" };
}

function commandStatus(commands: ReleaseGateCommandResult[], name: ReleaseGateCommandName): GateStatus {
  return commands.find((command) => command.name === name)?.status ?? "pending";
}

function collectDependencyStatus(status: GateStatus, label: string, blockers: string[], pending: string[]) {
  if (status === "failed") {
    blockers.push(`${label} evidence failed.`);
  }
  if (status === "pending") {
    pending.push(`${label} evidence is pending.`);
  }
}

function pathExistsStatus(filePath: string): GateStatus {
  if (!filePath.trim()) {
    return "pending";
  }
  return existsSync(filePath) ? "passed" : "pending";
}

function scriptExists(name: string): boolean {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  return Boolean(packageJson.scripts?.[name]);
}

function collectMigrations(): string[] {
  const migrationsDirectory = "server/migrations";
  if (!existsSync(migrationsDirectory)) {
    return ["no-op:no-migration-directory"];
  }

  const files = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql"));
  return files.length > 0 ? files : ["no-op:no-new-migrations"];
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
    return packageJson.version ? `v${packageJson.version}` : "";
  } catch {
    return "";
  }
}

function compactDetail(...parts: Array<string | undefined>) {
  const combined = parts.filter(Boolean).join("\n").trim();
  if (!combined) {
    return "ok";
  }
  return combined.split(/\r?\n/).slice(-8).join(" ").slice(0, 400);
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(token|secret|key|password)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/(token|secret|key|password):([^@\s]+)/gi, "$1:<redacted>");
}

function markdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSelfHostedReleaseGate();
  process.exit(result.status === "passed" ? 0 : 1);
}
