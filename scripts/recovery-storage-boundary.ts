import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

type Ownership = "check" | "execution" | "test" | "data";
const storage = "ops/self-hosted/storage/";
const externalDependencies = new Set([
  "node:buffer", "node:child_process", "node:crypto", "node:fs", "node:fs/promises",
  "node:os", "node:path", "node:timers/promises", "node:url", "pg",
]);
const supportModules = new Set([
  "ops/self-hosted/scripts/ip-lab-profile.ts",
  "ops/self-hosted/scripts/parameter-catalog-upgrade/bindingJournal.ts",
  "ops/self-hosted/scripts/parameter-catalog-upgrade/handoff.ts",
  "ops/self-hosted/scripts/parameter-catalog-upgrade/journal.ts",
  "ops/self-hosted/scripts/parameter-catalog-upgrade/managementJournal.ts",
  "ops/self-hosted/scripts/parameter-catalog-upgrade/stateMachine.ts",
  "scripts/isolated-upgrade-docker.ts", "scripts/run-m5-smoke.shared.ts",
  "server/config/xiaozeLlmConfig.ts", "server/modules/logs/objectStore.ts", "server/modules/logs/s3ObjectStore.ts",
]);
/** Explicit versioned ownership: adding files is a contract change, not an
 * automatic exemption. Check modules may not load test or execution modules. */
export const RECOVERY_STORAGE_OWNERSHIP: Readonly<Record<string, Ownership>> = Object.freeze({
  "scripts/run-restore-drill.ts": "check",
  [`${storage}recoveryPoint.ts`]: "check",
  [`${storage}threatMatrix.ts`]: "check",
  [`${storage}recoveryPackage.ts`]: "check",
  [`${storage}controlledRecovery.ts`]: "check",
  [`${storage}controlledRecovery.docker.ts`]: "check",
  [`${storage}dockerAccess.ts`]: "check",
  [`${storage}execution/packageRestore.ts`]: "execution",
  [`${storage}execution/controlledRestore.ts`]: "execution",
  [`${storage}execution/dockerRestore.ts`]: "execution",
  [`${storage}execution/authorization.ts`]: "execution",
  [`${storage}execution/authorization.test.ts`]: "test",
  [`${storage}execution/authorization.fixture.ts`]: "test",
  [`${storage}execution/README.md`]: "data",
  [`${storage}execution/README.zh-CN.md`]: "data",
  [`${storage}controlledRecovery.docker.integration.test.ts`]: "test",
  [`${storage}controlledRecovery.test.ts`]: "test",
  [`${storage}recoveryPackage.test.ts`]: "test",
  [`${storage}README.md`]: "data",
  [`${storage}README.zh-CN.md`]: "data",
  [`${storage}provider-decision.md`]: "data",
  [`${storage}provider-decision.zh-CN.md`]: "data",
  [`${storage}object-store.env.example`]: "data",
});

const resolveLocal = (file: string, name: string, sources: Readonly<Record<string, string>>) => {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
  return [base, ...[".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"].map(s => base + s)]
    .find(candidate => Object.hasOwn(sources, candidate));
};
const constant = (node: ts.Node): string | undefined => {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constant(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constant(node.left), right = constant(node.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const part of node.templateSpans) { const text = constant(part.expression); if (text === undefined) return undefined; value += text + part.literal.text; }
    return value;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join"
    && ts.isArrayLiteralExpression(node.expression.expression) && node.arguments.length <= 1) {
    const separator = node.arguments.length ? constant(node.arguments[0]) : ",";
    const parts = node.expression.expression.elements.map(constant);
    if (separator !== undefined && parts.every(part => part !== undefined)) return parts.join(separator);
  }
  return undefined;
};
const dependencies = (file: string, source: string, report: (reason: string) => void): string[] => {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const module = (node: ts.Node | undefined) => {
    const name = node && constant(node);
    if (name === undefined) report(`dynamic-code:${file}`); else imports.push(name);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
      if (!typeOnly && node.moduleSpecifier) module(node.moduleSpecifier);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) module(node.moduleReference.expression);
      else report(`dynamic-code:${file}`);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) module(node.arguments[0]);
    if (ts.isIdentifier(node) && ["eval", "Function", "require"].includes(node.text)) {
      if (node.text !== "require" || !ts.isCallExpression(node.parent) || node.parent.expression !== node) report(`dynamic-code:${file}`);
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)
      && ["globalThis", "global", "window", "self"].includes(node.expression.text)) {
      const name = constant(node.argumentExpression);
      if (name === undefined || ["eval", "Function", "require"].includes(name)) report(`dynamic-code:${file}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "constructor") report(`dynamic-code:${file}`);
    // Capture's exposed command seam must spell a fixed executable. The shared
    // transport's argv forwarding remains a separately registered observation
    // module; arbitrary strings cannot enter through a capture caller.
    if (file === `${storage}controlledRecovery.docker.ts` && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "exec") {
      const args = node.arguments[1];
      if (!args || !ts.isArrayLiteralExpression(args) || !args.elements[0] || constant(args.elements[0]) !== "pg_dump") report(`unbounded-capture-command:${file}`);
    }
    const text = constant(node);
    if (text !== undefined && /pg_restore\b|DROP\s+DATABASE|FLUSHALL\b/i.test(text)) report(`restore-effect:${file}`);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return imports;
};

export function checkRecoveryStorageBoundary(sources: Readonly<Record<string, string>>, ownership: Readonly<Record<string, Ownership>> = RECOVERY_STORAGE_OWNERSHIP): string[] {
  const errors = new Set<string>();
  for (const file of Object.keys(sources)) if (file.startsWith(storage) && !ownership[file]) errors.add(`unregistered:${file}`);
  for (const file of Object.keys(ownership)) if (!Object.hasOwn(sources, file)) errors.add(`missing:${file}`);
  for (const [file, layer] of Object.entries(ownership)) {
    if (layer === "data" && /\.(?:[cm]?[jt]sx?|sh|bash|py|wasm|node)$/i.test(file)) errors.add(`executable-data:${file}`);
  }
  for (const [root, layer] of Object.entries(ownership)) {
    if ((layer !== "check" && layer !== "execution") || !Object.hasOwn(sources, root)) continue;
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return; visited.add(file);
      if (!ownership[file] && !supportModules.has(file)) errors.add(`unregistered-local:${file}`);
      if (layer === "check" && ownership[file] === "execution") { errors.add(`execution-dependency:${root}:${file}`); return; }
      if (ownership[file] === "test" || /\.test\.[cm]?[jt]sx?$/.test(file)) { errors.add(`test-dependency:${root}:${file}`); return; }
      if (ownership[file] === "data") { errors.add(`data-dependency:${root}:${file}`); return; }
      for (const name of dependencies(file, sources[file], reason => {
        if (layer !== "execution" || !reason.startsWith("restore-effect:")) errors.add(reason);
      })) {
        if (!name.startsWith(".")) {
          if (!externalDependencies.has(name)) errors.add(`unapproved-external:${file}:${name}`);
          continue;
        }
        const dependency = resolveLocal(file, name, sources);
        if (!dependency) errors.add(`unresolved-dependency:${file}:${name}`); else visit(dependency);
      }
    };
    visit(root);
  }
  return [...errors].sort();
}

/** Only reads sources. Runtime imports are never evaluated by the boundary test. */
export function readRecoveryBoundarySources(root = process.cwd()): Record<string, string> {
  const sources: Record<string, string> = {};
  const read = (file: string) => {
    if (Object.hasOwn(sources, file)) return;
    sources[file] = readFileSync(path.join(root, file), "utf8");
    if (!/\.[cm]?[jt]sx?$/.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file)) return;
    for (const name of dependencies(file, sources[file], () => {})) {
      if (!name.startsWith(".")) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
      const found = [base, ...[".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"].map(s => base + s)]
        .find(candidate => existsSync(path.join(root, candidate)) && statSync(path.join(root, candidate)).isFile());
      if (found) read(found);
    }
  };
  const walk = (directory: string) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = directory + "/" + entry.name;
      if (entry.isDirectory()) walk(file); else read(file);
    }
  };
  walk(storage.slice(0, -1));
  for (const file of Object.keys(RECOVERY_STORAGE_OWNERSHIP)) if (!file.startsWith(storage) && existsSync(path.join(root, file))) read(file);
  return sources;
}
