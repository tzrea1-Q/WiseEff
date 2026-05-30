import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type RuntimeEnv = Record<string, string | undefined>;

export function buildVitestInvocation(args: string[], env: RuntimeEnv = process.env, platform = process.platform) {
  const explicitRuntimeMode = env.VITE_WISEEFF_RUNTIME_MODE?.trim();
  const vitestArgs = ["vitest", "run", ...args];

  return {
    command: platform === "win32" ? "cmd.exe" : "npx",
    args: platform === "win32" ? ["/d", "/s", "/c", ["npx", ...vitestArgs].map(quoteForCmd).join(" ")] : vitestArgs,
    env: {
      ...env,
      VITE_WISEEFF_RUNTIME_MODE: explicitRuntimeMode || "mock"
    }
  };
}

function quoteForCmd(value: string) {
  return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const invocation = buildVitestInvocation(process.argv.slice(2));
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: invocation.env,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}
