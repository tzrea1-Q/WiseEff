import type { ToolProbeResult, ToolProbeState } from "./toolProbe";

export type ToolsInstallStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  protocol?: "adb" | "hdc" | "all";
  error?: string;
  updatedAt: string;
};

export type BridgeHealthState = {
  paired: boolean;
  connected: boolean;
  bridgeId?: string;
  serverUrl?: string;
  tokenExpiresAt?: string;
  lastError?: string;
  updatedAt: string;
  tools?: ToolProbeResult;
  toolsInstall?: ToolsInstallStatus;
};

export type ToolProbeCache = {
  getTools: () => ToolProbeResult | undefined;
  refreshTools: (force?: boolean) => Promise<ToolProbeResult>;
  setToolsInstall: (next: ToolsInstallStatus) => void;
  getToolsInstall: () => ToolsInstallStatus | undefined;
};

export function createToolProbeCache(input: {
  probe: () => Promise<ToolProbeResult>;
  ttlMs?: number;
  now?: () => number;
}): ToolProbeCache {
  const ttlMs = input.ttlMs ?? 60_000;
  const now = input.now ?? (() => Date.now());
  let cachedTools: ToolProbeResult | undefined;
  let cachedAt = 0;
  let toolsInstall: ToolsInstallStatus | undefined;

  return {
    getTools() {
      return cachedTools;
    },
    async refreshTools(force = false) {
      if (!force && cachedTools && now() - cachedAt < ttlMs) {
        return cachedTools;
      }
      cachedTools = await input.probe();
      cachedAt = now();
      return cachedTools;
    },
    setToolsInstall(next) {
      toolsInstall = next;
    },
    getToolsInstall() {
      return toolsInstall;
    }
  };
}

export function isToolProbeState(value: unknown): value is ToolProbeState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ToolProbeState).available === "boolean"
  );
}

export function parseToolProbeResult(value: unknown): ToolProbeResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isToolProbeState(record.adb) || !isToolProbeState(record.hdc)) {
    return undefined;
  }
  return {
    adb: record.adb,
    hdc: record.hdc
  };
}

export function parseToolsInstallStatus(value: unknown): ToolsInstallStatus | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.status !== "idle" &&
    record.status !== "running" &&
    record.status !== "succeeded" &&
    record.status !== "failed"
  ) {
    return undefined;
  }
  if (typeof record.updatedAt !== "string") {
    return undefined;
  }
  return {
    status: record.status,
    protocol:
      record.protocol === "adb" || record.protocol === "hdc" || record.protocol === "all"
        ? record.protocol
        : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    updatedAt: record.updatedAt
  };
}
