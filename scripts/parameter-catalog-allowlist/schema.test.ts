import { describe, expect, it } from "vitest";

import {
  allowlistShardSchema,
  boundaryViolationFixtureSchema,
  consumerFamilyIds,
  type AllowlistShard,
} from "./schema";

const entry = {
  id: "S12-CGH:legacy-catalog-sql-write:0123456789abcdef:fedcba9876543210",
  rule: "legacy-catalog-sql-write" as const,
  file: "server/modules/parameter-specs/repository.ts",
  reason: "Retained only until S12-CGH removes the legacy writer.",
};

const shard = (): AllowlistShard => ({
  schemaVersion: 2,
  family: "S12-CGH",
  paths: [
    "server/modules/parameter-specs/**",
    "src/infrastructure/http/parameterAdminClient.ts",
  ],
  entries: [entry],
});

describe("parameter catalog allow-list schema", () => {
  it("freezes the exact eleven consumer-family identifiers", () => {
    expect(consumerFamilyIds).toEqual([
      "S12-CGH",
      "S12-TOP",
      "S12-PRJ",
      "S12-FIL",
      "S12-AGT",
      "S12-LOG",
      "S12-DBG",
      "S12-DTS",
      "S12-KNW",
      "S12-MOD",
      "S12-OPS",
    ]);
  });

  it("accepts a strictly named, sorted, family-owned shard", () => {
    expect(allowlistShardSchema.parse(shard())).toEqual(shard());
  });

  it("rejects unknown fields, duplicate IDs, unsorted entries, and cross-family IDs", () => {
    const duplicate = { ...entry };
    const later = {
      ...entry,
      id: "S12-CGH:legacy-catalog-sql-write:fedcba9876543210:0123456789abcdef",
    };

    expect(() => allowlistShardSchema.parse({ ...shard(), extra: true })).toThrow();
    expect(() => allowlistShardSchema.parse({ ...shard(), entries: [entry, duplicate] })).toThrow(/duplicate/i);
    expect(() => allowlistShardSchema.parse({ ...shard(), entries: [later, entry] })).toThrow(/sorted/i);
    expect(() =>
      allowlistShardSchema.parse({
        ...shard(),
        entries: [{ ...entry, id: entry.id.replace("S12-CGH", "S12-TOP") }],
      }),
    ).toThrow(/family/i);
  });

  it("validates the immutable current-violations fixture independently of live shard shrinkage", () => {
    const fixture = {
      schemaVersion: 2,
      trustedBaseSha: "9b3ba7df7e21f5589684bc92c872da593ad4c246",
      violations: [
        {
          ...entry,
          family: "S12-CGH" as const,
          line: 10,
          column: 5,
          trustedBaseSha: "9b3ba7df7e21f5589684bc92c872da593ad4c246",
          trustedBlobOid: "0123456789abcdef0123456789abcdef01234567",
          byteStart: 120,
          byteEnd: 148,
          token: "write:parameter_specs",
          evidence: "insert into parameter_specs",
        },
      ],
    };

    expect(boundaryViolationFixtureSchema.parse(fixture)).toEqual(fixture);
    expect(() => boundaryViolationFixtureSchema.parse({ ...fixture, violations: [...fixture.violations, fixture.violations[0]] })).toThrow(
      /duplicate/i,
    );
    expect(() =>
      boundaryViolationFixtureSchema.parse({
        ...fixture,
        violations: [{ ...fixture.violations[0], rule: "legacy-catalog-raw-read" }],
      }),
    ).toThrow(/rule/i);
    expect(() =>
      boundaryViolationFixtureSchema.parse({
        ...fixture,
        violations: fixture.violations.map(({ trustedBlobOid: _trustedBlobOid, ...violation }) => violation),
      }),
    ).toThrow();
    expect(() =>
      allowlistShardSchema.parse({
        ...shard(),
        entries: [{ ...entry, id: "S12-CGH:legacy-catalog-sql-write:0123456789abcdef:1" }],
      }),
    ).toThrow(/occurrence/i);
  });
});
