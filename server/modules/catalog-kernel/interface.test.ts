import { describe, expect, it } from "vitest";

import { compileCatalogRelease } from "./compiler/index";
import { validCatalogReleaseBundle } from "./compiler/__fixtures__/catalogReleaseBundle";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogMaintainer,
  type CatalogRuntime,
  type CatalogVerifier,
} from "./interface";
import pg from "pg";

describe("catalog kernel public interface", () => {
  const kernel = createCatalogKernel(new pg.Pool({ max: 1 }));

  it("exposes role-shaped facets of one kernel", () => {
    const runtime: CatalogRuntime = kernel;
    const maintainer: CatalogMaintainer = kernel;
    const verifier: CatalogVerifier = kernel;
    expect(runtime.loadCurrentCatalog).toBeTypeOf("function");
    expect(maintainer.compilePublishedRelease).toBeTypeOf("function");
    expect(verifier.loadPinnedCatalog).toBeTypeOf("function");
  });

  it("compiles a published source through the S1-CMP compiler", async () => {
    const bundle = validCatalogReleaseBundle();
    const compiled = await kernel.compilePublishedRelease(jsonCatalogReleaseSource(bundle));
    const direct = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    expect(direct.ok).toBe(true);
    if (compiled.ok && direct.ok) {
      expect(compiled.value.compiledReleaseDigest).toBe(direct.value.compiledReleaseDigest);
    }
  });

  it("returns tagged permission-denied for maintainer/verifier writes not owned by S3-RUN", async () => {
    const compiled = compileCatalogRelease(validCatalogReleaseBundle());
    if (!compiled.ok) throw new Error("fixture failed");
    const denied = await kernel.installPublishedRelease({
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    expect(denied).toEqual({
      ok: false,
      error: { kind: "permission-denied", operation: "installPublishedRelease" },
    });
    expect(await kernel.switchBackBeforeTraffic({
      maintenanceAttemptId: "attempt",
      expectedCurrent: { id: "crel_acme_2" as never, digest: "sha256:x" as never },
      targetPrevious: { id: "crel_acme_1" as never, digest: "sha256:y" as never },
    })).toEqual({
      ok: false,
      error: { kind: "permission-denied", operation: "switchBackBeforeTraffic" },
    });
    expect(
      await kernel.verifyCurrentMaterialization({
        source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
        expected: { id: "crel_acme_2" as never, digest: "sha256:x" as never },
      }),
    ).toEqual({
      ok: false,
      error: { kind: "permission-denied", operation: "verifyCurrentMaterialization" },
    });
  });
});
