import { existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preProcessFile } from "typescript";
import { discoverBrowserInventory, type BrowserInventory } from "./browser-navigation";
import { qualityRoutePaths, routeOwnership } from "../e2e/quality/route-ownership";

const suiteConfigs = {
  frontend: "vite.config.ts",
  server: "vitest.server.config.ts",
  scripts: "vitest.scripts.config.ts",
  bridge: "vitest.bridge.config.ts",
} as const;

type SuiteName = keyof typeof suiteConfigs;
export type TestInventory = Record<SuiteName, { files: string[]; related: Record<string, string[]> }>;
const suiteNames = Object.keys(suiteConfigs) as SuiteName[];

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageScripts = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).scripts as Record<string, string>;
const gateScripts = Object.keys(packageScripts).filter((name) => name.endsWith(":check")
  || (name.startsWith("acceptance:") && /scripts\/check-/.test(packageScripts[name])));

function toolingFiles(command: string): string[] {
  const files = new Set<string>();
  const pending = [...command.matchAll(/(?:scripts|ops)\/[\w./-]+\.[cm]?[jt]sx?\b/g)].map((match) => match[0]);
  while (pending.length) {
    const file = pending.pop()!;
    if (files.has(file) || !existsSync(resolve(repositoryRoot, file))) continue;
    files.add(file);
    for (const imported of preProcessFile(readFileSync(resolve(repositoryRoot, file), "utf8")).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const base = resolve(repositoryRoot, dirname(file), imported.fileName);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((candidate) => /\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate));
      if (!dependency) continue;
      const path = relative(repositoryRoot, dependency).replaceAll("\\", "/");
      if (/^(?:scripts|ops)\//.test(path)) pending.push(path);
    }
  }
  return [...files].sort();
}

const generators = Object.entries(packageScripts).filter(([, command]) => /(?:scripts|ops)\/generate-/.test(command)).map(([name, command]) => ({ name, files: toolingFiles(command) }));
export const gateImplementationFiles: Record<string, string[]> = Object.fromEntries(gateScripts.map((gate) => {
  const files = toolingFiles(packageScripts[gate]);
  const namespace = gate.endsWith(":check") ? gate.slice(0, -":check".length) : gate;
  return [gate, [...new Set([...files, ...generators.filter((generator) => generator.name.startsWith(`${namespace}:`)
    || generator.files.some((file) => files.includes(file))).flatMap((generator) => generator.files)])].sort()];
}));

function normalizePath(file: string): string {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((part) => part === ".." || part === "." || !part)
    || normalized.includes("\0")) throw new Error(`Invalid repository-relative path: ${file}`);
  return normalized;
}

function ciScriptPath(file: string): boolean {
  return /^scripts\/(?:ci-|check-acceptance-ci\.|quality-partition\.|acceptance-diagnostic\.|[^/]*seed-contract\.)/.test(file);
}

function sharedPath(file: string): boolean {
  return /^(?:\.github\/|e2e\/|src\/(?:app\/|components\/(?:common|layout|notifications|ui)\/|linear-template\/|test\/|(?:App|main|workbenchUi)\.tsx$|appConfig\.ts$|styles\.css$))/.test(file)
    || ciScriptPath(file)
    || /^scripts\/(?:test-impact\.|run-vitest\.|verification\/|reset-quality-runtime\.|seed-quality-|quality-(?:viewport-profile|visual-review-authorization)\.|owned-local-acceptance-runtime\.|run-(?:browser-acceptance|acceptance-(?:gate0|preflight))\.|check-quality-(?:gates|snapshot-config|visual-masks)\.)/.test(file)
    || /^(?:(?:vite|vitest[^/]*|playwright[^/]*|eslint)\.config\.[^/]+|tsconfig[^/]*\.json|package(?:-lock)?\.json)$/.test(file)
    || (file.endsWith(".css") && !/^src\/(?:components|features)\//.test(file));
}

function documentationPath(file: string): boolean {
  return /^(?:docs\/.+|[^/]+)\.md$/i.test(file);
}

function gateOnlyPath(file: string): boolean {
  return documentationPath(file) || file === "docs/generated/openapi.json";
}

function staticGates(file: string): string[] {
  const gates = Object.entries(gateImplementationFiles).filter(([, files]) => files.includes(file)).map(([gate]) => gate);
  if (documentationPath(file)) gates.push("docs:check");
  if (/^docs\/(?:zh-CN\/)?runbooks\/.+\.md$/i.test(file)) gates.push("docs:runbook-commands:check");
  if (/^src\/.+\.(?:css|tsx)$/.test(file)) gates.push("ui:check");
  if (file === "docs/generated/openapi.json" || /^server\/modules\/contracts\/(?:dtoSchemas\/|(?:openapi|schemaRegistry|zodToOpenApiSchema|routeManifest)\.ts$)/.test(file)) gates.push("contract:check");
  if (file.startsWith(".github/") || ciScriptPath(file)) gates.push("acceptance:ci");
  return gates;
}

function explicitSuites(file: string): SuiteName[] {
  if (/^ops\/.+\.[cm]?[jt]sx?$/.test(file)) return ["scripts"];
  if (/^packages\/.+\.[cm]?[jt]sx?$/.test(file)) return ["bridge"];
  if (/^src\/(?:components|features)\/.+\.css$/.test(file)) return ["frontend", "scripts"];
  return [];
}

function quote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export type { BrowserInventory } from "./browser-navigation";

export function selectBrowserImpact(paths: string[], inventory?: BrowserInventory, discoveryReasons: string[] = []) {
  if (!paths.length) throw new Error("Empty changed-file selection");
  const changedPaths = [...new Set(paths.map(normalizePath))].filter((file) => !gateOnlyPath(file));
  if (!changedPaths.length) return { fullFallback: false, reasons: [], qualityRoutes: [], qualityGrep: null, acceptanceSpecs: [], commands: [] };
  inventory ??= discoverBrowserInventory(repositoryRoot);
  if (!Object.keys(inventory).length) throw new Error("Empty browser test inventory");
  const reasons = [...discoveryReasons];
  const routes = new Set<string>();
  for (const file of changedPaths) {
    const owners = Object.entries(routeOwnership).filter(([owner]) => owner.endsWith("/") ? file.startsWith(owner) : file === owner);
    if (sharedPath(file)) reasons.push(`Shared browser change: ${file}`);
    else if (!owners.length) reasons.push(`Unmapped browser change: ${file}`);
    for (const [, ownedRoutes] of owners) for (const route of ownedRoutes) routes.add(route);
  }
  const fullFallback = reasons.length > 0;
  const qualityRoutes = fullFallback ? [...qualityRoutePaths] : [...routes].sort();
  if (!qualityRoutes.length) throw new Error("Empty quality route selection");
  const acceptanceSpecs = Object.keys(inventory).filter((spec) => fullFallback || inventory[spec] === null
    || inventory[spec]!.some((route) => qualityRoutes.some((selected) => route.split(/[?#]/)[0] === selected
      || route.startsWith(`${selected}/`)))).sort();
  if (!acceptanceSpecs.length) throw new Error("Empty acceptance spec selection");
  const escape = (route: string) => route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const excluded = qualityRoutePaths.filter((route) => !qualityRoutes.includes(route));
  const qualityGrep = fullFallback || !excluded.length ? ".*"
    : `(?:${qualityRoutes.map(escape).join("|")})(?=[\\s?:]|$)|^(?!.*(?:${excluded.map(escape).join("|")})(?=[\\s?:]|$)).*$`;
  return {
    fullFallback, reasons, qualityRoutes, qualityGrep, acceptanceSpecs,
    commands: [
      `npx playwright test --config playwright.quality.config.ts --grep ${quote(qualityGrep)}`,
      `npx playwright test --config playwright.acceptance.config.ts ${acceptanceSpecs.map(quote).join(" ")}`,
    ],
  };
}

export function selectVitestImpact(paths: string[], inventory: TestInventory, discoveryReasons: string[] = []) {
  if (!paths.length) throw new Error("Empty changed-file selection");
  const changedPaths = [...new Set(paths.map(normalizePath))].sort();
  const testPaths = changedPaths.filter((file) => !gateOnlyPath(file));
  const gates = [...new Set(changedPaths.flatMap(staticGates))].sort();
  const reasons = [...discoveryReasons];
  for (const file of testPaths) {
    if (sharedPath(file)) reasons.push(`Shared change: ${file}`);
    else if (!explicitSuites(file).length && !suiteNames.some((name) => inventory[name].related[file]?.length)) reasons.push(`Unmapped change: ${file}`);
  }
  const fullFallback = reasons.length > 0;
  const suites = suiteNames.flatMap((name) => {
    const files = [...new Set(fullFallback ? inventory[name].files : testPaths.flatMap((file) => [
      ...(inventory[name].related[file] ?? []),
      ...(explicitSuites(file).includes(name) ? inventory[name].files : []),
    ]))].sort();
    if (fullFallback && !files.length) throw new Error(`Empty test inventory: ${name}`);
    return files.length ? [{ name, config: suiteConfigs[name], files }] : [];
  });
  if (!suites.length && !gates.length) throw new Error("Empty test and gate selection");
  return {
    changedPaths,
    fullFallback,
    reasons,
    suites,
    gates,
    commands: [
      ...suites.map((suite) => `VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner --config ${suite.config} --passWithNoTests=false${fullFallback ? "" : ` ${suite.files.map(quote).join(" ")}`}`),
      ...gates.map((gate) => `npm run ${gate}`),
    ],
  };
}

export async function createVitestImpact(paths: string[], root = process.cwd()) {
  root = realpathSync(root);
  if (!paths.length) throw new Error("Empty changed-file selection");
  const changedPaths = [...new Set(paths.map(normalizePath))].sort();
  const testPaths = changedPaths.filter((file) => !gateOnlyPath(file));
  const inventory: TestInventory = {
    frontend: { files: [], related: {} },
    server: { files: [], related: {} },
    scripts: { files: [], related: {} },
    bridge: { files: [], related: {} },
  };
  if (!testPaths.length) return { ...selectVitestImpact(changedPaths, inventory), browser: selectBrowserImpact(changedPaths) };
  const reasons = testPaths.filter((file) => !existsSync(resolve(root, file))).map((file) => `Missing or deleted change: ${file}`);
  const skipRelated = reasons.length > 0 || changedPaths.some(sharedPath);
  const { createVitest } = await import("vitest/node");
  for (const name of suiteNames) {
    const vitest = await createVitest("test", {
      root, config: resolve(root, suiteConfigs[name]), configLoader: "runner", watch: false,
    });
    try {
      const files = (await vitest.globTestSpecifications()).map((spec) => relative(root, spec.moduleId).replaceAll("\\", "/"));
      const related: Record<string, string[]> = {};
      inventory[name] = { files, related };
      if (!skipRelated && !reasons.length) {
        for (const file of testPaths) {
          vitest.config.related = [resolve(root, file)];
          related[file] = (await vitest.getRelevantTestSpecifications()).map((spec) => relative(root, spec.moduleId).replaceAll("\\", "/"));
        }
      }
    } catch (error) {
      if (!inventory[name]) throw error;
      reasons.push(`Related discovery failed for ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await vitest.close();
    }
  }
  const selection = selectVitestImpact(changedPaths, inventory, reasons);
  const browser = selectBrowserImpact(changedPaths, discoverBrowserInventory(root), reasons);
  return { ...selection, browser, commands: [...selection.commands, ...browser.commands] };
}

async function cli() {
  const { values, positionals } = parseArgs({
    options: { base: { type: "string" }, json: { type: "boolean" } }, allowPositionals: true,
  });
  if ((values.base !== undefined && positionals.length) || (values.base === undefined && !positionals.length)) {
    throw new Error("Usage: npm run test:impact -- [--json] <changed files...> OR --base <commit>");
  }
  let paths = positionals;
  if (values.base !== undefined) {
    const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const base = git(["rev-parse", "--verify", "--end-of-options", `${values.base}^{commit}`]).trim();
    paths = [
      ...git(["diff", "--name-only", "--no-renames", "-z", base, "--"]).split("\0"),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ].filter(Boolean);
  }
  const selection = await createVitestImpact(paths);
  if (!values.json) for (const command of selection.commands) console.error(command);
  console.log(JSON.stringify(selection, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await cli(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
