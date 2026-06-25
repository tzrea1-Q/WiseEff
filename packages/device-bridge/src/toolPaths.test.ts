import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveManagedToolPath, resolveToolBinary, resolveToolsRoot } from "./toolPaths";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }))));
});

async function makeTempToolsRoot() {
  const dir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "wiseeff-tools-")));
  tempDirs.push(dir);
  return dir;
}

describe("toolPaths", () => {
  it("resolves platform-specific tools roots", () => {
    expect(
      resolveToolsRoot({
        platform: "win32",
        localAppData: "C:\\Users\\dev\\AppData\\Local"
      })
    ).toBe(path.join("C:\\Users\\dev\\AppData\\Local", "WiseEff", "tools"));

    expect(
      resolveToolsRoot({
        platform: "darwin",
        homeDir: "/Users/dev"
      })
    ).toBe(path.join("/Users/dev", "Library", "Application Support", "WiseEff", "tools"));

    expect(
      resolveToolsRoot({
        platform: "linux",
        homeDir: "/home/dev"
      })
    ).toBe(path.join("/home/dev", ".wiseeff", "tools"));
  });

  it("prefers managed adb binary when installed version exists", async () => {
    const toolsRoot = await makeTempToolsRoot();
    const managedPath = path.join(toolsRoot, "adb", "0.1.0", "platform-tools", "adb");
    await mkdir(path.dirname(managedPath), { recursive: true });
    await writeFile(managedPath, "#!/bin/sh\necho adb\n", "utf8");
    await import("node:fs/promises").then(({ chmod }) => chmod(managedPath, 0o755));

    const resolved = await resolveToolBinary("adb", {
      installedVersion: "0.1.0",
      platform: "linux",
      toolsRoot
    });

    expect(resolved).toEqual({ command: managedPath, source: "managed" });
  });

  it("falls back to system command name when managed binary is missing", async () => {
    const resolved = await resolveToolBinary("hdc", {
      installedVersion: "0.1.0",
      platform: "darwin",
      homeDir: "/Users/dev"
    });

    expect(resolved).toEqual({ command: "hdc", source: "system" });
  });

  it("builds managed tool paths per protocol", () => {
    expect(
      resolveManagedToolPath("adb", "0.1.0", {
        platform: "win32",
        localAppData: "C:\\Users\\dev\\AppData\\Local"
      })
    ).toBe(path.join("C:\\Users\\dev\\AppData\\Local", "WiseEff", "tools", "adb", "0.1.0", "platform-tools", "adb.exe"));

    expect(
      resolveManagedToolPath("hdc", "0.1.0", {
        platform: "darwin",
        homeDir: "/Users/dev"
      })
    ).toBe(
      path.join("/Users/dev", "Library", "Application Support", "WiseEff", "tools", "hdc", "0.1.0", "hdc")
    );
  });
});
