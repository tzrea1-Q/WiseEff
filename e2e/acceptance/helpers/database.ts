import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { Client } from "pg";
import { npmCommand } from "../../../scripts/run-browser-acceptance";

export type AcceptanceDatabaseEnv = Record<string, string | undefined>;

export function runNpmScript(script: string): SpawnSyncReturns<Buffer> {
  const result = spawnSync(npmCommand(), ["run", script], {
    cwd: process.cwd(),
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`npm script "${script}" failed with status ${result.status ?? "unknown"}.`);
  }

  return result;
}

export async function withPgClient<T>(
  callback: (client: Client) => Promise<T> | T,
  env: AcceptanceDatabaseEnv = process.env
): Promise<T> {
  const connectionString = env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for acceptance database helpers.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}
