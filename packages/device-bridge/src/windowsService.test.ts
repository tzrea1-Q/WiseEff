import { describe, expect, it, vi } from "vitest";

import {
  WISEEFF_BRIDGE_SERVICE_NAME,
  buildServiceBinPath,
  buildServiceWrapperContent,
  formatScBinPath,
  getServiceWrapperPath,
  installWindowsService,
  isWindowsPlatform,
  runWindowsServiceCommand,
  startWindowsService,
  stopWindowsService,
  uninstallWindowsService,
  type WindowsServiceDependencies
} from "./windowsService";

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

function createDeps(overrides: Partial<WindowsServiceDependencies> = {}): WindowsServiceDependencies {
  const capture = createCapture();
  return {
    execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    platform: "win32",
    homedir: () => "C:\\Users\\operator",
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    cliPath: "C:\\WiseEff\\device-bridge\\dist\\cli.js",
    log: capture.log,
    error: capture.error,
    ...overrides
  };
}

describe("windowsService helpers", () => {
  it("detects Windows platform", () => {
    expect(isWindowsPlatform("win32")).toBe(true);
    expect(isWindowsPlatform("darwin")).toBe(false);
    expect(isWindowsPlatform("linux")).toBe(false);
  });

  it("builds wrapper script content with relative install paths", () => {
    expect(buildServiceWrapperContent()).toBe(
      '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0wiseeff-bridge.cmd" start\r\n'
    );
  });

  it("resolves wrapper path next to the bridge install directory", () => {
    expect(getServiceWrapperPath("C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\cli.js")).toBe(
      "C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\start-service.cmd"
    );
  });

  it("formats sc binPath with quotes when needed", () => {
    expect(formatScBinPath("C:\\WiseEff\\start-service.cmd")).toBe("binPath= C:\\WiseEff\\start-service.cmd");
    expect(formatScBinPath("C:\\Program Files\\WiseEff\\start-service.cmd")).toBe(
      'binPath= "C:\\Program Files\\WiseEff\\start-service.cmd"'
    );
  });

  it("builds service binPath with bundled node.exe and cli.js start", () => {
    expect(
      buildServiceBinPath(
        "C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\node.exe",
        "C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\cli.js"
      )
    ).toBe(
      'binPath= "\\"C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\node.exe\\" \\"C:\\Users\\operator\\AppData\\Local\\WiseEff\\Bridge\\cli.js\\" start"'
    );
  });
});

describe("windowsService commands", () => {
  it("rejects non-Windows platforms", async () => {
    const capture = createCapture();
    const deps = createDeps({ platform: "darwin", ...capture });

    const exitCode = await installWindowsService(deps);

    expect(exitCode).toBe(1);
    expect(capture.errors).toContain("Windows service commands are only supported on Windows.");
  });

  it("installs service wrapper, registers sc.exe service, and registers URL scheme", async () => {
    const capture = createCapture();
    const deps = createDeps(capture);
    const wrapperPath = getServiceWrapperPath(deps.cliPath);

    const exitCode = await installWindowsService(deps);

    expect(exitCode).toBe(0);
    expect(deps.mkdir).toHaveBeenCalledWith("C:\\WiseEff\\device-bridge\\dist", {
      recursive: true
    });
    expect(deps.writeFile).toHaveBeenCalledWith(wrapperPath, buildServiceWrapperContent(), "utf8");
    expect(deps.execFile).toHaveBeenCalledWith(
      "sc.exe",
      [
        "create",
        WISEEFF_BRIDGE_SERVICE_NAME,
        'binPath= "\\"C:\\Program Files\\nodejs\\node.exe\\" \\"C:\\WiseEff\\device-bridge\\dist\\cli.js\\" start"',
        "start=auto",
        "DisplayName=WiseEff Device Bridge"
      ],
      { windowsHide: true }
    );
    expect(deps.execFile).toHaveBeenCalledWith(
      "reg.exe",
      expect.arrayContaining(["add", "HKCU\\Software\\Classes\\wiseeff-bridge"]),
      { windowsHide: true }
    );
    expect(capture.logs.some((line) => line.includes("Installed Windows service"))).toBe(true);
  });

  it("reinstalls service when Windows service already exists", async () => {
    const capture = createCapture();
    let createAttempts = 0;
    const execFile = vi.fn(async (_file, args: readonly string[]) => {
      if (args[0] === "create") {
        createAttempts += 1;
        if (createAttempts === 1) {
          throw new Error("CreateService FAILED 1073: The specified service already exists.");
        }
      }
      return { stdout: "", stderr: "" };
    });
    const deps = createDeps({
      ...capture,
      execFile
    });

    const exitCode = await installWindowsService(deps);

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith("sc.exe", ["stop", WISEEFF_BRIDGE_SERVICE_NAME], { windowsHide: true });
    expect(execFile).toHaveBeenCalledWith("sc.exe", ["delete", WISEEFF_BRIDGE_SERVICE_NAME], { windowsHide: true });
    expect(capture.logs.some((line) => line.includes("Reinstalled Windows service"))).toBe(true);
  });

  it("starts and stops the Windows service", async () => {
    const startDeps = createDeps(createCapture());
    const stopDeps = createDeps(createCapture());

    expect(await startWindowsService(startDeps)).toBe(0);
    expect(startDeps.execFile).toHaveBeenCalledWith("sc.exe", ["start", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });

    expect(await stopWindowsService(stopDeps)).toBe(0);
    expect(stopDeps.execFile).toHaveBeenCalledWith("sc.exe", ["stop", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });
  });

  it("uninstalls service, removes wrapper script, and unregisters URL scheme", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async (_file, args: readonly string[]) => {
      if (args[0] === "query") {
        return {
          stdout: '    (Default)    REG_SZ    "C:\\WiseEff\\device-bridge\\dist\\wiseeff-bridge.cmd" --handle-url "%1"\r\n',
          stderr: ""
        };
      }
      return { stdout: "", stderr: "" };
    });
    const deps = createDeps({ ...capture, execFile });

    const exitCode = await uninstallWindowsService(deps);

    expect(exitCode).toBe(0);
    expect(deps.execFile).toHaveBeenCalledWith("sc.exe", ["stop", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });
    expect(deps.execFile).toHaveBeenCalledWith("sc.exe", ["delete", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });
    expect(deps.unlink).toHaveBeenCalledWith("C:\\WiseEff\\device-bridge\\dist\\start-service.cmd");
    expect(deps.execFile).toHaveBeenCalledWith(
      "reg.exe",
      ["delete", "HKCU\\Software\\Classes\\wiseeff-bridge", "/f"],
      { windowsHide: true }
    );
    expect(capture.logs.some((line) => line.includes("Uninstalled Windows service"))).toBe(true);
  });

  it("routes service actions through runWindowsServiceCommand", async () => {
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const capture = createCapture();

    expect(await runWindowsServiceCommand("start", { platform: "darwin", ...capture })).toBe(1);
    expect(await runWindowsServiceCommand("start", { platform: "win32", execFile, ...createCapture() })).toBe(0);
  });
});
