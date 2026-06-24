import { describe, expect, it, vi } from "vitest";

import { runCli } from "./cli";
import type { BridgeConfig } from "./config";

function createStdoutCapture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    stdout: {
      log: vi.fn((message: string) => logs.push(message)),
      error: vi.fn((message: string) => errors.push(message))
    },
    logs,
    errors
  };
}

describe("device bridge cli", () => {
  it("pairs bridge and persists config", async () => {
    const capture = createStdoutCapture();
    const saveConfig = vi.fn(async () => undefined);
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

    const exitCode = await runCli(["pair", "--server", "https://wiseeff.example.com", "--code", "123456"], {
      fetchImpl,
      saveConfig,
      stdout: capture.stdout
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith("https://wiseeff.example.com/api/v1/device-bridges/pair", expect.any(Object));
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        bridgeId: "bridge_123",
        bridgeToken: "wb_123",
        serverUrl: "https://wiseeff.example.com"
      })
    );
  });

  it("reports not paired status when config is missing", async () => {
    const capture = createStdoutCapture();
    const exitCode = await runCli(["status"], {
      loadConfig: async () => null,
      stdout: capture.stdout
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.some((line) => line.includes("not paired"))).toBe(true);
  });

  it("reads local health state for status command", async () => {
    const capture = createStdoutCapture();
    const config: BridgeConfig = {
      bridgeId: "bridge_123",
      bridgeToken: "wb_123",
      tokenExpiresAt: "2026-07-01T00:00:00.000Z",
      serverUrl: "https://wiseeff.example.com",
      machineLabel: "machine",
      platform: "windows",
      arch: "x64",
      pairedAt: "2026-06-23T00:00:00.000Z"
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ connected: true }),
      text: async () => ""
    })) as typeof fetch;

    const exitCode = await runCli(["status"], {
      loadConfig: async () => config,
      fetchImpl,
      stdout: capture.stdout
    });

    expect(exitCode).toBe(0);
    expect(capture.logs.some((line) => line.includes("bridgeStatus=connected"))).toBe(true);
  });

  it("rejects service commands on non-Windows platforms", async () => {
    const capture = createStdoutCapture();
    const originalPlatform = process.platform;

    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const exitCode = await runCli(["service", "install"], {
        stdout: capture.stdout
      });

      expect(exitCode).toBe(1);
      expect(capture.errors.some((line) => line.includes("only supported on Windows"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("connect command requires server flag", async () => {
    const capture = createStdoutCapture();
    const exitCode = await runCli(["connect"], {
      stdout: capture.stdout
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.some((line) => line.includes("--server"))).toBe(true);
  });

  it("handle-url flag parses scheme and invokes connect flow", async () => {
    const capture = createStdoutCapture();
    const config: BridgeConfig = {
      bridgeId: "bridge_123",
      bridgeToken: "wb_123",
      tokenExpiresAt: "2026-07-01T00:00:00.000Z",
      serverUrl: "https://wiseeff.example.com",
      machineLabel: "machine",
      platform: "windows",
      arch: "x64",
      pairedAt: "2026-06-23T00:00:00.000Z"
    };
    const ensureBridgeRunning = vi.fn(async () => ({ exitCode: 0 }));

    const exitCode = await runCli(
      ["--handle-url", "wiseeff-bridge://connect?server=https%3A%2F%2Fwiseeff.example.com&code=123456"],
      {
        loadConfig: async () => config,
        stdout: capture.stdout,
        ensureBridgeRunning
      }
    );

    expect(exitCode).toBe(0);
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });
});
