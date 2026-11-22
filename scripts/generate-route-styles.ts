import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { resolveConfig } from "vite";

const output = "src/app/routeStyles.generated.ts";

// The split moved these declarations. Visit them before their former next
// runtime import so the existing cascade matches the static page graph.
const formerPositions: Record<string, Record<string, string[]>> = {
  "src/App.tsx": {
    "@/application/debugging/debuggingRuntime": ["@/DebuggingAdminPage"],
    "@/infrastructure/http/organizationScope": ["@/features/organization/InvitationAcceptancePage"],
  },
  "src/app/routes.tsx": {
    "@/domain/users/types": ["@/AuditCenterPage"],
    "@/domain/dtsReload/handoff": [
      "@/linear-template/LinearTemplateHome",
      "@/features/log-analysis/LogsPage",
      "@/features/parameter-review/ParameterChangesPage",
      "@/LogAdminPage",
      "@/features/log-skills/SkillWorkspace",
      "@/NodeDebuggingPage",
      "@/ParameterAdminNextPage",
      "@/features/parameter-home/ParameterHomePage",
      "@/features/product-feedback/FeedbackAdminPage",
      "@/features/product-feedback/FeedbackCenterPage",
      "@/features/knowledge/KnowledgeAdminPage",
      "@/features/knowledge/KnowledgePage",
    ],
    "@/components/layout/RetiredNotice": [
      "@/features/dts-reload/DtsReloadPage",
      "@/ParametersPage",
      "@/OrganizationPage",
      "@/features/organization/OrganizationWorkspace",
    ],
    "@/application/parameters/parameterModuleRegistryResolve": ["@/features/parameter-catalog/CatalogPage"],
    "@/components/layout/WorkflowPublicationNotice": [
      "@/features/workflow-publication/WorkflowPublicationPage",
      "@/features/organization/PlatformOrganizationsPage",
    ],
  },
};

function staticSpecifier(statement: ts.Statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
      && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly))) return;
    return statement.moduleSpecifier;
  }
  if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause) && clause.elements.length > 0
      && clause.elements.every((element) => element.isTypeOnly)) return;
    return statement.moduleSpecifier;
  }
}

function lazySpecifier(statement: ts.Statement) {
  if (!ts.isVariableStatement(statement)) return;
  const initializer = statement.declarationList.declarations[0]?.initializer;
  if (!initializer || !ts.isCallExpression(initializer) || initializer.expression.getText() !== "lazy") return;
  const callback = initializer.arguments[0];
  if (!callback || !ts.isArrowFunction(callback) || !ts.isCallExpression(callback.body)) return;
  const expression = callback.body.expression;
  const loader = ts.isPropertyAccessExpression(expression) ? expression.expression : callback.body;
  if (ts.isCallExpression(loader) && loader.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return loader.arguments[0];
  }
}

async function generate() {
  const config = await resolveConfig({}, "build", "production");
  const resolveId = config.createResolver();
  const outputId = resolve(output);
  const sourceRoot = resolve("src") + "/";
  const seen = new Set([outputId]);
  const styles: string[] = [];

  async function visit(id: string, specifier?: string) {
    if (!isAbsolute(id) || seen.has(id)) return;
    seen.add(id);
    if (id.endsWith(".css")) {
      const importPath = id.startsWith(sourceRoot)
        ? "@/" + id.slice(sourceRoot.length)
        : specifier && await resolveId(specifier, outputId) === id
          ? specifier
          : relative(resolve("src/app"), id);
      styles.push(importPath);
      return;
    }
    if (!/\.[cm]?[jt]sx?$/.test(id)) return;

    const source = ts.createSourceFile(id, readFileSync(id, "utf8"), ts.ScriptTarget.Latest, true);
    const positions = formerPositions[id.slice(config.root.length + 1)];
    const lazy = new Set(positions && source.statements.flatMap((statement) => {
      const specifier = lazySpecifier(statement);
      return specifier && ts.isStringLiteral(specifier) ? [specifier.text] : [];
    }));
    const relocated = new Set<string>();

    async function follow(specifier: string) {
      if (id === resolve("src/main.tsx") && specifier === "./app/routeStyles.generated") return;
      const dependency = await resolveId(specifier, id);
      if (!dependency) {
        throw new Error(`Cannot resolve ${specifier} from ${id}`);
      }
      await visit(dependency, specifier);
    }

    for (const statement of source.statements) {
      const specifier = staticSpecifier(statement) ?? (positions && lazySpecifier(statement));
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      for (const page of positions?.[specifier.text] ?? []) {
        if (lazy.has(page)) {
          relocated.add(page);
          await follow(page);
        }
      }
      if (!relocated.has(specifier.text)) await follow(specifier.text);
    }
  }

  await visit(resolve("src/main.tsx"));
  return [
    "// Generated by npm run styles:routes. Run that command after changing stylesheet imports.",
    ...styles.map((specifier) => `import ${JSON.stringify(specifier)};`),
    "",
  ].join("\n");
}

const generated = await generate();
if (process.argv.includes("--check")) {
  if (!existsSync(output) || readFileSync(output, "utf8") !== generated) {
    console.error(`${output} is stale. Run npm run styles:routes and commit the result.`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, generated);
}
