import { describe, expect, it, vi } from "vitest";

import {
  buildWindowsUrlSchemeCommandValue,
  extractLauncherPathFromRegistryCommand,
  isWindowsUrlSchemeRegistered,
  parseRegQueryDefaultValue,
  registerWindowsUrlScheme,
  registryCommandMatchesLauncher,
  runWindowsUrlSchemeCommand,
  unregisterWindowsUrlScheme,
  WINDOWS_URL_SCHEME_COMMAND_KEY,
  WINDOWS_URL_SCHEME_KEY,
  type WindowsUrlSchemeDependencies
} from "./windowsUrlScheme";

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

function createDeps(overrides: Partial<WindowsUrlSchemeDependencies> = {}): WindowsUrlSchemeDependencies {
  const capture = createCapture();
  return {
    execFile: vi.fn(async () => ({ stdout: "", stderr: "" })),
    platform: "win32",
    log: capture.log,
    error: capture.error,
    ...overrides
  };
}

describe("windowsUrlScheme helpers", () => {
  it("builds registry command value with handle-url parameter", () => {
    expect(buildWindowsUrlSchemeCommandValue("C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd")).toBe(
      '"C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"'
    );
  });

  it("builds registry command value with node.exe and cli.js for Chrome compatibility", () => {
    expect(
      buildWindowsUrlSchemeCommandValue(
        "C:\\WiseEff\\Bridge\\node.exe",
        "C:\\WiseEff\\Bridge\\cli.js"
      )
    ).toBe('"C:\\WiseEff\\Bridge\\node.exe" "C:\\WiseEff\\Bridge\\cli.js" --handle-url "%1"');
  });

  it("extracts launcher path from registry command value", () => {
    expect(
      extractLauncherPathFromRegistryCommand('"C:\\Custom\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"')
    ).toBe("C:\\Custom\\Bridge\\wiseeff-bridge.cmd");
  });

  it("parses reg query default value output", () => {
    const stdout = [
      "",
      "HKEY_CURRENT_USER\\Software\\Classes\\wiseeff-bridge\\shell\\open\\command",
      '    (Default)    REG_SZ    "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"'
    ].join("\r\n");

    expect(parseRegQueryDefaultValue(stdout)).toBe(
      '"C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"'
    );
  });

  it("matches launcher paths case-insensitively", () => {
    expect(
      registryCommandMatchesLauncher(
        '"c:\\wiseeff\\bridge\\wiseeff-bridge.cmd" --handle-url "%1"',
        "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd"
      )
    ).toBe(true);
  });
});

describe("windowsUrlScheme register/unregister", () => {
  it("rejects register on non-Windows platforms", async () => {
    const capture = createCapture();
    const deps = createDeps({ platform: "linux", ...capture });

    const exitCode = await registerWindowsUrlScheme("C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd", deps);

    expect(exitCode).toBe(1);
    expect(capture.errors).toContain("register is only available on Windows.");
  });

  it("writes registry keys for URL scheme registration", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const deps = createDeps({ execFile, ...capture });

    const exitCode = await registerWindowsUrlScheme("C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd", deps);

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      ["add", WINDOWS_URL_SCHEME_KEY, "/ve", "/d", "URL:WiseEff Bridge Protocol", "/f"],
      { windowsHide: true }
    );
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      ["add", "HKLM\\Software\\Classes\\wiseeff-bridge", "/ve", "/d", "URL:WiseEff Bridge Protocol", "/f"],
      { windowsHide: true }
    );
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      ["add", WINDOWS_URL_SCHEME_KEY, "/v", "URL Protocol", "/d", "", "/f"],
      { windowsHide: true }
    );
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      [
        "add",
        WINDOWS_URL_SCHEME_COMMAND_KEY,
        "/ve",
        "/d",
        '"C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"',
        "/f"
      ],
      { windowsHide: true }
    );
    expect(capture.logs.some((line) => line.includes("Registered wiseeff-bridge://"))).toBe(true);
  });

  it("writes URL Protocol as a named value and uses node.exe handler when cliPath is provided", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const deps = createDeps({ execFile, ...capture });

    const exitCode = await registerWindowsUrlScheme(
      "C:\\WiseEff\\Bridge\\node.exe",
      deps,
      "C:\\WiseEff\\Bridge\\cli.js"
    );

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      ["add", WINDOWS_URL_SCHEME_KEY, "/v", "URL Protocol", "/d", "", "/f"],
      { windowsHide: true }
    );
    expect(execFile).toHaveBeenCalledWith(
      "reg.exe",
      [
        "add",
        WINDOWS_URL_SCHEME_COMMAND_KEY,
        "/ve",
        "/d",
        '"C:\\WiseEff\\Bridge\\node.exe" "C:\\WiseEff\\Bridge\\cli.js" --handle-url "%1"',
        "/f"
      ],
      { windowsHide: true }
    );
  });

  it("detects registered scheme and validates launcher path", async () => {
    const execFile = vi.fn(async () => ({
      stdout: [
        "",
        "HKEY_CURRENT_USER\\Software\\Classes\\wiseeff-bridge\\shell\\open\\command",
        '    (Default)    REG_SZ    "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"'
      ].join("\r\n"),
      stderr: ""
    }));

    const registered = await isWindowsUrlSchemeRegistered("C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd", { execFile });
    expect(registered).toBe(true);

    const mismatched = await isWindowsUrlSchemeRegistered("D:\\Other\\wiseeff-bridge.cmd", { execFile });
    expect(mismatched).toBe(false);
  });

  it("unregisters URL scheme when command key exists", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async (_file, args: readonly string[]) => {
      if (args[0] === "query") {
        return {
          stdout: '    (Default)    REG_SZ    "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd" --handle-url "%1"\r\n',
          stderr: ""
        };
      }
      return { stdout: "", stderr: "" };
    });
    const deps = createDeps({ execFile, ...capture });

    const exitCode = await unregisterWindowsUrlScheme(deps);

    expect(exitCode).toBe(0);
    expect(execFile).toHaveBeenCalledWith("reg.exe", ["delete", WINDOWS_URL_SCHEME_KEY, "/f"], {
      windowsHide: true
    });
    expect(capture.logs.some((line) => line.includes("Unregistered wiseeff-bridge://"))).toBe(true);
  });

  it("reports success when unregister finds nothing to remove", async () => {
    const capture = createCapture();
    const execFile = vi.fn(async () => {
      throw new Error("ERROR: The system was unable to find the specified registry key or value.");
    });
    const deps = createDeps({ execFile, ...capture });

    const exitCode = await runWindowsUrlSchemeCommand(
      "unregister",
      "C:\\WiseEff\\Bridge\\wiseeff-bridge.cmd",
      deps
    );

    expect(exitCode).toBe(0);
    expect(capture.logs).toContain("Windows URL scheme is not registered.");
  });
});
