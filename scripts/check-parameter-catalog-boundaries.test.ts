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
  return fixtureBytes;
}
