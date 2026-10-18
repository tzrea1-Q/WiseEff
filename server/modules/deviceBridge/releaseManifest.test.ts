import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBridgeReleaseManifest, loadLatestBridgeReleaseManifest } from "./releaseManifest";

describe("bridge release manifest", () => {
  it("returns windows-first same-origin download urls for artifacts that exist on disk", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    expect(manifest.recommendedVersion).toBe("0.1.0");
    expect(manifest.items.find((item) => item.platform === "windows" && item.artifactKind === "installer")?.downloadUrl).toBe(
      "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe"
    );
    expect(manifest.items.find((item) => item.platform === "windows" && item.downloadUrl.endsWith(".zip"))?.downloadUrl).toBe(
      "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
    );
    expect(manifest.items[0]?.platform).toBe("windows");
  });

  it("defaults artifactKind to portable when omitted", async () => {
    const manifest = await loadBridgeReleaseManifest("ops/self-hosted/bridge-artifacts/0.1.0/manifest.json");
    const portable = manifest.items.find((item) => item.downloadUrl.includes(".zip"));
    expect(portable?.artifactKind).toBe("portable");
  });

  it("publishes the current graphical installer for every supported platform", async () => {
    const manifest = await loadLatestBridgeReleaseManifest("ops/self-hosted/bridge-artifacts");
    expect(manifest.recommendedVersion).toBe("0.1.1");
    expect(
      manifest.items.find((item) => item.platform === "windows" && item.artifactKind === "installer")?.downloadUrl
    ).toBe("/downloads/device-bridge/0.1.1/windows/amd64/WiseEffBridgeSetup_0.1.1.exe");
    expect(manifest.items.filter((item) => item.artifactKind === "installer").map((item) => item.version))
      .toEqual(["0.1.1", "0.1.1", "0.1.1"]);
    expect(
      manifest.items.find((item) => item.platform === "windows" && item.artifactKind === "portable")?.downloadUrl
    ).toBe("/downloads/device-bridge/0.1.1/windows/amd64/wiseeff-bridge_0.1.1_windows_amd64.zip");
    expect(
      manifest.items.find((item) => item.platform === "darwin" && item.arch === "arm64" && item.artifactKind === "installer")
        ?.version
    ).toBe("0.1.1");
  });

  it("keeps a previous graphical installer when the latest catalog only has a portable zip", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bridge-releases-"));
    try {
      for (const [version, artifact, artifactKind] of [["0.1.0", "old.exe", "installer"], ["0.1.1", "new.zip", "portable"]] as const) {
        const versionRoot = path.join(root, version);
        await mkdir(path.join(versionRoot, "windows/amd64"), { recursive: true });
        await writeFile(path.join(versionRoot, "windows/amd64", artifact), "test artifact");
        await writeFile(path.join(versionRoot, "manifest.json"), JSON.stringify({
          recommendedVersion: version, minCompatibleVersion: "0.1.0",
          items: [{ platform: "windows", arch: "amd64", version, artifact, artifactKind }]
        }));
      }
      const manifest = await loadLatestBridgeReleaseManifest(root);
      expect(manifest.recommendedVersion).toBe("0.1.1");
      expect(manifest.items.find((item) => item.artifactKind === "installer")?.version).toBe("0.1.0");
      expect(manifest.items.find((item) => item.artifactKind === "portable")?.version).toBe("0.1.1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
