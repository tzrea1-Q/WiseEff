import { describe, expect, it } from "vitest";
import { loadBridgeReleaseManifest } from "./releaseManifest";

describe("bridge release manifest", () => {
  it("returns windows-first same-origin download urls", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    expect(manifest.recommendedVersion).toBe("0.1.0");
    expect(manifest.items.find((item) => item.platform === "windows")?.downloadUrl).toBe(
      "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
    );
    expect(manifest.items[0]?.platform).toBe("windows");
  });
});
