import { describe, expect, it, vi } from "vitest";

import type { BridgeConfig } from "./config";
import { runConnectCommand } from "./connectCommand";

const pairedConfig: BridgeConfig = {
  bridgeId: "bridge_123",
  bridgeToken: "wb_123",
  tokenExpiresAt: "2026-07-01T00:00:00.000Z",
  serverUrl: "https://wiseeff.example.com",
  machineLabel: "machine",
  platform: "windows",
  arch: "x64",
  pairedAt: "2026-06-23T00:00:00.000Z"
};

function createStdoutCapture() {
  return {
    log: vi.fn(),
    error: vi.fn()
  };
}

describe("connectCommand", () => {
  it("pairs when code provided and config missing, then starts", async () => {
    let config: BridgeConfig | null = null;
    const saveConfig = vi.fn(async (next: BridgeConfig) => {
      config = next;
    });
    const loadConfig = vi.fn(async () => config);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        bridgeId: "bridge_123",
        bridgeToken: "wb_123",
        tokenExpiresAt: "2026-07-01T00:00:00.000Z"
      }),
      text: async () => ""
    })) as typeof fetch;

    const startBridge = vi.fn(async () => ({ exitCode: 0, statusLine: "connected" }));

    const result = await runConnectCommand(
      {
        fetchImpl,
        loadConfig,
        saveConfig,
        stdout: createStdoutCapture(),
        startBridge
      },
      { server: "https://wiseeff.example.com", code: "123456" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://wiseeff.example.com/api/v1/device-bridges/pair",
      expect.any(Object)
    );
    expect(saveConfig).toHaveBeenCalled();
    expect(startBridge).toHaveBeenCalledWith(expect.objectContaining({ bridgeId: "bridge_123" }));
  });

  it("starts without re-pair when config server matches and token valid", async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const saveConfig = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => pairedConfig);
    const startBridge = vi.fn(async () => ({ exitCode: 0, statusLine: "connected" }));

    const result = await runConnectCommand(
      {
        fetchImpl,
        loadConfig,
        saveConfig,
        stdout: createStdoutCapture(),
        startBridge
      },
      { server: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(startBridge).toHaveBeenCalledWith(pairedConfig);
  });

  it("returns exit code 1 when unpaired and code is missing", async () => {
    const capture = createStdoutCapture();
    const result = await runConnectCommand(
      {
        fetchImpl: vi.fn() as typeof fetch,
        loadConfig: async () => null,
        saveConfig: vi.fn(async () => undefined),
        stdout: capture,
        startBridge: vi.fn()
      },
      { server: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(1);
    expect(capture.error).toHaveBeenCalled();
  });
});
