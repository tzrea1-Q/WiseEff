import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      unref: vi.fn()
    }))
  };
});

vi.mock("./localBridgeProcess", () => ({
  stopLocalBridgeHealthListener: vi.fn(async () => undefined),
  waitForLocalBridgeConnection: vi.fn(async () => null)
}));

import { spawn } from "node:child_process";

import { ensureBridgeRunning, probeLocalBridgeHealth } from "./ensureBridgeRunning";

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
      platform: "darwin",
      execPath: "/usr/bin/node",
      cliPath: "/opt/cli.js",
      stdout
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.log).toHaveBeenCalledWith("Started bridge in background.");
    expect(spawn).toHaveBeenCalledWith("/usr/bin/node", ["/opt/cli.js", "start"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  });
});
