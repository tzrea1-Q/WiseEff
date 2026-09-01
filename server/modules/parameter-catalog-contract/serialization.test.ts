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
  verificationPurposes,
  type ContractJsonValue
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

const serializeUnknown = (value: unknown): string =>
  serializeContract(value as ContractJsonValue);

describe("parameter catalog wire serialization", () => {
  it("matches the required golden bytes", () => {
    expect(serializeContract(contractSample)).toBe(golden);
  });

  it("is byte-stable across object insertion order", () => {
    expect(serializeContract({ second: { beta: 2, alpha: 1 }, first: true })).toBe(
      serializeContract({ first: true, second: { alpha: 1, beta: 2 } })
    );
  });

  it("sorts nested object keys while retaining array order", () => {
    expect(
      serializeContract({
        z: [{ "2": "two", "10": "ten", beta: 2, alpha: 1 }, null],
        a: { descending: [3, 2, 1] }
      })
    ).toBe(`{
  "a": {
    "descending": [
      3,
      2,
      1
    ]
  },
  "z": [
    {
      "10": "ten",
      "2": "two",
      "alpha": 1,
      "beta": 2
    },
    null
  ]
}
`);
  });

  it("rejects numbers that JSON would silently coerce", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => serializeContract({ invalid })).toThrow(TypeError);
    }
  });

  it("rejects non-JSON runtime values instead of producing colliding bytes", () => {
    class ContractLikeClass {
      readonly value = 1;
    }

    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "present";

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const nonEnumerable = { visible: true };
    Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false });

    const symbolMember = { visible: true };
    Object.defineProperty(symbolMember, Symbol("hidden"), {
      value: true,
      enumerable: true
    });

    const accessor = {};
    Object.defineProperty(accessor, "computed", {
      get: () => 1,
      enumerable: true
    });

    for (const invalid of [
      undefined,
      () => undefined,
      Symbol("contract"),
      1n,
      new Date("2026-09-01T00:00:00.000Z"),
      new ContractLikeClass(),
      { omitted: undefined },
      [undefined],
      sparse,
      cyclic,
      nonEnumerable,
      symbolMember,
      accessor
    ]) {
      expect(() => serializeUnknown(invalid)).toThrow(TypeError);
    }
  });
});
