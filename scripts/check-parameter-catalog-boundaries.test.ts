import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildInitialAllowlistArtifacts,
  boundaryInventoryStatistics,
  canonicalCatalogRelations,
  checkParameterCatalogBoundaries,
  initializeParameterCatalogAllowlist,
  legacyCatalogLookupKinds,
  legacyCatalogMappingSourceKinds,
  scanParameterCatalogBoundaries,
} from "./check-parameter-catalog-boundaries";
import {
  allowlistShardDirectory,
  boundaryViolationFixturePath,
  loadBoundaryViolationFixture,
} from "./parameter-catalog-allowlist/index";
import { exactRelocationRecordPath } from "./parameter-catalog-allowlist/exactRelocation";
import {
  postCutoverRelocationRecordPath,
  runtimeTopologyRelocationRecordPath,
} from "./parameter-catalog-allowlist/runtimeTopologyRelocation";
import { debuggingTransferRelocationRecordPath } from "./parameter-catalog-allowlist/debuggingTransferRelocation";
import { editServiceVersionIndexRelocationRecordPath } from "./parameter-catalog-allowlist/editServiceVersionIndexRelocation";
import {
  issue911RelocationRecordPath,
  sourceWorkflowRelocationRecordPath,
  sourceWorkflowConsumerRelocationRecordPath,
} from "./parameter-catalog-allowlist/sourceWorkflowRelocation";
import { t14FamilySuccessorRelocationRecordPath } from "./parameter-catalog-allowlist/t14FamilySuccessorRelocation";
import { t14RewrittenSliceSuccessorRelocationRecordPath } from "./parameter-catalog-allowlist/t14RewrittenSliceSuccessorRelocation";
import {
  issue913T14RetiredSourceIds,
  issue913T14SuccessorPairCount,
  issue913T14SuccessorRelocationRecordPath,
  issue913T14RewrittenRepositorySuccessorRelocationRecordPath,
  issue913T14ServiceSuccessorRelocationRecordPath,
} from "./parameter-catalog-allowlist/issue913T14Relocation";
import {
  issue913StaleRetiredSourceIds,
  issue913StaleSuccessorPairCount,
  issue913StaleSuccessorRelocationRecordPath,
} from "./parameter-catalog-allowlist/issue913StaleSuccessorRelocation";
import {
  issue853CActionRetiredSourceIds,
  loadIssue853CRemainderRetiredSourceIds,
} from "./parameter-catalog-allowlist/issue853CRelocation";
import { seedDriverPositionRecordPath, seedDriverQueryRecordPath } from "./parameter-catalog-allowlist/seedDriverLookupRelocation";
import { issue901RoutesTestRelocationRecordPath } from "./parameter-catalog-allowlist/issue901RouteTestRelocation";
import { issue900DashboardRelocationRecordPath } from "./parameter-catalog-allowlist/issue900DashboardRelocation";

const seedDriverRecords = await Promise.all([seedDriverPositionRecordPath, seedDriverQueryRecordPath].map(async (path) =>
  JSON.parse(await readFile(`${process.cwd()}/${path}`, "utf8")) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> },
));
const issue901RoutesTestRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${issue901RoutesTestRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };

const consumerRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${sourceWorkflowConsumerRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const issue911RelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${issue911RelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const sourceWorkflowRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${sourceWorkflowRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const familySuccessorRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${t14FamilySuccessorRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const rewrittenSliceRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${t14RewrittenSliceSuccessorRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const issue913T14SuccessorRecords = await Promise.all([
  issue913T14SuccessorRelocationRecordPath,
  issue913T14RewrittenRepositorySuccessorRelocationRecordPath,
  issue913T14ServiceSuccessorRelocationRecordPath,
].map(async (path) => JSON.parse(await readFile(`${process.cwd()}/${path}`, "utf8")) as {
  files: Array<{ pairs: Array<{ old: { id: string } }> }>;
}));
const issue913StaleSuccessorRecord = JSON.parse(
  await readFile(`${process.cwd()}/${issue913StaleSuccessorRelocationRecordPath}`, "utf8"),
) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> };
const issue853SuccessorRecords = await Promise.all([
  "issue-853-c-debug-routes-successor.json",
  "issue-853-c-debug-catalog-split-successor.json",
  "issue-853-c-debug-repository-successor.json",
  "issue-853-c-debug-repository-rewritten-successor.json",
  "issue-853-c-remainder-exact.json",
  "issue-853-c-remainder-rewritten.json",
  "issue-853-d-902-exact-successor.json",
  "issue-853-d-914-fixed-successor.json",
  "issue-853-d-additional-fixed-successor.json",
].map(async (name) => JSON.parse(await readFile(
  `${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/${name}`, "utf8",
)) as { files: Array<{ pairs: Array<{ old: { id: string } }> }> }));
const currentUnallowlistedRecord = JSON.parse(
  await readFile(`${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/issue-853-a-0169-current-unallowlisted.json`, "utf8"),
) as {
  schemaVersion: number;
  baseHead: string;
  ownerHead: string;
  ownerBlobs: Record<string, string>;
  baseUnallowlistedIds: string[];
  ownerAddedUnallowlistedIds: string[];
};

const jointUnallowlistedRecord = JSON.parse(
  await readFile(`${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/issue-853-a-906-joint-current-unallowlisted.json`, "utf8"),
) as {
  schemaVersion: number;
  baseHead: string;
  priorOwnerHead: string;
  ownerHead: string;
  dHead: string;
  bChangedBlobs: Record<string, { before: string; after: string }>;
  oldBlobs: Record<string, string>;
  currentBlobs: Record<string, string>;
  retired: Array<{ oldId: string; file: string; oldRule: string; oldLine: number; oldByteStart: number; oldByteEnd: number; oldSliceSha256: string }>;
  moved: Array<{ oldId: string; newId: string; file: string; oldRule: string; oldLine: number; oldByteStart: number; oldByteEnd: number; oldSliceSha256: string }>;
  currentUnallowlistedIds: string[];
};
const c940CurrentSuccessor = JSON.parse(
  await readFile(`${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/issue-853-a-c940-current-successor.json`, "utf8"),
) as {
  schemaVersion: number;
  priorHead: string;
  cHead: string;
  dHead: string;
  blobs: Record<string, { before: string; after: string }>;
  moved: Array<{ oldId: string; newId: string; file: string; oldByteStart: number; oldByteEnd: number; sliceSha256: string }>;
};
const c940FixedSuccessors = await Promise.all([
  "issue-853-c-940-conflict-service-successor.json",
  "issue-853-c-940-conflict-service-owner-successor.json",
].map(async (name) => JSON.parse(await readFile(
  `${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/${name}`, "utf8",
)) as { files: Array<{ pairs: Array<{ old: { id: string }; new: { id: string } }> }> }));
const b948FixedSuccessor = JSON.parse(await readFile(
  `${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/issue-853-a-b948-conflict-service-owner-successor.json`, "utf8",
)) as { files: Array<{ pairs: Array<{ old: { id: string }; new: { id: string } }> }> };
const b948CurrentSuccessor = JSON.parse(await readFile(
  `${process.cwd()}/scripts/fixtures/parameter-catalog-allowlist/issue-853-a-b948-current-successor.json`, "utf8",
)) as {
  schemaVersion: number;
  priorAHead: string;
  dHead: string;
  cHead: string;
  bHead: string;
  aMergeHead: string;
  blobs: Record<string, { before: string | null; after: string }>;
  movedUnallowlisted: Array<{ oldId: string; newId: string; file: string; oldByteStart: number; oldByteEnd: number; newByteStart: number; newByteEnd: number; sliceSha256: string }>;
  newUnallowlisted: Array<{ id: string; file: string; rule: string; line: number; byteStart: number; byteEnd: number; sliceSha256: string }>;
};

const originalRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${exactRelocationRecordPath}`, "utf8"),
) as { pairs: Array<{ old: { id: string } }> };
const runtimeTopologyRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${runtimeTopologyRelocationRecordPath}`, "utf8"),
) as { files: Array<{ file: string; pairs: Array<{ old: { id: string } }> }> };
const postCutoverRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${postCutoverRelocationRecordPath}`, "utf8"),
) as { files: Array<{ file: string; pairs: Array<{ old: { id: string } }> }> };
const debuggingTransferRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${debuggingTransferRelocationRecordPath}`, "utf8"),
) as { files: Array<{ file: string; pairs: Array<{ old: { id: string } }> }> };
const editServiceVersionIndexRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${editServiceVersionIndexRelocationRecordPath}`, "utf8"),
) as { files: Array<{ file: string; pairs: Array<{ old: { id: string } }> }> };
const issue900DashboardRelocationRecord = JSON.parse(
  await readFile(`${process.cwd()}/${issue900DashboardRelocationRecordPath}`, "utf8"),
) as { files: Array<{ file: string; pairs: Array<{ old: { id: string } }> }> };

describe("parameter catalog boundary checker", () => {
  it("freezes the exact 37 schema-qualified canonical relations", () => {
    expect(canonicalCatalogRelations).toEqual([
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
    ]);
  });

  it("consumes the G0.1 public lookup and internal mapping kind registries without widening them", () => {
    expect(legacyCatalogLookupKinds).toHaveLength(7);
    expect(legacyCatalogMappingSourceKinds).toHaveLength(49);
    expect(legacyCatalogLookupKinds).toEqual([
      "parameter-spec",
      "parameter-spec-version",
      "project-parameter-binding",
      "project-parameter-binding-revision",
      "parameter-subject",
      "parameter-placement",
      "parameter-module",
    ]);
    expect(legacyCatalogMappingSourceKinds.at(-1)).toBe("unresolved-protected-reference");
  });

  it("enumerates the authorized legacy boundary classes through syntax nodes", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameter-specs/repository.ts",
      [
        "const parameterSpecId = 'spec-1';",
        "const read = `select ps.id from parameter_specs ps join parameter_spec_versions psv on psv.parameter_spec_id = ps.id`;",
        "const write = `insert into parameter_specs (id) values ($1)`;",
        "const exactTableName = 'parameter_specs';",
        "const catalogRead = `select subject_id from parameter_catalog.catalog_subjects`;",
        "const query = { view: 'effective' as const };",
        "const DriverSchemaOverlayWriter = true;",
        "router.post('/api/v2/parameter-specs/:specId/activate', handler);",
        "// select * from parameter_specs; /api/v2/parameter-specs",
        "const harmlessDtsOverlay = 'overlay.dtsi';",
      ].join("\n"),
    );
    await writeSource(
      root,
      "server/modules/parameter-topology/service.ts",
      [
        "import { findSpec } from '../parameter-specs/repository';",
        "import { install } from '../catalog-kernel/install/privateStore';",
        "import type { CatalogRuntime } from '../catalog-kernel/interface';",
        "export const load = () => findSpec();",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);
    const rules = new Set(violations.map((item) => item.rule));

    expect(rules).toEqual(
      new Set([
        "legacy-parameter-spec-identifier",
        "legacy-catalog-raw-read",
        "legacy-catalog-sql-write",
        "legacy-catalog-table-name",
        "canonical-catalog-raw-access",
        "legacy-effective-governance-contract",
        "legacy-overlay-catalog-contract",
        "legacy-catalog-route",
        "legacy-catalog-module-import",
        "forbidden-catalog-internal-import",
      ]),
    );
    expect(violations.every((item) => item.file.startsWith("server/modules/"))).toBe(true);
    expect(violations.some((item) => item.evidence.includes("select * from parameter_specs"))).toBe(false);
    expect(violations.some((item) => item.evidence.includes("overlay.dtsi"))).toBe(false);
    expect(violations.some((item) => item.evidence.includes("catalog-kernel/interface"))).toBe(false);
  });

  it("binds each occurrence ID to its trusted blob and byte span", async () => {
    const firstRoot = await createConsumerTree();
    const secondRoot = await createConsumerTree();
    const relativePath = "server/modules/parameters/repository.ts";
    const source = "export const read = `select id from parameter_specs where id = $1`;\n";
    await writeSource(firstRoot, relativePath, source);
    await writeSource(secondRoot, relativePath, `// moved down\n\n${source}`);

    const first = await scanParameterCatalogBoundaries(firstRoot);
    const second = await scanParameterCatalogBoundaries(secondRoot);

    expect(first.map((item) => item.id)).not.toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.id.split(":").slice(0, 3))).toEqual(
      second.map((item) => item.id.split(":").slice(0, 3)),
    );
    expect(first.map((item) => item.line)).not.toEqual(second.map((item) => item.line));
    expect(first[0]).toMatchObject({
      trustedBaseSha: "0000000000000000000000000000000000000000",
      byteStart: expect.any(Number),
      byteEnd: expect.any(Number),
      token: expect.any(String),
    });
    expect(first[0].trustedBlobOid).not.toBe(second[0].trustedBlobOid);
  });

  it("anchors each stable ID to one legacy debt instead of its SQL sibling or carrier identifier", async () => {
    const firstRoot = await createConsumerTree();
    const secondRoot = await createConsumerTree();
    const relativePath = "server/modules/parameters/atomicDebt.ts";
    await writeSource(
      firstRoot,
      relativePath,
      [
        "const originalCarrier = `select ps.id from parameter_specs ps join parameter_spec_versions psv on psv.parameter_spec_id = ps.id`;",
        "export const unrelatedValue = 'before';",
      ].join("\n"),
    );
    await writeSource(
      secondRoot,
      relativePath,
      [
        "export const unrelatedValueAfterEdit = 'after';",
        "const renamedCarrier = `select ps.id from parameter_specs ps`;",
      ].join("\n"),
    );

    const first = (await scanParameterCatalogBoundaries(firstRoot)).find(
      (violation) => violation.rule === "legacy-catalog-raw-read" && violation.evidence.startsWith("read parameter_specs:"),
    );
    const second = (await scanParameterCatalogBoundaries(secondRoot)).find(
      (violation) => violation.rule === "legacy-catalog-raw-read" && violation.evidence.startsWith("read parameter_specs:"),
    );

    expect(first?.id).toBeDefined();
    expect(second?.id).not.toBe(first?.id);
    expect(second?.id.split(":").slice(0, 3)).toEqual(first?.id.split(":").slice(0, 3));
  });

  it("assigns debt from independently listed frozen paths to the exact future shrink owner", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameter-drafts/repository.ts",
      "export const read = `select id from parameter_specs`;\n",
    );
    await writeSource(
      root,
      "src/infrastructure/http/parameterTopologyClient.ts",
      "export const route = '/api/v2/parameter-specs';\n",
    );
    await writeSource(
      root,
      "scripts/reconcile-parameter-definitions.ts",
      "export const write = `update parameter_specs set lifecycle = 'active'`;\n",
    );
    await writeSource(
      root,
      "server/modules/agent/tools/perceptionTools.ts",
      "export const unrelated = `select id from parameter_specs`;\n",
    );

    const violations = await scanParameterCatalogBoundaries(root);
    const ownerByFile = new Map(violations.map((violation) => [violation.file, violation.family]));

    expect(ownerByFile.get("server/modules/parameter-drafts/repository.ts")).toBe("S12-PRJ");
    expect(ownerByFile.get("src/infrastructure/http/parameterTopologyClient.ts")).toBe("S12-TOP");
    expect(ownerByFile.get("scripts/reconcile-parameter-definitions.ts")).toBe("S12-OPS");
    expect(ownerByFile.get("server/modules/agent/tools/perceptionTools.ts")).toBe("S12-AGT");
  });

  it("resolves local constant composition for SQL, routes, module loaders, and ImportEquals", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/composed.ts",
      [
        "import legacy = require('../parameter-specs/repository');",
        "const table = 'parameter_' + 'specs';",
        "const prefix = '/api/v2';",
        "const route = `${prefix}/parameter-specs`;",
        "const modulePrefix = '../parameter-';",
        "const modulePath = modulePrefix + 'specs/repository';",
        "const sql = `select id from ${table}`;",
        "const directSql = `select id from parameter_spec_versions`;",
        "db.query(sql);",
        "db.query(directSql);",
        "router.get(route, handler);",
        "require(modulePath);",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);

    expect(violations.some((violation) => violation.rule === "legacy-catalog-raw-read" && violation.evidence.includes("parameter_specs"))).toBe(true);
    expect(violations.some((violation) => violation.rule === "legacy-catalog-raw-read" && violation.evidence.includes("parameter_spec_versions"))).toBe(true);
    expect(violations.some((violation) => violation.rule === "legacy-catalog-route" && violation.evidence.includes("/api/v2/parameter-specs"))).toBe(true);
    expect(violations.filter((violation) => violation.rule === "legacy-catalog-module-import")).toHaveLength(2);
  });

  it("fails closed when database, route, or module-loader boundary expressions cannot be resolved", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/unresolved.ts",
      [
        "db.query(buildSql());",
        "router.get(resolveRoute(), handler);",
        "require(resolveModule());",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);
    const unresolved = violations.filter((violation) => violation.rule === "unresolved-boundary-expression");

    expect(unresolved).toHaveLength(3);
    expect(unresolved.map((violation) => violation.evidence).sort()).toEqual([
      "database: buildSql()",
      "module-loader: resolveModule()",
      "route: resolveRoute()",
    ]);
  });

  it("unwraps typed receivers and element-access methods before failing unresolved boundaries closed", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/receiverBoundaries.ts",
      [
        "((db as Database)!).query(makeSql());",
        "(db as Database)![`query`](['select id', 'from parameter_specs'].join(' '));",
        "(server as HttpServer)!.get(buildRoute(), handler);",
        "router['get'](['/api/v2', '/parameter-specs'].join(''), handler);",
      ].join("\n"),
    );

    const unresolved = (await scanParameterCatalogBoundaries(root))
      .filter((violation) => violation.rule === "unresolved-boundary-expression")
      .map((violation) => violation.evidence)
      .sort();

    expect(unresolved).toEqual([
      "database: ['select id', 'from parameter_specs'].join(' ')",
      "database: makeSql()",
      "route: ['/api/v2', '/parameter-specs'].join('')",
      "route: buildRoute()",
    ]);
  });

  it("recognizes CommonJS loader aliases and fails dynamic alias arguments closed", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/loaderAliases.ts",
      [
        "const load = require;",
        "const delegatedLoad = load;",
        "const modulePath = '../parameter-' + 'specs/repository';",
        "load(modulePath);",
        "delegatedLoad(buildModulePath());",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);

    expect(violations.filter((violation) => violation.rule === "legacy-catalog-module-import")).toHaveLength(1);
    expect(
      violations
        .filter((violation) => violation.rule === "unresolved-boundary-expression")
        .map((violation) => violation.evidence),
    ).toEqual(["module-loader: buildModulePath()"]);
  });

  it("tracks database receiver aliases and destructured query methods without flagging known non-SQL clients", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/databaseAliases.ts",
      [
        "const runner = db;",
        "const delegatedRunner = runner;",
        "const { query: runQuery } = pool;",
        "delegatedRunner.query(makeSql());",
        "runQuery(makeOtherSql());",
        "getDb().query(makeDynamicSql());",
        "const searchClient = new SearchClient();",
        "searchClient.query(makeSearchQuery());",
      ].join("\n"),
    );

    const unresolved = (await scanParameterCatalogBoundaries(root))
      .filter((violation) => violation.rule === "unresolved-boundary-expression")
      .map((violation) => violation.evidence)
      .sort();

    expect(unresolved).toEqual([
      "database-receiver: getDb()",
      "database: makeOtherSql()",
      "database: makeSql()",
    ]);
  });

  it("covers TABLE, COPY, quoted canonical relations, and nested SQL comments", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/sqlSurface.ts",
      [
        "db.query(`TABLE parameter_specs`);",
        "db.query(`COPY parameter_specs FROM STDIN`);",
        "db.query(`COPY parameter_spec_versions TO STDOUT`);",
        "db.query(`select id from \"parameter_catalog\".\"catalog_releases\"`);",
        "db.query(`select 1 /* outer /* from parameter_specs */ still comment */`);",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);
    expect(
      violations
        .filter((violation) => violation.rule === "legacy-catalog-raw-read")
        .map((violation) => violation.evidence.split(":", 1)[0])
        .sort(),
    ).toEqual(["read parameter_spec_versions", "read parameter_specs"]);
    expect(
      violations
        .filter((violation) => violation.rule === "legacy-catalog-sql-write")
        .map((violation) => violation.evidence.split(":", 1)[0]),
    ).toEqual(["write parameter_specs"]);
    expect(
      violations
        .filter((violation) => violation.rule === "canonical-catalog-raw-access")
        .map((violation) => violation.evidence.split(":", 1)[0]),
    ).toEqual(["parameter_catalog.catalog_releases"]);
  });

  it("defaults protected Catalog module roots to private with explicit public seams only", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/catalogImports.ts",
      [
        "import type { CatalogRuntime } from '../catalog-kernel/interface';",
        "import { parseCanonicalPropertyKey } from '../parameter-catalog-contract';",
        "import { cache } from '../catalog-kernel/cache/publicLooking';",
        "import { parser } from '../parameter-catalog-contract/normalization';",
        "import { writer } from '../parameter-governance/registration/writer';",
      ].join("\n"),
    );

    const forbidden = (await scanParameterCatalogBoundaries(root))
      .filter((violation) => violation.rule === "forbidden-catalog-internal-import")
      .map((violation) => violation.evidence)
      .sort();

    expect(forbidden).toEqual([
      "../catalog-kernel/cache/publicLooking",
      "../parameter-catalog-contract/normalization",
      "../parameter-governance/registration/writer",
    ]);
  });

  it("finds legacy parameter identity keys in element access, in checks, and has-own checks", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/payloadKeys.ts",
      [
        "declare const payload: Record<string, unknown>;",
        "payload['parameterSpecId'];",
        "'parameter_spec_id' in payload;",
        "Object.hasOwn(payload, 'parameterSpecVersionId');",
        "Object.prototype.hasOwnProperty.call(payload, 'parameter_spec_ids');",
      ].join("\n"),
    );

    const keys = (await scanParameterCatalogBoundaries(root))
      .filter((violation) => violation.rule === "legacy-parameter-spec-identifier")
      .map((violation) => violation.evidence)
      .sort();

    expect(keys).toEqual([
      "parameterSpecId",
      "parameterSpecVersionId",
      "parameter_spec_id",
      "parameter_spec_ids",
    ]);
  });

  it("ignores table-shaped text inside SQL literals and comments while retaining real access", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/sqlLexing.ts",
      [
        "const quoted = `select '-- from parameter_specs' as note`;",
        "const lineComment = `select 1 -- from parameter_specs`;",
        "const blockComment = `select 1 /* join parameter_specs */`;",
        "const real = `select id from parameter_specs where note = 'join parameter_specs'`;",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);
    const reads = violations.filter((violation) => violation.rule === "legacy-catalog-raw-read");

    expect(reads).toHaveLength(1);
    expect(reads[0].evidence).toContain("select id from parameter_specs");
  });

  it("preserves comment markers and escaped quotes inside double-quoted SQL identifiers", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/quotedIdentifiers.ts",
      [
        "const first = `select id from \"schema--name\".\"parameter_specs\"`;",
        "const second = `select id from \"schema/*\"\"name\".\"parameter_spec_versions\"`;",
        "const write = `update \"schema--name\".\"parameter_specs\" set lifecycle = 'retired'`;",
      ].join("\n"),
    );

    const violations = await scanParameterCatalogBoundaries(root);

    expect(
      violations
        .filter((violation) => violation.rule === "legacy-catalog-raw-read")
        .map((violation) => violation.evidence.split(":", 1)[0])
        .sort(),
    ).toEqual(["read parameter_spec_versions", "read parameter_specs"]);
    expect(
      violations
        .filter((violation) => violation.rule === "legacy-catalog-sql-write")
        .map((violation) => violation.evidence.split(":", 1)[0]),
    ).toEqual(["write parameter_specs"]);
  });

  it("rejects fixture and shard growth after the authorized fixture digest is fixed", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameters/first.ts",
      "export const read = `select id from parameter_specs`;\n",
    );
    initializeGitRepository(root);
    commitAll(root, "trusted consumer tree");
    const trustedBaseSha = runGit(root, "rev-parse", "HEAD");
    const initialArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root, trustedBaseSha),
      trustedBaseSha,
    );
    const initialFixtureBytes = await writeAllowlistArtifacts(root, initialArtifacts);
    const fixtureSha256 = createHash("sha256").update(initialFixtureBytes).digest("hex");
    commitAll(root, "seed trusted fixture");

    await expect(
      checkParameterCatalogBoundaries(root, trustedBaseSha, { trustedBaseSha, fixtureSha256 }),
    ).resolves.toMatchObject({ status: "passed" });

    await writeSource(
      root,
      "server/modules/parameters/second.ts",
      "export const write = `update parameter_specs set lifecycle = 'active'`;\n",
    );
    const grownArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root, trustedBaseSha),
      trustedBaseSha,
    );
    await writeAllowlistArtifacts(root, grownArtifacts);

    await expect(
      checkParameterCatalogBoundaries(root, trustedBaseSha, { trustedBaseSha, fixtureSha256 }),
    ).rejects.toThrow(/fixture.*digest/iu);
  });

  it("fails closed when the explicit trusted base is unavailable or not the HEAD merge-base", async () => {
    const unavailableRoot = await createConsumerTree();
    const unavailableSha = "2222222222222222222222222222222222222222";
    const unavailableArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(unavailableRoot),
      unavailableSha,
    );
    const unavailableFixture = await writeAllowlistArtifacts(unavailableRoot, unavailableArtifacts);
    const unavailableDigest = createHash("sha256").update(unavailableFixture).digest("hex");
    await expect(
      checkParameterCatalogBoundaries(unavailableRoot, unavailableSha, {
        trustedBaseSha: unavailableSha,
        fixtureSha256: unavailableDigest,
      }),
    ).rejects.toThrow(/fails closed/iu);

    const divergentRoot = await createConsumerTree();
    initializeGitRepository(divergentRoot);
    commitAll(divergentRoot, "common trusted fixture base");
    const fixtureBaseSha = runGit(divergentRoot, "rev-parse", "HEAD");
    const divergentArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(divergentRoot, fixtureBaseSha),
      fixtureBaseSha,
    );
    const divergentFixture = await writeAllowlistArtifacts(divergentRoot, divergentArtifacts);
    const divergentDigest = createHash("sha256").update(divergentFixture).digest("hex");
    commitAll(divergentRoot, "seed ratchet");
    runGit(divergentRoot, "switch", "-c", "feature/divergent");
    runGit(divergentRoot, "switch", "main");
    await writeSource(divergentRoot, "unrelated-main.txt", "main advanced\n");
    commitAll(divergentRoot, "advance main");
    const divergentTrustedBase = runGit(divergentRoot, "rev-parse", "HEAD");
    runGit(divergentRoot, "switch", "feature/divergent");

    await expect(
      checkParameterCatalogBoundaries(divergentRoot, divergentTrustedBase, {
        trustedBaseSha: fixtureBaseSha,
        fixtureSha256: divergentDigest,
      }),
    ).rejects.toThrow(/untrusted.*explicit base.*merge-base/iu);
  });

  it("rejects re-adding debt removed from the explicit trusted-base shard", async () => {
    const root = await createConsumerTree();
    const relativePath = "server/modules/parameters/monotonic.ts";
    const initialSource = [
      "export const first = `select id from parameter_specs`;",
      "export const second = `select id from parameter_spec_versions`;",
    ].join("\n");
    await writeSource(root, relativePath, initialSource);
    initializeGitRepository(root);
    commitAll(root, "trusted consumer tree");
    const fixtureBaseSha = runGit(root, "rev-parse", "HEAD");
    const initialArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root, fixtureBaseSha),
      fixtureBaseSha,
    );
    const fixtureBytes = await writeAllowlistArtifacts(root, initialArtifacts);
    const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
    commitAll(root, "seed initial fixture");

    await writeSource(root, relativePath, `${initialSource.split("\n")[0]}\n`);
    const removedId = initialArtifacts.fixture.violations.find((violation) =>
      violation.evidence.includes("parameter_spec_versions"),
    )?.id;
    expect(removedId).toBeDefined();
    const reducedArtifacts = {
      fixture: initialArtifacts.fixture,
      shards: initialArtifacts.shards.map((shard) => ({
        ...shard,
        entries: shard.entries.filter((entry) => entry.id !== removedId),
      })),
    };
    await writeAllowlistShards(root, reducedArtifacts);
    commitAll(root, "remove one debt");
    const trustedParentSha = runGit(root, "rev-parse", "HEAD");
    runGit(root, "switch", "-c", "feature/readd");

    await writeSource(root, relativePath, initialSource);
    await writeAllowlistShards(root, initialArtifacts);

    await expect(
      checkParameterCatalogBoundaries(root, trustedParentSha, {
        trustedBaseSha: fixtureBaseSha,
        fixtureSha256,
      }),
    ).rejects.toThrow(/trusted merge-base.*allow-list growth/iu);
  });

  it("builds one immutable fixture and eleven independently shrinkable shards", async () => {
    const root = await createConsumerTree();
    await writeSource(
      root,
      "server/modules/parameter-specs/repository.ts",
      "export const write = `update parameter_specs set lifecycle = 'retired' where id = $1`;\n",
    );
    await writeSource(
      root,
      "server/modules/parameter-topology/service.ts",
      "export const read = `select id from parameter_specs`;\n",
    );
    const violations = await scanParameterCatalogBoundaries(root);

    const artifacts = buildInitialAllowlistArtifacts(
      violations,
      "e84ca078ab8f7b7006fa8e635d722297a287d2a5",
    );

    expect(artifacts.fixture.violations).toHaveLength(2);
    expect(artifacts.shards).toHaveLength(11);
    expect(artifacts.shards.map((shard) => shard.family)).toEqual(
      ["S12-CGH", "S12-TOP", "S12-PRJ", "S12-FIL", "S12-AGT", "S12-LOG", "S12-DBG", "S12-DTS", "S12-KNW", "S12-MOD", "S12-OPS"],
    );
    expect(artifacts.shards.find((shard) => shard.family === "S12-CGH")?.entries).toHaveLength(1);
    expect(artifacts.shards.find((shard) => shard.family === "S12-TOP")?.entries).toHaveLength(1);
    expect(artifacts.shards.find((shard) => shard.family === "S12-OPS")?.entries).toEqual([]);
  });

  it("fails initializer authorization on dirty, staged, or wrong-HEAD state", async () => {
    const dirtyRoot = await createConsumerTree();
    initializeGitRepository(dirtyRoot);
    commitAll(dirtyRoot, "trusted base");
    const dirtyBase = runGit(dirtyRoot, "rev-parse", "HEAD");
    await writeSource(dirtyRoot, "dirty.txt", "dirty\n");
    await expect(
      initializeParameterCatalogAllowlist(dirtyRoot, {
        trustedBaseSha: dirtyBase,
        authorizedHeadSha: dirtyBase,
        expectedStatistics: boundaryInventoryStatistics(
          await scanParameterCatalogBoundaries(dirtyRoot, dirtyBase),
        ),
      }),
    ).rejects.toThrow(/clean/iu);

    const stagedRoot = await createConsumerTree();
    initializeGitRepository(stagedRoot);
    commitAll(stagedRoot, "trusted base");
    const stagedBase = runGit(stagedRoot, "rev-parse", "HEAD");
    await writeSource(stagedRoot, "staged.txt", "staged\n");
    runGit(stagedRoot, "add", "staged.txt");
    await expect(
      initializeParameterCatalogAllowlist(stagedRoot, {
        trustedBaseSha: stagedBase,
        authorizedHeadSha: stagedBase,
        expectedStatistics: boundaryInventoryStatistics(
          await scanParameterCatalogBoundaries(stagedRoot, stagedBase),
        ),
      }),
    ).rejects.toThrow(/clean/iu);

    const cleanRoot = await createConsumerTree();
    initializeGitRepository(cleanRoot);
    commitAll(cleanRoot, "trusted base");
    const cleanBase = runGit(cleanRoot, "rev-parse", "HEAD");
    await expect(
      initializeParameterCatalogAllowlist(cleanRoot, {
        trustedBaseSha: cleanBase,
        authorizedHeadSha: "ffffffffffffffffffffffffffffffffffffffff",
        expectedStatistics: boundaryInventoryStatistics(
          await scanParameterCatalogBoundaries(cleanRoot, cleanBase),
        ),
      }),
    ).rejects.toThrow(/caller-authorized/iu);
  });

  it("wires Hosted execution to an explicitly fetched and verified trusted base", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = await readFile(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

    expect(packageJson.scripts["parameter-catalog-boundaries:check"]).toBe(
      "tsx scripts/check-parameter-catalog-boundaries.ts",
    );
    const l1Static = workflow.split("\n  l1-static:")[1]?.split("\n  l1-frontend:")[0] ?? "";
    expect(l1Static).toContain('git fetch --no-tags origin "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}"');
    expect(l1Static).toContain('git rev-parse --verify "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}^{commit}"');
    expect(l1Static).toContain(
      "npm run test:scripts -- scripts/check-parameter-catalog-boundaries.test.ts",
    );
    expect(l1Static).toContain("fetch-depth: 0");
  });

  it("stages privately, validates the complete artifact set, and rolls back a partial publish", async () => {
    const root = await createConsumerTree();
    initializeGitRepository(root);
    commitAll(root, "trusted base");
    const trustedBaseSha = runGit(root, "rev-parse", "HEAD");
    const expectedStatistics = boundaryInventoryStatistics(
      await scanParameterCatalogBoundaries(root, trustedBaseSha),
    );
    let targetPaths: readonly string[] = [];

    await initializeParameterCatalogAllowlist(root, {
      trustedBaseSha,
      authorizedHeadSha: trustedBaseSha,
      expectedStatistics,
      afterStage: async (stagingRoot, stagedTargetPaths) => {
        expect((await stat(stagingRoot)).mode & 0o777).toBe(0o700);
        expect(stagedTargetPaths).toHaveLength(12);
        targetPaths = stagedTargetPaths;
      },
    });
    expect(targetPaths).toHaveLength(12);
    commitAll(root, "seed allow-list");
    const authorizedHeadSha = runGit(root, "rev-parse", "HEAD");
    const before = new Map(
      await Promise.all(
        targetPaths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const),
      ),
    );

    await expect(
      initializeParameterCatalogAllowlist(root, {
        trustedBaseSha,
        authorizedHeadSha,
        expectedStatistics,
        publishFaultAfter: 1,
      }),
    ).rejects.toThrow(/publication failure/iu);

    for (const [path, contents] of before) {
      expect(await readFile(join(root, path), "utf8")).toBe(contents);
    }
    expect((await readdir(root)).filter((name) => name.startsWith(".parameter-catalog-allowlist-stage-"))).toEqual([]);
  });

  it(
    "locks the post-refresh owner-path inventory against the reviewed S0-ID trusted base",
    async () => {
      const repoRoot = process.cwd();
      const [report, fixture] = await Promise.all([
        checkParameterCatalogBoundaries(repoRoot, "9b3ba7df7e21f5589684bc92c872da593ad4c246"),
        loadBoundaryViolationFixture(repoRoot),
      ]);

      expect(fixture.trustedBaseSha).toBe("9b3ba7df7e21f5589684bc92c872da593ad4c246");
      expect(boundaryInventoryStatistics(fixture.violations)).toEqual({
        violations: 3_519,
        duplicateBaseIdGroups: 577,
        duplicateBaseIdOccurrences: 1_975,
      });
      expect(report.status).toBe("failed");
      // The new node-type-root test repeats an existing call. Its first position
      // must not take the historical identity from the older test below it.
      expect(report.relocations.find((entry) => entry.id ===
        "S12-CGH:legacy-effective-governance-contract:48cedd95a59c21c6:e7c8785127abf5d9")?.observed).toMatchObject({
        id: "S12-CGH:legacy-effective-governance-contract:48cedd95a59c21c6:274893b18e873a7e",
        file: "server/modules/parameter-specs/effectiveDefinition.integration.test.ts",
        line: 264,
      });
      expect(report.unallowlisted).toEqual(expect.arrayContaining([expect.objectContaining({
        id: "S12-CGH:legacy-effective-governance-contract:48cedd95a59c21c6:192979529c607eba",
        line: 248,
      })]));
      const originalIds = new Set(originalRelocationRecord.pairs.map((pair) => pair.old.id));
      const runtimeIds = new Set(runtimeTopologyRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)));
      const postCutoverIds = new Set(postCutoverRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)));
      const debuggingTransferIds = new Set(
        debuggingTransferRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const originalRelocations = report.relocations.filter((entry) => originalIds.has(entry.id));
      const runtimeRelocations = report.relocations.filter((entry) => runtimeIds.has(entry.id));
      const postCutoverRelocations = report.relocations.filter((entry) => postCutoverIds.has(entry.id));
      const debuggingTransferRelocations = report.relocations.filter((entry) => debuggingTransferIds.has(entry.id));
      expect(originalRelocations).toHaveLength(23);
      expect(runtimeRelocations).toHaveLength(16);
      expect(postCutoverRelocations).toHaveLength(29);
      expect(runtimeRelocations.filter((entry) => entry.observed.file === "server/modules/parameter-topology/ingestService.ts")).toHaveLength(15);
      expect(runtimeRelocations.filter((entry) => entry.observed.file === "server/modules/parameter-topology/schemas.ts")).toHaveLength(1);
      expect(postCutoverRelocations.every((entry) => entry.observed.file === "server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts")).toBe(true);
      // Issue #846 added one reviewed record: four S12-DBG occurrences whose byte offsets
      // moved when the debugging catalog transfer added a route handler and repository
      // functions above them. No new allowance is granted; each pair is an existing
      // allowance restated at its new position.
      expect(debuggingTransferRelocations).toHaveLength(4);
      expect(
        debuggingTransferRelocations.every((entry) =>
          [
            "server/modules/debugging/routes.ts",
            "server/modules/debugging/catalogSplitRepository.ts",
          ].includes(entry.observed.file),
        ),
      ).toBe(true);
      expect(debuggingTransferRelocations.every((entry) => entry.id !== entry.observed.id)).toBe(true);
      // Issue #859 added one reviewed record: 59 S12-TOP occurrences whose byte
      // offsets moved when draft/writeback version indexing inserted imports and
      // helpers above them. No new allowance is granted; each pair restates an
      // existing allowance at its new position, and the one occurrence #859
      // genuinely added was removed from its source instead.
      const editServiceVersionIndexIds = new Set(
        editServiceVersionIndexRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const editServiceVersionIndexRelocations = report.relocations.filter((entry) =>
        editServiceVersionIndexIds.has(entry.id),
      );
      expect(editServiceVersionIndexRelocations).toHaveLength(59);
      expect(
        editServiceVersionIndexRelocations.filter(
          (entry) => entry.observed.file === "server/modules/parameter-topology/editService.ts",
        ),
      ).toHaveLength(26);
      expect(
        editServiceVersionIndexRelocations.filter(
          (entry) => entry.observed.file === "server/modules/parameter-topology/editService.test.ts",
        ),
      ).toHaveLength(28);
      expect(
        editServiceVersionIndexRelocations.filter(
          (entry) => entry.observed.file === "server/modules/parameter-topology/overlayWriteback.ts",
        ),
      ).toHaveLength(5);
      expect(editServiceVersionIndexRelocations.every((entry) => entry.id !== entry.observed.id)).toBe(true);
      const issue900Ids = new Set(issue900DashboardRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)));
      const issue900Relocations = report.relocations.filter((entry) => issue900Ids.has(entry.id));
      expect(issue900Relocations).toHaveLength(18);
      expect(issue900Relocations.filter((entry) => entry.observed.file === "server/modules/parameters/lifecycleRanking.integration.test.ts")).toHaveLength(14);
      expect(issue900Relocations.filter((entry) => entry.observed.file === "server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts")).toHaveLength(1);
      expect(issue900Relocations.filter((entry) => entry.observed.file === "server/modules/parameters/dashboard/repository.ts")).toHaveLength(3);
      expect(issue900Relocations.every((entry) => entry.id !== entry.observed.id)).toBe(true);
      // This set distinguishes the fixed source-workflow proof identities from the
      // new successor aliases; the historical record itself remains unchanged.
      const sourceWorkflowIds = new Set(
        sourceWorkflowRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const historicalIds = new Set([
        ...originalIds, ...runtimeIds, ...postCutoverIds, ...debuggingTransferIds,
        ...editServiceVersionIndexIds, ...sourceWorkflowIds, ...issue900Ids,
      ]);
      const consumerIds = new Set(consumerRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)));
      const familyIds = new Set(
        familySuccessorRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const rewrittenIds = new Set(
        rewrittenSliceRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const seedDriverIds = new Set(seedDriverRecords.flatMap((record) => record.files.flatMap((file) => file.pairs.map((pair) => pair.old.id))));
      const issue901RouteTestIds = new Set(
        issue901RoutesTestRelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      const issue911Ids = new Set(
        issue911RelocationRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)),
      );
      expect(seedDriverRecords.map((record) => record.files[0]!.pairs.length)).toEqual([50, 11]);
      expect(report.relocations.filter((entry) => seedDriverIds.has(entry.id))).toHaveLength(61);
      expect(report.relocations.filter((entry) => issue911Ids.has(entry.id))).toHaveLength(133);
      expect(issue901RoutesTestRelocationRecord.files[0]!.pairs).toHaveLength(5);
      const issue901RouteTestRelocations = report.relocations.filter((entry) => issue901RouteTestIds.has(entry.id));
      expect(issue901RouteTestRelocations).toHaveLength(5);
      expect(issue901RouteTestRelocations.every(
        (entry) => entry.observed.file === "server/modules/parameters/routes.test.ts",
      )).toBe(true);
      expect(report.relocations.filter((entry) => consumerIds.has(entry.id))).toHaveLength(237);
      const t14SuccessorIds = new Set(issue913T14SuccessorRecords.flatMap((record) =>
        record.files.flatMap((file) => file.pairs.map((pair) => pair.old.id))));
      expect(t14SuccessorIds.size).toBe(issue913T14SuccessorPairCount);
      expect(report.relocations.filter((entry) => t14SuccessorIds.has(entry.id))).toHaveLength(issue913T14SuccessorPairCount);
      expect(issue913T14RetiredSourceIds.every((id) => !report.relocations.some((entry) => entry.id === id))).toBe(true);
      const staleSuccessorIds = new Set(issue913StaleSuccessorRecord.files.flatMap((file) =>
        file.pairs.map((pair) => pair.old.id)));
      expect(staleSuccessorIds.size).toBe(issue913StaleSuccessorPairCount);
      expect(report.relocations.filter((entry) => staleSuccessorIds.has(entry.id))).toHaveLength(issue913StaleSuccessorPairCount);
      expect(issue913StaleRetiredSourceIds).toHaveLength(17);
      expect(issue913StaleRetiredSourceIds.every((id) =>
        !report.relocations.some((entry) => entry.id === id)
        && !report.violations.some((entry) => entry.id === id),
      )).toBe(true);
      const issue853SuccessorIds = new Set(issue853SuccessorRecords.flatMap((record) =>
        record.files.flatMap((file) => file.pairs.map((pair) => pair.old.id))));
      expect(issue853SuccessorIds.size).toBe(85);
      expect(report.relocations.filter((entry) => issue853SuccessorIds.has(entry.id))).toHaveLength(85);
      const retiredIds = new Set([
        ...issue913T14RetiredSourceIds,
        ...issue853CActionRetiredSourceIds,
        ...await loadIssue853CRemainderRetiredSourceIds(process.cwd()),
      ]);
      const activeFamilyIds = report.relocations
        .filter((entry) => familyIds.has(entry.id)).map((entry) => entry.id).sort();
      const activeRewrittenIds = report.relocations
        .filter((entry) => rewrittenIds.has(entry.id)).map((entry) => entry.id).sort();
      expect([...familyIds].filter((id) => retiredIds.has(id))).toHaveLength(14);
      expect(activeFamilyIds).toEqual([...familyIds].filter((id) => !retiredIds.has(id)).sort());
      expect(activeFamilyIds).toHaveLength(251);
      expect(activeRewrittenIds).toEqual([...rewrittenIds].filter((id) => !retiredIds.has(id)).sort());
      const otherwiseUnclassified = report.relocations.filter(
          (entry) =>
            !historicalIds.has(entry.id)
            && !consumerIds.has(entry.id)
            && !familyIds.has(entry.id)
            && !rewrittenIds.has(entry.id)
            && !seedDriverIds.has(entry.id)
            && !issue901RouteTestIds.has(entry.id)
            && !staleSuccessorIds.has(entry.id)
            && !issue853SuccessorIds.has(entry.id),
        );
      const expectedIssue911Unclassified = [...issue911Ids].filter((id) =>
        !historicalIds.has(id)
        && !consumerIds.has(id)
        && !familyIds.has(id)
        && !rewrittenIds.has(id)
        && !seedDriverIds.has(id)
        && !issue901RouteTestIds.has(id)
        && !staleSuccessorIds.has(id),
      ).sort();
      expect(expectedIssue911Unclassified).toHaveLength(76);
      expect(otherwiseUnclassified.map((entry) => entry.id).sort()).toEqual(expectedIssue911Unclassified);
      expect(otherwiseUnclassified.filter((entry) => !issue911Ids.has(entry.id))).toHaveLength(0);
      expect(report.relocations).toHaveLength(946);
      expect(new Set(report.relocations.map((entry) => entry.id)).size).toBe(946);
      expect(new Set(report.relocations.map((entry) => entry.observed.id)).size).toBe(946);
      expect(new Set(report.relocations.flatMap((entry) => [entry.id, entry.observed.id])).size).toBe(1_892);
      expect(currentUnallowlistedRecord.schemaVersion).toBe(1);
      expect(currentUnallowlistedRecord.baseHead).toBe("78e10fb2e9ebb29ada9db7fdf854a5c60f4bfc89");
      expect(currentUnallowlistedRecord.ownerHead).toBe("78e7d699d6868d76560f166ec9d233aece1657b1");
      expect(currentUnallowlistedRecord.baseUnallowlistedIds).toHaveLength(177);
      expect(currentUnallowlistedRecord.ownerAddedUnallowlistedIds).toHaveLength(23);
      expect(new Set([
        ...currentUnallowlistedRecord.baseUnallowlistedIds,
        ...currentUnallowlistedRecord.ownerAddedUnallowlistedIds,
      ]).size).toBe(200);
      const previousIds = [
        ...currentUnallowlistedRecord.baseUnallowlistedIds,
        ...currentUnallowlistedRecord.ownerAddedUnallowlistedIds,
      ].sort();
      expect(jointUnallowlistedRecord.schemaVersion).toBe(1);
      expect(jointUnallowlistedRecord.baseHead).toBe("f73abe902926625d49ba4a402df067c2df8f54ee");
      expect(jointUnallowlistedRecord.priorOwnerHead).toBe("443a7149df6689a6fd9fd9692558d5827cc2525d");
      expect(jointUnallowlistedRecord.ownerHead).toBe("6aa8a6655fe273c1f690d5309ce678d2ecd9a911");
      expect(jointUnallowlistedRecord.dHead).toBe("200b90a95c53c41fe4c3a9545b17ba8b5a8164b7");
      expect(execFileSync("git", ["cat-file", "-t", jointUnallowlistedRecord.ownerHead], { encoding: "utf8" }).trim()).toBe("commit");
      expect(execFileSync("git", ["merge-base", "--is-ancestor", jointUnallowlistedRecord.priorOwnerHead, jointUnallowlistedRecord.ownerHead], { encoding: "utf8" })).toBe("");
      expect(execFileSync("git", ["merge-base", "--is-ancestor", jointUnallowlistedRecord.ownerHead, "HEAD"], { encoding: "utf8" })).toBe("");
      expect(execFileSync("git", ["diff", "--name-only", jointUnallowlistedRecord.priorOwnerHead, jointUnallowlistedRecord.ownerHead], { encoding: "utf8" }).trim().split("\n").sort()).toEqual(
        Object.keys(jointUnallowlistedRecord.bChangedBlobs).sort(),
      );
      for (const [file, blobs] of Object.entries(jointUnallowlistedRecord.bChangedBlobs)) {
        expect(execFileSync("git", ["rev-parse", `${jointUnallowlistedRecord.priorOwnerHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.before);
        expect(execFileSync("git", ["rev-parse", `${jointUnallowlistedRecord.ownerHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.after);
        expect(execFileSync("git", ["rev-parse", `${b948CurrentSuccessor.priorAHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.after);
      }
      expect(jointUnallowlistedRecord.retired).toHaveLength(27);
      expect(jointUnallowlistedRecord.moved).toHaveLength(11);
      expect(jointUnallowlistedRecord.currentUnallowlistedIds).toHaveLength(173);
      expect(c940CurrentSuccessor.schemaVersion).toBe(1);
      expect(c940CurrentSuccessor.priorHead).toBe("a51ba55c955cb0852819bc49d95ea26404093b73");
      expect(c940CurrentSuccessor.cHead).toBe("5f8a05f8bfbc9374c64a8b147653170894db2a1b");
      expect(c940CurrentSuccessor.dHead).toBe("fbec1bd5134fc0256205f6fcfb40d0ccf6fa48f5");
      for (const sha of [c940CurrentSuccessor.priorHead, c940CurrentSuccessor.cHead, c940CurrentSuccessor.dHead]) {
        expect(execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { encoding: "utf8" })).toBe("");
      }
      expect(Object.keys(c940CurrentSuccessor.blobs).sort()).toEqual([
        "server/modules/parameter-files/conflictService.test.ts",
        "server/modules/parameter-files/conflictService.ts",
      ]);
      const previousBytes = new Map<string, Buffer>();
      for (const [file, blobs] of Object.entries(c940CurrentSuccessor.blobs)) {
        expect(execFileSync("git", ["rev-parse", `${c940CurrentSuccessor.priorHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.before);
        expect(execFileSync("git", ["rev-parse", `${c940CurrentSuccessor.cHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.after);
        expect(execFileSync("git", ["rev-parse", `${c940CurrentSuccessor.dHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.before);
        const current = await readFile(`${process.cwd()}/${file}`);
        const currentBlob = file === "server/modules/parameter-files/conflictService.ts"
          ? b948CurrentSuccessor.blobs[file]!.after : blobs.after;
        expect(createHash("sha1").update(`blob ${current.length}\0`).update(current).digest("hex")).toBe(currentBlob);
        previousBytes.set(file, execFileSync("git", ["cat-file", "blob", blobs.before]));
      }
      expect(c940CurrentSuccessor.moved).toHaveLength(3);
      const oldMoved = new Set(c940CurrentSuccessor.moved.map((entry) => entry.oldId));
      const newMoved = new Set(c940CurrentSuccessor.moved.map((entry) => entry.newId));
      expect(oldMoved.size).toBe(3);
      expect(newMoved.size).toBe(3);
      const priorAUnallowlisted = [
        ...jointUnallowlistedRecord.currentUnallowlistedIds.filter((id) => !oldMoved.has(id)), ...newMoved,
      ];
      expect(priorAUnallowlisted).toHaveLength(173);
      expect(b948CurrentSuccessor.schemaVersion).toBe(1);
      expect(b948CurrentSuccessor.priorAHead).toBe("bc9c2d1f324d39498205913ec5c9a38f680a2d8b");
      expect(b948CurrentSuccessor.dHead).toBe("783c1545d7cbe07a6bb26cc8df1d5c07dd380b81");
      expect(b948CurrentSuccessor.cHead).toBe("f8879b054c2a410ff6a42a000569161e7f89f0c9");
      expect(b948CurrentSuccessor.bHead).toBe("f44f03a2b881ae11e90b9022edd647d5c0f4c46e");
      expect(b948CurrentSuccessor.aMergeHead).toBe("0304913bc74afd51877523436475e7ad75ebfc6d");
      for (const [ancestor, descendant] of [
        [b948CurrentSuccessor.priorAHead, b948CurrentSuccessor.dHead],
        [b948CurrentSuccessor.dHead, b948CurrentSuccessor.cHead],
        [b948CurrentSuccessor.cHead, b948CurrentSuccessor.bHead],
        [b948CurrentSuccessor.bHead, b948CurrentSuccessor.aMergeHead],
        [b948CurrentSuccessor.aMergeHead, "HEAD"],
      ]) {
        expect(execFileSync("git", ["merge-base", "--is-ancestor", ancestor!, descendant!], { encoding: "utf8" })).toBe("");
      }
      expect(b948CurrentSuccessor.movedUnallowlisted).toHaveLength(1);
      expect(b948CurrentSuccessor.newUnallowlisted).toHaveLength(1);
      const movedB948 = b948CurrentSuccessor.movedUnallowlisted[0]!;
      const newB948 = b948CurrentSuccessor.newUnallowlisted[0]!;
      expect(priorAUnallowlisted).toContain(movedB948.oldId);
      expect(priorAUnallowlisted).not.toContain(newB948.id);
      expect(report.unallowlisted.map((entry) => entry.id).sort()).toEqual([
        ...priorAUnallowlisted.filter((id) => id !== movedB948.oldId),
        movedB948.newId, newB948.id,
      ].sort());
      expect(new Set(report.unallowlisted.map((entry) => entry.id)).size).toBe(174);
      for (const [file, blobs] of Object.entries(b948CurrentSuccessor.blobs)) {
        if (blobs.before === null) {
          expect(execFileSync("git", ["ls-tree", b948CurrentSuccessor.priorAHead, "--", file], { encoding: "utf8" })).toBe("");
        } else {
          expect(execFileSync("git", ["rev-parse", `${b948CurrentSuccessor.priorAHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.before);
        }
        for (const sha of [b948CurrentSuccessor.cHead, b948CurrentSuccessor.bHead, b948CurrentSuccessor.aMergeHead]) {
          expect(execFileSync("git", ["rev-parse", `${sha}:${file}`], { encoding: "utf8" }).trim()).toBe(blobs.after);
        }
      }
      const priorABytes = execFileSync("git", ["show", `${b948CurrentSuccessor.priorAHead}:${movedB948.file}`]);
      const currentB948Bytes = await readFile(`${process.cwd()}/${movedB948.file}`);
      const oldB948Slice = priorABytes.subarray(movedB948.oldByteStart, movedB948.oldByteEnd);
      expect(createHash("sha256").update(oldB948Slice).digest("hex")).toBe(movedB948.sliceSha256);
      expect(currentB948Bytes.subarray(movedB948.newByteStart, movedB948.newByteEnd)).toEqual(oldB948Slice);
      const observedMoved = report.unallowlisted.find((entry) => entry.id === movedB948.newId);
      expect(observedMoved?.file).toBe(movedB948.file);
      expect(observedMoved?.byteStart).toBe(movedB948.newByteStart);
      expect(observedMoved?.byteEnd).toBe(movedB948.newByteEnd);
      const observedNew = report.unallowlisted.find((entry) => entry.id === newB948.id);
      expect(observedNew?.file).toBe(newB948.file);
      expect(observedNew?.rule).toBe(newB948.rule);
      expect(observedNew?.line).toBe(newB948.line);
      expect(observedNew?.byteStart).toBe(newB948.byteStart);
      expect(observedNew?.byteEnd).toBe(newB948.byteEnd);
      const newB948Bytes = await readFile(`${process.cwd()}/${newB948.file}`);
      expect(createHash("sha256").update(newB948Bytes.subarray(newB948.byteStart, newB948.byteEnd)).digest("hex")).toBe(newB948.sliceSha256);
      for (const entry of c940CurrentSuccessor.moved) {
        expect(jointUnallowlistedRecord.currentUnallowlistedIds).toContain(entry.oldId);
        expect(entry.oldId.split(":").slice(0, 3)).toEqual(entry.newId.split(":").slice(0, 3));
        const oldSlice = previousBytes.get(entry.file)!.subarray(entry.oldByteStart, entry.oldByteEnd);
        const observedId = entry.newId === movedB948.oldId ? movedB948.newId : entry.newId;
        const observed = report.unallowlisted.find((violation) => violation.id === observedId);
        expect(observed?.file).toBe(entry.file);
        expect(createHash("sha256").update(oldSlice).digest("hex")).toBe(entry.sliceSha256);
        const currentBytes = await readFile(`${process.cwd()}/${entry.file}`);
        expect(currentBytes.subarray(observed!.byteStart, observed!.byteEnd)).toEqual(oldSlice);
        expect(createHash("sha256").update([
          "9b3ba7df7e21f5589684bc92c872da593ad4c246",
          c940CurrentSuccessor.blobs[entry.file]!.before,
          String(entry.oldByteStart), String(entry.oldByteEnd), observed!.token, observed!.evidence,
          entry.file, observed!.family, observed!.rule,
        ].join("\0")).digest("hex").slice(0, 16)).toBe(entry.oldId.split(":")[3]);
      }
      const fixedSuccessorPairs = c940FixedSuccessors.flatMap((record) => record.files.flatMap((file) => file.pairs));
      expect(fixedSuccessorPairs).toHaveLength(5);
      const b948FixedPairs = b948FixedSuccessor.files.flatMap((file) => file.pairs);
      expect(b948FixedPairs).toHaveLength(2);
      const b948FixedByOldId = new Map(b948FixedPairs.map((pair) => [pair.old.id, pair.new.id]));
      for (const pair of fixedSuccessorPairs) {
        expect(report.relocations.find((entry) => entry.id === pair.old.id)?.observed.id).toBe(
          b948FixedByOldId.get(pair.old.id) ?? pair.new.id,
        );
      }
      expect(previousIds.filter((id) => !jointUnallowlistedRecord.currentUnallowlistedIds.includes(id))).toEqual(
        [...jointUnallowlistedRecord.retired, ...jointUnallowlistedRecord.moved].map((entry) => entry.oldId).sort(),
      );
      expect(jointUnallowlistedRecord.currentUnallowlistedIds.filter((id) => !previousIds.includes(id))).toEqual(
        jointUnallowlistedRecord.moved.map((entry) => entry.newId).sort(),
      );
      expect(Object.keys(currentUnallowlistedRecord.ownerBlobs).sort()).toEqual([
        "server/modules/parameter-files/canonicalMemberRemoval.integration.test.ts",
        "server/modules/parameter-files/canonicalMemberRemoval.ts",
      ]);
      for (const [file, blob] of Object.entries(currentUnallowlistedRecord.ownerBlobs)) {
        expect(execFileSync("git", ["rev-parse", `${jointUnallowlistedRecord.baseHead}:${file}`], { encoding: "utf8" }).trim()).toBe(blob);
      }
      const oldSources = new Map<string, Buffer>();
      const newSources = new Map<string, Buffer>();
      for (const [file, oldBlob] of Object.entries(jointUnallowlistedRecord.oldBlobs)) {
        expect(execFileSync("git", ["rev-parse", `${jointUnallowlistedRecord.baseHead}:${file}`], { encoding: "utf8" }).trim()).toBe(oldBlob);
        expect(execFileSync("git", ["rev-parse", `${jointUnallowlistedRecord.dHead}:${file}`], { encoding: "utf8" }).trim()).toBe(jointUnallowlistedRecord.currentBlobs[file]);
        oldSources.set(file, execFileSync("git", ["cat-file", "blob", oldBlob]));
        const source = await readFile(`${process.cwd()}/${file}`);
        expect(createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex")).toBe(jointUnallowlistedRecord.currentBlobs[file]);
        newSources.set(file, source);
      }
      for (const entry of [...jointUnallowlistedRecord.retired, ...jointUnallowlistedRecord.moved]) {
        expect(entry.oldId.split(":")[1]).toBe(entry.oldRule);
        const oldSlice = oldSources.get(entry.file)!.subarray(entry.oldByteStart, entry.oldByteEnd);
        expect(createHash("sha256").update(oldSlice).digest("hex")).toBe(entry.oldSliceSha256);
        if ("newId" in entry) {
          expect(entry.newId.split(":").slice(0, 3)).toEqual(entry.oldId.split(":").slice(0, 3));
          const observed = report.unallowlisted.find((item) => item.id === entry.newId);
          expect(observed).toBeDefined();
          expect(observed!.file).toBe(entry.file);
          expect(observed!.rule).toBe(entry.oldRule);
          expect(observed!.line).toBe(entry.oldLine + 1);
          expect(newSources.get(entry.file)!.subarray(observed!.byteStart, observed!.byteEnd)).toEqual(oldSlice);
        } else {
          expect(newSources.get(entry.file)!.includes(oldSlice)).toBe(false);
        }
      }
      expect(report.summary).toEqual({
        violations: 3_565,
        allowlisted: 3_391,
        unallowlisted: 174,
        staleAllowances: 0,
        metadataMismatches: 0,
        allowlistGrowth: 0,
      });
      expect(report.violations.map((violation) => violation.id)).toEqual(
        [...report.violations.map((violation) => violation.id)].sort(),
      );
    },
    120_000,
  );
});

async function createConsumerTree() {
  const root = await mkdtemp(join(tmpdir(), "parameter-catalog-boundaries-"));
  const requiredDirectories = [
    "server/modules/parameter-specs",
    "server/modules/parameter-topology",
    "server/modules/parameters",
    "server/modules/parameter-drafts",
    "server/modules/parameter-files",
    "server/modules/logs",
    "server/modules/debugging",
    "server/modules/dts-reload",
    "server/modules/knowledge",
    "src/features/knowledge",
    "server/modules/parameter-modules",
    "server/modules/operations",
  ];
  for (const directory of requiredDirectories) {
    await mkdir(join(root, directory), { recursive: true });
  }
  const requiredFiles = [
    "src/infrastructure/http/parameterAdminClient.ts",
    "e2e/acceptance/parameter-import-wizard.acceptance.spec.ts",
    "src/application/ports/ParameterTopologyRepository.ts",
    "src/infrastructure/http/parameterTopologyClient.ts",
    "src/infrastructure/http/parameterTopologyClient.test.ts",
    "e2e/acceptance/parameter-topology.acceptance.spec.ts",
    "src/application/ports/ParameterRepository.ts",
    "src/infrastructure/http/parameterClient.ts",
    "src/infrastructure/http/parameterDtos.ts",
    "src/infrastructure/http/parameterClient.test.ts",
    "src/infrastructure/http/parameterDtos.test.ts",
    "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts",
    "src/application/ports/ParameterFileRepository.ts",
    "src/infrastructure/http/parameterFileClient.ts",
    "src/infrastructure/http/parameterFileClient.test.ts",
    "e2e/acceptance/parameter-files.acceptance.spec.ts",
    "server/modules/agent/tools/actionTools.ts",
    "server/modules/agent/toolRegistry.ts",
    "server/modules/agent/toolMetadata.ts",
    "server/modules/agent/tools/actionTools.test.ts",
    "server/modules/agent/tools/actionTools.integration.test.ts",
    "server/modules/agent/toolRegistry.test.ts",
    "e2e/acceptance/xiaoze-action.acceptance.spec.ts",
    "server/modules/agent/tools/perceptionTools.ts",
    "server/modules/agent/tools/perceptionTools.test.ts",
    "src/application/ports/LogAnalysisRepository.ts",
    "src/infrastructure/http/logClient.ts",
    "src/infrastructure/http/logDtos.ts",
    "src/infrastructure/http/logClient.test.ts",
    "src/infrastructure/http/logDtos.test.ts",
    "e2e/acceptance/log-analysis.acceptance.spec.ts",
    "src/application/ports/DebuggingGateway.ts",
    "src/infrastructure/http/debuggingClient.ts",
    "src/infrastructure/http/debuggingDtos.ts",
    "src/infrastructure/http/debuggingClient.test.ts",
    "src/infrastructure/http/debuggingDtos.test.ts",
    "e2e/acceptance/debugging-admin.acceptance.spec.ts",
    "src/application/ports/DtsReloadRepository.ts",
    "src/infrastructure/http/dtsReloadClient.ts",
    "e2e/acceptance/dts-reload-deploy.acceptance.spec.ts",
    "server/modules/knowledge/relatedKnowledge.ts",
    "src/application/ports/KnowledgeRepository.ts",
    "src/infrastructure/http/knowledgeClient.ts",
    "src/infrastructure/http/knowledgeClient.test.ts",
    "e2e/acceptance/knowledge.acceptance.spec.ts",
    "src/application/ports/ParameterModuleRegistryRepository.ts",
    "src/infrastructure/http/parameterModuleRegistryClient.ts",
    "e2e/acceptance/hierarchical-modules.acceptance.spec.ts",
    "scripts/reconcile-parameter-definitions.ts",
  ];
  for (const file of requiredFiles) {
    await writeSource(root, file, "export {};\n");
  }
  return root;
}

async function writeSource(root: string, relativePath: string, contents: string) {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function writeAllowlistArtifacts(
  root: string,
  artifacts: ReturnType<typeof buildInitialAllowlistArtifacts>,
) {
  const fixtureBytes = `${JSON.stringify(artifacts.fixture, null, 2)}\n`;
  await writeSource(root, boundaryViolationFixturePath, fixtureBytes);
  await writeAllowlistShards(root, artifacts);
  return fixtureBytes;
}

async function writeAllowlistShards(
  root: string,
  artifacts: ReturnType<typeof buildInitialAllowlistArtifacts>,
) {
  const shardFiles = {
    "S12-CGH": "s12-cgh.json",
    "S12-TOP": "s12-top.json",
    "S12-PRJ": "s12-prj.json",
    "S12-FIL": "s12-fil.json",
    "S12-AGT": "s12-agt.json",
    "S12-LOG": "s12-log.json",
    "S12-DBG": "s12-dbg.json",
    "S12-DTS": "s12-dts.json",
    "S12-KNW": "s12-knw.json",
    "S12-MOD": "s12-mod.json",
    "S12-OPS": "s12-ops.json",
  } as const;
  for (const shard of artifacts.shards) {
    await writeSource(
      root,
      `${allowlistShardDirectory}/${shardFiles[shard.family]}`,
      `${JSON.stringify(shard, null, 2)}\n`,
    );
  }
}

function initializeGitRepository(root: string) {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Boundary Checker Test");
  runGit(root, "config", "user.email", "boundary-checker@example.invalid");
}

function commitAll(root: string, message: string) {
  runGit(root, "add", ".");
  runGit(root, "commit", "-m", message);
}

function runGit(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
