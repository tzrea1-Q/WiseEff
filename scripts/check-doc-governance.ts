import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const activePlansDir = "docs/exec-plans/active";
export const requiredSections = ["## Documentation Impact Matrix", "## Documentation Update Gate"];
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
  "docs/exec-plans/completed/README.md"
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
  "DEBUG_DEVICE_GATEWAY_MODE",
  "DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION",
  "HDC_TIMEOUT_MS",
  "AGENT_PROVIDER",
  "AGENT_API_FORMAT",
  "AGENT_API_BASE_URL",
  "AGENT_MODEL",
  "AGENT_API_KEY",
  "AGENT_API_TIMEOUT_MS",
  "AGENT_PROMPT_VERSION",
  "M5_CONTRACT_CHECK_PASSED",
  "M5_SMOKE_ALLOW_NO_API"
];

export function validatePlanDocument(planPath: string, content: string): string[] {
  const normalizedPath = planPath.replace(/\\/g, "/");

  if (normalizedPath.endsWith("/development-roadmap.md")) {
    return [];
  }

  const headings = collectMarkdownHeadings(content);

  return requiredSections
    .filter((section) => !headings.has(section))
    .map((section) => `${normalizedPath} is missing ${section}.`);
}

function collectMarkdownHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && trimmed.startsWith("## ")) {
      headings.add(trimmed);
    }
  }

  return headings;
}

export async function validateActivePlans(root = process.cwd()): Promise<string[]> {
  const activeDir = path.join(root, activePlansDir);
  const entries = await readdir(activeDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(activePlansDir, entry.name));

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

export async function validateDocumentationRepository(root = process.cwd()): Promise<string[]> {
  const [activePlanErrors, requiredDocErrors, envErrors, linkErrors] = await Promise.all([
    validateActivePlans(root),
    validateRequiredRepositoryDocs(root),
    validateEnvExample(root),
    validateMarkdownLinks(root)
  ]);

  return [...activePlanErrors, ...requiredDocErrors, ...envErrors, ...linkErrors];
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
