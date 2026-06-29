import { describe, expect, it } from "vitest";

import { pairingStartupErrorMessage, resolveBridgeLauncherPath } from "./bridgeRuntimePaths";

describe("bridgeRuntimePaths", () => {
  it("returns platform-specific pairing startup errors", () => {
    expect(pairingStartupErrorMessage("win32")).toContain("WiseEff Bridge");
    expect(pairingStartupErrorMessage("darwin")).toContain("Node.js");
    expect(pairingStartupErrorMessage("linux")).toContain("Node.js");
  });

  it("falls back to cli path when no launcher wrapper exists", () => {
    expect(resolveBridgeLauncherPath("/tmp/wiseeff/cli.js", "linux")).toBe("/tmp/wiseeff/cli.js");
  });
});
