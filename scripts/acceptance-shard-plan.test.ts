import { describe, expect, it } from "vitest";
import { balanceAcceptanceShards } from "./acceptance-shard-plan";

describe("duration-balanced acceptance ownership", () => {
  it("reserves visual time in shard 1 and assigns each whole spec exactly once, independent of collection order", () => {
    const durations = { "a.spec.ts": 90, "b.spec.ts": 80, "c.spec.ts": 30, "d.spec.ts": 20 };
    const files = Object.keys(durations);
    const plan = balanceAcceptanceShards(files, 2, durations, 100);
    expect(plan).toEqual([
      { files: ["c.spec.ts", "d.spec.ts"], durationMs: 150 },
      { files: ["a.spec.ts", "b.spec.ts"], durationMs: 170 },
    ]);
    expect(balanceAcceptanceShards([...files].reverse(), 2, durations, 100)).toEqual(plan);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual(files);
  });

  it("uses the slowest measured spec for new or zero-duration specs, never silently drops them", () => {
    expect(balanceAcceptanceShards(["new.spec.ts", "zero.spec.ts", "a.spec.ts"], 2, { "a.spec.ts": 40, "zero.spec.ts": 0 }, 50)).toEqual([
      { files: ["zero.spec.ts"], durationMs: 90 },
      { files: ["a.spec.ts", "new.spec.ts"], durationMs: 80 },
    ]);
  });

  it("keeps every browser shard nonempty even when visual outweighs all browser work", () => {
    const plan = balanceAcceptanceShards(["a", "b", "c"], 3, { a: 1, b: 1, c: 1 }, 100);
    expect(plan.map((shard) => shard.files)).toEqual([["c"], ["a"], ["b"]]);
  });

  it("rejects empty shards, duplicate owners and invalid measurements", () => {
    expect(() => balanceAcceptanceShards(["a"], 2, { a: 1 }, 1)).toThrow();
    expect(() => balanceAcceptanceShards(["a", "a"], 2, { a: 1 }, 1)).toThrow();
    expect(() => balanceAcceptanceShards(["a"], 1, { a: NaN }, 1)).toThrow();
    expect(() => balanceAcceptanceShards(["a"], 1, { a: 1 }, -1)).toThrow();
  });
});
