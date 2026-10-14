import { availableParallelism } from "node:os";

function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive safe integer.`);
  }
  return value;
}

export function resolveVitestMaxWorkers(
  suite: "frontend" | "server" | "bridge" | "scripts",
  env: NodeJS.ProcessEnv = process.env,
  parallelism = availableParallelism()
): number {
  const lanes = positiveInteger(env, "WISEEFF_VITEST_LANES", 1);
  const ceiling = suite === "scripts" ? 1 : suite === "server"
    ? positiveInteger(env, "VITEST_SERVER_MAX_WORKERS", Math.min(4, Math.max(1, Math.floor(parallelism / 2))))
    : 4;
  return Math.max(1, Math.min(ceiling, Math.floor(parallelism / lanes)));
}
