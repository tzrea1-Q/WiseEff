import { describe, expect, it } from "vitest";

import { pairingStartupErrorMessage } from "./bridgeRuntimePaths";

describe("bridgeRuntimePaths", () => {
  it("returns platform-specific pairing startup errors", () => {
    expect(pairingStartupErrorMessage("win32")).toContain("WiseEff Bridge");
    expect(pairingStartupErrorMessage("darwin")).toContain("Node.js");
    expect(pairingStartupErrorMessage("linux")).toContain("Node.js");
  });
});
