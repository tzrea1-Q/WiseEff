import { describe, expect, it } from "vitest";

import { loadBridgeToolReleaseManifest } from "./toolReleaseManifest";

describe("bridge tool release manifest", () => {
  it("returns same-origin download urls with protocol metadata", async () => {
    const manifest = await loadBridgeToolReleaseManifest(
      "ops/self-hosted/bridge-tool-artifacts/0.1.0/manifest.json"
    );
    expect(manifest.recommendedVersion).toBe("0.1.0");
    const adbWindows = manifest.items.find(
      (item) => item.platform === "windows" && item.protocol === "adb" && item.arch === "amd64"
    );
    expect(adbWindows?.downloadUrl).toBe(
      "/downloads/device-bridge-tools/0.1.0/windows/amd64/adb-platform-tools.zip"
    );
    expect(adbWindows?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
