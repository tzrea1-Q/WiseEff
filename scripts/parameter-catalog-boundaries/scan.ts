import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import * as ts from "typescript";
import { legacyLookupIdentifierTypes, legacyMappingSourceKinds } from "../../server/modules/parameter-catalog-contract/index";
import { consumerShardDefinitions, type ConsumerFamilyId } from "./families";

export type BoundaryRuleId = keyof typeof reasons;
export type BoundaryViolation = {
  family: ConsumerFamilyId;
  rule: BoundaryRuleId;
  file: string;
  line: number;
  column: number;
  evidence: string;
  reason: string;
};

const legacyCatalogTables = [
  "attribution_subjects",
  "driver_registration_placements",
  "driver_registrations",
  "driver_schema_overlay_promotions",
  "driver_schema_overlay_properties",
  "driver_schema_overlays",
  "driver_schema_versions",
  "driver_schemas",
  "dts_property_specs",
  "node_type_definitions",
  "parameter_definition_reconciliation_items",
  "parameter_definition_reconciliation_runs",
  "parameter_definitions",
  "parameter_module_dismissed_compatibles",
  "parameter_module_mappings",
  "parameter_modules",
  "parameter_spec_matcher_overrides",
  "parameter_spec_property_key_cutover_items",
  "parameter_spec_property_key_cutover_runs",
  "parameter_spec_review_tasks",
  "parameter_spec_version_cutover_items",
  "parameter_spec_version_cutover_runs",
  "parameter_spec_versions",
  "parameter_specs",
  "project_parameter_binding_revisions",
  "project_parameter_bindings",
] as const;

export const canonicalCatalogRelations = [
  "parameter_catalog.catalog_releases",
  "parameter_catalog.catalog_subjects",
  "parameter_catalog.catalog_drivers",
  "parameter_catalog.catalog_node_types",
  "parameter_catalog.catalog_release_subjects",
  "parameter_catalog.catalog_subject_aliases",
  "parameter_catalog.catalog_release_subject_aliases",
  "parameter_catalog.parameter_definitions",
  "parameter_catalog.definition_revisions",
  "parameter_catalog.catalog_release_definition_heads",
  "parameter_catalog.catalog_materializations",
  "parameter_catalog.catalog_state",
  "parameter_catalog.project_parameter_bindings",
  "parameter_catalog.project_parameter_values",
  "parameter_catalog.binding_history_events",
  "parameter_catalog.legacy_identities",
  "parameter_catalog.parameter_catalog_cutover_runs",
  "parameter_catalog.parameter_catalog_cutover_events",
  "parameter_catalog.parameter_catalog_cutover_checkpoints",
  "parameter_catalog.parameter_catalog_archives",
  "parameter_catalog.legacy_mapping_versions",
  "parameter_catalog.legacy_mapping_heads",
  "parameter_catalog.parameter_catalog_classification_ledger",
  "parameter_catalog.parameter_catalog_comparison_cases",
  "parameter_catalog.parameter_catalog_comparison_results",
  "parameter_catalog.catalog_command_idempotency",
  "parameter_catalog.organization_subject_registrations",
  "parameter_catalog.subject_placements",
  "parameter_catalog.parameter_observations",
  "parameter_catalog.parameter_review_evidence",
  "parameter_catalog.parameter_review_items",
  "parameter_catalog.definition_proposals",
  "parameter_catalog.definition_proposal_revisions",
  "parameter_catalog.catalog_publication_intents",
  "parameter_catalog.parameter_review_resolutions",
  "parameter_catalog.governance_command_idempotency",
  "parameter_catalog.parameter_observation_matches",
] as const;

export const publicationCatalogRelations = [
  "parameter_catalog.catalog_activation_receipts",
  "catalog_publication.release_artifacts",
  "catalog_publication.candidates",
  "catalog_publication.publication_authorizations",
  "catalog_publication.publication_jobs",
  "catalog_publication.publication_policies",
  "catalog_publication.publication_policy_revisions",
  "catalog_publication.publication_guard",
] as const;

export const legacyCatalogLookupKinds = legacyLookupIdentifierTypes;
export const legacyCatalogMappingSourceKinds = legacyMappingSourceKinds;

const legacyRouteFragments = [
  "/api/v2/parameter-specs",
  "/api/v2/parameter-spec-review-tasks",
  "/api/v2/organization-driver-schemas",
  "/api/v2/platform/driver-schemas",
  "/api/v2/identity-mapping-tasks",
  "/api/v2/parameter-modules",
  "/api/v1/knowledge/related-to-spec",
  "/parameter-references/:specId",
  "/api/v1/debugging/reload-targets",
  "/api/v1/debugging/parameters/reload",
] as const;

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"]);
const parameterSpecIdentifier = /^(?:parameterSpec(?:Version)?Ids?|parameter_spec(?:_version)?_ids?)$/u;
const effectiveGovernanceIdentifier =
  /(?:effective.*(?:catalog|definition|parameterSpec)|(?:catalog|definition|parameterSpec).*effective|governance.*parameterSpec|parameterSpec.*governance)/iu;
const overlayContractIdentifier = /(?:DriverSchemaOverlay|OrganizationDriverSchema)/u;
const legacyModuleImport = /(?:^|\/)parameter-specs(?:\/|$)/u;
const protectedCatalogModuleRoot =
  /(?:^|\/)(?:catalog-kernel|parameter-catalog-contract|parameter-governance|catalog-cutover)(?:\/|$)/u;

export const reasons = {
  "legacy-catalog-sql-write": "Legacy Catalog SQL writer remains pending the owning consumer migration.",
  "legacy-catalog-raw-read": "Direct legacy Catalog table read remains pending the owning consumer migration.",
  "canonical-catalog-raw-access": "Consumer code must use the typed Catalog seam instead of a raw canonical Catalog table.",
  "legacy-catalog-table-name": "Legacy Catalog table identity remains embedded outside an explicit SQL statement.",
  "legacy-parameter-spec-identifier": "Legacy parameterSpecId identity remains pending canonical Definition or Binding adaptation.",
  "legacy-catalog-module-import": "Consumer code still imports the legacy parameter-specs module.",
  "forbidden-catalog-internal-import": "Consumer code reaches a private Catalog, Governance, or Cutover implementation package.",
  "legacy-catalog-route": "Legacy structural Catalog or governance route remains pending retirement or exact adaptation.",
  "legacy-effective-governance-contract": "Legacy Effective or Governance catalog projection remains in a consumer contract.",
  "legacy-overlay-catalog-contract": "Legacy driver-schema overlay authoring contract remains reachable.",
  "unresolved-boundary-expression": "A database, route, or module-loader boundary expression cannot be resolved statically.",
};

export function scanSourceFile(family: ConsumerFamilyId, file: string, source: string): BoundaryViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const candidates: BoundaryViolation[] = [];
  const constantBindings = collectUniqueConstantBindings(sourceFile);
  const moduleLoaderAliases = collectModuleLoaderAliases(constantBindings);
  const boundaryAliases = collectBoundaryAliases(sourceFile, constantBindings);

  const add = (rule: BoundaryRuleId, node: ts.Node, evidence: string) => {
    const start = node.getStart(sourceFile, false);
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    candidates.push({
      family,
      rule,
      file,
      line: position.line + 1,
      column: position.character + 1,
      evidence: boundedEvidence(evidence),
      reason: reasons[rule],
    });
  };

  const scanModuleSpecifier = (modulePath: string, node: ts.Node) => {
    if (legacyModuleImport.test(modulePath)) {
      add("legacy-catalog-module-import", node, modulePath);
    }
    if (isForbiddenCatalogModuleImport(modulePath)) {
      add("forbidden-catalog-internal-import", node, modulePath);
    }
  };

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      scanModuleSpecifier(node.moduleSpecifier.text, node);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      scanModuleSpecifier(node.moduleReference.expression.text, node);
    } else if (
      ts.isCallExpression(node) &&
      isModuleLoaderCall(node, moduleLoaderAliases) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      scanModuleSpecifier(node.arguments[0].text, node);
    }

    if (ts.isCallExpression(node)) {
      const unresolvedReceiver = unresolvedBoundaryReceiver(node);
      if (unresolvedReceiver) {
        add(
          "unresolved-boundary-expression",
          unresolvedReceiver.expression,
          `${unresolvedReceiver.kind}-receiver: ${normalizeText(unresolvedReceiver.expression.getText(sourceFile))}`,
        );
      }
    }

    if (ts.isCallExpression(node) && node.arguments[0]) {
      const argument = node.arguments[0];
      if (isModuleLoaderCall(node, moduleLoaderAliases) && !ts.isStringLiteral(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanModuleSpecifier(evaluated.text, argument);
        } else {
          add(
            "unresolved-boundary-expression",
            argument,
            `module-loader: ${normalizeText(argument.getText(sourceFile))}`,
          );
        }
      } else if (isDatabaseStringCall(node, boundaryAliases) && !isStringNode(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanStringValue(argument, evaluated.text, add);
        } else {
          add(
            "unresolved-boundary-expression",
            argument,
            `database: ${normalizeText(argument.getText(sourceFile))}`,
          );
        }
      } else if (isRouteRegistrationCall(node, boundaryAliases) && !isStringNode(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanStringValue(argument, evaluated.text, add);
        } else {
          add(
            "unresolved-boundary-expression",
            argument,
            `route: ${normalizeText(argument.getText(sourceFile))}`,
          );
        }
      }
    }

    if (ts.isIdentifier(node)) {
      if (parameterSpecIdentifier.test(node.text)) {
        add("legacy-parameter-spec-identifier", node, node.text);
      }
      if (effectiveGovernanceIdentifier.test(node.text)) {
        add("legacy-effective-governance-contract", node, node.text);
      }
      if (overlayContractIdentifier.test(node.text)) {
        add("legacy-overlay-catalog-contract", node, node.text);
      }
    }

    if (isStringNode(node)) {
      const text = stringNodeText(node);
      scanStringValue(node, text, add);
      if (isLegacyIdentityKeyContext(node) && parameterSpecIdentifier.test(text)) {
        add("legacy-parameter-spec-identifier", node, text);
      }
    } else if (ts.isTemplateExpression(node)) {
      scanStringValue(node, templateExpressionText(node), add);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return candidates;
}

function scanStringValue(
  node: ts.Node,
  value: string,
  add: (rule: BoundaryRuleId, node: ts.Node, evidence: string) => void,
) {
  const normalized = normalizeText(value);
  if (!normalized) return;
  const sqlStructure = normalizeText(maskSqlLiteralsAndComments(value));

  for (const table of legacyCatalogTables) {
    const writePattern = sqlWritePattern(table);
    const hasWrite = writePattern.test(sqlStructure);
    const withoutWriteTarget = sqlStructure.replace(sqlWritePattern(table), " ");
    const hasRead = sqlReadPattern(table).test(withoutWriteTarget);
    if (hasWrite) {
      add("legacy-catalog-sql-write", node, `write ${table}: ${normalized}`);
    }
    if (hasRead) {
      add("legacy-catalog-raw-read", node, `read ${table}: ${normalized}`);
    }
    if (!hasWrite && !hasRead && normalized.toLowerCase() === table) {
      add("legacy-catalog-table-name", node, table);
    }
  }

  for (const relation of [...canonicalCatalogRelations, ...publicationCatalogRelations]) {
    if (sqlWritePattern(relation).test(sqlStructure) || sqlReadPattern(relation).test(sqlStructure)) {
      add("canonical-catalog-raw-access", node, `${relation}: ${normalized}`);
    }
  }

  for (const fragment of legacyRouteFragments) {
    if (normalized.includes(fragment)) {
      add("legacy-catalog-route", node, normalized);
    }
  }
  const viewSelector = normalized.match(/view=(effective|governance)(?:&|$)/iu)?.[1]?.toLowerCase();
  const contextualView = isViewContext(node) && /^(?:effective|governance)$/u.test(normalized)
    ? normalized.toLowerCase()
    : undefined;
  if (viewSelector || contextualView) {
    add(
      "legacy-effective-governance-contract",
      node,
      normalized,
    );
  }
  const overlayToken = normalized.match(
    /(?:driver_schema_overlays?|driver-schema-overlays?|organization-driver-schemas?)/iu,
  )?.[0];
  if (overlayToken) {
    add("legacy-overlay-catalog-contract", node, normalized);
  }
}

function maskSqlLiteralsAndComments(value: string) {
  let result = "";
  let index = 0;
  let state: "code" | "single" | "double" | "line-comment" | "block-comment" | "dollar" = "code";
  let dollarDelimiter = "";
  let blockCommentDepth = 0;
  const mask = (character: string) => (character === "\n" || character === "\r" ? character : " ");

  while (index < value.length) {
    const character = value[index];
    const next = value[index + 1];
    if (state === "code") {
      if (character === "'") {
        state = "single";
        result += " ";
        index += 1;
        continue;
      }
      if (character === '"') {
        state = "double";
        result += character;
        index += 1;
        continue;
      }
      if (character === "-" && next === "-") {
        state = "line-comment";
        result += "  ";
        index += 2;
        continue;
      }
      if (character === "/" && next === "*") {
        state = "block-comment";
        blockCommentDepth = 1;
        result += "  ";
        index += 2;
        continue;
      }
      if (character === "$") {
        const delimiter = value.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u)?.[0];
        if (delimiter) {
          state = "dollar";
          dollarDelimiter = delimiter;
          result += " ".repeat(delimiter.length);
          index += delimiter.length;
          continue;
        }
      }
      result += character;
      index += 1;
      continue;
    }
    if (state === "single") {
      if (character === "'" && next === "'") {
        result += "  ";
        index += 2;
        continue;
      }
      if (character === "\\" && next !== undefined) {
        result += mask(character) + mask(next);
        index += 2;
        continue;
      }
      result += mask(character);
      index += 1;
      if (character === "'") state = "code";
      continue;
    }
    if (state === "double") {
      if (character === '"' && next === '"') {
        result += '""';
        index += 2;
        continue;
      }
      result += character;
      index += 1;
      if (character === '"') state = "code";
      continue;
    }
    if (state === "line-comment") {
      result += mask(character);
      index += 1;
      if (character === "\n" || character === "\r") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        result += "  ";
        index += 2;
        continue;
      }
      if (character === "*" && next === "/") {
        result += "  ";
        index += 2;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) state = "code";
      } else {
        result += mask(character);
        index += 1;
      }
      continue;
    }
    if (value.startsWith(dollarDelimiter, index)) {
      result += " ".repeat(dollarDelimiter.length);
      index += dollarDelimiter.length;
      state = "code";
    } else {
      result += mask(character);
      index += 1;
    }
  }
  return result;
}

function sqlWritePattern(table: string) {
  const relation = sqlRelationPattern(table);
  return new RegExp(
    `\\b(?:(?:insert\\s+into|update|delete\\s+from|merge\\s+into|truncate(?:\\s+table)?)\\s+(?:only\\s+)?${relation}|copy\\s+${relation}\\s+from\\b)`,
    "giu",
  );
}

function sqlReadPattern(table: string) {
  const relation = sqlRelationPattern(table);
  return new RegExp(
    `(?:\\b(?:from|join)\\s+(?:only\\s+)?${relation}|(?:^|;)\\s*table\\s+(?:only\\s+)?${relation}|\\bcopy\\s+${relation}\\s+to\\b)`,
    "iu",
  );
}

function sqlRelationPattern(relation: string) {
  const identifier = '(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)';
  const [schema, table] = relation.includes(".") ? relation.split(".", 2) : [undefined, relation];
  const tablePattern = `(?:"${table}"|${table})(?![a-z0-9_$])`;
  if (schema) return `(?:"${schema}"|${schema})\\s*\\.\\s*${tablePattern}`;
  return `(?:${identifier}\\s*\\.\\s*)?${tablePattern}`;
}

function isModuleLoaderCall(node: ts.CallExpression, aliases: ReadonlySet<string>) {
  return (
    (ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) ||
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

type BoundaryAliases = {
  databaseReceivers: ReadonlySet<string>;
  databaseMethods: ReadonlySet<string>;
  routeReceivers: ReadonlySet<string>;
  routeMethods: ReadonlySet<string>;
};

function isDatabaseStringCall(node: ts.CallExpression, aliases: BoundaryAliases) {
  const expression = unwrapStringExpression(node.expression);
  if (ts.isIdentifier(expression) && aliases.databaseMethods.has(expression.text)) return true;
  const boundary = callBoundary(node);
  return Boolean(
    boundary &&
      /^(?:query|execute|raw|unsafe)$/u.test(boundary.method) &&
      aliases.databaseReceivers.has(boundary.receiver),
  );
}

function isRouteRegistrationCall(node: ts.CallExpression, aliases: BoundaryAliases) {
  const expression = unwrapStringExpression(node.expression);
  if (ts.isIdentifier(expression) && aliases.routeMethods.has(expression.text)) return true;
  const boundary = callBoundary(node);
  return Boolean(
    boundary &&
      /^(?:all|delete|get|head|options|patch|post|put|use)$/u.test(boundary.method) &&
      aliases.routeReceivers.has(boundary.receiver),
  );
}

function callBoundary(node: ts.CallExpression) {
  const expression = unwrapStringExpression(node.expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      method: expression.name.text,
      receiver: boundaryReceiverName(expression.expression),
    };
  }
  if (ts.isElementAccessExpression(expression) && isStringNode(expression.argumentExpression)) {
    return {
      method: expression.argumentExpression.text,
      receiver: boundaryReceiverName(expression.expression),
    };
  }
  return undefined;
}

function unresolvedBoundaryReceiver(node: ts.CallExpression) {
  const expression = unwrapStringExpression(node.expression);
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return undefined;
  const method = callMemberName(expression);
  const receiver = boundaryReceiverName(expression.expression);
  if (receiver || !method) return undefined;
  if (/^(?:query|execute|raw|unsafe)$/u.test(method)) {
    return { kind: "database" as const, expression: expression.expression };
  }
  return undefined;
}

function boundaryReceiverName(expression: ts.Expression): string {
  const node = unwrapStringExpression(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && isStringNode(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return "";
}

function collectUniqueConstantBindings(sourceFile: ts.SourceFile) {
  const declarations = new Map<string, ts.Expression[]>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const values = declarations.get(node.name.text) ?? [];
      values.push(node.initializer);
      declarations.set(node.name.text, values);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return new Map(
    [...declarations.entries()].flatMap(([name, values]) => (values.length === 1 ? [[name, values[0]] as const] : [])),
  );
}

function collectModuleLoaderAliases(bindings: ReadonlyMap<string, ts.Expression>) {
  const aliases = new Set(["require"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, initializer] of bindings) {
      const target = unwrapStringExpression(initializer);
      if (ts.isIdentifier(target) && aliases.has(target.text) && !aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

function collectBoundaryAliases(
  sourceFile: ts.SourceFile,
  bindings: ReadonlyMap<string, ts.Expression>,
): BoundaryAliases {
  const databaseReceivers = new Set(["db", "database", "pool", "client", "tx", "queryable"]);
  const routeReceivers = new Set(["app", "router", "route", "routes", "server"]);
  const databaseMethods = new Set<string>();
  const routeMethods = new Set<string>();
  const aliasesByTarget = new Map<string, string[]>();
  for (const [name, initializer] of bindings) {
    const target = unwrapStringExpression(initializer);
    if (ts.isIdentifier(target)) {
      const aliases = aliasesByTarget.get(target.text) ?? [];
      aliases.push(name);
      aliasesByTarget.set(target.text, aliases);
    }
  }
  expandAliases(databaseReceivers, aliasesByTarget);
  expandAliases(routeReceivers, aliasesByTarget);

  for (const [name, initializer] of bindings) {
    const target = unwrapStringExpression(initializer);
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const method = callMemberName(target);
      const owner = boundaryReceiverName(target.expression);
      if (method && /^(?:query|execute|raw|unsafe)$/u.test(method) && databaseReceivers.has(owner)) {
        databaseMethods.add(name);
      }
      if (
        method &&
        /^(?:all|delete|get|head|options|patch|post|put|use)$/u.test(method) &&
        routeReceivers.has(owner)
      ) {
        routeMethods.add(name);
      }
    }
  }
  expandAliases(databaseMethods, aliasesByTarget);
  expandAliases(routeMethods, aliasesByTarget);

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const owner = boundaryReceiverName(node.initializer);
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const property = element.propertyName ? propertyNameText(element.propertyName) : element.name.text;
        if (/^(?:query|execute|raw|unsafe)$/u.test(property) && databaseReceivers.has(owner)) {
          databaseMethods.add(element.name.text);
        }
        if (
          /^(?:all|delete|get|head|options|patch|post|put|use)$/u.test(property) &&
          routeReceivers.has(owner)
        ) {
          routeMethods.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { databaseReceivers, databaseMethods, routeReceivers, routeMethods };
}

function expandAliases(targets: Set<string>, aliasesByTarget: ReadonlyMap<string, readonly string[]>) {
  const queue = [...targets];
  for (let index = 0; index < queue.length; index += 1) {
    for (const alias of aliasesByTarget.get(queue[index]) ?? []) {
      if (targets.has(alias)) continue;
      targets.add(alias);
      queue.push(alias);
    }
  }
}

function isForbiddenCatalogModuleImport(modulePath: string) {
  if (!protectedCatalogModuleRoot.test(modulePath)) return false;
  const segments = modulePath.split("/").filter(Boolean);
  const roots = ["catalog-kernel", "parameter-catalog-contract", "parameter-governance", "catalog-cutover"];
  const rootIndex = segments.findIndex((segment) => roots.includes(segment));
  if (rootIndex < 0) return false;
  const root = segments[rootIndex];
  const suffix = segments.slice(rootIndex + 1).join("/").replace(/\.(?:[cm]?[jt]sx?)$/u, "");
  if (root === "catalog-kernel") return suffix !== "interface";
  if (root === "parameter-catalog-contract") return suffix !== "" && suffix !== "index";
  return true;
}

type EvaluatedString = { text: string; complete: boolean };

function evaluateStringExpression(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): EvaluatedString {
  const node = unwrapStringExpression(expression);
  if (isStringNode(node)) return { text: node.text, complete: true };
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return { text: "${unresolved}", complete: false };
    const initializer = bindings.get(node.text);
    if (!initializer) return { text: "${unresolved}", complete: false };
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return evaluateStringExpression(initializer, bindings, nextSeen);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateStringExpression(node.left, bindings, seen);
    const right = evaluateStringExpression(node.right, bindings, seen);
    return { text: left.text + right.text, complete: left.complete && right.complete };
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    let complete = true;
    for (const span of node.templateSpans) {
      const value = evaluateStringExpression(span.expression, bindings, seen);
      text += value.text + span.literal.text;
      complete = complete && value.complete;
    }
    return { text, complete };
  }
  return { text: "${unresolved}", complete: false };
}

function unwrapStringExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapStringExpression(expression.expression);
  }
  return expression;
}

function isStringNode(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function stringNodeText(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) {
  return node.text;
}

function templateExpressionText(node: ts.TemplateExpression) {
  return `${node.head.text}${node.templateSpans.map((span) => `\${…}${span.literal.text}`).join("")}`;
}

function isQuotedPropertyName(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) &&
    parent.name === node
  );
}

function isLegacyIdentityKeyContext(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) {
  if (isQuotedPropertyName(node)) return true;
  const parent = node.parent;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
    parent.left === node
  ) {
    return true;
  }
  if (!ts.isCallExpression(parent)) return false;
  const argumentIndex = parent.arguments.indexOf(node);
  const member = callMemberName(parent.expression);
  if (member === "hasOwn" && argumentIndex === 1) return true;
  if (member === "hasOwnProperty" && argumentIndex === 0) return true;
  if (member !== "call" || argumentIndex !== 1) return false;
  const callee = unwrapStringExpression(parent.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callMemberName(callee.expression) === "hasOwnProperty"
  );
}

function isViewContext(node: ts.Node) {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parent) {
    const text = normalizeText(current.getText());
    if (/\b(?:view|catalogView|defaultView)\b/u.test(text)) return true;
  }
  return false;
}

function propertyNameText(node: ts.PropertyName) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : ts.SyntaxKind[node.kind];
}

function callMemberName(expression: ts.LeftHandSideExpression) {
  const unwrapped = unwrapStringExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
  if (ts.isElementAccessExpression(unwrapped) && isStringNode(unwrapped.argumentExpression)) {
    return unwrapped.argumentExpression.text;
  }
  return undefined;
}

function normalizeText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function boundedEvidence(value: string) {
  const normalized = normalizeText(value);
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

function scriptKind(file: string) {
  const extension = extname(file).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in parameter-catalog consumer roots: ${path}.`);
    }
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files;
}

async function collectConsumerSourceFiles(
  repoRoot: string,
  paths: readonly { pattern: string; required: boolean }[],
): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    const isDirectoryGlob = path.pattern.endsWith("/**");
    const relativePath = isDirectoryGlob ? path.pattern.slice(0, -3) : path.pattern;
    const absolutePath = resolve(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      if (path.required) throw new Error(`Required parameter-catalog consumer path is missing: ${path.pattern}.`);
      continue;
    }
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Symbol links are not allowed in parameter-catalog consumer paths: ${path.pattern}.`);
    }
    if (isDirectoryGlob) {
      if (!metadata.isDirectory()) {
        throw new Error(`Required parameter-catalog consumer directory is not a directory: ${path.pattern}.`);
      }
      for (const file of await collectSourceFiles(absolutePath)) files.add(file);
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Required parameter-catalog consumer file is not a file: ${path.pattern}.`);
    }
    if (sourceExtensions.has(extname(absolutePath).toLowerCase())) files.add(absolutePath);
  }
  return [...files].sort(compareText);
}

export async function scanParameterCatalogBoundaries(repoRoot: string): Promise<BoundaryViolation[]> {
  const violations: BoundaryViolation[] = [];
  const ownerByFile = new Map<string, ConsumerFamilyId>();
  for (const definition of consumerShardDefinitions) {
    for (const absoluteFile of await collectConsumerSourceFiles(repoRoot, definition.paths)) {
      const file = relative(repoRoot, absoluteFile).split(sep).join("/");
      const existingOwner = ownerByFile.get(file);
      if (existingOwner && existingOwner !== definition.family) {
        throw new Error(`Consumer source file ${file} is assigned to both ${existingOwner} and ${definition.family}.`);
      }
      if (existingOwner) continue;
      ownerByFile.set(file, definition.family);
      violations.push(...scanSourceFile(definition.family, file, await readFile(absoluteFile, "utf8")));
    }
  }
  return violations;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
