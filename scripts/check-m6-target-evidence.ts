import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type M6PhaseId = "M6.2" | "M6.3" | "M6.4" | "M6.5" | "M6.6";
export type M6EvidenceStatus = "passed" | "failed" | "pending";
export type M6PlanLocation = "active" | "completed" | "missing";

export type M6TargetEvidenceInput = {
  activePlans: string[];
  completedPlans: string[];
  evidence: {
    identity?: string;
    localIdentity?: string;
    backupRestore?: string;
    backupRestoreJson?: string;
    queue?: string;
    observability?: string;
    rollback?: string;
    capacity?: string;
    release?: string;
    operationEvidence?: string;
  };
};

export type M6TargetEvidencePhase = {
  id: M6PhaseId;
  title: string;
  evidenceStatus: M6EvidenceStatus;
  planLocation: M6PlanLocation;
  completionAllowed: boolean;
  blockers: string[];
  pending: string[];
  notes: string[];
};

export type M6TargetEvidenceResult = {
  status: "passed" | "failed";
  phases: M6TargetEvidencePhase[];
  blockers: string[];
  pending: string[];
};

type PhaseDefinition = {
  id: M6PhaseId;
  title: string;
  planNeedle: string;
  evaluate: (input: M6TargetEvidenceInput["evidence"]) => Pick<M6TargetEvidencePhase, "evidenceStatus" | "blockers" | "pending" | "notes">;
};

const defaultOutput = "docs/generated/m6-target-evidence-summary.md";

const phaseDefinitions: PhaseDefinition[] = [
  {
    id: "M6.2",
    title: "Identity And User Governance",
    planNeedle: "m6-2",
    evaluate: (evidence) => {
      const blockers: string[] = [];
      const pending: string[] = [];
      const notes: string[] = [];
      const localStatus = markdownStatus(evidence.localIdentity);
      const targetStatus = markdownStatus(evidence.identity);
      const targetScope = markdownField(evidence.identity, "Evidence scope");
      const issuer = markdownField(evidence.identity, "Issuer");
      const apiBaseUrl = markdownField(evidence.identity, "API base URL");
      const audience = markdownField(evidence.identity, "Audience");
      const requiredChecksPassed = [
        "OIDC discovery/JWKS",
        "/api/v1/me",
        "wrong issuer",
        "wrong audience",
        "expired token",
        "browser token acquisition/refresh/logout"
      ].every((check) => markdownTableStatusPassed(evidence.identity, check));
      const userGovernanceEvidenceReady = operationEvidenceReady(evidence.operationEvidence);

      if (localStatus === "passed") {
        notes.push("Local OIDC drill is present but does not satisfy target identity readiness.");
      }
      if (targetStatus === "missing") {
        pending.push("Target OIDC identity evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes };
      }
      if (targetStatus !== "passed") {
        pending.push("Target OIDC identity evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes };
      }
      if (!targetScope.toLowerCase().includes("target")) {
        blockers.push("Target OIDC identity evidence must be scoped as target self-hosted OIDC.");
        return { evidenceStatus: "failed", blockers, pending, notes };
      }
      if (!isTargetUrl(issuer) || !isTargetUrl(apiBaseUrl) || !isEvidenceReference(audience) || !requiredChecksPassed) {
        pending.push("Target OIDC identity evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes };
      }
      if (!userGovernanceEvidenceReady) {
        pending.push("Target user-governance operation evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes };
      }

      return { evidenceStatus: "passed", blockers, pending, notes };
    }
  },
  {
    id: "M6.3",
    title: "Self-Hosted Storage And Backup",
    planNeedle: "m6-3",
    evaluate: (evidence) => {
      const blockers: string[] = [];
      const pending: string[] = [];
      const status = markdownStatus(evidence.backupRestore);
      const environment = markdownField(evidence.backupRestore, "Environment");
      const hasCleanValidation =
        markdownBulletIncludes(evidence.backupRestore, "Missing fields", "_none_") &&
        markdownBulletIncludes(evidence.backupRestore, "Unsafe fields", "_none_") &&
        markdownBulletIncludes(evidence.backupRestore, "Validation errors", "_none_");
      const hasObjectChecksum = markdownField(evidence.backupRestore, "Object checksum validated") === "true";
      const hasDatabaseTableCounts = markdownField(evidence.backupRestore, "Database table counts validated") === "true";
      const hasNoMissingLogObjects = markdownField(evidence.backupRestore, "Missing log objects") === "0";
      const hasRestoreTargets = hasPattern(evidence.backupRestore, /`postgres:\/\/[^`]+`/i) && hasPattern(evidence.backupRestore, /`s3:\/\/[^`]+`/i);
      const hasMachineReadableTargetDrill = backupRestoreJsonReady(evidence.backupRestoreJson);

      if (
        status === "missing" ||
        status !== "passed" ||
        !isTargetEnvironment(environment) ||
        !hasCleanValidation ||
        !hasObjectChecksum ||
        !hasDatabaseTableCounts ||
        !hasNoMissingLogObjects ||
        !hasRestoreTargets ||
        !hasMachineReadableTargetDrill
      ) {
        pending.push("Target backup/restore evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes: [] };
      }

      return { evidenceStatus: "passed", blockers, pending, notes: [] };
    }
  },
  {
    id: "M6.4",
    title: "Durable Queue",
    planNeedle: "m6-4",
    evaluate: (evidence) => {
      const blockers: string[] = [];
      const pending: string[] = [];
      const notes: string[] = [];
      const status = markdownStatus(evidence.queue);
      const baseUrl = markdownField(evidence.queue, "Base URL");
      const hasReadyBody = durableQueueReadyBody(evidence.queue);

      if (baseUrl) {
        notes.push(`Queue target evidence base URL: ${baseUrl}.`);
      }

      if (status === "missing" || status !== "passed" || !isTargetUrl(baseUrl) || !hasReadyBody) {
        pending.push("Target durable queue evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes };
      }

      return { evidenceStatus: "passed", blockers, pending, notes };
    }
  },
  {
    id: "M6.5",
    title: "Observability And Operations",
    planNeedle: "m6-5",
    evaluate: (evidence) => {
      const blockers: string[] = [];
      const pending: string[] = [];
      const status = markdownStatus(evidence.observability);
      const scope = markdownField(evidence.observability, "Evidence scope");
      const targetEnvironment = markdownField(evidence.observability, "Target environment");
      const configStatus = markdownField(evidence.observability, "Config check");
      const prometheusProof = markdownField(evidence.observability, "Prometheus query or scrape evidence");
      const alertProof = markdownField(evidence.observability, "Alert route proof");
      const grafanaProof = markdownField(evidence.observability, "Grafana dashboard proof");
      const hasScrape = /Prometheus target scrape:\s*`passed`/i.test(evidence.observability ?? "");
      const hasAlert = /Alertmanager routing:\s*`passed`/i.test(evidence.observability ?? "");
      const hasGrafana = /Grafana dashboard import:\s*`passed`/i.test(evidence.observability ?? "");
      const hasTargetScope = scope.toLowerCase().includes("target");
      const hasTargetEnvironment = isTargetEnvironment(targetEnvironment);
      const hasConfigPassed = configStatus.toLowerCase() === "passed";
      const hasProofs =
        isTargetProofReference(prometheusProof) &&
        isTargetProofReference(alertProof) &&
        isTargetProofReference(grafanaProof);

      if (
        status === "missing" ||
        status !== "passed" ||
        !hasTargetScope ||
        !hasTargetEnvironment ||
        !hasConfigPassed ||
        !hasScrape ||
        !hasAlert ||
        !hasGrafana ||
        !hasProofs
      ) {
        pending.push("Target observability scrape, alert routing, and dashboard evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes: [] };
      }

      return { evidenceStatus: "passed", blockers, pending, notes: [] };
    }
  },
  {
    id: "M6.6",
    title: "Release, Rollback And Capacity Gate",
    planNeedle: "m6-6",
    evaluate: (evidence) => {
      const blockers: string[] = [];
      const pending: string[] = [];
      const releasePassed = markdownStatus(evidence.release) === "passed";
      const rollbackPassed = markdownStatus(evidence.rollback) === "passed";
      const capacityPassed = markdownStatus(evidence.capacity) === "passed";
      const releaseDependencies = [
        "identity readiness",
        "rollback readiness",
        "capacity readiness",
        "target synthetic readiness",
        "queue readiness",
        "observability"
      ];
      const missingDependency = releaseDependencies.find((dependency) => !markdownTableStatusPassed(evidence.release, dependency));
      const releaseReady = releaseEvidenceReady(evidence.release);
      const rollbackReady = rollbackEvidenceReady(evidence.rollback);
      const capacityReady = capacityEvidenceReady(evidence.capacity);

      if (
        !releasePassed ||
        !rollbackPassed ||
        !capacityPassed ||
        missingDependency ||
        !releaseReady ||
        !rollbackReady ||
        !capacityReady
      ) {
        pending.push("Target release, rollback, capacity, and synthetic acceptance evidence is pending.");
        return { evidenceStatus: "pending", blockers, pending, notes: [] };
      }

      return { evidenceStatus: "passed", blockers, pending, notes: [] };
    }
  }
];

export function evaluateM6TargetEvidence(input: M6TargetEvidenceInput): M6TargetEvidenceResult {
  const phases = phaseDefinitions.map((definition) => {
    const planLocation = findPlanLocation(input, definition.planNeedle);
    const evaluated = definition.evaluate(input.evidence);
    const blockers = [...evaluated.blockers];
    const pending = [...evaluated.pending];

    if (planLocation === "completed" && evaluated.evidenceStatus !== "passed") {
      blockers.push(`${definition.id} plan is in completed before target evidence passed.`);
    }
    if (planLocation === "active" && evaluated.evidenceStatus === "passed") {
      pending.push(`${definition.id} target evidence passed; move the plan to completed after final verification.`);
    }
    if (planLocation === "missing") {
      blockers.push(`${definition.id} plan file is missing from active and completed directories.`);
    }

    return {
      id: definition.id,
      title: definition.title,
      evidenceStatus: evaluated.evidenceStatus,
      planLocation,
      completionAllowed: evaluated.evidenceStatus === "passed",
      blockers,
      pending,
      notes: evaluated.notes
    };
  });
  const blockers = phases.flatMap((phase) => phase.blockers);
  const pending = phases.flatMap((phase) => phase.pending);

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    phases,
    blockers,
    pending
  };
}

export function renderM6TargetEvidenceMarkdown(input: { date: string; result: M6TargetEvidenceResult }): string {
  const lines = [
    "## M6 Target Evidence Summary",
    "",
    `- Date: ${input.date}`,
    `- Status: \`${input.result.status}\``,
    "",
    "### Phase Gates",
    "",
    "| Phase | Evidence | Plan | Can complete |",
    "| --- | --- | --- | --- |",
    ...input.result.phases.map(
      (phase) => `| ${phase.id} | ${phase.evidenceStatus} | ${phase.planLocation} | ${phase.completionAllowed ? "yes" : "no"} |`
    ),
    "",
    "### Notes",
    "",
    ...formatItems(input.result.phases.flatMap((phase) => phase.notes)),
    "",
    "### Blockers",
    "",
    ...formatItems(input.result.blockers),
    "",
    "### Pending Evidence",
    "",
    ...formatItems(input.result.pending),
    ""
  ];

  return redactM6TargetSecret(lines.join("\n"));
}

export function loadM6TargetEvidenceInput(root = process.cwd()): M6TargetEvidenceInput {
  return {
    activePlans: listMarkdownFiles(join(root, "docs", "exec-plans", "active")),
    completedPlans: listMarkdownFiles(join(root, "docs", "exec-plans", "completed")),
    evidence: {
      identity: readOptional(join(root, "docs", "generated", "m6-identity-evidence.md")),
      localIdentity: readOptional(join(root, "docs", "generated", "m6-local-oidc-identity-evidence.md")),
      backupRestore: readOptional(join(root, "docs", "generated", "m6-backup-restore-evidence.md")),
      backupRestoreJson: readOptional(join(root, "docs", "generated", "m6-backup-restore-evidence.json")),
      queue: readOptional(join(root, "docs", "generated", "m6-queue-readiness-evidence.md")),
      observability: readOptional(join(root, "docs", "generated", "m6-observability-evidence.md")),
      rollback: readOptional(join(root, "docs", "generated", "m6-rollback-rehearsal-evidence.md")),
      capacity: readOptional(join(root, "docs", "generated", "capacity-gate.md")),
      release: readOptional(join(root, "docs", "generated", "m6-release-readiness.md")),
      operationEvidence: readOptional(join(root, "docs", "generated", "acceptance-operation-evidence", "index.json"))
    }
  };
}

export function checkM6TargetEvidence(options: { root?: string; output?: string } = {}): M6TargetEvidenceResult {
  const root = options.root ?? process.cwd();
  const output = options.output ?? defaultOutput;
  const result = evaluateM6TargetEvidence(loadM6TargetEvidenceInput(root));
  const markdown = renderM6TargetEvidenceMarkdown({
    date: new Date().toISOString(),
    result
  });
  const outputPath = join(root, output);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, "utf8");
  console.log(markdown);

  return result;
}

function findPlanLocation(input: M6TargetEvidenceInput, needle: string): M6PlanLocation {
  if (input.completedPlans.some((plan) => plan.includes(needle))) {
    return "completed";
  }
  if (input.activePlans.some((plan) => plan.includes(needle))) {
    return "active";
  }
  return "missing";
}

function markdownStatus(markdown?: string): M6EvidenceStatus | "missing" {
  if (!markdown?.trim()) {
    return "missing";
  }

  const match = markdown.match(/(?:Status:\s*|-\s*Status:\s*)`(passed|failed|pending)`/i);
  return match ? (match[1].toLowerCase() as M6EvidenceStatus) : "pending";
}

function markdownField(markdown: string | undefined, label: string): string {
  if (!markdown) {
    return "";
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`-\\s*${escapedLabel}:\\s*\`([^\`]*)\``, "i"));
  return match?.[1] ?? "";
}

function markdownBulletIncludes(markdown: string | undefined, label: string, expected: string): boolean {
  if (!markdown) {
    return false;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`-\\s*${escapedLabel}:\\s*.*${escapedExpected}`, "i").test(markdown);
}

function hasPattern(markdown: string | undefined, pattern: RegExp): boolean {
  return Boolean(markdown && pattern.test(markdown));
}

function durableQueueReadyBody(markdown: string | undefined): boolean {
  const body = parseJsonFence(markdown);
  const dependencies = asRecord(body)?.dependencies;
  const durableQueue = asRecord(asRecord(dependencies)?.durableQueue);
  const transport = asRecord(durableQueue?.transport);
  const database = asRecord(durableQueue?.database);

  return (
    durableQueue?.ok === true &&
    durableQueue.status === "ready" &&
    transport?.ok === true &&
    transport.status === "ready" &&
    database?.ok === true &&
    database.status === "ready"
  );
}

function parseJsonFence(markdown: string | undefined): unknown {
  if (!markdown) {
    return null;
  }

  const match = markdown.match(/```json\s*([\s\S]*?)```/i);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseJsonDocument(value: string | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.flatMap((item) => (asRecord(item) ? [item as Record<string, unknown>] : [])) : [];
}

function operationEvidenceReady(value: string | undefined): boolean {
  const root = asRecord(parseJsonDocument(value));
  if (!root || root.status !== "passed") {
    return false;
  }

  const records = asRecordArray(root.records);
  const record = records.find((item) => item.operationId === "PERM-USER-MGMT-001");
  if (!record || record.status !== "passed") {
    return false;
  }

  const assertions = Array.isArray(record.assertions) ? record.assertions : [];
  const requiredAssertions = ["ui", "api", "db", "audit"];
  const runtime = asRecord(record.runtime);
  const api = asRecordArray(record.api);
  const hasAdminMutation = api.some((item) => {
    const method = String(item.method ?? "").toUpperCase();
    const path = String(item.path ?? "");
    const status = Number(item.status);

    return ["POST", "PUT", "PATCH", "DELETE"].includes(method) && path.startsWith("/api/v1/users") && status >= 200 && status < 300;
  });
  const hasNonAdminRejection = api.some((item) => {
    const path = String(item.path ?? "");
    const status = Number(item.status);

    return path.startsWith("/api/v1/users") && (status === 401 || status === 403);
  });

  return (
    requiredAssertions.every((assertion) => assertions.includes(assertion)) &&
    isTargetUrl(String(runtime?.apiBaseUrl ?? "")) &&
    api.length > 0 &&
    hasAdminMutation &&
    hasNonAdminRejection &&
    asRecordArray(record.db).length > 0 &&
    asRecordArray(record.audit).length > 0
  );
}

function backupRestoreJsonReady(value: string | undefined): boolean {
  const root = asRecord(parseJsonDocument(value));
  if (!root) {
    return false;
  }

  const environment = asRecord(root.environment);
  const objectStore = asRecord(root.objectStore);
  const database = asRecord(root.database);
  const queue = asRecord(root.queue);
  const persistence = asRecord(queue?.persistence);
  const restore = asRecord(root.restore);
  const isolatedTargets = Array.isArray(restore?.isolatedTargets) ? restore.isolatedTargets.map(String) : [];
  const commands = asRecordArray(root.commands);
  const requiredCommands = ["restore:drill", "backup:drill", "backup:check"];
  const commandsPassed = requiredCommands.every((name) =>
    commands.some((command) => command.name === name && Number(command.exitCode) === 0)
  );

  return (
    isTargetEnvironment(String(environment?.label ?? "")) &&
    String(objectStore?.restoreTarget ?? "").startsWith("s3://") &&
    objectStore?.checksumValidated === true &&
    String(database?.restoreTarget ?? "").startsWith("postgres://") &&
    database?.tableCountsValidated === true &&
    Number(restore?.missingLogObjects) === 0 &&
    isolatedTargets.some((target) => target.startsWith("postgres://")) &&
    isolatedTargets.some((target) => target.startsWith("s3://")) &&
    queue?.mode === "durable" &&
    queue?.status === "captured" &&
    typeof persistence?.snapshotTarget === "string" &&
    persistence.snapshotTarget.trim().length > 0 &&
    persistence?.checkpointValidated === true &&
    commandsPassed
  );
}

function rollbackEvidenceReady(markdown: string | undefined): boolean {
  const requiredFields = [
    "Environment",
    "Release version",
    "Candidate artifact",
    "Previous artifact",
    "Approval owner",
    "Maintenance window"
  ];
  const requiredPassedSteps = ["stop writes", "queue drain", "artifact rollback", "post-rollback smoke"];
  const scopedRestoreSteps = ["database restore", "object-store restore"];

  return (
    requiredFields.every((field) => isEvidenceReference(markdownField(markdown, field))) &&
    isTargetEnvironment(markdownField(markdown, "Environment")) &&
    requiredPassedSteps.every((step) => markdownTableStatusPassed(markdown, step)) &&
    scopedRestoreSteps.every((step) => markdownTableStatusPassed(markdown, step) || markdownTableStatus(markdown, step) === "skipped_by_scope") &&
    isEvidenceReference(markdownField(markdown, "Backup/restore evidence")) &&
    isEvidenceReference(markdownField(markdown, "Post-rollback smoke evidence")) &&
    isEvidenceReference(markdownField(markdown, "Queue evidence")) &&
    isEvidenceReference(markdownField(markdown, "Notes"))
  );
}

function capacityEvidenceReady(markdown: string | undefined): boolean {
  const requiredMetrics = [
    "p95 latency",
    "error rate",
    "throughput",
    "CPU utilization",
    "memory utilization",
    "database connections",
    "queue backlog",
    "object-store probe"
  ];

  return (
    isTargetUrl(markdownField(markdown, "Target URL")) &&
    isTargetEnvironment(markdownField(markdown, "Environment")) &&
    isEvidenceReference(markdownField(markdown, "Profile")) &&
    isEvidenceReference(markdownField(markdown, "Duration")) &&
    isEvidenceReference(markdownField(markdown, "Virtual users")) &&
    requiredMetrics.every((metric) => markdownTableObservedReady(markdown, metric)) &&
    isEvidenceReference(markdownField(markdown, "k6 summary")) &&
    isEvidenceReference(markdownField(markdown, "metrics snapshot"))
  );
}

function releaseEvidenceReady(markdown: string | undefined): boolean {
  const requiredFields = [
    "Branch",
    "Commit",
    "Version",
    "Target environment",
    "Artifact",
    "Environment fingerprint",
    "Synthetic acceptance mode"
  ];
  const requiredEvidenceFields = [
    "Backup evidence",
    "Identity evidence",
    "Rollback plan",
    "Rollback rehearsal",
    "Target synthetic acceptance",
    "Capacity gate",
    "Queue evidence",
    "Observability evidence"
  ];
  const requiredCommands = [
    "docs:check",
    "contract:check",
    "test:all",
    "build",
    "acceptance:coverage",
    "acceptance:operations",
    "acceptance:evidence",
    "selfhost:check",
    "identity:check",
    "git diff --check"
  ];

  return (
    requiredFields.every((field) => isEvidenceReference(markdownField(markdown, field))) &&
    markdownField(markdown, "Dirty worktree") === "false" &&
    isTargetEnvironment(markdownField(markdown, "Target environment")) &&
    hasPattern(markdown, /### Migration Set/i) &&
    requiredEvidenceFields.every((field) => isEvidenceReference(markdownField(markdown, field))) &&
    requiredCommands.every((command) => markdownTableStatusPassed(markdown, command))
  );
}

function markdownTableStatusPassed(markdown: string | undefined, label: string): boolean {
  if (!markdown) {
    return false;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\|\\s*${escapedLabel}\\s*\\|\\s*passed\\s*\\|`, "i").test(markdown);
}

function markdownTableStatus(markdown: string | undefined, label: string): string {
  if (!markdown) {
    return "";
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`\\|\\s*${escapedLabel}\\s*\\|\\s*([^|\\s]+)\\s*\\|`, "i"));
  return match?.[1]?.toLowerCase() ?? "";
}

function markdownTableObservedReady(markdown: string | undefined, label: string): boolean {
  if (!markdown) {
    return false;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`\\|\\s*${escapedLabel}\\s*\\|\\s*([^|]+?)\\s*\\|`, "i"));
  const observed = match?.[1]?.trim().toLowerCase() ?? "";
  return observed.length > 0 && observed !== "pending" && observed !== "failed" && observed !== "n/a";
}

function isTargetEnvironment(value: string): boolean {
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

function isTargetUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return !isLocalHostname(hostname);
  } catch {
    return false;
  }
}

function isEvidenceReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "pending" && normalized !== "n/a" && normalized !== "not-configured";
}

function isTargetProofReference(value: string): boolean {
  return isEvidenceReference(value) && !isLocalUrl(value);
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    return isLocalHostname(url.hostname.toLowerCase());
  } catch {
    return false;
  }
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

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function listMarkdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).filter((file) => file.endsWith(".md"));
}

function readOptional(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
}

function formatItems(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function redactM6TargetSecret(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/((?:api_)?(?:token|secret|key|password)=)([^&\s]+)/gi, "$1<redacted>")
    .replace(/((?:api_)?(?:token|secret|key|password):)([^@\s]+)/gi, "$1<redacted>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkM6TargetEvidence();
  process.exit(result.status === "passed" ? 0 : 1);
}
