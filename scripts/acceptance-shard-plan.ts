import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const measurements: { visualDurationMs: number; specDurationMs: Record<string, number> } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./acceptance-durations.json", import.meta.url)), "utf8"),
);

export function balanceAcceptanceShards(
  files: readonly string[],
  shardCount: number,
  durations: Record<string, number> = measurements.specDurationMs,
  visualDurationMs = measurements.visualDurationMs,
): Array<{ files: string[]; durationMs: number }> {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || files.length < shardCount
    || new Set(files).size !== files.length
    || !Number.isFinite(visualDurationMs) || visualDurationMs < 0
    || Object.values(durations).some((duration) => !Number.isFinite(duration) || duration < 0)) {
    throw new Error("Invalid acceptance shard inventory or duration measurements.");
  }
  const fallback = Math.max(1, ...Object.values(durations));
  const durationOf = (file: string) => durations[file] || fallback;
  const sorted = [...files].sort((left, right) => durationOf(right) - durationOf(left)
    || (left < right ? -1 : left > right ? 1 : 0));
  const shards = Array.from({ length: shardCount }, (_, index) => ({ files: [] as string[], durationMs: index === 0 ? visualDurationMs : 0 }));
  for (const [index, file] of sorted.entries()) {
    const empty = shards.filter((shard) => shard.files.length === 0);
    const candidates = sorted.length - index === empty.length ? empty : shards;
    const target = candidates.reduce((best, shard) => shard.durationMs < best.durationMs ? shard : best);
    target.files.push(file);
    target.durationMs += durationOf(file);
  }
  return shards.map((shard) => ({ ...shard, files: shard.files.sort() }));
}
