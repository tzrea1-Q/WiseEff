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

  it("reports target-unresolved for overlay &label with no definition", () => {
    const result = resolveDtsConfigSet({
      entryFile: "board.dts",
      includeSearchPaths: [],
      overlayOrder: ["overlay.dtso"],
      files: loadFixtureDir("unresolved-target"),
    });

    expect(result.diagnostics.map((d) => d.code)).toContain("target-unresolved");
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
