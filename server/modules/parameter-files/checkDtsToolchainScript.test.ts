import { describe, expect, it } from "vitest";

import { evaluateToolchainProbe, loadPinnedVersions } from "../../../scripts/check-dts-toolchain";

describe("evaluateToolchainProbe version pin", () => {
  const pinned = loadPinnedVersions();

  it("accepts tools present at the pinned versions", () => {
    const result = evaluateToolchainProbe({
      dtc: { available: true, version: `Version: DTC ${pinned.dtc.version}`, error: null },
      fdtoverlay: { available: true, version: pinned.dtc.version, error: null },
      dtschema: { available: true, version: pinned.dtschema, error: null },
      pinned
    });
    expect(result.ok).toBe(true);
    expect(result.versionsMatch).toBe(true);
    expect(result.versionError).toBeNull();
  });

  it("fails when a tool reports the wrong version", () => {
    const result = evaluateToolchainProbe({
      dtc: { available: true, version: "1.6.0", error: null },
      fdtoverlay: { available: true, version: pinned.dtc.version, error: null },
      dtschema: { available: true, version: pinned.dtschema, error: null },
      pinned
    });
    expect(result.ok).toBe(false);
    expect(result.versionsMatch).toBe(false);
    expect(result.versionError).toMatch(/dtc version 1\.6\.0 does not match pinned/i);
  });

  it("fails when a version string is unparseable", () => {
    const result = evaluateToolchainProbe({
      dtc: { available: true, version: "Version: DTC 1.8.1", error: null },
      fdtoverlay: { available: true, version: "not-a-version", error: null },
      dtschema: { available: true, version: pinned.dtschema, error: null },
      pinned
    });
    expect(result.ok).toBe(false);
    expect(result.versionsMatch).toBe(false);
    expect(result.versionError).toMatch(/Unparseable fdtoverlay version/i);
  });
});
