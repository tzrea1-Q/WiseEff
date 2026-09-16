import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_BRIDGE_BUNDLE_MARKERS,
  checkBridgePackageConsistency,
  computeBridgeSourceFingerprint
} from "./lib/bridgePackageConsistency";

describe("bridge package consistency", () => {
  it("passes against committed Bridge artifacts once they match the runtime source", async () => {
    const result = await checkBridgePackageConsistency(process.cwd());
    expect(result.failures.map((failure) => `${failure.code}: ${failure.message}`)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.recommendedVersion).toBe("0.1.1");
  });

  it("requires the rebind restart markers", () => {
    expect(REQUIRED_BRIDGE_BUNDLE_MARKERS).toContain('forceRestart: Boolean(input.code)');
    expect(REQUIRED_BRIDGE_BUNDLE_MARKERS).toContain('pathname === "/connect"');
  });

  it("computes a stable fingerprint for the current repository", async () => {
    const first = await computeBridgeSourceFingerprint(process.cwd());
    const second = await computeBridgeSourceFingerprint(process.cwd());
    expect(first).toBe(second);
  });

  it("fails closed when the versioned artifact directory is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bridge-package-"));
    await mkdir(path.join(root, "packages/device-bridge/src"), { recursive: true });
    await writeFile(path.join(root, "packages/device-bridge/src/version.ts"), 'export const BRIDGE_CLIENT_VERSION = "9.9.9";\n');
    await writeFile(path.join(root, "packages/device-bridge/package.json"), `${JSON.stringify({ version: "9.9.9" })}\n`);
    await mkdir(path.join(root, "ops/self-hosted/bridge-artifacts"), { recursive: true });
    const result = await checkBridgePackageConsistency(root);
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.code).toBe("manifest");
  });
});
