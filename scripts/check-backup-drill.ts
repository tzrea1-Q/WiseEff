import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type QueueStatus = "captured" | "conditional" | "skipped" | "failed";

export type BackupDrillEvidence = {
  providerDecision?: {
    selectedProvider?: string;
    decisionRecordPath?: string;
  };
  environment?: {
    label?: string;
    branch?: string;
    commit?: string;
  };
  objectStore?: {
    endpoint?: string;
    bucket?: string;
    healthPrefix?: string;
    tlsPolicy?: string;
    pathStyle?: boolean;
    backupTarget?: string;
    restoreTarget?: string;
    objectCount?: number;
    checksumValidated?: boolean;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  database?: {
    backupCommand?: string;
    backupTarget?: string;
    restoreTarget?: string;
    tableCountsValidated?: boolean;
  };
  queue?: {
    status?: QueueStatus;
    reason?: string;
  };
  restore?: {
    startedAt?: string;
    completedAt?: string;
    isolatedTargets?: string[];
    sampledLogReferences?: number;
    missingLogObjects?: number;
  };
  redaction?: {
    checked?: boolean;
    secretsRedacted?: boolean;
  };
  commands?: {
    name?: string;
    command?: string;
    exitCode?: number;
  }[];
  notes?: string;
};

export type BackupDrillEvaluation = {
  status: "passed" | "failed";
  missingFields: string[];
  unsafeFields: string[];
  validationErrors: string[];
};

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireText(missingFields: string[], field: string, value: unknown) {
  if (!hasText(value)) {
    missingFields.push(field);
  }
}

function isHttpUrl(value: string | undefined) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isUnsafeRestoreTarget(value: string | undefined) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = value.toLowerCase();
  return normalized.includes("production") || /postgres:\/\/[^/]+\/wiseeff($|\?)/.test(normalized) || normalized.endsWith("/wiseeff");
}

export function evaluateBackupDrillEvidence(evidence: BackupDrillEvidence): BackupDrillEvaluation {
  const missingFields: string[] = [];
  const unsafeFields: string[] = [];
  const validationErrors: string[] = [];

  requireText(missingFields, "providerDecision.selectedProvider", evidence.providerDecision?.selectedProvider);
  requireText(missingFields, "providerDecision.decisionRecordPath", evidence.providerDecision?.decisionRecordPath);
  requireText(missingFields, "environment.label", evidence.environment?.label);
  requireText(missingFields, "environment.branch", evidence.environment?.branch);
  requireText(missingFields, "environment.commit", evidence.environment?.commit);
  requireText(missingFields, "objectStore.bucket", evidence.objectStore?.bucket);
  requireText(missingFields, "objectStore.healthPrefix", evidence.objectStore?.healthPrefix);
  requireText(missingFields, "objectStore.backupTarget", evidence.objectStore?.backupTarget);
  requireText(missingFields, "objectStore.restoreTarget", evidence.objectStore?.restoreTarget);
  requireText(missingFields, "database.backupCommand", evidence.database?.backupCommand);
  requireText(missingFields, "database.backupTarget", evidence.database?.backupTarget);
  requireText(missingFields, "database.restoreTarget", evidence.database?.restoreTarget);
  requireText(missingFields, "restore.startedAt", evidence.restore?.startedAt);
  requireText(missingFields, "restore.completedAt", evidence.restore?.completedAt);
  if (!evidence.restore?.isolatedTargets?.length) {
    missingFields.push("restore.isolatedTargets");
  }

  if (!isHttpUrl(evidence.objectStore?.endpoint)) {
    validationErrors.push("objectStore.endpoint must be a valid http(s) URL.");
  }
  if (evidence.objectStore?.tlsPolicy !== "required") {
    validationErrors.push("objectStore.tlsPolicy must be required for target evidence.");
  }
  if (evidence.objectStore?.checksumValidated !== true) {
    validationErrors.push("objectStore.checksumValidated must be true.");
  }
  if (evidence.database?.tableCountsValidated !== true) {
    validationErrors.push("database.tableCountsValidated must be true.");
  }
  if (evidence.restore?.missingLogObjects !== 0) {
    validationErrors.push("restore.missingLogObjects must be 0.");
  }
  if (evidence.redaction?.checked !== true) {
    validationErrors.push("redaction.checked must be true.");
  }
  if (evidence.redaction?.secretsRedacted !== true) {
    validationErrors.push("redaction.secretsRedacted must be true.");
  }
  if ((evidence.queue?.status === "conditional" || evidence.queue?.status === "failed") && !hasText(evidence.queue.reason)) {
    validationErrors.push("queue.reason is required when queue.status is conditional or failed.");
  }
  for (const command of evidence.commands ?? []) {
    const exitCode = command.exitCode;
    if (exitCode !== 0) {
      validationErrors.push(`commands.${command.name ?? "unknown"} exited with ${exitCode ?? "unknown"}.`);
    }
  }

  if (isUnsafeRestoreTarget(evidence.objectStore?.restoreTarget)) {
    unsafeFields.push("objectStore.restoreTarget");
  }
  if (isUnsafeRestoreTarget(evidence.database?.restoreTarget)) {
    unsafeFields.push("database.restoreTarget");
  }

  return {
    status: missingFields.length || unsafeFields.length || validationErrors.length ? "failed" : "passed",
    missingFields,
    unsafeFields,
    validationErrors
  };
}

function redactString(value: string) {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(password=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(secret(access)?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(accesskeyid["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/([?&]X-Amz-Signature=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\/\/([^/:@]+):([^@]+)@/g, "//[redacted]:[redacted]@");
}

export function redactBackupDrillEvidence<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactBackupDrillEvidence(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /secret|accessKey|authorization|password|signature/i.test(key) && typeof item === "string"
          ? "[redacted]"
          : redactBackupDrillEvidence(item)
      ])
    ) as T;
  }
  return value;
}

export function renderBackupDrillMarkdown(evaluation: BackupDrillEvaluation, evidence?: BackupDrillEvidence) {
  const lines = [
    "# M6 Backup Restore Evidence",
    "",
    `Status: \`${evaluation.status}\``,
    "",
    `- Missing fields: ${evaluation.missingFields.length ? evaluation.missingFields.map((field) => `\`${field}\``).join(", ") : "_none_"}`,
    `- Unsafe fields: ${evaluation.unsafeFields.length ? evaluation.unsafeFields.map((field) => `\`${field}\``).join(", ") : "_none_"}`,
    `- Validation errors: ${evaluation.validationErrors.length ? evaluation.validationErrors.join("; ") : "_none_"}`
  ];

  if (evidence) {
    lines.push(
      "",
      "## Summary",
      "",
      `- Provider: \`${evidence.providerDecision?.selectedProvider ?? "unknown"}\``,
      `- Decision record: \`${evidence.providerDecision?.decisionRecordPath ?? "unknown"}\``,
      `- Environment: \`${evidence.environment?.label ?? "unknown"}\``,
      `- Branch: \`${evidence.environment?.branch ?? "unknown"}\``,
      `- Commit: \`${evidence.environment?.commit ?? "unknown"}\``,
      `- Object store: \`${evidence.objectStore?.endpoint ?? "unknown"}\` / \`${evidence.objectStore?.bucket ?? "unknown"}\``,
      `- Object checksum validated: \`${evidence.objectStore?.checksumValidated === true ? "true" : "false"}\``,
      `- Database table counts validated: \`${evidence.database?.tableCountsValidated === true ? "true" : "false"}\``,
      `- Missing log objects: \`${evidence.restore?.missingLogObjects ?? "unknown"}\``,
      `- Queue: \`${evidence.queue?.status ?? "unknown"}\`${evidence.queue?.reason ? ` (${evidence.queue.reason})` : ""}`,
      "",
      "## Restore targets:",
      "",
      ...(evidence.restore?.isolatedTargets?.length
        ? evidence.restore.isolatedTargets.map((target) => `- \`${target}\``)
        : ["- _none recorded_"])
    );
  }

  return `${lines.join("\n")}\n`;
}

function readEvidence(path: string): BackupDrillEvidence {
  return JSON.parse(readFileSync(path, "utf8")) as BackupDrillEvidence;
}

export function checkBackupDrillEvidence(inputPath = join("docs", "generated", "m6-backup-restore-evidence.json")) {
  if (!existsSync(inputPath)) {
    return {
      status: "failed" as const,
      missingFields: [inputPath],
      unsafeFields: [],
      validationErrors: ["Backup drill evidence file is missing."]
    };
  }
  return evaluateBackupDrillEvidence(redactBackupDrillEvidence(readEvidence(inputPath)));
}

if (process.argv[1]?.endsWith("check-backup-drill.ts")) {
  const inputPath = process.argv[2];
  const evidencePath = inputPath ?? join("docs", "generated", "m6-backup-restore-evidence.json");
  const evidence = existsSync(evidencePath) ? redactBackupDrillEvidence(readEvidence(evidencePath)) : undefined;
  const evaluation = evidence
    ? evaluateBackupDrillEvidence(evidence)
    : {
        status: "failed" as const,
        missingFields: [evidencePath],
        unsafeFields: [],
        validationErrors: ["Backup drill evidence file is missing."]
      };
  const markdown = renderBackupDrillMarkdown(evaluation, evidence);
  writeFileSync(join("docs", "generated", "m6-backup-restore-evidence.md"), markdown, "utf8");
  console.log(JSON.stringify(evaluation, null, 2));
  if (evaluation.status !== "passed") {
    process.exitCode = 1;
  }
}
