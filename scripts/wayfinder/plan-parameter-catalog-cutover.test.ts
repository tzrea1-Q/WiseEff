import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { parsePlanCliArgs, runPlanCutoverCli } from "./plan-parameter-catalog-cutover";

const graph = {
  catalog: "parameter-catalog-p0-graph",
  identities: [
    {
      id: "s7orc-lid-r1",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7orc-spec-r1",
    },
  ],
  specs: [
    {
      id: "s7orc-spec-r1",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7orc.r1.status",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "status",
    },
  ],
  specVersions: [
    {
      id: "s7orc-ver-r1",
      parameterSpecId: "s7orc-spec-r1",
      version: 1,
      lifecycle: "active",
      versionStatus: "active",
    },
  ],
  subjects: [],
  driverRegistrations: [],
  nodeTypeDefinitions: [],
  driverSchemas: [],
  driverSchemaVersions: [],
  dtsPropertySpecs: [],
  modules: [],
  placements: [],
  bindings: [],
  bindingRevisions: [],
};

describe("plan-parameter-catalog-cutover CLI", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("refuses activation phases on the public plan seam", async () => {
    const result = await runPlanCutoverCli(["--phase", "P12", "--graph", "missing.json", "--target-artifact-sha", "a".repeat(40)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
  });

  it("plans a digest from a populated graph and compiled release", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "s7orc-plan-"));
    const graphPath = path.join(tempDir, "graph.json");
    const releasePath = path.join(tempDir, "release.json");
    const full = validCatalogReleaseBundle();
    const first = structuredClone(full.releases[0]!);
    const bundle = {
      schemaVersion: full.schemaVersion,
      targetReleaseId: first.manifest.release.id,
      releases: [first],
    };
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    await writeFile(graphPath, JSON.stringify(graph));
    await writeFile(releasePath, JSON.stringify(bundle));
    const args = parsePlanCliArgs([
      "--graph",
      graphPath,
      "--release-json",
      releasePath,
      "--target-artifact-sha",
      "d".repeat(40),
      "--target-catalog-release-digest",
      compiled.value.release.digest,
    ]);
    expect(args.graphPath).toBe(graphPath);
    const planned = await runPlanCutoverCli([
      "--graph",
      graphPath,
      "--release-json",
      releasePath,
      "--target-artifact-sha",
      "d".repeat(40),
      "--target-catalog-release-digest",
      compiled.value.release.digest,
    ]);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned).toMatchObject({
      ok: true,
      value: {
        targetArtifactSha: "d".repeat(40),
        phases: ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"],
      },
    });
  });
});
