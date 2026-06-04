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
    queue?: string;
    observability?: string;
    rollback?: string;
    capacity?: string;
    release?: string;
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

      if (status === "missing" || status !== "passed" || !isTargetEnvironment(environment)) {
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

      if (baseUrl) {
        notes.push(`Queue target evidence base URL: ${baseUrl}.`);
      }

      if (status === "missing" || status !== "passed" || !isTargetUrl(baseUrl)) {
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
      const hasScrape = /Prometheus target scrape:\s*`passed`/i.test(evidence.observability ?? "");
      const hasAlert = /Alertmanager routing:\s*`passed`/i.test(evidence.observability ?? "");
      const hasGrafana = /Grafana dashboard import:\s*`passed`/i.test(evidence.observability ?? "");

      if (status === "missing" || status !== "passed" || !hasScrape || !hasAlert || !hasGrafana) {
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

      if (!releasePassed || !rollbackPassed || !capacityPassed || missingDependency) {
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
      queue: readOptional(join(root, "docs", "generated", "m6-queue-readiness-evidence.md")),
      observability: readOptional(join(root, "docs", "generated", "m6-observability-evidence.md")),
      rollback: readOptional(join(root, "docs", "generated", "m6-rollback-rehearsal-evidence.md")),
      capacity: readOptional(join(root, "docs", "generated", "capacity-gate.md")),
      release: readOptional(join(root, "docs", "generated", "m6-release-readiness.md"))
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

function markdownTableStatusPassed(markdown: string | undefined, label: string): boolean {
  if (!markdown) {
    return false;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\|\\s*${escapedLabel}\\s*\\|\\s*passed\\s*\\|`, "i").test(markdown);
}

function isTargetEnvironment(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("target") || normalized.includes("staging") || normalized.includes("pilot");
}

function isTargetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && !/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/i.test(value);
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
