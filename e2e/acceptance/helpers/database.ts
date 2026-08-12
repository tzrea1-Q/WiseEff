import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { Client } from "pg";

export type AcceptanceDatabaseEnv = Record<string, string | undefined>;

/**
 * The one npm-script runner for acceptance code. Windows cannot spawn `npm` directly
 * (EINVAL); route through cmd.exe exactly like scripts/run-vitest.ts does.
 */
export function runNpmScript(script: string): SpawnSyncReturns<Buffer> {
  const invocation =
    process.platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", `npm run ${script}`] }
      : { command: "npm", args: ["run", script] };
  const result = spawnSync(invocation.command, invocation.args, {
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
