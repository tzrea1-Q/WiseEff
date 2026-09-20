import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDtsConfigSet, type DtsConfigSetFile } from "./configSetResolver";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "config-set");

function loadFixtureDir(name: string): Map<string, DtsConfigSetFile> {
  const root = join(fixturesRoot, name);
  const files = new Map<string, DtsConfigSetFile>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = relative(root, abs).split("\\").join("/");
      files.set(rel, {
        fileVersionId: `${name}:${rel}`,
        content: readFileSync(abs, "utf8"),
      });
    }
  };

  walk(root);
  return files;
}

describe("resolveDtsConfigSet", () => {
  it("bounds repeated locator metadata even when source bytes are small", () => {
    const properties = Array.from({ length: 1000 }, (_, index) => `p${index};`).join(" ");
    const result = resolveDtsConfigSet({ entryFile: "board.dts", includeSearchPaths: [], overlayOrder: [], requireExactOrigins: true,
      files: new Map([["board.dts", { fileVersionId: "v-board", content: `/ { ${"x".repeat(9000)} { ${properties} }; };` }]]),
    });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "source-proof-limit" })]);
    expect(result.effective.nodesByLocator.size).toBe(0);
  });

  it("refuses a source proof with too many visited syntax entries", () => {
    const result = resolveDtsConfigSet({ entryFile: "board.dts", includeSearchPaths: [], overlayOrder: [], requireExactOrigins: true,
      files: new Map([["board.dts", { fileVersionId: "v-board", content: `/ { ${"present;".repeat(100_000)} };` }]]),
    });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "source-proof-limit" })]);
    expect(result.effective.nodesByLocator.size).toBe(0);
  });

  it("counts repeated include expansion against the complete proof byte budget", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts", includeSearchPaths: [], overlayOrder: [], requireExactOrigins: true,
      files: new Map([
        ["board.dts", { fileVersionId: "v-board", content: '/include/ "large.dtsi";\n'.repeat(17) + "/ {};" }],
        ["large.dtsi", { fileVersionId: "v-large", content: `/*${"x".repeat(2 * 1024 * 1024 - 16)}*/\n` }],
      ]),
    });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "source-proof-limit" })]);
    expect(result.effective.nodesByLocator.size).toBe(0);
  });

  it("refuses excessive include depth before resolving an exact source proof", () => {
    const files = new Map<string, DtsConfigSetFile>();
    for (let index = 0; index < 65; index += 1) {
      files.set(`${index}.dts`, { fileVersionId: `v-${index}`, content: index === 64 ? "/ {};" : `/include/ "${index + 1}.dts";` });
    }
    const result = resolveDtsConfigSet({ entryFile: "0.dts", includeSearchPaths: [], overlayOrder: [], files, requireExactOrigins: true });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "source-proof-limit", severity: "error" })]);
    expect(result.effective.nodesByLocator.size).toBe(0);
  });

  it("preserves exact original property origins across includes and label overlays", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts", includeSearchPaths: [], overlayOrder: ["change.dtso"],
      files: new Map([
        ["board.dts", { fileVersionId: "v-board", content: '/dts-v1/;\n/include/ "base.dtsi";\n' }],
        ["base.dtsi", { fileVersionId: "v-base", content: "/ { charger: device@0 { limit = <5>; }; other { limit = <5>; }; };\n" }],
        ["change.dtso", { fileVersionId: "v-overlay", content: "/* 🧪 */\n&charger { limit = <7>; };\n" }],
      ]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.effective.nodesByLocator.get("/device@0")?.properties.get("limit")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "base.dtsi", origin: { fileVersionId: "v-base", start: 32, end: 35 } }),
      expect.objectContaining({ fileName: "change.dtso", nodeLocator: "/device@0", origin: { fileVersionId: "v-overlay", start: 28, end: 31 } }),
    ]);
    expect(result.effective.nodesByLocator.get("/other")?.properties.get("limit")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "base.dtsi", origin: { fileVersionId: "v-base", start: 56, end: 59 } }),
    ]);
  });

  it("resolves include + base + overlay with provenance sourceChain", () => {
    const fixtureFiles = loadFixtureDir("happy");
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: ["include"],
      overlayOrder: ["power.dtso"],
      files: fixtureFiles,
    });

    expect(result.diagnostics).toEqual([]);
    expect(
      result.effective.nodesByLocator.get("/amba/i2c@FDF5E000/sc8562@6E")?.properties.get("gpio_int")?.sourceChain,
    ).toEqual([
      expect.objectContaining({ fileName: "power.dtso", propertyName: "gpio_int", effect: "set" }),
    ]);
    expect(result.effective.nodesByLocator.get("/gpio13")?.labels).toContain("gpio13");
    expect(result.effective.nodesByLocator.get("/amba/i2c@FDF5E000/sc8562@6E")?.labels).toContain("sc8562");
  });

  it("reports include-cycle for mutually recursive includes", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      files: loadFixtureDir("cycle"),
    });

    expect(result.diagnostics.some((d) => d.code === "include-cycle")).toBe(true);
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("reports path-escape for include paths that leave the manifest root", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: ["include"],
      overlayOrder: [],
      files: loadFixtureDir("escape"),
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("path-escape");
    expect(result.diagnostics.find((d) => d.code === "path-escape")?.fileName).toBe("board.dts");
  });

  it("reports include-missing when the target is absent from the manifest", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: ["include"],
      overlayOrder: [],
      files: loadFixtureDir("missing"),
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("include-missing");
  });

  it("reports label-duplicate when the same label binds two nodes", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: [],
      files: loadFixtureDir("duplicate-label"),
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("label-duplicate");
    expect(result.diagnostics.find((d) => d.code === "label-duplicate")?.message).toMatch(/shared/);
  });

  it("self-anchors an overlay &label with no definition instead of dropping it", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay.dtso"],
      files: loadFixtureDir("unresolved-target"),
    });

    // Dangling overlay target is a non-fatal warning, not a fail-closed error.
    const dangling = result.diagnostics.filter((d) => d.code === "dangling-reference");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.severity).toBe("warning");
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);

    // The fragment's business property survives on a synthetic anchor node keyed by the
    // label, so it can still surface as a parameter and round-trip on writeback.
    const anchor = result.effective.nodesByLocator.get("/nonexistent");
    expect(anchor?.labels).toContain("nonexistent");
    expect(anchor?.properties.get("foo")?.normalizedValue).toContain("1");
    expect(anchor?.properties.get("foo")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "overlay.dtso", propertyName: "foo", effect: "set" }),
    ]);
  });

  it("applies /delete-property/ and /delete-node/ with delete provenance", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay.dtso"],
      files: loadFixtureDir("delete"),
    });

    expect(result.diagnostics).toEqual([]);

    const charger = result.effective.nodesByLocator.get("/charger");
    expect(charger?.properties.get("a")?.deleted).toBe(true);
    expect(charger?.properties.get("a")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "board.dts", effect: "set", propertyName: "a" }),
      expect.objectContaining({ fileName: "overlay.dtso", effect: "delete", propertyName: "a" }),
    ]);
    expect(charger?.properties.get("b")?.deleted).toBe(false);
    expect(charger?.properties.get("c")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "overlay.dtso", effect: "set", propertyName: "c" }),
    ]);

    const sub = result.effective.nodesByLocator.get("/charger/sub");
    expect(sub?.deleted).toBe(true);
    expect(sub?.sourceChain.some((e) => e.effect === "delete" && e.fileName === "overlay.dtso")).toBe(true);
  });

  it("applies overlays in overlayOrder with ordered override provenance", () => {
    const files = loadFixtureDir("ordering");

    const aThenB = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay-a.dtso", "overlay-b.dtso"],
      files,
    });
    expect(aThenB.diagnostics).toEqual([]);
    expect(aThenB.effective.nodesByLocator.get("/led")?.properties.get("blink_ms")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "board.dts", effect: "set" }),
      expect.objectContaining({ fileName: "overlay-a.dtso", effect: "override" }),
      expect.objectContaining({ fileName: "overlay-b.dtso", effect: "override" }),
    ]);
    expect(aThenB.effective.nodesByLocator.get("/led")?.properties.get("blink_ms")?.normalizedValue).toContain("300");

    const bThenA = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay-b.dtso", "overlay-a.dtso"],
      files,
    });
    expect(bThenA.effective.nodesByLocator.get("/led")?.properties.get("blink_ms")?.sourceChain).toEqual([
      expect.objectContaining({ fileName: "board.dts", effect: "set" }),
      expect.objectContaining({ fileName: "overlay-b.dtso", effect: "override" }),
      expect.objectContaining({ fileName: "overlay-a.dtso", effect: "override" }),
    ]);
    expect(bThenA.effective.nodesByLocator.get("/led")?.properties.get("blink_ms")?.normalizedValue).toContain("200");
  });
});
