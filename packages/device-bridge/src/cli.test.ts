import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fsMockState = vi.hoisted(() => ({
  passthroughExistsSync: null as null | typeof import("node:fs").existsSync,
  existsSyncMock: vi.fn<(target: string) => boolean>()
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMockState.passthroughExistsSync = actual.existsSync;
  fsMockState.existsSyncMock.mockImplementation((target) => actual.existsSync(target));
  return {
    ...actual,
    existsSync: (target: string) => fsMockState.existsSyncMock(target)
  };
});

import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";

import { isCliEntryPoint, resolveCliEntryPath, runCli } from "./cli";
import { resolveBridgeBinPath } from "./macosLaunchAgent";
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
  it("detects CLI entry when argv path contains spaces", () => {
    const entryPath = "/Applications/WiseEff Bridge.app/Contents/Resources/cli.js";
    expect(resolveCliEntryPath(fileURLToPath(pathToFileURL(entryPath).href))).toBe(resolveCliEntryPath(entryPath));
    expect(isCliEntryPoint(["node"])).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")("detects CLI entry across macOS /tmp and /private/tmp aliases", () => {
    const dir = "/tmp/wiseeff-cli-entry-test";
    mkdirSync(dir, { recursive: true });
    const entryPath = path.join(dir, "cli.js");
    writeFileSync(entryPath, "");
    const privatePath = path.join("/private", entryPath);
    expect(resolveCliEntryPath(privatePath)).toBe(resolveCliEntryPath(entryPath));
    rmSync(dir, { recursive: true, force: true });
  });

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

    expect(exitCode).toBe(0);
    expect(capture.logs.some((line) => line.includes("paired=false"))).toBe(true);
  });

  it("starts standby health service when start runs without config", async () => {
    const capture = createStdoutCapture();
    const startPromise = runCli(["start"], {
      loadConfig: async () => null,
      stdout: capture.stdout
    });

    let healthReady = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch("http://127.0.0.1:18787/health").catch(() => null);
      if (response?.ok) {
        const body = (await response.json()) as { paired?: boolean };
        healthReady = body.paired === false;
        if (healthReady) {
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    process.emit("SIGTERM");
    const exitCode = await startPromise;

    expect(healthReady).toBe(true);
    expect(exitCode).toBe(0);
    expect(capture.logs.some((line) => line.includes("Bridge standby started"))).toBe(true);
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

  it("rejects service commands on unsupported platforms", async () => {
    const capture = createStdoutCapture();
    const exitCode = await runCli(["service", "install"], {
      stdout: capture.stdout,
      platform: "linux"
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.some((line) => line.includes("only supported on Windows and macOS"))).toBe(true);
  });

  it.skipIf(process.platform !== "darwin")("installs macOS launch agent via service install", async () => {
    const capture = createStdoutCapture();
    const cliPath = "/Applications/WiseEff Bridge.app/Contents/Resources/cli.js";
    const bridgeBin = resolveBridgeBinPath(cliPath);
    fsMockState.existsSyncMock.mockImplementation((target) => target === bridgeBin);

    const exitCode = await runCli(["service", "install"], {
      stdout: capture.stdout,
      platform: "darwin",
      cliPath,
      execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined)
    });
    fsMockState.existsSyncMock.mockImplementation((target) => fsMockState.passthroughExistsSync!(target));

    expect(exitCode).toBe(0);
    expect(capture.logs.some((line) => line.includes("LaunchAgent plist"))).toBe(true);
  });

  it("connect command requires server flag", async () => {
    const capture = createStdoutCapture();
    const exitCode = await runCli(["connect"], {
      stdout: capture.stdout
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.some((line) => line.includes("--server"))).toBe(true);
  });

  it("rejects register on unsupported platforms", async () => {
    const capture = createStdoutCapture();
    const exitCode = await runCli(["register"], {
      stdout: capture.stdout,
      platform: "linux"
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.some((line) => line.includes("only available on Windows and macOS"))).toBe(true);
  });

  it("registers Windows URL scheme via register command", async () => {
    const capture = createStdoutCapture();
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const exitCode = await runCli(["register"], {
      stdout: capture.stdout,
      platform: "win32",
      cliPath: "C:\\WiseEff\\Bridge\\cli.js",
      execFile
    });

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      expect.arrayContaining(["add", "HKCU\\Software\\Classes\\wiseeff-bridge\\shell\\open\\command"]),
      { windowsHide: true }
    );
    expect(capture.logs.some((line) => line.includes("Registered wiseeff-bridge://"))).toBe(true);
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

    const exitCode = await runCli(
      ["--handle-url", "wiseeff-bridge://connect?server=https%3A%2F%2Fwiseeff.example.com&code=123456"],
      {
        loadConfig: async () => config,
        saveConfig: vi.fn(async () => undefined),
        fetchImpl,
        stdout: capture.stdout,
        ensureBridgeRunning
      }
    );

    expect(exitCode).toBe(0);
    expect(ensureBridgeRunning).toHaveBeenCalled();
  });
});
