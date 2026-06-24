import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getInstalledToolVersion,
  readToolInstallState,
  recordToolInstall,
  writeToolInstallState
} from "./toolInstallState";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempToolsRoot() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiseeff-tool-state-"));
  tempDirs.push(dir);
  return dir;
}

describe("toolInstallState", () => {
  it("returns empty state when state.json is missing", async () => {
    const toolsRoot = await makeTempToolsRoot();
    await expect(readToolInstallState({ toolsRoot })).resolves.toEqual({});
  });

  it("persists installed tool versions and sha256", async () => {
    const toolsRoot = await makeTempToolsRoot();
    const record = {
      version: "0.1.0",
      sha256: "abc123",
      installedAt: "2026-06-25T00:00:00.000Z"
    };

    await recordToolInstall("adb", record, { toolsRoot });
    await expect(readToolInstallState({ toolsRoot })).resolves.toEqual({ adb: record });
    await expect(getInstalledToolVersion("adb", { toolsRoot })).resolves.toBe("0.1.0");
  });

  it("merges protocol records without dropping the other protocol", async () => {
    const toolsRoot = await makeTempToolsRoot();
    await writeToolInstallState(
      {
        adb: {
          version: "0.1.0",
          sha256: "adb-sha",
          installedAt: "2026-06-25T00:00:00.000Z"
        }
      },
      { toolsRoot }
    );

    await recordToolInstall(
      "hdc",
      {
        version: "0.1.0",
        sha256: "hdc-sha",
        installedAt: "2026-06-25T00:00:01.000Z"
      },
      { toolsRoot }
    );

    await expect(readToolInstallState({ toolsRoot })).resolves.toEqual({
      adb: {
        version: "0.1.0",
        sha256: "adb-sha",
        installedAt: "2026-06-25T00:00:00.000Z"
      },
      hdc: {
        version: "0.1.0",
        sha256: "hdc-sha",
        installedAt: "2026-06-25T00:00:01.000Z"
      }
    });
  });
});
