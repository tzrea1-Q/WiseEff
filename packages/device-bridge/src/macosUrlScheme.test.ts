import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as macosUrlScheme from "./macosUrlScheme";
import {
  buildLauncherInfoPlist,
  buildLauncherScript,
  isPortableUrlSchemeRegistered,
  registerPortableUrlScheme,
  resolveLauncherAppPath,
  runMacosUrlSchemeCommand,
  unregisterPortableUrlScheme,
  type MacosUrlSchemeDependencies
} from "./macosUrlScheme";

function createCapture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message: string) => logs.push(message),
    error: (message: string) => errors.push(message)
  };
}

function createDeps(overrides: Partial<MacosUrlSchemeDependencies> = {}): MacosUrlSchemeDependencies {
  const capture = createCapture();
  return {
    execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    platform: "darwin",
    homedir: () => "/Users/operator",
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    nodePath: "/usr/local/bin/node",
    cliPath: "/Users/operator/Downloads/wiseeff-bridge/cli.js",
    log: capture.log,
    error: capture.error,
    ...overrides
  };
}

describe("macosUrlScheme helpers", () => {
  it("builds Info.plist with wiseeff-bridge URL scheme", () => {
    const plist = buildLauncherInfoPlist("0.1.0");
    expect(plist).toContain("wiseeff-bridge");
    expect(plist).toContain("com.wiseeff.bridge.launcher");
  });

  it("builds launcher script with absolute node and cli paths", () => {
    const script = buildLauncherScript("/usr/local/bin/node", "/tmp/cli.js");
    expect(script).toContain('NODE="/usr/local/bin/node"');
    expect(script).toContain('CLI="/tmp/cli.js"');
    expect(script).toContain('--handle-url "$1"');
  });

  it("resolves launcher app path under ~/.wiseeff", () => {
    expect(resolveLauncherAppPath(() => "/Users/operator")).toBe(
      "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app"
    );
  });
});

describe("macosUrlScheme register/unregister", () => {
  beforeEach(() => {
    vi.spyOn(macosUrlScheme, "resolveLsRegisterPath").mockReturnValue("/usr/bin/lsregister");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects register on non-macOS platforms", async () => {
    const capture = createCapture();
    const deps = createDeps({ platform: "linux", ...capture });

    const exitCode = await registerPortableUrlScheme(deps);

    expect(exitCode).toBe(1);
    expect(capture.errors).toContain("register is only available on macOS.");
  });

  it("registers launcher app and calls lsregister", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const writeFile = vi.fn(async () => undefined);
    const deps = createDeps({ execFile, writeFile, ...capture });

    const exitCode = await registerPortableUrlScheme(deps);

    expect(exitCode).toBe(0);
    expect(deps.mkdir).toHaveBeenCalledWith(
      "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app/Contents/MacOS",
      { recursive: true }
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app/Contents/Info.plist",
      expect.stringContaining("wiseeff-bridge"),
      "utf8"
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app/Contents/MacOS/WiseEffBridge",
      expect.stringContaining("/Users/operator/Downloads/wiseeff-bridge/cli.js"),
      "utf8"
    );
    expect(execFile).toHaveBeenCalledWith(
      expect.stringContaining("lsregister"),
      ["-f", "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app"]
    );
    expect(capture.logs.some((line) => line.includes("Registered wiseeff-bridge://"))).toBe(true);
  });

  it("detects registered launcher app", async () => {
    const access = vi.fn(async () => undefined);
    const registered = await isPortableUrlSchemeRegistered({
      homedir: () => "/Users/operator",
      access
    });

    expect(registered).toBe(true);
    expect(access).toHaveBeenCalledWith("/Users/operator/.wiseeff/WiseEffBridgeLauncher.app");
  });

  it("unregisters launcher app and removes bundle", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const rm = vi.fn(async () => undefined);
    const deps = createDeps({ execFile, rm, ...capture });

    const exitCode = await unregisterPortableUrlScheme(deps);

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith(
      expect.stringContaining("lsregister"),
      ["-u", "/Users/operator/.wiseeff/WiseEffBridgeLauncher.app"]
    );
    expect(rm).toHaveBeenCalledWith("/Users/operator/.wiseeff/WiseEffBridgeLauncher.app", {
      recursive: true,
      force: true
    });
    expect(capture.logs.some((line) => line.includes("Unregistered wiseeff-bridge://"))).toBe(true);
  });

  it("reports success when unregister finds nothing to remove", async () => {
    const capture = createCapture();
    const access = vi.fn(async () => {
      throw new Error("missing");
    });
    const deps = createDeps({ access, ...capture });

    const exitCode = await runMacosUrlSchemeCommand("unregister", deps);

    expect(exitCode).toBe(0);
    expect(capture.logs).toContain("Portable URL scheme is not registered.");
  });
});
