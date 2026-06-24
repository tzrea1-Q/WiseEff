import { describe, expect, it } from "vitest";
import { loadBridgeReleaseManifest } from "./releaseManifest";

describe("bridge release manifest", () => {
  it("returns windows-first same-origin download urls", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    expect(manifest.recommendedVersion).toBe("0.1.0");
    expect(manifest.items.find((item) => item.platform === "windows" && item.artifactKind === "installer")?.downloadUrl).toBe(
      "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe"
    );
    expect(manifest.items[0]?.platform).toBe("windows");
  });

  it("defaults artifactKind to portable when omitted", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    const portable = manifest.items.find((item) => item.downloadUrl.includes(".zip"));
    expect(portable?.artifactKind).toBe("portable");
  });
});
