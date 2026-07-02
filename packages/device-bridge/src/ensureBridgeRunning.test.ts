import { describe, expect, it, vi } from "vitest";

const { spawnMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn()
  })),
  existsSyncMock: vi.fn((target: string) => target.endsWith("wiseeff-bridge") || target.endsWith("node.exe"))
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (target: string) => existsSyncMock(target),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 3)
  };
});

vi.mock("./localBridgeProcess", () => ({
  stopLocalBridgeHealthListener: vi.fn(async () => undefined),
  waitForLocalBridgeConnection: vi.fn(async () => null)
}));

vi.mock("./bridgeLaunchLog", () => ({
  appendBridgeLaunchLog: vi.fn(async () => undefined)
}));

vi.mock("./windowsService", () => ({
  runWindowsServiceCommand: vi.fn(async () => 1)
}));

import { buildDarwinLoginShellStartScript, ensureBridgeRunning, probeLocalBridgeHealth } from "./ensureBridgeRunning";
import { resolveDetachedBridgeStartCommand } from "./bridgeRuntimePaths";

describe("probeLocalBridgeHealth", () => {
  it("returns connected state when health endpoint responds", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ connected: true, paired: true })
    })) as typeof fetch;

    const health = await probeLocalBridgeHealth(fetchImpl);
    expect(health).toEqual({ connected: true, paired: true });
  });

  it("returns null when health endpoint is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;

    expect(await probeLocalBridgeHealth(fetchImpl)).toBeNull();
  });
});

describe("ensureBridgeRunning", () => {
  it("skips start when health already connected", async () => {
    const stdout = { log: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ connected: true })
    })) as typeof fetch;

    const result = await ensureBridgeRunning({
      fetchImpl,
      platform: "darwin",
      execPath: "/usr/bin/node",
      cliPath: "/opt/cli.js",
      stdout
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.log).toHaveBeenCalledWith("Bridge already connected.");
  });

  it("attempts detached start when health is offline", async () => {
    const stdout = { log: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn(async () => null) as typeof fetch;

    const result = await ensureBridgeRunning({
      fetchImpl,
      platform: "linux",
      execPath: "/usr/bin/node",
      cliPath: "/opt/cli.js",
      stdout
    });

    expect(result.exitCode).toBe(1);
    expect(stdout.error).toHaveBeenCalledWith("Bridge failed to come online within 25 seconds.");
  });

  it("uses bundled node on Windows instead of .cmd launchers", () => {
    expect(
      resolveDetachedBridgeStartCommand({
        platform: "win32",
        execPath: "C:\\Program Files\\nodejs\\node.exe",
        cliPath: "C:\\Users\\dev\\AppData\\Local\\WiseEff\\Bridge\\cli.js"
      })
    ).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\dev\\AppData\\Local\\WiseEff\\Bridge\\cli.js", "start"]
    });
  });

  it("quotes darwin app bundle paths with spaces when spawning start", () => {
    const wrapperPath = "/Applications/WiseEff Bridge.app/Contents/Resources/wiseeff-bridge";
    expect(buildDarwinLoginShellStartScript(wrapperPath, ["start"])).toBe(`'${wrapperPath}' 'start'`);
  });
});
