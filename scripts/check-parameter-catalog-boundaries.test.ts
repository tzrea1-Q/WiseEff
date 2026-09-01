import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildInitialAllowlistArtifacts,
  checkParameterCatalogBoundaries,
  scanParameterCatalogBoundaries,
} from "./check-parameter-catalog-boundaries";
import {
  allowlistShardDirectory,
  boundaryViolationFixturePath,
  loadBoundaryViolationFixture,
} from "./parameter-catalog-allowlist/index";

describe("parameter catalog boundary checker", () => {
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
        "const catalogRead = `select subject_id from catalog_subjects`;",
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

  it("keeps stable violation IDs when only comments and line positions change", async () => {
    const firstRoot = await createConsumerTree();
    const secondRoot = await createConsumerTree();
    const relativePath = "server/modules/parameters/repository.ts";
    const source = "export const read = `select id from parameter_specs where id = $1`;\n";
    await writeSource(firstRoot, relativePath, source);
    await writeSource(secondRoot, relativePath, `// moved down\n\n${source}`);

    const first = await scanParameterCatalogBoundaries(firstRoot);
    const second = await scanParameterCatalogBoundaries(secondRoot);

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.line)).not.toEqual(second.map((item) => item.line));
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
    expect(second?.id).toBe(first?.id);
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
    expect(ownerByFile.has("server/modules/agent/tools/perceptionTools.ts")).toBe(false);
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
    const baselineSha = "e84ca078ab8f7b7006fa8e635d722297a287d2a5";
    await writeSource(
      root,
      "server/modules/parameters/first.ts",
      "export const read = `select id from parameter_specs`;\n",
    );
    const initialArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root),
      baselineSha,
    );
    const initialFixtureBytes = await writeAllowlistArtifacts(root, initialArtifacts);
    const fixtureSha256 = createHash("sha256").update(initialFixtureBytes).digest("hex");
    initializeGitRepository(root);
    commitAll(root, "seed trusted fixture");
    runGit(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    runGit(root, "switch", "-c", "feature/tamper");

    await expect(
      checkParameterCatalogBoundaries(root, { baselineSha, fixtureSha256 }),
    ).resolves.toMatchObject({ status: "passed" });

    await writeSource(
      root,
      "server/modules/parameters/second.ts",
      "export const write = `update parameter_specs set lifecycle = 'active'`;\n",
    );
    const grownArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root),
      baselineSha,
    );
    await writeAllowlistArtifacts(root, grownArtifacts);

    await expect(
      checkParameterCatalogBoundaries(root, { baselineSha, fixtureSha256 }),
    ).rejects.toThrow(/fixture.*digest/iu);
  });

  it("fails closed when origin/main is unavailable or no longer the HEAD merge-base", async () => {
    const unavailableRoot = await createConsumerTree();
    const baselineSha = "2222222222222222222222222222222222222222";
    const unavailableArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(unavailableRoot),
      baselineSha,
    );
    const unavailableFixture = await writeAllowlistArtifacts(unavailableRoot, unavailableArtifacts);
    const unavailableDigest = createHash("sha256").update(unavailableFixture).digest("hex");
    await expect(
      checkParameterCatalogBoundaries(unavailableRoot, {
        baselineSha,
        fixtureSha256: unavailableDigest,
      }),
    ).rejects.toThrow(/fails closed/iu);

    const divergentRoot = await createConsumerTree();
    const divergentArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(divergentRoot),
      baselineSha,
    );
    const divergentFixture = await writeAllowlistArtifacts(divergentRoot, divergentArtifacts);
    const divergentDigest = createHash("sha256").update(divergentFixture).digest("hex");
    initializeGitRepository(divergentRoot);
    commitAll(divergentRoot, "seed common base");
    runGit(divergentRoot, "switch", "-c", "feature/divergent");
    runGit(divergentRoot, "switch", "main");
    await writeSource(divergentRoot, "unrelated-main.txt", "main advanced\n");
    commitAll(divergentRoot, "advance main");
    runGit(divergentRoot, "update-ref", "refs/remotes/origin/main", "HEAD");
    runGit(divergentRoot, "switch", "feature/divergent");

    await expect(
      checkParameterCatalogBoundaries(divergentRoot, {
        baselineSha,
        fixtureSha256: divergentDigest,
      }),
    ).rejects.toThrow(/untrusted.*origin\/main.*merge-base/iu);
  });

  it("rejects re-adding debt removed from the trusted merge-base shard", async () => {
    const root = await createConsumerTree();
    const baselineSha = "1111111111111111111111111111111111111111";
    const relativePath = "server/modules/parameters/monotonic.ts";
    const initialSource = [
      "export const first = `select id from parameter_specs`;",
      "export const second = `select id from parameter_spec_versions`;",
    ].join("\n");
    await writeSource(root, relativePath, initialSource);
    const initialArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root),
      baselineSha,
    );
    const fixtureBytes = await writeAllowlistArtifacts(root, initialArtifacts);
    const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
    initializeGitRepository(root);
    commitAll(root, "seed initial fixture");

    await writeSource(root, relativePath, `${initialSource.split("\n")[0]}\n`);
    const reducedArtifacts = buildInitialAllowlistArtifacts(
      await scanParameterCatalogBoundaries(root),
      baselineSha,
    );
    await writeAllowlistShards(root, reducedArtifacts);
    commitAll(root, "remove one debt");
    runGit(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    runGit(root, "switch", "-c", "feature/readd");

    await writeSource(root, relativePath, initialSource);
    await writeAllowlistShards(root, initialArtifacts);

    await expect(
      checkParameterCatalogBoundaries(root, { baselineSha, fixtureSha256 }),
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

  it(
    "closes the current repository inventory against only the named decreasing shards",
    async () => {
      const repoRoot = process.cwd();
      const [report, fixture] = await Promise.all([
        checkParameterCatalogBoundaries(repoRoot),
        loadBoundaryViolationFixture(repoRoot),
      ]);

      expect(fixture.baselineSha).toBe("e84ca078ab8f7b7006fa8e635d722297a287d2a5");
      expect(report.status).toBe("passed");
      expect(report.summary).toMatchObject({
        unallowlisted: 0,
        staleAllowances: 0,
        metadataMismatches: 0,
        allowlistGrowth: 0,
      });
      expect(report.violations.map((violation) => violation.id)).toEqual(
        [...report.violations.map((violation) => violation.id)].sort(),
      );
    },
    60_000,
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
    "src/application/ports/ParameterTopologyRepository.ts",
    "src/infrastructure/http/parameterTopologyClient.ts",
    "src/application/ports/ParameterRepository.ts",
    "src/infrastructure/http/parameterClient.ts",
    "src/infrastructure/http/parameterDtos.ts",
    "src/application/ports/ParameterFileRepository.ts",
    "src/infrastructure/http/parameterFileClient.ts",
    "server/modules/agent/tools/actionTools.ts",
    "server/modules/agent/toolRegistry.ts",
    "server/modules/agent/toolMetadata.ts",
    "src/application/ports/LogAnalysisRepository.ts",
    "src/infrastructure/http/logClient.ts",
    "src/infrastructure/http/logDtos.ts",
    "src/application/ports/DebuggingGateway.ts",
    "src/infrastructure/http/debuggingClient.ts",
    "src/infrastructure/http/debuggingDtos.ts",
    "src/application/ports/DtsReloadRepository.ts",
    "src/infrastructure/http/dtsReloadClient.ts",
    "server/modules/knowledge/relatedKnowledge.ts",
    "src/application/ports/KnowledgeRepository.ts",
    "src/infrastructure/http/knowledgeClient.ts",
    "src/application/ports/ParameterModuleRegistryRepository.ts",
    "src/infrastructure/http/parameterModuleRegistryClient.ts",
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
