import { spawn as defaultSpawn, type SpawnOptions } from "node:child_process";
import { parseHdcTargets } from "./hdcTargets";

export type { HdcDeviceTarget } from "./hdcTargets";
export { parseHdcTargets };

export type HdcCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
};

export type HdcCommandRunner = (
  args: string[],
  options: { timeoutMs: number }
) => Promise<HdcCommandResult>;

type SpawnFn = typeof defaultSpawn;

type CreateHdcCommandRunnerOptions = {
  spawnImpl?: SpawnFn;
  command?: string;
};

function durationSince(startedAt: number) {
  return Math.max(1, Date.now() - startedAt);
}

export function createHdcCommandRunner(options: CreateHdcCommandRunnerOptions = {}): HdcCommandRunner {
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const command = options.command ?? "hdc";

  return (args, runOptions) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let settled = false;

      const spawnOptions: SpawnOptions = { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] };
      const child = spawnImpl(command, args, spawnOptions);
      const timeout = setTimeout(() => {
        settled = true;
        child.kill();
        resolve({
          code: null,
          stdout,
          stderr,
          timedOut: true,
          durationMs: durationSince(startedAt)
        });
      }, runOptions.timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({
          code,
          stdout,
          stderr,
          durationMs: durationSince(startedAt)
        });
      });
    });
}

export function createDefaultHdcCommandRunner(command = "hdc"): HdcCommandRunner {
  return createHdcCommandRunner({ command });
}
