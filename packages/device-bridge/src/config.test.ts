import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { resolveBridgeConfigPath, loadBridgeConfig, saveBridgeConfig, type BridgeConfig } from "./config";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (target) => {
      await rm(target, { recursive: true, force: true });
    })
  );
  tempDirs.length = 0;
});

describe("bridge config", () => {
  it("stores windows-local config under LOCALAPPDATA", () => {
    const configPath = resolveBridgeConfigPath({
      platform: "win32",
      localAppData: "C:/Users/test/AppData/Local"
    });
    expect(configPath).toBe(path.join("C:/Users/test/AppData/Local", "WiseEff", "bridge.json"));
  });

  it("loads and saves config payload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-bridge-config-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "WiseEff", "bridge.json");

    const config: BridgeConfig = {
      bridgeId: "bridge_123",
      bridgeToken: "wb_123",
      tokenExpiresAt: "2026-07-01T00:00:00.000Z",
      serverUrl: "https://wiseeff.example.com",
      machineLabel: "my-machine",
      platform: "windows",
      arch: "x64",
      pairedAt: "2026-06-23T00:00:00.000Z"
    };

    await saveBridgeConfig(config, configPath);
    const loaded = await loadBridgeConfig(configPath);
    expect(loaded).toEqual(config);
  });
});
