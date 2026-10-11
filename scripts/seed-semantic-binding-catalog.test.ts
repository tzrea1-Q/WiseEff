import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compileLocalizedVendorCatalogSuccessor } from "./compile-vendor-catalog-release";
import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler";
import { readCurrentCatalogPointer } from "../server/modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../server/modules/catalog-kernel/install/installer";
import { SEMANTIC_BINDING_FIXTURE_RELEASE_ID, seedSemanticBindingCatalog } from "../server/testing/parameterCatalog/semanticBinding";

vi.mock("../server/modules/catalog-kernel/install/currentPointer", () => ({ readCurrentCatalogPointer: vi.fn() }));
vi.mock("../server/modules/catalog-kernel/install/installer", () => ({ installPublishedRelease: vi.fn() }));

describe("semantic Binding Catalog seed lineage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances the localized seeded current to a distinct, ordered acceptance release", async () => {
    const seeded = compileLocalizedVendorCatalogSuccessor();
    vi.mocked(readCurrentCatalogPointer).mockResolvedValue({
      kind: "installed", current: seeded.compiled.release, predecessorReleaseId: seeded.predecessor.id,
    });
    vi.mocked(installPublishedRelease).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof installPublishedRelease>>);

    await seedSemanticBindingCatalog({} as pg.Pool);

    expect(installPublishedRelease).toHaveBeenCalledTimes(1);
    const command = vi.mocked(installPublishedRelease).mock.calls[0]![1];
    expect(command).toMatchObject({
      mode: "advance", expectedCurrent: { id: seeded.compiled.release.id, digest: seeded.compiled.release.digest },
    });
    const bundle = JSON.parse(Buffer.from(await command.source.readManifest()).toString("utf8"));
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(seeded.compiled.release.version).toBe("1.2.1");
    expect(compiled.value.release).toMatchObject({ id: SEMANTIC_BINDING_FIXTURE_RELEASE_ID, version: "1.3.0" });
    expect(compiled.value.predecessor).toEqual({ id: seeded.compiled.release.id, digest: seeded.compiled.release.digest });
    expect(bundle.releases.at(-1).manifest.release.sequence).toBe(5);
    expect(command.expectedTargetDigest).toBe(compiled.value.aggregateDigest);
    expect(new Set(bundle.releases.map((release: { manifest: { release: { version: string } } }) => release.manifest.release.version)).size)
      .toBe(bundle.releases.length);
    const seededDocuments = seeded.bundle.releases.at(-1)!.documents;
    const seededIds = new Set(seededDocuments.map((document) => document.content.id));
    expect(bundle.releases.at(-1).documents
      .filter((document: { content: { id: string } }) => seededIds.has(document.content.id))
      .map((document: { content: unknown }) => document.content))
      .toEqual(seededDocuments.map((document) => document.content));
  });

  it("does not bypass installer digest verification when the acceptance release ID is already current", async () => {
    const seeded = compileLocalizedVendorCatalogSuccessor();
    vi.mocked(readCurrentCatalogPointer).mockResolvedValue({
      kind: "installed", current: { ...seeded.compiled.release, id: SEMANTIC_BINDING_FIXTURE_RELEASE_ID as typeof seeded.compiled.release.id },
      predecessorReleaseId: seeded.compiled.release.id,
    });
    vi.mocked(installPublishedRelease).mockResolvedValue({
      ok: false, error: { kind: "digest-conflict" },
    } as Awaited<ReturnType<typeof installPublishedRelease>>);

    await expect(seedSemanticBindingCatalog({} as pg.Pool)).rejects.toThrow("digest-conflict");
    expect(installPublishedRelease).toHaveBeenCalledTimes(1);
  });

  it("propagates stale-current failures without retrying against a different predecessor", async () => {
    const seeded = compileLocalizedVendorCatalogSuccessor();
    vi.mocked(installPublishedRelease).mockResolvedValue({
      ok: false, error: { kind: "unsupported-lineage", reason: "stale-expected-current" },
    } as Awaited<ReturnType<typeof installPublishedRelease>>);

    await expect(seedSemanticBindingCatalog({} as pg.Pool)).rejects.toThrow("stale-expected-current");
    expect(installPublishedRelease).toHaveBeenCalledTimes(1);
    expect(vi.mocked(installPublishedRelease).mock.calls[0]![1]).toMatchObject({
      expectedCurrent: { id: seeded.compiled.release.id, digest: seeded.compiled.release.digest },
    });
  });
});
