import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getInstalledToolVersion, readToolInstallState } from "./toolInstallState";
import { resolveManagedToolPath } from "./toolPaths";
import {
  fetchToolReleaseManifest,
  installToolReleaseItem,
  runToolsInstallCommand,
  selectToolReleaseItems
} from "./toolsInstallCommand";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempToolsRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-tool-install-"));
  tempDirs.push(dir);
  return dir;
}

async function fakeExtract(protocol: "adb" | "hdc", version: string, toolsRoot: string) {
  return async (_archivePath: string, destination: string) => {
    if (protocol === "adb") {
      const platformToolsDir = path.join(destination, "platform-tools");
      await mkdir(platformToolsDir, { recursive: true });
      const adbPath = path.join(platformToolsDir, process.platform === "win32" ? "adb.exe" : "adb");
      await writeFile(adbPath, "#!/bin/sh\necho adb\n");
      await chmod(adbPath, 0o755);
      return;
    }
    const hdcPath = path.join(destination, process.platform === "win32" ? "hdc.exe" : "hdc");
    await writeFile(hdcPath, "#!/bin/sh\necho hdc\n");
    await chmod(hdcPath, 0o755);
    await mkdir(path.dirname(resolveManagedToolPath(protocol, version, { toolsRoot })), { recursive: true });
  };
}

describe("toolsInstallCommand", () => {
  it("selects platform-specific manifest items", () => {
    const items = selectToolReleaseItems({
      manifest: {
        recommendedVersion: "0.1.0",
        minCompatibleVersion: "0.1.0",
        items: [
          {
            platform: "darwin",
            arch: "arm64",
            protocol: "adb",
            version: "0.1.0",
            sha256: "abc",
            downloadUrl: "/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip"
          },
          {
            platform: "darwin",
            arch: "arm64",
            protocol: "hdc",
            version: "0.1.0",
            sha256: "def",
            downloadUrl: "/downloads/device-bridge-tools/0.1.0/darwin/arm64/hdc.zip"
          }
        ]
      },
      protocol: "all",
      platform: "darwin",
      arch: "arm64"
    });

    expect(items.map((item) => item.protocol)).toEqual(["adb", "hdc"]);
  });

  it("skips download when the same version and sha256 are already installed", async () => {
    const toolsRoot = await makeTempToolsRoot();
    const item = {
      platform: "darwin" as const,
      arch: "arm64",
      protocol: "adb" as const,
      version: "0.1.0",
      sha256: "abc123",
      downloadUrl: "/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip"
    };
    const managedDir = path.join(toolsRoot, "adb", "0.1.0", "platform-tools");
    await mkdir(managedDir, { recursive: true });
    await writeFile(path.join(managedDir, "adb"), "#!/bin/sh\n", { mode: 0o755 });
    await writeFile(
      path.join(toolsRoot, "state.json"),
      `${JSON.stringify({ adb: { version: "0.1.0", sha256: "abc123", installedAt: "2026-06-25T00:00:00.000Z" } })}\n`
    );

    const fetchImpl = vi.fn();
    const result = await installToolReleaseItem({
      serverUrl: "https://wiseeff.example.com",
      item,
      toolsRoot,
      fetchImpl
    });

    expect(result.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(getInstalledToolVersion("adb", { toolsRoot })).resolves.toBe("0.1.0");
  });

  it("downloads, verifies sha256, and records install state", async () => {
    const toolsRoot = await makeTempToolsRoot();
    const payload = Buffer.from("fake adb bundle");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const item = {
      platform: "darwin" as const,
      arch: "arm64",
      protocol: "adb" as const,
      version: "0.1.0",
      sha256,
      downloadUrl: "/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip"
    };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
    })) as typeof fetch;

    await installToolReleaseItem({
      serverUrl: "https://wiseeff.example.com",
      item,
      toolsRoot,
      fetchImpl,
      extractArchive: await fakeExtract("adb", "0.1.0", toolsRoot)
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(readToolInstallState({ toolsRoot })).resolves.toEqual({
      adb: {
        version: "0.1.0",
        sha256,
        installedAt: expect.any(String)
      }
    });
  });

  it("runs install from manifest via mocked fetch", async () => {
    const toolsRoot = await makeTempToolsRoot();
    const payload = Buffer.from("tool bundle");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const manifest = {
      recommendedVersion: "0.1.0",
      minCompatibleVersion: "0.1.0",
      items: [
        {
          platform: "darwin" as const,
          arch: "arm64",
          protocol: "adb" as const,
          version: "0.1.0",
          sha256,
          downloadUrl: "/downloads/device-bridge-tools/0.1.0/darwin/arm64/adb-platform-tools.zip"
        }
      ]
    };

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.endsWith("/tool-releases")) {
        return { ok: true, json: async () => manifest } as Response;
      }
      return {
        ok: true,
        arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
      } as Response;
    }) as typeof fetch;

    const statuses: string[] = [];
    const result = await runToolsInstallCommand({
      serverUrl: "https://wiseeff.example.com",
      protocol: "adb",
      toolsRoot,
      fetchImpl,
      platform: "darwin",
      arch: "arm64",
      extractArchive: await fakeExtract("adb", "0.1.0", toolsRoot),
      onStatus: (status) => statuses.push(status.status)
    });

    expect(result.ok).toBe(true);
    expect(statuses).toEqual(["running", "succeeded"]);
    await expect(fetchToolReleaseManifest("https://wiseeff.example.com", fetchImpl)).resolves.toEqual(manifest);
  });
});
