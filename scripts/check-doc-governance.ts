import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { developerFacingBilingualDocs } from "./bilingual-docs";

export const activePlansDir = "docs/exec-plans/active";
export const completedPlansDir = "docs/exec-plans/completed";
export const zhActivePlansDir = "docs/zh-CN/exec-plans/active";
export const zhCompletedPlansDir = "docs/zh-CN/exec-plans/completed";
export const requiredSections = ["## Documentation Impact Matrix", "## Documentation Update Gate"];
const requiredSectionHeadings = [
  {
    errorLabel: requiredSections[0],
    en: [requiredSections[0]],
    zh: ["## 文档影响矩阵", "## 文档影响矩阵与更新门禁"]
  },
  {
    errorLabel: requiredSections[1],
    en: [requiredSections[1]],
    zh: ["## 文档更新门", "## 文档更新门禁", "## 文档影响矩阵与更新门禁"]
  }
] as const;
export type HistoricalPlanDisposition =
  | "implemented"
  | "implemented-with-superseded-sections"
  | "superseded";
export interface HistoricalPlanInventoryEntry {
  id: string;
  disposition: HistoricalPlanDisposition;
  activePaths: string[];
  completedPaths: { en: string; zh: string };
}
export const managedHistoricalPlanInventory: HistoricalPlanInventoryEntry[] = [
  {
    id: "organization-administration",
    disposition: "implemented",
    activePaths: [
      "docs/exec-plans/active/2026-08-19-organization-administration.md",
      "docs/zh-CN/exec-plans/active/2026-08-19-organization-administration.md"
    ],
    completedPaths: {
      en: "docs/exec-plans/completed/2026-08-19-organization-administration.md",
      zh: "docs/zh-CN/exec-plans/completed/2026-08-19-organization-administration.md"
    }
  },
  {
    id: "local-eval-auth-hardening",
    disposition: "implemented",
    activePaths: [
      "docs/exec-plans/active/2026-08-19-local-eval-auth-hardening.md",
      "docs/zh-CN/exec-plans/active/2026-08-19-local-eval-auth-hardening.md"
    ],
    completedPaths: {
      en: "docs/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md",
      zh: "docs/zh-CN/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md"
    }
  },
  {
    id: "node-only-debugging-platform",
    disposition: "implemented-with-superseded-sections",
    activePaths: ["docs/exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md"],
    completedPaths: {
      en: "docs/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md",
      zh: "docs/zh-CN/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md"
    }
  },
  {
    id: "dts-parameter-workbench-redesign",
    disposition: "implemented-with-superseded-sections",
    activePaths: [
      "docs/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md",
      "docs/zh-CN/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md"
    ],
    completedPaths: {
      en: "docs/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md",
      zh: "docs/zh-CN/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md"
    }
  }
];
export const currentXiaozeLlmInstructionDocs = [
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "README.md",
  "docs/FRONTEND.md",
  "docs/QUALITY_SCORE.md",
  "docs/README.md",
  "docs/RELIABILITY.md",
  "docs/SECURITY.md",
  "docs/design-docs/2026-08-12-knowledge-base-design.md",
  "docs/design-docs/deployment-operations.md",
  "docs/design-docs/full-stack-architecture.md",
  "docs/design-docs/security-governance.md",
  "docs/design-docs/testing-strategy.md",
  "docs/developer/environment-variables.md",
  "docs/developer/local-development.md",
  "docs/developer/verification-matrix.md",
  "docs/exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md",
  "docs/exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md",
  "docs/exec-plans/active/2026-08-18-self-hosted-setup-wizard.md",
  "docs/references/pi-agent-provider-evidence.md",
  "docs/runbooks/agent-provider.md",
  "docs/runbooks/m5-commercial-pilot-readiness.md",
  "docs/runbooks/manual-acceptance.md",
  "docs/runbooks/observability-operations.md",
  "docs/security/secrets-management.md",
  "docs/zh-CN/QUALITY_SCORE.md",
  "docs/zh-CN/README.md",
  "docs/zh-CN/SECURITY.md",
  "docs/zh-CN/backend-runtime.md",
  "docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md",
  "docs/zh-CN/design-docs/deployment-operations.md",
  "docs/zh-CN/design-docs/full-stack-architecture.md",
  "docs/zh-CN/design-docs/security-governance.md",
  "docs/zh-CN/design-docs/testing-strategy.md",
  "docs/zh-CN/developer/environment-variables.md",
  "docs/zh-CN/developer/local-development.md",
  "docs/zh-CN/developer/verification-matrix.md",
  "docs/zh-CN/exec-plans/active/2026-08-18-self-hosted-setup-wizard.md",
  "docs/zh-CN/frontend.md",
  "docs/zh-CN/manual-acceptance.md",
  "docs/zh-CN/root/ARCHITECTURE.md",
  "docs/zh-CN/root/CONTRIBUTING.md",
  "docs/zh-CN/root/README.md",
  "docs/zh-CN/runbooks/agent-provider.md",
  "docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md",
  "docs/zh-CN/runbooks/observability-operations.md",
  "docs/zh-CN/security-reliability.md",
  "docs/zh-CN/security/secrets-management.md"
] as const;
export const canonicalXiaozeLlmOperatorDocs = [
  "docs/developer/environment-variables.md",
  "docs/developer/local-development.md",
  "docs/runbooks/agent-provider.md",
  "docs/runbooks/m5-commercial-pilot-readiness.md",
  "docs/runbooks/manual-acceptance.md",
  "docs/zh-CN/backend-runtime.md",
  "docs/zh-CN/developer/environment-variables.md",
  "docs/zh-CN/developer/local-development.md",
  "docs/zh-CN/manual-acceptance.md",
  "docs/zh-CN/runbooks/agent-provider.md",
  "docs/zh-CN/runbooks/m5-commercial-pilot-readiness.md"
] as const;
const canonicalXiaozeLlmKeys = [
  "XIAOZE_LLM_API_BASE_URL",
  "XIAOZE_LLM_MODEL",
  "XIAOZE_LLM_API_KEY"
] as const;
const xiaozeLegacyFallbackStart = "<!-- xiaoze-llm-legacy-fallback:start -->";
const xiaozeLegacyFallbackEnd = "<!-- xiaoze-llm-legacy-fallback:end -->";
const xiaozeLegacyFallbackDocs = new Set([
  "docs/developer/environment-variables.md",
  "docs/zh-CN/developer/environment-variables.md"
]);
export const requiredRepositoryDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/README.md",
  "docs/developer/README.md",
  "docs/developer/local-development.md",
  "docs/developer/environment-variables.md",
  "docs/developer/verification-matrix.md",
  "docs/api/README.md",
  "docs/api/authentication.md",
  "docs/api/errors.md",
  "docs/api/examples.md",
  "docs/security/README.md",
  "docs/security/threat-model.md",
  "docs/security/data-classification.md",
  "docs/security/secrets-management.md",
  "docs/security/audit-retention.md",
  "docs/runbooks/README.md",
  "docs/runbooks/manual-acceptance.md",
  "docs/runbooks/m5-commercial-pilot-readiness.md",
  "docs/runbooks/staging-deployment.md",
  "docs/runbooks/backup-restore.md",
  "docs/runbooks/rollback.md",
  "docs/runbooks/monitoring-alerting.md",
  "docs/runbooks/hdc-device-lab.md",
  "docs/runbooks/agent-provider.md",
  "docs/zh-CN/manual-acceptance.md",
  "docs/exec-plans/completed/README.md",
  "docs/zh-CN/exec-plans/completed/README.md"
];
export const requiredEnvExampleKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "AUTH_MODE",
  "AUTH_TOKEN_ISSUER",
  "AUTH_TOKEN_HMAC_SECRET",
  "M5_SMOKE_AUTHORIZATION",
  "WISEEFF_SMOKE_AUTHORIZATION",
  "WISEEFF_API_BASE_URL",
  "VITE_WISEEFF_RUNTIME_MODE",
  "VITE_WISEEFF_API_BASE_URL",
  "OBJECT_STORE_MODE",
  "OBJECT_STORE_ROOT",
  "WISEEFF_LOCAL_BACKUP_DIR",
  "WISEEFF_LOCAL_RESTORE_DIR",
  "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION",
  "HDC_TIMEOUT_MS",
  "XIAOZE_LLM_API_BASE_URL",
  "XIAOZE_LLM_MODEL",
  "XIAOZE_LLM_API_KEY",
  "AGENT_API_TIMEOUT_MS",
  "LOG_ANALYSIS_API_BASE_URL",
  "LOG_ANALYSIS_MODEL",
  "LOG_ANALYSIS_API_KEY",
  "LOG_ANALYSIS_API_TIMEOUT_MS",
  "LOG_ANALYSIS_TOKEN_BUDGET",
  "LOG_ANALYSIS_DETERMINISTIC",
  "M5_CONTRACT_CHECK_PASSED",
  "M5_SMOKE_ALLOW_NO_API",
  "LOG_WORKER_ENABLED",
  "LOG_ANALYSIS_QUEUE_MODE",
  "REDIS_URL",
  "LOG_ANALYSIS_QUEUE_PREFIX",
  "LOG_ANALYSIS_QUEUE_ATTEMPTS",
  "LOG_ANALYSIS_QUEUE_BACKOFF_MS",
  "LOG_ANALYSIS_QUEUE_CONCURRENCY"
];

export function validateCurrentXiaozeLlmInstructions(docPath: string, content: string): string[] {
  const normalizedPath = docPath.replace(/\\/g, "/");
  const errors = (canonicalXiaozeLlmOperatorDocs as readonly string[]).includes(normalizedPath)
    ? canonicalXiaozeLlmKeys
        .filter((key) => !content.includes(key))
        .map((key) => `${normalizedPath} is missing canonical Xiaoze LLM key ${key}.`)
    : [];
  const allowsLegacyFallback = xiaozeLegacyFallbackDocs.has(normalizedPath);
  if (
    !allowsLegacyFallback &&
    (content.includes(xiaozeLegacyFallbackStart) || content.includes(xiaozeLegacyFallbackEnd))
  ) {
    errors.push(
      `${normalizedPath} may not declare a Xiaoze LLM legacy fallback block; only the English and Chinese environment-variable guides may contain one.`
    );
  }
  let inLegacyFallback = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === xiaozeLegacyFallbackStart) {
      if (!allowsLegacyFallback) {
        continue;
      }
      if (inLegacyFallback) {
        errors.push(`${normalizedPath} has nested Xiaoze LLM legacy fallback markers.`);
      } else {
        inLegacyFallback = true;
      }
      continue;
    }
    if (trimmed === xiaozeLegacyFallbackEnd) {
      if (!allowsLegacyFallback) {
        continue;
      }
      if (!inLegacyFallback) {
        errors.push(`${normalizedPath} has an unmatched Xiaoze LLM legacy fallback end marker.`);
      } else {
        inLegacyFallback = false;
      }
      continue;
    }

    for (const match of line.matchAll(/AGENT_API_\*|AGENT_API_BASE_URL|AGENT_API_KEY|AGENT_MODEL|XIAOZE_MODEL/g)) {
      if (!inLegacyFallback) {
        errors.push(
          `${normalizedPath} treats legacy Xiaoze LLM key ${match[0]} as a current instruction outside an explicit canonical-group-absent migration fallback.`
        );
      }
    }
  }

  if (inLegacyFallback) {
    errors.push(`${normalizedPath} has an unclosed Xiaoze LLM legacy fallback marker.`);
  }

  return errors;
}

export async function validateCurrentXiaozeLlmInstructionDocs(root = process.cwd()): Promise<string[]> {
  const checks = await Promise.all(
    currentXiaozeLlmInstructionDocs.map(async (docPath) => {
      const content = await readFile(path.join(root, docPath), "utf8");
      return validateCurrentXiaozeLlmInstructions(docPath, content);
    })
  );

  return checks.flat();
}

function declaredPlanStatus(line: string): string | null {
  const match =
    line.match(/^\s*>?\s*\*\*(?:Status|状态)\s*[:：]\*\*\s*(.*)$/iu) ??
    line.match(/^\s*>?\s*\*\*(?:Status|状态)\*\*\s*[:：]\s*(.*)$/iu) ??
    line.match(/^\s*>?\s*(?:Status|状态)\s*[:：]\s*(.*)$/iu);
  if (match === null) {
    return null;
  }

  const rawStatus = match[1].trim();
  const emphasizedStatus = rawStatus.match(/^\*\*(.+?)\*\*/u);
  const statusText = emphasizedStatus === null ? rawStatus : emphasizedStatus[1].trim();
  return statusText.split(/\s*(?:—+|–+|-{2,}|[;；。])\s*/u, 1)[0].trim();
}

export function validatePlanDocument(planPath: string, content: string): string[] {
  const normalizedPath = planPath.replace(/\\/g, "/");

  if (normalizedPath.endsWith("/development-roadmap.md")) {
    return [];
  }

  const markdownLines = collectMarkdownLinesOutsideFences(content);
  const headings = collectMarkdownHeadings(markdownLines);
  const errors: string[] = [];
  const isChinesePlan = normalizedPath.startsWith(`${zhActivePlansDir}/`);
  const activeTree = normalizedPath.startsWith(`${activePlansDir}/`)
    ? { completedDir: completedPlansDir }
    : normalizedPath.startsWith(`${zhActivePlansDir}/`)
      ? { completedDir: zhCompletedPlansDir }
      : null;

  if (
    activeTree !== null &&
    markdownLines.some(
      (line) => {
        const status = declaredPlanStatus(line);
        return (
          status !== null &&
          (/superseded/i.test(status) ||
            /(?:已被|被).{0,24}(?:取代|替代)|(?:取代|替代)(?:了)?(?:本|这)(?:个|次|份)?(?:计划|重写|方案)/u.test(
              status
            ))
        );
      }
    )
  ) {
    errors.push(
      `${normalizedPath} declares itself superseded and must move to ${activeTree.completedDir}.`
    );
  }

  errors.push(
    ...requiredSectionHeadings
      .filter(
        (section) =>
          !section[isChinesePlan ? "zh" : "en"].some((heading) => headings.has(heading))
      )
      .map((section) => `${normalizedPath} is missing ${section.errorLabel}.`)
  );

  return errors;
}

function collectMarkdownLinesOutsideFences(content: string): string[] {
  const lines: string[] = [];
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines;
}

function collectMarkdownHeadings(lines: readonly string[]): Set<string> {
  const headings = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      headings.add(trimmed);
    }
  }

  return headings;
}

async function listMarkdownFilenames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function validateNoDuplicatePlanFilenames(root = process.cwd()): Promise<string[]> {
  const trees: Array<[string, string]> = [
    [activePlansDir, completedPlansDir],
    [zhActivePlansDir, zhCompletedPlansDir]
  ];

  const errors = await Promise.all(
    trees.map(async ([activeDir, completedDir]) => {
      const [activeNames, completedNames] = await Promise.all([
        listMarkdownFilenames(path.join(root, activeDir)),
        listMarkdownFilenames(path.join(root, completedDir))
      ]);
      const completedSet = new Set(completedNames);

      return activeNames
        .filter((name) => completedSet.has(name))
        .sort()
        .map((name) => `Plan filename ${name} exists in both ${activeDir} and ${completedDir}.`);
    })
  );

  return errors.flat();
}

const historicalStatusText: Record<
  HistoricalPlanDisposition,
  { en: string; zh: string; errorLabel: string }
> = {
  implemented: {
    en: "Historical status: **Implemented and archived**",
    zh: "历史状态：**已实施并归档**",
    errorLabel: "Implemented and archived"
  },
  "implemented-with-superseded-sections": {
    en: "Historical status: **Implemented with superseded sections and archived**",
    zh: "历史状态：**已实施，部分章节已被取代，现已归档**",
    errorLabel: "Implemented with superseded sections and archived"
  },
  superseded: {
    en: "Historical status: **Superseded and archived**",
    zh: "历史状态：**已被取代并归档**",
    errorLabel: "Superseded and archived"
  }
};
const historicalResidualOwnershipText = {
  en: "Residual ownership:",
  zh: "余量归属："
} as const;

export async function validateHistoricalPlanInventory(
  root = process.cwd(),
  inventory: HistoricalPlanInventoryEntry[] = managedHistoricalPlanInventory
): Promise<string[]> {
  const errors: string[] = [];

  for (const entry of inventory) {
    for (const activePath of entry.activePaths) {
      try {
        await access(path.join(root, activePath));
        errors.push(`Managed historical plan ${entry.id} still exists in active: ${activePath}.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }

        // The bounded historical plan has left active as required.
      }
    }

    for (const language of ["en", "zh"] as const) {
      const completedPath = entry.completedPaths[language];
      const content = await readOptionalFile(path.join(root, completedPath));
      if (content === null) {
        errors.push(`Managed historical plan ${entry.id} is missing completed document: ${completedPath}.`);
        continue;
      }

      const expected = historicalStatusText[entry.disposition];
      if (!content.includes(expected[language])) {
        errors.push(
          `${completedPath} must declare Historical status: ${expected.errorLabel}.`
        );
      }
      if (!content.includes(historicalResidualOwnershipText[language])) {
        errors.push(`${completedPath} must declare Residual ownership for any remaining work.`);
      }
    }
  }

  return errors;
}

export async function validateActivePlans(root = process.cwd()): Promise<string[]> {
  const markdownFiles = (
    await Promise.all(
      [activePlansDir, zhActivePlansDir].map(async (activeDir) => {
        const entries = await readdir(path.join(root, activeDir), { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => path.join(activeDir, entry.name));
      })
    )
  ).flat();

  const errors = await Promise.all(
    markdownFiles.map(async (planPath) => {
      const content = await readFile(path.join(root, planPath), "utf8");
      return validatePlanDocument(planPath, content);
    })
  );

  return errors.flat();
}

export async function validateRequiredRepositoryDocs(root = process.cwd()): Promise<string[]> {
  const checks = await Promise.all(
    requiredRepositoryDocs.map(async (docPath) => {
      try {
        await access(path.join(root, docPath));
        return null;
      } catch {
        return `Missing required documentation file: ${docPath}.`;
      }
    })
  );

  return checks.filter((error): error is string => error !== null);
}

export async function validateEnvExample(root = process.cwd()): Promise<string[]> {
  const envPath = path.join(root, ".env.example");
  let content: string;

  try {
    content = await readFile(envPath, "utf8");
  } catch {
    return ["Missing required documentation file: .env.example."];
  }

  const keys = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.split("=")[0])
  );

  return requiredEnvExampleKeys
    .filter((key) => !keys.has(key))
    .map((key) => `Missing required .env.example key: ${key}.`);
}

export async function validateMarkdownLinks(root = process.cwd()): Promise<string[]> {
  const markdownFiles = await collectMarkdownFiles(root);
  const errors: string[] = [];

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf8");
    const relativeFile = toPosix(path.relative(root, filePath));

    for (const target of collectLocalMarkdownTargets(content)) {
      const targetWithoutAnchor = target.split("#")[0].trim();

      if (targetWithoutAnchor.length === 0) {
        continue;
      }

      const normalizedTarget = targetWithoutAnchor.replace(/^<|>$/g, "");
      const resolved = path.resolve(path.dirname(filePath), normalizedTarget);

      try {
        await access(resolved);
      } catch {
        errors.push(`Broken local markdown link in ${relativeFile}: ${target}`);
      }
    }
  }

  return errors;
}

export async function validateBilingualDeveloperDocs(root = process.cwd()): Promise<string[]> {
  const errors: string[] = [];

  await Promise.all(
    developerFacingBilingualDocs
      .filter((entry) => entry.status === "required")
      .map(async (entry) => {
        const enContent = await readOptionalFile(path.join(root, entry.en));
        const zhContent = await readOptionalFile(path.join(root, entry.zh));

        if (enContent === null) {
          errors.push(`Missing English developer-facing doc: ${entry.en}.`);
        }
        if (zhContent === null) {
          errors.push(`Missing Chinese developer-facing doc: ${entry.zh}.`);
        }

        if (enContent !== null && containsHanOutsideCodeBlocks(enContent)) {
          errors.push(`${entry.en} contains Chinese prose; keep developer-facing languages in separate linked files.`);
        }

        if (enContent !== null && !containsLocalLinkTo(enContent, entry.en, entry.zh)) {
          errors.push(`${entry.en} is missing a language link to ${entry.zh}.`);
        }
        if (zhContent !== null && !containsLocalLinkTo(zhContent, entry.zh, entry.en)) {
          errors.push(`${entry.zh} is missing a language link to ${entry.en}.`);
        }
        if (zhContent !== null && containsMojibake(zhContent)) {
          errors.push(`${entry.zh} appears to contain mojibake or placeholder question marks.`);
        }
      })
  );

  return errors;
}

export function validateM6ReleaseRunbookCommands(docPath: string, content: string): string[] {
  const errors: string[] = [];
  const normalizedPath = docPath.replace(/\\/g, "/");
  const rollbackCommand = findCommandLine(content, "npm run rollback:rehearsal");
  const capacityCommand = findCommandLine(content, "npm run capacity:gate");
  const releaseGateCommand = findCommandLine(content, "npm run selfhost:release-gate");

  if (!rollbackCommand.includes("--notes")) {
    errors.push(`${normalizedPath} rollback rehearsal command is missing --notes.`);
  }
  if (!capacityCommand.includes("--k6-summary")) {
    errors.push(`${normalizedPath} capacity gate command is missing --k6-summary.`);
  }
  if (!capacityCommand.includes("--metrics-snapshot")) {
    errors.push(`${normalizedPath} capacity gate command is missing --metrics-snapshot.`);
  }
  if (!releaseGateCommand.includes("--backup-evidence")) {
    errors.push(`${normalizedPath} self-hosted release gate command is missing --backup-evidence.`);
  }

  return errors;
}

export async function validateM6RunbookCommands(root = process.cwd()): Promise<string[]> {
  const runbooks = ["docs/runbooks/release-rollback.md", "docs/runbooks/manual-acceptance.md"];
  const checks = await Promise.all(
    runbooks.map(async (runbookPath) => {
      const content = await readFile(path.join(root, runbookPath), "utf8");
      return validateM6ReleaseRunbookCommands(runbookPath, content);
    })
  );

  return checks.flat();
}

export async function validateDocumentationRepository(root = process.cwd()): Promise<string[]> {
  const [activePlanErrors, duplicatePlanErrors, historicalPlanErrors, requiredDocErrors, envErrors, linkErrors, bilingualErrors, m6RunbookErrors, xiaozeLlmInstructionErrors] = await Promise.all([
    validateActivePlans(root),
    validateNoDuplicatePlanFilenames(root),
    validateHistoricalPlanInventory(root),
    validateRequiredRepositoryDocs(root),
    validateEnvExample(root),
    validateMarkdownLinks(root),
    validateBilingualDeveloperDocs(root),
    validateM6RunbookCommands(root),
    validateCurrentXiaozeLlmInstructionDocs(root)
  ]);

  return [
    ...activePlanErrors,
    ...duplicatePlanErrors,
    ...historicalPlanErrors,
    ...requiredDocErrors,
    ...envErrors,
    ...linkErrors,
    ...bilingualErrors,
    ...m6RunbookErrors,
    ...xiaozeLlmInstructionErrors
  ];
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const ignoredDirectories = new Set([".git", ".worktrees", "node_modules", "dist", "coverage", "playwright-report"]);
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) {
            await visit(entryPath);
          }
          return;
        }

        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(entryPath);
        }
      })
    );
  }

  await visit(root);
  return files;
}

function collectLocalMarkdownTargets(content: string): string[] {
  const targets: string[] = [];
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(line)) !== null) {
      const target = match[1].trim();

      if (isLocalMarkdownTarget(target)) {
        targets.push(target);
      }
    }
  }

  return targets;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function containsLocalLinkTo(content: string, sourcePath: string, expectedPath: string): boolean {
  const sourceDirectory = path.posix.dirname(sourcePath.replace(/\\/g, "/"));
  const normalizedExpected = path.posix.normalize(expectedPath.replace(/\\/g, "/"));

  return collectLocalMarkdownTargets(content).some((target) => {
    const targetWithoutAnchor = target.split("#")[0].trim().replace(/^<|>$/g, "");

    if (targetWithoutAnchor.length === 0) {
      return false;
    }

    const normalizedTarget = path.posix.normalize(path.posix.join(sourceDirectory, targetWithoutAnchor.replace(/\\/g, "/")));
    return normalizedTarget === normalizedExpected;
  });
}

function containsHanOutsideCodeBlocks(content: string): boolean {
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && /\p{Script=Han}/u.test(line)) {
      return true;
    }
  }

  return false;
}

function containsMojibake(content: string): boolean {
  const mojibakeMarkers = ["\u951b", "\u9286", "\u93c2", "\u6770", "\u7efe"];
  return content.includes("\uFFFD") || /\?{3,}/.test(content) || mojibakeMarkers.some((marker) => content.includes(marker));
}

function findCommandLine(content: string, command: string): string {
  return content.split(/\r?\n/).find((line) => line.includes(command)) ?? "";
}

function isLocalMarkdownTarget(target: string): boolean {
  if (target.length === 0 || target.startsWith("#")) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return false;
  }

  return true;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await validateDocumentationRepository();

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log("Documentation governance check passed.");
}
