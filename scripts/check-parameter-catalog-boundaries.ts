import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

import {
  allowlistShardDirectory,
  boundaryViolationFixturePath,
  consumerShardDefinitions,
  loadAllowlistIndex,
  loadBoundaryViolationFixture,
  type BoundaryFixtureIntegrity,
} from "./parameter-catalog-allowlist/index";
import { compareBoundaryInventory, formatBoundaryReport } from "./parameter-catalog-allowlist/deterministicOutput";
import {
  allowlistShardSchema,
  boundaryViolationFixtureSchema,
  compareText,
  type AllowlistShard,
  type BoundaryRuleId,
  type BoundaryViolation,
  type BoundaryViolationFixture,
  type ConsumerFamilyId,
} from "./parameter-catalog-allowlist/schema";

const initialBaselineSha = "e84ca078ab8f7b7006fa8e635d722297a287d2a5";
const initialFixtureSha256 = "9932ab08f7bd3ba5cafac08e03fa32d8a3c9a5e75f8aaa9242fefafcba798267";
const initialFixtureIntegrity: BoundaryFixtureIntegrity = {
  baselineSha: initialBaselineSha,
  fixtureSha256: initialFixtureSha256,
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

const canonicalCatalogTables = [
  "catalog_materializations",
  "catalog_release_definition_heads",
  "catalog_release_subject_aliases",
  "catalog_release_subjects",
  "catalog_releases",
  "catalog_state",
  "catalog_subject_aliases",
  "catalog_subjects",
  "definition_revisions",
  "organization_subject_registrations",
] as const;

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
const forbiddenInternalImport =
  /(?:^|\/)(?:catalog-kernel\/(?:install|verification|cache)|parameter-governance\/(?:registration|evidence|review|resolveReviewItem|proposals)|catalog-cutover\/(?:classifier|mapping|archive))(?:\/|$)/u;

const reasons: Record<BoundaryRuleId, string> = {
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

type CandidateViolation = Omit<BoundaryViolation, "id"> & {
  start: number;
  stableEvidence: string;
};

export type InitialAllowlistArtifacts = {
  fixture: BoundaryViolationFixture;
  shards: AllowlistShard[];
};

export async function scanParameterCatalogBoundaries(repoRoot: string): Promise<BoundaryViolation[]> {
  const candidates: CandidateViolation[] = [];
  const ownerByFile = new Map<string, ConsumerFamilyId>();
  for (const definition of consumerShardDefinitions) {
    const files = await collectConsumerSourceFiles(repoRoot, definition.paths);
    for (const absoluteFile of files) {
      const file = toPosix(relative(repoRoot, absoluteFile));
      const existingOwner = ownerByFile.get(file);
      if (existingOwner && existingOwner !== definition.family) {
        throw new Error(`Consumer source file ${file} is assigned to both ${existingOwner} and ${definition.family}.`);
      }
      ownerByFile.set(file, definition.family);
      const source = await readFile(absoluteFile, "utf8");
      candidates.push(...scanSourceFile(definition.family, file, source));
    }
  }

  candidates.sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      left.start - right.start ||
      compareText(left.rule, right.rule) ||
      compareText(left.stableEvidence, right.stableEvidence),
  );

  const occurrenceByBaseId = new Map<string, number>();
  return candidates
    .map(({ start: _start, stableEvidence, ...candidate }) => {
      const fingerprint = createHash("sha256")
        .update([candidate.family, candidate.rule, candidate.file, stableEvidence].join("\0"))
        .digest("hex")
        .slice(0, 16);
      const baseId = `${candidate.family}:${candidate.rule}:${fingerprint}`;
      const ordinal = (occurrenceByBaseId.get(baseId) ?? 0) + 1;
      occurrenceByBaseId.set(baseId, ordinal);
      return { id: `${baseId}:${ordinal}`, ...candidate };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

export function buildInitialAllowlistArtifacts(
  violations: readonly BoundaryViolation[],
  baselineSha: string,
): InitialAllowlistArtifacts {
  const sortedViolations = [...violations].sort((left, right) => compareText(left.id, right.id));
  const fixture = boundaryViolationFixtureSchema.parse({
    schemaVersion: 1,
    baselineSha,
    violations: sortedViolations,
  });
  const shards = consumerShardDefinitions.map((definition) =>
    allowlistShardSchema.parse({
      schemaVersion: 1,
      family: definition.family,
      paths: definition.paths.map(({ pattern }) => pattern),
      entries: sortedViolations
        .filter((violation) => violation.family === definition.family)
        .map(({ id, rule, file, reason }) => ({ id, rule, file, reason }))
        .sort((left, right) => compareText(left.id, right.id)),
    }),
  );
  return { fixture, shards };
}

export async function checkParameterCatalogBoundaries(
  repoRoot: string,
  integrity: BoundaryFixtureIntegrity = initialFixtureIntegrity,
) {
  const [violations, allowlist, fixture] = await Promise.all([
    scanParameterCatalogBoundaries(repoRoot),
    loadAllowlistIndex(repoRoot),
    loadBoundaryViolationFixture(repoRoot, integrity),
  ]);
  return compareBoundaryInventory(violations, allowlist.entries, fixture.violations);
}

function scanSourceFile(family: ConsumerFamilyId, file: string, source: string): CandidateViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const candidates: CandidateViolation[] = [];
  const constantBindings = collectUniqueConstantBindings(sourceFile);

  const add = (rule: BoundaryRuleId, node: ts.Node, evidence: string, stableEvidence = evidence) => {
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
      start,
      stableEvidence: `${normalizeText(stableEvidence)}\0${stableContext(node, sourceFile)}`,
    });
  };

  const scanModuleSpecifier = (modulePath: string, node: ts.Node) => {
    if (legacyModuleImport.test(modulePath)) {
      add("legacy-catalog-module-import", node, modulePath, modulePath);
    }
    if (forbiddenInternalImport.test(modulePath)) {
      add("forbidden-catalog-internal-import", node, modulePath, modulePath);
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
    } else if (ts.isCallExpression(node) && isModuleLoaderCall(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      scanModuleSpecifier(node.arguments[0].text, node);
    }

    if (ts.isCallExpression(node) && node.arguments[0]) {
      const argument = node.arguments[0];
      if (isModuleLoaderCall(node) && !ts.isStringLiteral(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanModuleSpecifier(evaluated.text, argument);
        } else {
          add("unresolved-boundary-expression", argument, `module-loader: ${normalizeText(argument.getText(sourceFile))}`);
        }
      } else if (isDatabaseStringCall(node) && !isStringNode(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanStringValue(argument, evaluated.text, add);
        } else {
          add("unresolved-boundary-expression", argument, `database: ${normalizeText(argument.getText(sourceFile))}`);
        }
      } else if (isRouteRegistrationCall(node) && !isStringNode(argument)) {
        const evaluated = evaluateStringExpression(argument, constantBindings);
        if (evaluated.complete) {
          scanStringValue(argument, evaluated.text, add);
        } else {
          add("unresolved-boundary-expression", argument, `route: ${normalizeText(argument.getText(sourceFile))}`);
        }
      }
    }

    if (ts.isIdentifier(node)) {
      if (parameterSpecIdentifier.test(node.text)) {
        add("legacy-parameter-spec-identifier", node, node.text, node.text);
      }
      if (effectiveGovernanceIdentifier.test(node.text)) {
        add("legacy-effective-governance-contract", node, node.text, node.text);
      }
      if (overlayContractIdentifier.test(node.text)) {
        add("legacy-overlay-catalog-contract", node, node.text, node.text);
      }
    }

    if (isStringNode(node)) {
      const text = stringNodeText(node);
      scanStringValue(node, text, add);
      if (isQuotedPropertyName(node) && parameterSpecIdentifier.test(text)) {
        add("legacy-parameter-spec-identifier", node, text, text);
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
  add: (rule: BoundaryRuleId, node: ts.Node, evidence: string, stableEvidence?: string) => void,
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
      add("legacy-catalog-sql-write", node, `write ${table}: ${normalized}`, `write\0${table}\0${normalized}`);
    }
    if (hasRead) {
      add("legacy-catalog-raw-read", node, `read ${table}: ${normalized}`, `read\0${table}\0${normalized}`);
    }
    if (!hasWrite && !hasRead && normalized.toLowerCase() === table) {
      add("legacy-catalog-table-name", node, table, table);
    }
  }

  for (const table of canonicalCatalogTables) {
    if (sqlWritePattern(table).test(sqlStructure) || sqlReadPattern(table).test(sqlStructure)) {
      add("canonical-catalog-raw-access", node, `${table}: ${normalized}`, `${table}\0${normalized}`);
    }
  }

  if (legacyRouteFragments.some((fragment) => normalized.includes(fragment))) {
    add("legacy-catalog-route", node, normalized, normalized);
  }
  if (/view=(?:effective|governance)(?:&|$)/iu.test(normalized) || (isViewContext(node) && /^(?:effective|governance)$/u.test(normalized))) {
    add("legacy-effective-governance-contract", node, normalized, normalized);
  }
  if (/(?:driver_schema_overlays?|driver-schema-overlays?|organization-driver-schemas?)/iu.test(normalized)) {
    add("legacy-overlay-catalog-contract", node, normalized, normalized);
  }
}

function maskSqlLiteralsAndComments(value: string) {
  let result = "";
  let index = 0;
  let state: "code" | "single" | "line-comment" | "block-comment" | "dollar" = "code";
  let dollarDelimiter = "";
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
      if (character === "-" && next === "-") {
        state = "line-comment";
        result += "  ";
        index += 2;
        continue;
      }
      if (character === "/" && next === "*") {
        state = "block-comment";
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
    if (state === "line-comment") {
      result += mask(character);
      index += 1;
      if (character === "\n" || character === "\r") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 2;
        state = "code";
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
  return new RegExp(
    `\\b(?:insert\\s+into|update|delete\\s+from|merge\\s+into|truncate(?:\\s+table)?)\\s+(?:only\\s+)?(?:"?[a-z_][a-z0-9_]*"?\\.)?"?${table}"?\\b`,
    "giu",
  );
}

function sqlReadPattern(table: string) {
  return new RegExp(
    `\\b(?:from|join)\\s+(?:only\\s+)?(?:"?[a-z_][a-z0-9_]*"?\\.)?"?${table}"?\\b`,
    "iu",
  );
}

function isModuleLoaderCall(node: ts.CallExpression) {
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

function isDatabaseStringCall(node: ts.CallExpression) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (!/^(?:query|execute|raw|unsafe)$/u.test(node.expression.name.text)) return false;
  return /(?:^|\.)(?:db|database|pool|client|tx|queryable)$/iu.test(normalizeText(node.expression.expression.getText()));
}

function isRouteRegistrationCall(node: ts.CallExpression) {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (!/^(?:all|delete|get|head|options|patch|post|put|use)$/u.test(node.expression.name.text)) return false;
  return /(?:^|\.)(?:app|router|routes?)$/iu.test(normalizeText(node.expression.expression.getText()));
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

function isViewContext(node: ts.Node) {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parent) {
    const text = normalizeText(current.getText());
    if (/\b(?:view|catalogView|defaultView)\b/u.test(text)) return true;
  }
  return false;
}

function stableContext(node: ts.Node, sourceFile: ts.SourceFile) {
  let current = node;
  while (current.parent && !isStableContextBoundary(current)) {
    current = current.parent;
  }
  return normalizeText(current.getText(sourceFile));
}

function isStableContextBoundary(node: ts.Node) {
  return (
    ts.isStatement(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isCallExpression(node)
  );
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

async function initializeBaseline(repoRoot: string, baselineSha: string) {
  if (baselineSha !== initialBaselineSha) {
    throw new Error(`Initial allow-list baseline must be the authorized SHA ${initialBaselineSha}.`);
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  if (head !== baselineSha) {
    throw new Error(`Refusing baseline initialization: HEAD ${head} does not equal authorized baseline ${baselineSha}.`);
  }

  const targetPaths = [
    boundaryViolationFixturePath,
    ...consumerShardDefinitions.map(({ shardFile }) => `${allowlistShardDirectory}/${shardFile}`),
  ];
  for (const path of targetPaths) {
    if (await pathExists(resolve(repoRoot, path))) {
      throw new Error(`Refusing to grow or replace an existing parameter-catalog allow-list artifact: ${path}.`);
    }
  }

  const violations = await scanParameterCatalogBoundaries(repoRoot);
  const artifacts = buildInitialAllowlistArtifacts(violations, baselineSha);
  await writeJson(resolve(repoRoot, boundaryViolationFixturePath), artifacts.fixture);
  for (const definition of consumerShardDefinitions) {
    const shard = artifacts.shards.find((candidate) => candidate.family === definition.family);
    if (!shard) throw new Error(`Missing generated shard for ${definition.family}.`);
    await writeJson(resolve(repoRoot, allowlistShardDirectory, definition.shardFile), shard);
  }

  return {
    schemaVersion: 1,
    status: "initialized" as const,
    baselineSha,
    violationCount: violations.length,
    shards: artifacts.shards.map((shard) => ({ family: shard.family, entries: shard.entries.length })),
  };
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseCliArgs(args: readonly string[]) {
  const rootArgument = args.find((argument) => argument.startsWith("--root="));
  const baselineArgument = args.find((argument) => argument.startsWith("--baseline-sha="));
  return {
    repoRoot: resolve(rootArgument?.slice("--root=".length) || process.cwd()),
    initialize: args.includes("--initialize-baseline"),
    baselineSha: baselineArgument?.slice("--baseline-sha=".length) ?? "",
  };
}

async function runCli() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.initialize) {
    const result = await initializeBaseline(options.repoRoot, options.baselineSha);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const report = await checkParameterCatalogBoundaries(options.repoRoot);
  process.stdout.write(formatBoundaryReport(report));
  if (report.status !== "passed") process.exitCode = 1;
}

function toPosix(path: string) {
  return sep === "/" ? path : path.split(sep).join("/");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  void runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
