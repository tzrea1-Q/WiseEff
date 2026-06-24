import { loadBridgeConfig } from "./config";
import { runToolsInstallCommand, type ToolInstallProtocol } from "./toolsInstallCommand";
import type { CliDependencies } from "./connectCommand";

export async function runToolsInstallCliCommand(
  deps: CliDependencies,
  input: {
    server?: string;
    protocol: ToolInstallProtocol;
    force?: boolean;
  }
) {
  const config = await deps.loadConfig();
  const serverUrl = input.server ?? config?.serverUrl;
  if (!serverUrl) {
    deps.stdout.error("Missing server URL. Pass --server or pair the bridge first.");
    return 1;
  }

  try {
    await runToolsInstallCommand({
      serverUrl,
      protocol: input.protocol,
      fetchImpl: deps.fetchImpl,
      force: input.force,
      onStatus: (status) => {
        if (status.status === "running") {
          deps.stdout.log(`Installing ${status.protocol ?? "tools"}...`);
        }
        if (status.status === "failed") {
          deps.stdout.error(status.error ?? "Tool install failed.");
        }
        if (status.status === "succeeded") {
          deps.stdout.log("Tool install completed.");
        }
      }
    });
    return 0;
  } catch (error) {
    deps.stdout.error(error instanceof Error ? error.message : "Tool install failed.");
    return 1;
  }
}

export function kickOffInstallTools(input: {
  serverUrl: string;
  protocol: ToolInstallProtocol;
  fetchImpl: typeof fetch;
  onStatus?: Parameters<typeof runToolsInstallCommand>[0]["onStatus"];
}) {
  void runToolsInstallCommand({
    serverUrl: input.serverUrl,
    protocol: input.protocol,
    fetchImpl: input.fetchImpl,
    onStatus: input.onStatus
  }).catch(() => undefined);
}
