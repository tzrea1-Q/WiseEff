import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type ChangedPathDecision = {
  docsOnly: boolean;
  ui: boolean;
  product: boolean;
  workflow: boolean;
  runL1: boolean;
  runQuality: boolean;
  runSmoke: boolean;
};

const WORKFLOW_FILES = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/log-analysis-quality-gate.yml",
  "scripts/check-acceptance-ci.ts",
  "scripts/check-acceptance-ci.test.ts",
  "scripts/ci-changed-paths.ts",
  "scripts/ci-changed-paths.test.ts"
]);

export function normalizeChangedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

export function classifyChangedPaths(paths: string[]): ChangedPathDecision {
  const normalized = paths.map(normalizeChangedPath).filter(Boolean);
  if (normalized.length === 0) {
    return {
      docsOnly: false,
      ui: true,
      product: true,
      workflow: false,
      runL1: true,
      runQuality: true,
      runSmoke: true
    };
  }

  let ui = false;
  let product = false;
  let workflow = false;
  let allDocsInert = true;

  for (const path of normalized) {
    const isWorkflow = isWorkflowPath(path);
    const isProduct = isProductPath(path);
    const isUi = isUiPath(path);
    const isDocsInert = isDocsInertPath(path);

    if (isWorkflow) {
      workflow = true;
    }
    if (isProduct) {
      product = true;
    }
    if (isUi) {
      ui = true;
    }
    if (!isDocsInert) {
      allDocsInert = false;
    }
    if (!isWorkflow && !isProduct && !isUi && !isDocsInert) {
      product = true;
      allDocsInert = false;
    }
  }

  const docsOnly = allDocsInert && !workflow && !product && !ui;
  return {
    docsOnly,
    ui,
    product,
    workflow,
    runL1: !docsOnly,
    runQuality: ui || product,
    runSmoke: product || workflow
  };
}

export function formatGithubOutput(decision: ChangedPathDecision): string {
  return [
    `docs_only=${decision.docsOnly}`,
    `run_l1=${decision.runL1}`,
    `run_quality=${decision.runQuality}`,
    `run_smoke=${decision.runSmoke}`
  ].join("\n");
}

export function readChangedPathsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function runChangedPathClassification(args = process.argv.slice(2), stdinText?: string) {
  const useStdin = args.includes("--stdin");
  const writeGithub = args.includes("--github-output");
  const asJson = args.includes("--json");
  const paths = useStdin
    ? readChangedPathsFromText(stdinText ?? readFileSync(0, "utf8"))
    : args.filter((arg) => !arg.startsWith("--"));
  const decision = classifyChangedPaths(paths);

  if (asJson) {
    console.log(JSON.stringify(decision));
  } else {
    console.log(formatGithubOutput(decision));
  }

  if (writeGithub) {
    const outputPath = process.env.GITHUB_OUTPUT;
    const body = `${formatGithubOutput(decision)}\n`;
    if (outputPath) {
      appendFileSync(outputPath, body);
    }
  }

  return decision;
}

function isWorkflowPath(path: string): boolean {
  return path.startsWith(".github/workflows/") || WORKFLOW_FILES.has(path);
}

function isProductPath(path: string): boolean {
  return (
    path.startsWith("src/") ||
    path.startsWith("server/") ||
    path.startsWith("e2e/") ||
    path.startsWith("packages/") ||
    path.startsWith("ops/") ||
    /^playwright[^/]*\.ts$/.test(path) ||
    path.includes("/migrations/") ||
    path.startsWith("scripts/db") ||
    path.startsWith("scripts/seed") ||
    path === "package.json" ||
    path === "package-lock.json" ||
    path === ".nvmrc" ||
    /^vite\.config\.[cm]?[jt]s$/.test(path) ||
    /^vitest(\.[^/]+)?\.config\.[cm]?[jt]s$/.test(path)
  );
}

function isUiPath(path: string): boolean {
  return (
    path.startsWith("src/") ||
    path.startsWith("e2e/quality/") ||
    path === "index.html" ||
    path.startsWith("public/") ||
    path.endsWith(".css")
  );
}

function isDocsInertPath(path: string): boolean {
  if (isWorkflowPath(path)) {
    return false;
  }
  if (path.startsWith("docs/") || path.endsWith(".md")) {
    return true;
  }
  return path.startsWith(".github/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runChangedPathClassification();
}
