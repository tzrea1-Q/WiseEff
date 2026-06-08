import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type RollbackStepStatus = "passed" | "failed" | "pending" | "skipped_by_scope";

export type RollbackRehearsalInput = {
  metadata: {
    environment: string;
    releaseVersion: string;
    candidateArtifact: string;
    previousArtifact: string;
    approvalOwner: string;
    maintenanceWindow: string;
  };
  steps: {
    stopWrites: RollbackStepStatus;
    queueDrain: RollbackStepStatus;
    artifactRollback: RollbackStepStatus;
    databaseRestore: RollbackStepStatus;
    objectStoreRestore: RollbackStepStatus;
    postRollbackSmoke: RollbackStepStatus;
  };
  artifacts: {
    backupEvidencePath: string;
    smokeEvidencePath: string;
    queueEvidencePath: string;
    notesPath: string;
  };
};

export type RollbackRehearsalResult = {
  status: "passed" | "failed";
  blockers: string[];
  pending: string[];
};

type RuntimeEnv = Record<string, string | undefined>;

const defaultOutput = "docs/generated/m6-rollback-rehearsal-evidence.md";

const stepLabels: Record<keyof RollbackRehearsalInput["steps"], string> = {
  stopWrites: "stop writes",
  queueDrain: "queue drain",
  artifactRollback: "artifact rollback",
  databaseRestore: "database restore",
  objectStoreRestore: "object-store restore",
  postRollbackSmoke: "post-rollback smoke"
};

export function evaluateRollbackRehearsal(input: RollbackRehearsalInput): RollbackRehearsalResult {
  const blockers: string[] = [];
  const pending: string[] = [];

  if (!input.metadata.environment.trim()) {
    blockers.push("Rollback environment label is required.");
  } else if (!isTargetEnvironment(input.metadata.environment)) {
    blockers.push("Rollback environment must identify a configured target, staging, pilot, or self-hosted environment.");
  }
  if (!input.metadata.releaseVersion.trim()) {
    blockers.push("Release version is required.");
  }
  if (!input.metadata.candidateArtifact.trim()) {
    blockers.push("Candidate artifact reference is required.");
  }
  if (!input.metadata.previousArtifact.trim()) {
    blockers.push("Previous artifact reference is required.");
  }
  if (!input.metadata.approvalOwner.trim()) {
    blockers.push("Approval owner is required.");
  }
  if (!input.metadata.maintenanceWindow.trim()) {
    blockers.push("Maintenance window is required.");
  }

  for (const [step, status] of Object.entries(input.steps) as Array<[keyof RollbackRehearsalInput["steps"], RollbackStepStatus]>) {
    if (status === "failed") {
      blockers.push(`Rollback step failed: ${stepLabels[step]}.`);
    }
    if (status === "pending") {
      pending.push(`Rollback step pending: ${stepLabels[step]}.`);
    }
  }

  if ((input.steps.databaseRestore === "passed" || input.steps.objectStoreRestore === "passed") && !input.artifacts.backupEvidencePath.trim()) {
    blockers.push("Backup/restore evidence path is required when data restore is in scope.");
  }
  if (input.steps.postRollbackSmoke === "passed" && !input.artifacts.smokeEvidencePath.trim()) {
    blockers.push("Post-rollback smoke evidence path is required when smoke passes.");
  }
  if (input.steps.queueDrain === "passed" && !input.artifacts.queueEvidencePath.trim()) {
    blockers.push("Queue evidence path is required when queue drain passes.");
  }
  if (!input.artifacts.notesPath.trim()) {
    blockers.push("Rollback notes evidence path is required.");
  }

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    blockers,
    pending
  };
}

export function buildRollbackRehearsalEvidence(args: {
  date: string;
  input: RollbackRehearsalInput;
  result: RollbackRehearsalResult;
}): string {
  const lines = [
    "## M6.6 Rollback Rehearsal Evidence",
    "",
    `- Date: ${args.date}`,
    `- Status: \`${args.result.status}\``,
    `- Environment: \`${sanitize(args.input.metadata.environment)}\``,
    `- Release version: \`${sanitize(args.input.metadata.releaseVersion)}\``,
    `- Candidate artifact: \`${sanitize(args.input.metadata.candidateArtifact)}\``,
    `- Previous artifact: \`${sanitize(args.input.metadata.previousArtifact)}\``,
    `- Approval owner: \`${sanitize(args.input.metadata.approvalOwner)}\``,
    `- Maintenance window: \`${sanitize(args.input.metadata.maintenanceWindow)}\``,
    "",
    "### Rollback Steps",
    "",
    "| Step | Status |",
    "| --- | --- |",
    ...Object.entries(args.input.steps).map(
      ([step, status]) => `| ${stepLabels[step as keyof RollbackRehearsalInput["steps"]]} | ${status} |`
    ),
    "",
    "### Artifacts",
    "",
    `- Backup/restore evidence: \`${sanitize(args.input.artifacts.backupEvidencePath || "pending")}\``,
    `- Post-rollback smoke evidence: \`${sanitize(args.input.artifacts.smokeEvidencePath || "pending")}\``,
    `- Queue evidence: \`${sanitize(args.input.artifacts.queueEvidencePath || "pending")}\``,
    `- Notes: \`${sanitize(args.input.artifacts.notesPath || "pending")}\``,
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

export function parseRollbackRehearsalArgs(args: string[], env: RuntimeEnv = process.env) {
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
  const stepValue = (name: string, fallback: RollbackStepStatus): RollbackStepStatus => {
    const value = getValue(name, fallback) as RollbackStepStatus;
    if (!["passed", "failed", "pending", "skipped_by_scope"].includes(value)) {
      throw new Error(`${name} must be passed, failed, pending, or skipped_by_scope.`);
    }
    return value;
  };

  return {
    output: getValue("--output", defaultOutput),
    input: {
      metadata: {
        environment: getValue("--environment", "local-self-hosted"),
        releaseVersion: getValue("--release-version", ""),
        candidateArtifact: getValue("--candidate-artifact", ""),
        previousArtifact: getValue("--previous-artifact", ""),
        approvalOwner: getValue("--approval-owner", ""),
        maintenanceWindow: getValue("--maintenance-window", "")
      },
      steps: {
        stopWrites: stepValue("--stop-writes", "pending"),
        queueDrain: stepValue("--queue-drain", "pending"),
        artifactRollback: stepValue("--artifact-rollback", "pending"),
        databaseRestore: stepValue("--database-restore", "skipped_by_scope"),
        objectStoreRestore: stepValue("--object-store-restore", "skipped_by_scope"),
        postRollbackSmoke: stepValue("--post-rollback-smoke", "pending")
      },
      artifacts: {
        backupEvidencePath: getValue("--backup-evidence", "docs/generated/m6-backup-restore-evidence.md"),
        smokeEvidencePath: getValue("--smoke-evidence", ""),
        queueEvidencePath: getValue("--queue-evidence", "docs/generated/m6-queue-readiness-evidence.md"),
        notesPath: getValue("--notes", "")
      }
    } satisfies RollbackRehearsalInput
  };
}

export function runRollbackRehearsal(options = parseRollbackRehearsalArgs(process.argv.slice(2))): RollbackRehearsalResult {
  const result = evaluateRollbackRehearsal(options.input);
  const evidence = buildRollbackRehearsalEvidence({
    date: new Date().toISOString(),
    input: options.input,
    result
  });

  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(options.output, evidence, "utf8");
  console.log(evidence);

  return result;
}

function sanitize(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(token|secret|key|password)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/(token|secret|key|password):([^@\s]+)/gi, "$1:<redacted>");
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runRollbackRehearsal();
  process.exit(result.status === "passed" ? 0 : 1);
}
