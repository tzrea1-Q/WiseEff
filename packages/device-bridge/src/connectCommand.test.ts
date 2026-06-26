import { describe, expect, it, vi } from "vitest";

import type { BridgeConfig } from "./config";
import { isBridgeTokenExpired, runConnectCommand } from "./connectCommand";

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

function createConnectDeps(overrides: Partial<{
  fetchImpl: typeof fetch;
  loadConfig: () => Promise<BridgeConfig | null>;
  saveConfig: (config: BridgeConfig) => Promise<void>;
  stdout: ReturnType<typeof createStdoutCapture>;
  ensureBridgeRunning: ReturnType<typeof vi.fn>;
}>) {
  const stdout = overrides.stdout ?? createStdoutCapture();
  return {
    fetchImpl: overrides.fetchImpl ?? (vi.fn() as typeof fetch),
    loadConfig: overrides.loadConfig ?? vi.fn(async () => null),
    saveConfig: overrides.saveConfig ?? vi.fn(async () => undefined),
    stdout,
    ensureBridgeRunning:
      overrides.ensureBridgeRunning ??
      vi.fn(async () => ({ exitCode: 0 })),
    execPath: "/usr/bin/node",
    cliPath: "/opt/wiseeff/cli.js",
    platform: "darwin" as NodeJS.Platform
  };
}

describe("connectCommand", () => {
  it("persists webOrigin when pairing", async () => {
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

    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com", webOrigin: "https://wiseeff.example.com", code: "123456" }
    );

    expect(result.exitCode).toBe(0);
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://wiseeff.example.com",
        webOrigin: "https://wiseeff.example.com"
      })
    );
  });

  it("updates webOrigin without re-pairing and restarts bridge when origin changes", async () => {
    const saveConfig = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => pairedConfig);
    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl: vi.fn() as typeof fetch, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com", webOrigin: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(0);
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        webOrigin: "https://wiseeff.example.com"
      })
    );
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });

  it("pairs when code provided and config missing, then ensures bridge running", async () => {
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

    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com", code: "123456" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://wiseeff.example.com/api/v1/device-bridges/pair",
      expect.any(Object)
    );
    expect(saveConfig).toHaveBeenCalled();
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });

  it("ensures bridge running without re-pair when config server matches and token valid", async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const saveConfig = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => pairedConfig);
    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });

  it("returns exit code 1 when unpaired and code is missing", async () => {
    const capture = createStdoutCapture();
    const result = await runConnectCommand(
      createConnectDeps({ stdout: capture }),
      { server: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(1);
    expect(capture.error).toHaveBeenCalled();
  });

  it("re-pairs when token expired and code provided", async () => {
    const expiredConfig: BridgeConfig = {
      ...pairedConfig,
      tokenExpiresAt: "2020-01-01T00:00:00.000Z"
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        bridgeId: "bridge_456",
        bridgeToken: "wb_456",
        tokenExpiresAt: "2026-07-01T00:00:00.000Z"
      }),
      text: async () => ""
    })) as typeof fetch;
    const saveConfig = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => expiredConfig);
    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com", code: "654321" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalled();
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });

  it("re-pairs when code provided even if existing token is still valid", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        bridgeId: "bridge_456",
        bridgeToken: "wb_456",
        tokenExpiresAt: "2026-07-01T00:00:00.000Z"
      }),
      text: async () => ""
    })) as typeof fetch;
    const saveConfig = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => pairedConfig);
    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const result = await runConnectCommand(
      createConnectDeps({ fetchImpl, loadConfig, saveConfig, ensureBridgeRunning }),
      { server: "https://wiseeff.example.com", code: "654321" }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalled();
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });

  it("returns exit code 1 when token expired and code missing", async () => {
    const expiredConfig: BridgeConfig = {
      ...pairedConfig,
      tokenExpiresAt: "2020-01-01T00:00:00.000Z"
    };
    const capture = createStdoutCapture();
    const result = await runConnectCommand(
      createConnectDeps({
        stdout: capture,
        loadConfig: async () => expiredConfig
      }),
      { server: "https://wiseeff.example.com" }
    );

    expect(result.exitCode).toBe(1);
    expect(capture.error).toHaveBeenCalledWith(
      "Bridge token expired. Pass --code with a new 6-digit pairing code to re-pair."
    );
  });
});

describe("isBridgeTokenExpired", () => {
  it("returns true for past expiry", () => {
    expect(isBridgeTokenExpired("2020-01-01T00:00:00.000Z", Date.parse("2026-01-01"))).toBe(true);
  });

  it("returns false for future expiry", () => {
    expect(isBridgeTokenExpired("2026-07-01T00:00:00.000Z", Date.parse("2026-01-01"))).toBe(false);
  });
});
