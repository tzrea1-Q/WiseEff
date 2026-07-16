import { describe, expect, it } from "vitest";

import {
  assertManifestEntryAndBase,
  clearStatusAfterValidationFailure,
  isManifestPathEscape,
  normalizeIncludeSearchPaths,
  normalizeManifestLogicalPath,
  normalizePersistedManifest,
} from "./configRevisionManifest";
import type { ConfigRevisionManifestMember } from "./types";

function member(
  overrides: Partial<ConfigRevisionManifestMember> & Pick<ConfigRevisionManifestMember, "fileName" | "role">,
): ConfigRevisionManifestMember {
  return {
    fileId: "f1",
    fileVersionId: "v1",
    sortOrder: 0,
    content: "",
    ...overrides,
  };
}

describe("configRevisionManifest path safety", () => {
  it("normalizes logical paths and rejects escapes", () => {
    expect(normalizeManifestLogicalPath("include/foo.dtsi")).toBe("include/foo.dtsi");
    expect(normalizeManifestLogicalPath("./board.dts")).toBe("board.dts");
    expect(normalizeManifestLogicalPath("../secret.dts")).toBeNull();
    expect(isManifestPathEscape("../x")).toBe(true);
    expect(isManifestPathEscape("/abs")).toBe(true);
  });

  it("normalizes include search paths and rejects escapes", () => {
    expect(normalizeIncludeSearchPaths([".", "include"])).toEqual([".", "include"]);
    expect(normalizeIncludeSearchPaths([])).toEqual(["."]);
    expect(normalizeIncludeSearchPaths(["../etc"])).toMatchObject({ code: "path-escape" });
    expect(normalizeIncludeSearchPaths(["/abs"])).toMatchObject({ code: "path-escape" });
  });
});

describe("assertManifestEntryAndBase fail-closed", () => {
  it("rejects missing role=base and never invents an entry from the first file", () => {
    expect(
      assertManifestEntryAndBase({
        entryFile: "overlay.dts",
        members: [member({ fileName: "overlay.dts", role: "overlay" })],
      }),
    ).toMatchObject({ code: "missing-base" });

    expect(
      assertManifestEntryAndBase({
        entryFile: "",
        members: [member({ fileName: "a.dts", role: "overlay" })],
      }),
    ).toMatchObject({ code: "missing-entry-file" });
  });

  it("requires entryFile to match a base member", () => {
    expect(
      assertManifestEntryAndBase({
        entryFile: "base.dts",
        members: [
          member({ fileName: "base.dts", role: "base", sortOrder: 0 }),
          member({ fileName: "overlay.dts", role: "overlay", sortOrder: 1 }),
        ],
      }),
    ).toBeNull();

    expect(
      assertManifestEntryAndBase({
        entryFile: "missing.dts",
        members: [member({ fileName: "base.dts", role: "base" })],
      }),
    ).toMatchObject({ code: "missing-entry-file" });
  });
});

describe("normalizePersistedManifest", () => {
  it("preserves overlay order and include search paths", () => {
    const result = normalizePersistedManifest({
      entryFile: "board.dts",
      includeSearchPaths: ["include", "."],
      overlayOrder: ["ov2.dts", "ov1.dts"],
      members: [
        member({ fileName: "board.dts", role: "base", sortOrder: 0 }),
        member({ fileName: "ov2.dts", role: "overlay", sortOrder: 1 }),
        member({ fileName: "ov1.dts", role: "overlay", sortOrder: 2 }),
      ],
    });
    expect(result).toEqual({
      ok: true,
      manifest: {
        entryFile: "board.dts",
        includeSearchPaths: ["include", "."],
        overlayOrder: ["ov2.dts", "ov1.dts"],
      },
    });
  });
});

describe("clearStatusAfterValidationFailure", () => {
  it("revokes validated publishability", () => {
    expect(clearStatusAfterValidationFailure("validated", "compile-failed")).toBe("invalid");
    expect(clearStatusAfterValidationFailure("validated", "empty-config-set")).toBe(
      "validation_failed",
    );
    expect(clearStatusAfterValidationFailure("validated", "open-mapping")).toBe("needs_mapping");
  });

  it("keeps resolved for non-validated soft failures", () => {
    expect(clearStatusAfterValidationFailure("resolved", "empty-config-set")).toBe("resolved");
  });

  it("never returns validated", () => {
    const codes = [
      "empty-config-set",
      "open-mapping",
      "open-review",
      "compile-failed",
      "schema-failed",
      "toolchain-unavailable",
    ];
    for (const code of codes) {
      expect(clearStatusAfterValidationFailure("validated", code)).not.toBe("validated");
    }
  });
});
