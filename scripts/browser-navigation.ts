import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import * as ts from "typescript";
import { acceptanceOperations } from "../e2e/acceptance/operationMatrix";
import { qualityRoutePaths } from "../e2e/quality/route-ownership";

export type BrowserInventory = Record<string, readonly string[] | null>;
export const unresolvedBrowserNavigation: Readonly<Record<string, string>> = {};

type Value = string | Value[] | { [key: string]: Value };
type Bindings = Map<string, Value>;
type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

export function discoverBrowserInventory(root: string, allowlist = unresolvedBrowserNavigation): BrowserInventory {
  const modules = new Map<string, { source: ts.SourceFile; declarations: Map<string, ts.Node[]>; imports: Map<string, [string, string]> }>();
  const dependency = (file: string, name: string) => {
    const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(file), name);
    return [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find((path) => /\.[jt]sx?$/.test(path) && existsSync(path));
  };
  const load = (file: string) => {
    const cached = modules.get(file);
    if (cached) return cached;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = new Map<string, ts.Node[]>();
    const imports = new Map<string, [string, string]>();
    const collect = (node: ts.Node) => {
      if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        declarations.set(node.name.text, [...(declarations.get(node.name.text) ?? []), node]);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        const target = (name.startsWith(".") || name.startsWith("@/")) && dependency(file, name);
        const bindings = node.importClause?.namedBindings;
        if (target && bindings && ts.isNamedImports(bindings)) {
          for (const imported of bindings.elements) imports.set(imported.name.text, [target, imported.propertyName?.text ?? imported.name.text]);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    const module = { source, declarations, imports };
    modules.set(file, module);
    return module;
  };
  const declaration = (name: string, at: ts.Node, seen = new Set<string>()): ts.Node | undefined => {
    const file = at.getSourceFile().fileName;
    const key = `${file}:${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = load(file);
    const imported = module.imports.get(name);
    if (imported) return declaration(imported[1], load(imported[0]).source, seen);
    return module.declarations.get(name)?.filter((node) => {
      let scope = node.parent;
      while (!ts.isSourceFile(scope) && !ts.isBlock(scope)) scope = scope.parent;
      return ts.isSourceFile(at) || (scope.pos <= at.pos && scope.end >= at.end);
    }).sort((left, right) => right.pos - left.pos)[0];
  };
  const strings = (value: Value): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : [];
  const property = (value: Value, name: string): Value => Array.isArray(value) ? value.map((item) => property(item, name))
    : typeof value === "object" ? value[name] ?? "*" : "*";
  const functionFor = (node: ts.Node): FunctionNode | undefined => {
    if (!ts.isIdentifier(node)) return undefined;
    const target = declaration(node.text, node);
    if (target && ts.isFunctionDeclaration(target)) return target;
    if (target && ts.isVariableDeclaration(target) && target.initializer
      && (ts.isArrowFunction(target.initializer) || ts.isFunctionExpression(target.initializer))) return target.initializer;
    return undefined;
  };
  const parameters = (target: FunctionNode, args: readonly ts.Expression[], bindings: Bindings): Bindings => {
    const values: Bindings = new Map();
    target.parameters.forEach((parameter, index) => {
      if (ts.isIdentifier(parameter.name)) values.set(parameter.name.text, args[index] ? valueOf(args[index], bindings)
        : parameter.initializer ? valueOf(parameter.initializer, values) : "*");
    });
    return values;
  };
  const valueOf = (node: ts.Node | undefined, bindings: Bindings, seen = new Set<ts.Node>()): Value => {
    if (!node || seen.has(node)) return "*";
    seen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isRegularExpressionLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) {
      if (bindings.has(node.text)) return bindings.get(node.text)!;
      const target = declaration(node.text, node);
      if (target && ts.isVariableDeclaration(target)) {
        if (target.initializer) return valueOf(target.initializer, bindings, seen);
        if (ts.isVariableDeclarationList(target.parent) && ts.isForOfStatement(target.parent.parent)) return valueOf(target.parent.parent.expression, bindings, seen);
      }
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => valueOf(item, bindings, seen));
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment)
      .map((item) => [item.name.getText().replace(/^["']|["']$/g, ""), valueOf(item.initializer, bindings, seen)]));
    if (ts.isPropertyAccessExpression(node)) {
      if (/^(?:id|frontendUrl|frontendOrigin|baseURL)$/.test(node.name.text)) return "*";
      return property(valueOf(node.expression, bindings, seen), node.name.text);
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node)) return valueOf(node.expression, bindings, seen);
    if (ts.isConditionalExpression(node)) return [valueOf(node.whenTrue, bindings, seen), valueOf(node.whenFalse, bindings, seen)];
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text];
      for (const span of node.templateSpans) values = values.flatMap((prefix) => strings(valueOf(span.expression, bindings, seen)).map((value) => `${prefix}${value}${span.literal.text}`));
      return values;
    }
    if (ts.isBinaryExpression(node)) {
      const left = valueOf(node.left, bindings, seen);
      const right = valueOf(node.right, bindings, seen);
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return strings(left).flatMap((prefix) => strings(right).map((suffix) => prefix + suffix));
      if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [left, right];
    }
    if (ts.isNewExpression(node) && node.expression.getText() === "URL") return valueOf(node.arguments?.[0], bindings, seen);
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "url" && /page$/i.test(node.expression.expression.getText())) return "@current-url";
        if (["toString", "replace", "replaceAll", "trim", "first", "last", "nth"].includes(method)) return valueOf(node.expression.expression, bindings, seen);
      }
      const target = functionFor(node.expression);
      if (target?.body) {
        const values = parameters(target, node.arguments, bindings);
        if (!ts.isBlock(target.body)) return valueOf(target.body, values, seen);
        const returns: Value[] = [];
        const collect = (child: ts.Node) => {
          if (ts.isReturnStatement(child)) returns.push(valueOf(child.expression, values, seen));
          else if (!ts.isFunctionDeclaration(child) && !ts.isArrowFunction(child) && !ts.isFunctionExpression(child)) ts.forEachChild(child, collect);
        };
        collect(target.body);
        return returns.length ? returns : "*";
      }
    }
    return "*";
  };
  const navLabels = new Map<string, string[]>();
  const appConfig = resolve(root, "src/appConfig.ts");
  if (existsSync(appConfig)) {
    for (const name of ["navigationItems", "utilityItems"]) {
      const target = declaration(name, load(appConfig).source);
      if (target && ts.isVariableDeclaration(target)) {
        const items = valueOf(target.initializer, new Map());
        if (Array.isArray(items)) for (const item of items) {
          for (const label of strings(property(item, "label"))) navLabels.set(label, strings(property(item, "path")));
        }
      }
    }
  }
  const navigationFunctions = new Map<FunctionNode, boolean>();
  const navigates = (target: FunctionNode, seen = new Set<FunctionNode>()): boolean => {
    const cached = navigationFunctions.get(target);
    if (cached !== undefined) return cached;
    if (!target.body || seen.has(target) || !target.getSourceFile().fileName.startsWith(resolve(root, "e2e"))) return false;
    seen = new Set(seen).add(target);
    let result = false;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && ["goto", "click"].includes(node.expression.name.text)) result = true;
        else {
          const called = functionFor(node.expression);
          if (called && navigates(called, seen)) result = true;
        }
      }
      if (!result) ts.forEachChild(node, visit);
    };
    visit(target.body);
    navigationFunctions.set(target, result);
    return result;
  };
  const inventory: BrowserInventory = {};
  const unresolved = new Map<string, string[]>();
  const directory = resolve(root, "e2e/acceptance");
  for (const filename of readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".spec.ts"))) {
    const spec = `e2e/acceptance/${filename}`;
    const routes = new Set<string>();
    const unknown = new Set<string>();
    const active = new Set<FunctionNode>();
    const add = (value: string) => {
      if (value === "@current-url" || value === "about:blank") return;
      const path = value.replace(/^\*+(?=\/)/, "").replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0]
        .replace(/(\/projects\/)[^/]+(?=\/|$)/, "$1aurora");
      if (!path.startsWith("/") || path.startsWith("/*")) return;
      const pattern = new RegExp(`^${path.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
      const matches = qualityRoutePaths.filter((route) => pattern.test(route));
      const ancestor = qualityRoutePaths.filter((route) => path.startsWith(`${route}/`)).sort((left, right) => right.length - left.length)[0];
      for (const route of matches.length ? matches : ancestor ? [ancestor] : []) routes.add(route);
    };
    for (const operation of acceptanceOperations.filter((operation) => operation.specFiles.includes(spec))) add(operation.route);
    const addLabel = (label: string) => {
      const expression = /^\/(.*)\/([a-z]*)$/.exec(label);
      const pattern = expression ? new RegExp(expression[1], expression[2].replace(/[gy]/g, "")) : undefined;
      for (const [name, paths] of navLabels) if (pattern ? pattern.test(name) : name === label) for (const path of paths) add(path);
    };
    const clickLabels = (node: ts.Node, bindings: Bindings) => {
      if (ts.isIdentifier(node)) {
        const target = declaration(node.text, node);
        if (target && ts.isVariableDeclaration(target) && target.initializer) clickLabels(target.initializer, bindings);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "getByRole" && ["button", "link", "menuitem"].includes(strings(valueOf(node.arguments[0], bindings))[0])) {
          for (const label of strings(property(valueOf(node.arguments[1], bindings), "name"))) addLabel(label);
        } else if (method === "getByText") {
          for (const label of strings(valueOf(node.arguments[0], bindings))) addLabel(label);
        } else clickLabels(node.expression.expression, bindings);
      }
    };
    const scan = (node: ts.Node, bindings: Bindings) => {
      if (ts.isFunctionDeclaration(node) || (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))) return;
      if (node.getSourceFile().fileName === resolve(root, spec)) {
        if (ts.isStringLiteralLike(node)) add(node.text);
        if (ts.isTemplateExpression(node)) for (const value of strings(valueOf(node, bindings))) add(value);
      }
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "goto") {
          const values = strings(valueOf(node.arguments[0], bindings));
          if (!values.length || values.some((value) => value === "*" || /^\**\/\*/.test(value) || !/^(?:\**\/|https?:\/\/|about:blank|@current-url)/.test(value))) {
            unknown.add(`${relative(root, node.getSourceFile().fileName)}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.arguments[0]?.getText() ?? "missing destination"}`);
          }
          for (const value of values) add(value);
        } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "click") clickLabels(node.expression.expression, bindings);
        else {
          const target = functionFor(node.expression);
          if (target?.body && !active.has(target) && navigates(target)) {
            active.add(target);
            scan(target.body, parameters(target, node.arguments, bindings));
            active.delete(target);
          }
        }
      }
      ts.forEachChild(node, (child) => scan(child, bindings));
    };
    scan(load(resolve(root, spec)).source, new Map());
    if (unknown.size) unresolved.set(spec, [...unknown]);
    inventory[spec] = unknown.size ? null : [...routes].sort();
  }
  const unexpected = [...unresolved].filter(([spec]) => !allowlist[spec]);
  if (unexpected.length) throw new Error(`Unresolved browser navigation requires an explicit reasoned allow-list entry:\n${unexpected.map(([spec, details]) => `${spec}: ${details.join("; ")}`).join("\n")}`);
  if (Object.keys(allowlist).length > 5) throw new Error("Unresolved browser navigation allow-list exceeds 5 specs");
  for (const [spec, reason] of Object.entries(allowlist)) {
    if (!reason.trim() || !unresolved.has(spec)) throw new Error(`Stale or unreasoned unresolved browser navigation entry: ${spec}`);
  }
  return inventory;
}
