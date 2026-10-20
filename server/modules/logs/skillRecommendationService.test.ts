import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { LOG_SKILL_RECOMMENDATION_LIMITS as limits, recommendLogSkills } from "./skillRecommendation";
import { storedRecommendationFiles } from "./skillRecommendationService";

const source = [{ path: "kernel.log", objectKey: "org/kernel.log" }];
const candidate = (pattern: string) => [{ skillId: "test", spec: {
  schemaVersion: "skill/v1" as const,
  parsing: { schemaVersion: "parsing/v1" as const, extractors: [{ id: "feature", pattern, fields: {} }] }
} }];
const fixedClock = { now: () => 0 };
function streamStore(bytes: Buffer) {
  return { ...createMemoryObjectStore(), getStream: async () => Readable.from([bytes]) };
}

describe("stored log recommendation heads", () => {
  it("reads at most the bounded prefix and stops the source stream", async () => {
    const maxBytes = limits.headLines * (limits.lineBytes + 2);
    const stream = Readable.from([Buffer.alloc(maxBytes + 100_000, "x")]);
    const getStream = vi.fn(async () => stream);
    const heads = await storedRecommendationFiles({ ...createMemoryObjectStore(), getStream }, source);
    expect(getStream).toHaveBeenCalledWith("org/kernel.log", { start: 0, end: maxBytes });
    expect(heads).toEqual([{ path: "kernel.log", head: [] }]);
    expect(stream.destroyed).toBe(true);
  });

  it("retains only original first 64 positions when oversized lines are discarded", async () => {
    const lines = ["界".repeat(700), ...Array<string>(limits.headLines - 1).fill("ordinary"), "CHARGE"];
    const heads = await storedRecommendationFiles(streamStore(Buffer.from(lines.join("\n"))), source);
    expect(heads[0].head).toEqual(Array<string>(limits.headLines - 1).fill("ordinary"));
    expect(recommendLogSkills(candidate("CHARGE"), heads, fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("does not turn oversized lines into empty feature matches", async () => {
    const heads = await storedRecommendationFiles(streamStore(Buffer.from("界".repeat(700))), source);
    expect(heads).toEqual([{ path: "kernel.log", head: [] }]);
    expect(recommendLogSkills(candidate("^$"), heads, fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("ignores incomplete prefix tails rather than inventing an anchored match", async () => {
    const maxBytes = limits.headLines * (limits.lineBytes + 2);
    const bytes = Buffer.from(`${"x".repeat(maxBytes - 7)}\nCHARGE-more`);
    const heads = await storedRecommendationFiles(streamStore(bytes), source);
    expect(heads).toEqual([{ path: "kernel.log", head: [] }]);
    expect(recommendLogSkills(candidate("CHARGE$"), heads, fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("falls back on throwing reads without manufacturing blank lines", async () => {
    const failedStream = { ...createMemoryObjectStore(), getStream: async (): Promise<Readable> => { throw new Error("Storage unavailable"); } };
    await expect(storedRecommendationFiles(failedStream, source)).resolves.toEqual([]);
    const failedLegacy = { ...createMemoryObjectStore(), getStream: undefined,
      getBounded: async (): Promise<Buffer> => { throw new Error("Object exceeds bounded read limit"); } };
    const heads = await storedRecommendationFiles(failedLegacy, source);
    expect(heads).toEqual([{ path: "kernel.log", head: [] }]);
    expect(recommendLogSkills(candidate("^$"), heads, fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("times out a stalled read and destroys the active stream", async () => {
    const stream = new Readable({ read() { /* Storage supplies no bytes. */ } });
    const store = { ...createMemoryObjectStore(), getStream: async () => stream };
    const start = performance.now();
    await expect(storedRecommendationFiles(store, source)).resolves.toEqual([]);
    expect(stream.destroyed).toBe(true);
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
