import { afterEach, describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";

import { compileCatalogRelease, validateCatalogReleaseDigest } from "./compileCatalogRelease";
import { prepareForCompilation } from "./validation";
import {
  invalidCanonicalPropertyBundle,
  lineageGapBundle,
  malformedYamlSourceBundle,
  staleAggregateDigestBundle,
  staleSourceDigestBundle,
  validCatalogReleaseBundle,
} from "./__fixtures__/catalogReleaseBundle";
import { compiledReleaseGolden } from "./__fixtures__/compiledReleaseGolden";

afterEach(() => vi.restoreAllMocks());
vi.mock("yaml", { spy: true });

describe("request-local compiler preparation", () => {
  it("parses each YAML source once for syntax, authority and compiled output", () => {
    const bundle = validCatalogReleaseBundle();
    const sourceCount = bundle.releases.reduce((count, release) => count + release.sources.length, 0);
    const parse = vi.mocked(yaml.parseAllDocuments);
    parse.mockClear();

    const compiled = compileCatalogRelease(bundle);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("valid bundle did not compile");
    expect(compiled.value.compiledReleaseDigest).toBe(compiledReleaseGolden.compiledReleaseDigest);
    expect(parse).toHaveBeenCalledTimes(sourceCount);
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

  it("returns the same validated digest without a compiled projection", () => {
    const bundle = validCatalogReleaseBundle();
    expect(validateCatalogReleaseDigest(bundle)).toEqual({
      ok: true,
      value: { aggregateDigest: bundle.releases.at(-1)!.manifest.release.digest },
    });
  });

  it.each([
    ["malformed YAML", malformedYamlSourceBundle],
    ["source digest mismatch", staleSourceDigestBundle],
    ["aggregate digest mismatch", staleAggregateDigestBundle],
    ["invalid property", invalidCanonicalPropertyBundle],
    ["lineage gap", lineageGapBundle],
  ])("rejects %s exactly as full compilation does", (_name, fixture) => {
    const bundle = fixture();
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(false);
    expect(validateCatalogReleaseDigest(bundle)).toEqual(compiled);
  });
});
