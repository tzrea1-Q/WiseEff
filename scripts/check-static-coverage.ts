import { existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { ESLint } from "eslint";

type Check = { status: "configured" | "checked" | "excluded" | "missing"; reason?: string; project?: string; config?: string; rules?: number };
export type StaticCoverage = {
  status: "selected" | "passed" | "failed" | "not-applicable";
  testExecution: "not-run";
  files: { path: string; lint: Check; typecheck: Check; testSuiteCandidate: string | null }[];
  problems: string[];
  durationMs: number;
};

/** Actual tool applicability; execute checks selected roots, never claims a full project build. */
export async function inspectStaticCoverage(paths: string[], root = process.cwd(), { execute = false, deletedPaths = [] }: { execute?: boolean; deletedPaths?: string[] } = {}): Promise<StaticCoverage> {
  const started = performance.now();
  root = realpathSync(root);
  if (!paths.length) throw new Error("Empty static coverage selection");
  paths = [...new Set(paths.map((file) => {
    file = file.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!file || isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes("\0") || file.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Invalid repository-relative path: ${file}`);
    }
    return file;
  }))].sort();
  const result: StaticCoverage = { status: "selected", testExecution: "not-run", files: [], problems: [], durationMs: 0 };
  const eslint = new ESLint({ cwd: root });
  const projects = new Map<string, ts.ParsedCommandLine>();
  const groups = new Map<string, string[]>();
  const loadProject = (name: string) => {
    let parsed = projects.get(name);
    if (!parsed) {
      parsed = ts.getParsedCommandLineOfConfigFile(resolve(root, name), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
      } })!;
      projects.set(name, parsed);
    }
    return parsed;
  };
  for (const file of paths) {
    const entry: StaticCoverage["files"][number] = { path: file, lint: { status: "missing" }, typecheck: { status: "missing" }, testSuiteCandidate: null };
    result.files.push(entry);
    const absolute = resolve(root, file);
    if (!existsSync(absolute)) {
      if (deletedPaths.includes(file)) entry.lint = entry.typecheck = { status: "excluded", reason: "Git-confirmed deletion; current-file checks cannot execute. Keep conservative affected-test fallback." };
      else result.problems.push(`Missing changed file: ${file}`);
      continue;
    }
    const actual = relative(root, realpathSync(absolute)).replaceAll("\\", "/");
    if (actual === ".." || actual.startsWith("../") || isAbsolute(actual)) { result.problems.push(`Changed file escapes the repository: ${file}`); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(file)) {
      entry.lint = entry.typecheck = { status: "excluded", reason: "Not JavaScript/TypeScript; use the existing affected gates and test selection." };
      if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) {
        try {
          const parsed = loadProject(file);
          if (parsed.errors.length) throw new Error(parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; "));
          entry.typecheck = { status: execute ? "checked" : "configured", project: file, reason: "TypeScript configuration/options/global checks only; no full-project semantic acceptance." };
          if (!groups.has(file)) groups.set(file, []);
        } catch (error) { result.problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      continue;
    }
    if (!/^(?:src|server|scripts|ops|e2e|packages)\//.test(file) && file.includes("/")) {
      result.problems.push(`Unsupported code family: ${file}`); continue;
    }
    entry.testSuiteCandidate = file.startsWith("src/") ? "frontend" : file.startsWith("server/") ? "server"
      : /^(?:scripts|ops)\//.test(file) ? "scripts" : file.startsWith("packages/") ? "bridge"
      : file.startsWith("e2e/quality/") ? "quality" : file.startsWith("e2e/") ? "acceptance" : null;
    try {
      const configPath = await eslint.findConfigFile(absolute);
      const config = await eslint.calculateConfigForFile(absolute);
      const rules = Object.values(config?.rules ?? {}).filter((rule) => (Array.isArray(rule) ? rule[0] : rule) !== 0).length;
      if (!configPath || !config || !rules || await eslint.isPathIgnored(absolute)) throw new Error("No applicable ESLint rules (ignored or uncovered).");
      if (relative(root, configPath).startsWith("..")) throw new Error("ESLint configuration is outside the repository.");
      entry.lint = { status: execute ? "checked" : "configured", config: relative(root, configPath), rules };
      if (execute) for (const lint of await eslint.lintFiles([absolute])) {
        for (const message of lint.messages.filter((item) => item.severity === 2 || item.fatal)) {
          result.problems.push(`${file}:${message.line ?? 0} ESLint ${message.ruleId ?? "parse"}: ${message.message}`);
        }
      }
    } catch (error) { result.problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
    if (!/\.tsx?$/.test(file)) {
      entry.typecheck = { status: "excluded", reason: "JavaScript is linted; existing TypeScript projects do not enable checkJs." };
      continue;
    }
    const candidates = file.startsWith("src/") ? (/\.(?:test|spec)\.tsx?$/.test(file) ? ["tsconfig.tests.browser.json"] : ["tsconfig.app.json", "tsconfig.tests.browser.json"])
      : file.startsWith("e2e/") || /^playwright[^/]*\.ts$/.test(file) ? ["tsconfig.tests.browser.json"]
      : file.startsWith("packages/") ? [`${file.split("/").slice(0, 2).join("/")}/tsconfig.json`, "tsconfig.tests.node.json"]
      : /\.(?:test|spec)\.tsx?$/.test(file) ? ["tsconfig.tests.node.json"] : ["tsconfig.node.json", "tsconfig.tests.node.json"];
    try {
      for (const name of candidates) {
        if (!existsSync(resolve(root, name))) continue;
        const parsed = loadProject(name);
        const errors = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003); // An empty nonselected project may fall through to the test project.
        if (errors.length) throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; "));
        if (!parsed.fileNames.some((input) => resolve(input) === absolute)) continue;
        entry.typecheck = { status: execute ? "checked" : "configured", project: name };
        groups.set(name, [...(groups.get(name) ?? []), absolute]);
        break;
      }
      if (!entry.typecheck.project) throw new Error("No TypeScript project includes this changed file.");
    } catch (error) { result.problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (execute) for (const [name, files] of groups) {
    const project = projects.get(name)!;
    for (const type of project.options.types ?? []) {
      if (!ts.resolveTypeReferenceDirective(type, resolve(root, name), project.options, ts.sys).resolvedTypeReferenceDirective) {
        result.problems.push(`${name}: TypeScript cannot resolve configured type library: ${type}`);
      }
    }
    const program = ts.createProgram({ rootNames: [...files, ...project.fileNames.filter((file) => file.endsWith(".d.ts"))], options: { ...project.options, incremental: false, composite: false, noEmit: true } });
    const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
    for (const file of files) {
      const source = program.getSourceFile(file);
      if (!source) { result.problems.push(`TypeScript did not load selected file: ${relative(root, file)}`); continue; }
      diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source));
    }
    for (const diagnostic of diagnostics) result.problems.push(`${diagnostic.file ? relative(root, resolve(diagnostic.file.fileName)) : name}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  const applicable = result.files.some((file) => [file.lint.status, file.typecheck.status].some((status) => status === "checked" || status === "configured"));
  result.status = result.problems.length ? "failed" : !applicable ? "not-applicable" : execute ? "passed" : "selected";
  result.durationMs = Math.round(performance.now() - started);
  return result;
}

/** Shared native change range for lint coverage and existing impact selection. */
export function readStaticChanges(root = process.cwd(), base = "HEAD") {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const revision = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
  const paths = [...new Set([
    ...git(["diff", "--name-only", "--no-renames", "-z", revision, "--"]).split("\0"),
    ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
  ].filter(Boolean))].sort();
  const deletedPaths = git(["diff", "--name-only", "--no-renames", "--diff-filter=D", "-z", revision, "--"]).split("\0").filter(Boolean);
  return { base: revision, paths, deletedPaths };
}
