import { describe, expect, it } from "vitest";

import {
  buildLaunchAgentPlistContent,
  buildLaunchAgentPathEnv,
  resolveBridgeBinPath,
  WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL
} from "./macosLaunchAgent";

describe("macosLaunchAgent", () => {
  it("builds plist with bridge path containing spaces", () => {
    const plist = buildLaunchAgentPlistContent({
      bridgeBin: "/Applications/WiseEff Bridge.app/Contents/Resources/wiseeff-bridge",
      homedir: "/Users/tzrea1",
      logPath: "/Users/tzrea1/.wiseeff/bridge-launchd.log"
    });

    expect(plist).toContain("<string>/Applications/WiseEff Bridge.app/Contents/Resources/wiseeff-bridge</string>");
    expect(plist).toContain(`<string>${WISEEFF_BRIDGE_LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("/Users/tzrea1/.wiseeff/bridge-launchd.log");
  });

  it("includes user-local node path in PATH", () => {
    expect(buildLaunchAgentPathEnv("/Users/tzrea1")).toContain("/Users/tzrea1/.local/bin");
  });

  it("resolves bridge bin next to cli.js", () => {
    expect(resolveBridgeBinPath("/Applications/WiseEff Bridge.app/Contents/Resources/cli.js")).toBe(
      "/Applications/WiseEff Bridge.app/Contents/Resources/wiseeff-bridge"
    );
  });
});
