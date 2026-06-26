import { describe, expect, it, vi } from "vitest";

import {
  WISEEFF_BRIDGE_SERVICE_NAME,
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

  it("builds wrapper script content", () => {
    expect(buildServiceWrapperContent("C:\\node.exe", "C:\\cli.js")).toBe(
      '@echo off\r\n"C:\\node.exe" "C:\\cli.js" start\r\n'
    );
  });

  it("resolves wrapper path under Local AppData", () => {
    expect(getServiceWrapperPath(() => "C:\\Users\\operator")).toBe(
      "C:\\Users\\operator\\AppData\\Local\\WiseEff\\device-bridge\\start-service.cmd"
    );
  });

  it("formats sc binPath with quotes when needed", () => {
    expect(formatScBinPath("C:\\WiseEff\\start-service.cmd")).toBe("binPath= C:\\WiseEff\\start-service.cmd");
    expect(formatScBinPath("C:\\Program Files\\WiseEff\\start-service.cmd")).toBe(
      'binPath= "C:\\Program Files\\WiseEff\\start-service.cmd"'
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

  it("installs service wrapper and registers sc.exe service", async () => {
    const capture = createCapture();
    const deps = createDeps(capture);

    const exitCode = await installWindowsService(deps);

    expect(exitCode).toBe(0);
    expect(deps.mkdir).toHaveBeenCalledWith("C:\\Users\\operator\\AppData\\Local\\WiseEff\\device-bridge", {
      recursive: true
    });
    expect(deps.writeFile).toHaveBeenCalledWith(
      "C:\\Users\\operator\\AppData\\Local\\WiseEff\\device-bridge\\start-service.cmd",
      buildServiceWrapperContent(deps.nodePath, deps.cliPath),
      "utf8"
    );
    expect(deps.execFile).toHaveBeenCalledWith(
      "sc.exe",
      [
        "create",
        WISEEFF_BRIDGE_SERVICE_NAME,
        "binPath= C:\\Users\\operator\\AppData\\Local\\WiseEff\\device-bridge\\start-service.cmd",
        "start=auto",
        "DisplayName=WiseEff Device Bridge"
      ],
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

  it("uninstalls service and removes wrapper script", async () => {
    const capture = createCapture();
    const deps = createDeps(capture);

    const exitCode = await uninstallWindowsService(deps);

    expect(exitCode).toBe(0);
    expect(deps.execFile).toHaveBeenCalledWith("sc.exe", ["stop", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });
    expect(deps.execFile).toHaveBeenCalledWith("sc.exe", ["delete", WISEEFF_BRIDGE_SERVICE_NAME], {
      windowsHide: true
    });
    expect(deps.unlink).toHaveBeenCalledWith(
      "C:\\Users\\operator\\AppData\\Local\\WiseEff\\device-bridge\\start-service.cmd"
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
