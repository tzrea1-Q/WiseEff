import { afterEach, describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";

import { compileCatalogRelease } from "./compileCatalogRelease";
import { prepareForCompilation } from "./validation";
import {
  malformedYamlSourceBundle,
  staleSourceDigestBundle,
  validCatalogReleaseBundle,
} from "./__fixtures__/catalogReleaseBundle";
import { compiledReleaseGolden } from "./__fixtures__/compiledReleaseGolden";

afterEach(() => vi.restoreAllMocks());
vi.mock("yaml", { spy: true });

describe("request-local compiler preparation", () => {
  it("does not parse validated YAML a third time when producing the compiled projection", () => {
    const bundle = validCatalogReleaseBundle();
    const sourceCount = bundle.releases.reduce((count, release) => count + release.sources.length, 0);
    const parse = vi.mocked(yaml.parseAllDocuments);
    parse.mockClear();

    const compiled = compileCatalogRelease(bundle);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("valid bundle did not compile");
    expect(compiled.value.compiledReleaseDigest).toBe(compiledReleaseGolden.compiledReleaseDigest);
    // Keep the independent syntax and authoritative-content checks. Preparation
    // must reuse their result instead of creating a third YAML/object graph.
    expect(parse).toHaveBeenCalledTimes(sourceCount * 2);
  });

  it("revalidates changed bytes on a later call with the same bundle object", () => {
    const bundle = validCatalogReleaseBundle();
    expect(compileCatalogRelease(bundle).ok).toBe(true);
    Object.assign(bundle, staleSourceDigestBundle());

    const result = compileCatalogRelease(bundle);

    expect(result).toMatchObject({
      ok: false,
      error: {
        phase: "source",
        violations: [expect.objectContaining({ detail: "exact-source-bytes-digest-mismatch" })],
      },
    });
  });

  it("keeps malformed-source failures ahead of semantic and lineage validation", () => {
    const bundle = malformedYamlSourceBundle();
    const prepared = prepareForCompilation(bundle);

    expect(prepared.bundle).toBe(bundle);
    expect(prepared.validation.source).toContainEqual(
      expect.objectContaining({ detail: "source-yaml-unreadable" }),
    );
    expect(prepared.validation.compile).toEqual([]);
    expect(prepared.validation.lineage).toEqual([]);
  });
});
