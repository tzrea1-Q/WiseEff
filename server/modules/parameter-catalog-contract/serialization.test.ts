import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  comparisonOutcomes,
  catalogKernelOperations,
  catalogSubjectKinds,
  legacyIdentifierTypes,
  reviewResolutionTypes,
  serializeContract,
  verificationPurposes
} from "./index";

const golden = readFileSync(
  new URL("./__fixtures__/serialization-golden.json", import.meta.url),
  "utf8"
);

const contractSample = {
  comparisonOutcomes,
  ids: {
    definitionRevisionId: DefinitionRevisionId("drev_01KVIN3"),
    parameterDefinitionId: ParameterDefinitionId("pdef_01KVIN"),
    releaseId: CatalogReleaseId("crel_01K42"),
    subjectId: CatalogSubjectId("csub_01KSC8562")
  },
  kernelOperations: catalogKernelOperations,
  legacyIdentifierTypes,
  result: {
    ok: false,
    error: {
      kind: "release-mismatch",
      expected: {
        id: CatalogReleaseId("crel_01K42"),
        digest: CatalogReleaseDigest("sha256:release")
      },
      actual: null
    }
  },
  reviewResolutionTypes,
  subjectKinds: catalogSubjectKinds,
  verificationPurposes
} as const;

describe("parameter catalog wire serialization", () => {
  it("matches the required golden bytes", () => {
    expect(serializeContract(contractSample)).toBe(golden);
  });

  it("is byte-stable across object insertion order", () => {
    expect(serializeContract({ second: { beta: 2, alpha: 1 }, first: true })).toBe(
      serializeContract({ first: true, second: { alpha: 1, beta: 2 } })
    );
  });

  it("rejects numbers that JSON would silently coerce", () => {
    expect(() => serializeContract({ invalid: Number.NaN })).toThrow(
      "Contract serialization requires finite numbers"
    );
  });
});
