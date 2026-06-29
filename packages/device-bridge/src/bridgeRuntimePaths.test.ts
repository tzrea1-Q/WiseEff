import { describe, expect, it } from "vitest";

import {
  pairingStartupErrorMessage,
  resolveBridgeLauncherPath,
  resolveDetachedBridgeStartCommand
} from "./bridgeRuntimePaths";

describe("bridgeRuntimePaths", () => {
  it("returns platform-specific pairing startup errors", () => {
    expect(pairingStartupErrorMessage("win32")).toContain("WiseEff Bridge");
    expect(pairingStartupErrorMessage("darwin")).toContain("Node.js");
    expect(pairingStartupErrorMessage("linux")).toContain("Node.js");
  });

  it("falls back to cli path when no launcher wrapper exists", () => {
    expect(resolveBridgeLauncherPath("/tmp/wiseeff/cli.js", "linux")).toBe("/tmp/wiseeff/cli.js");
  });

  it("uses node.exe plus cli.js for detached start on Windows instead of .cmd", () => {
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
});
