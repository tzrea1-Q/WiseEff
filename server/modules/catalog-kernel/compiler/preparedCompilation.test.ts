import { afterEach, describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";

import { compileCatalogRelease, createCatalogReleaseDigestValidator, validateCatalogReleaseDigest } from "./compileCatalogRelease";
import { prepareForCompilation } from "./validation";
import { freezeCatalogJson } from "./contractArtifacts";
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
  it("reuses only immutable nodes in the same build and still checks the successor lineage", () => {
    const bundle = freezeCatalogJson(validCatalogReleaseBundle());
    const validate = createCatalogReleaseDigestValidator();
    const parse = vi.mocked(yaml.parseAllDocuments);
    parse.mockClear();
    const first = bundle.releases.find(node => node.manifest.release.sequence === 1)!;
    expect(validate({ ...bundle, targetReleaseId: first.manifest.release.id, releases: [first] }).ok).toBe(true);
    expect(validate(bundle).ok).toBe(true);
    const calls = parse.mock.calls.length;
    expect(calls).toBe(bundle.releases.reduce((count, node) => count + node.sources.length, 0));
    const disconnected = { ...bundle, targetReleaseId: "unknown" };
    const reused = validate(disconnected);
    expect(parse).toHaveBeenCalledTimes(calls);
    expect(reused.ok).toBe(false);
    expect(reused).toEqual(validateCatalogReleaseDigest(disconnected));
    expect(parse).toHaveBeenCalledTimes(calls * 2);
  });

  it("detects changes to nested data when only the outer release node was frozen", () => {
    const bundle = validCatalogReleaseBundle();
    for (const node of bundle.releases) Object.freeze(node);
    const validate = createCatalogReleaseDigestValidator();
    expect(validate(bundle).ok).toBe(true);
    Object.assign(bundle.releases[0].sources[0], { bytes: "eg==" });
    expect(validate(bundle)).toEqual(validateCatalogReleaseDigest(bundle));
    expect(validate(bundle).ok).toBe(false);
  });

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
