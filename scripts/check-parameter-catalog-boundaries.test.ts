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
  consumerShardDefinitions,
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
      consumerShardDefinitions.map(([family]) => family),
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
  for (const [, familyRoot] of consumerShardDefinitions) {
    await mkdir(join(root, familyRoot), { recursive: true });
  }
  return root;
}

async function writeSource(root: string, relativePath: string, contents: string) {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}
