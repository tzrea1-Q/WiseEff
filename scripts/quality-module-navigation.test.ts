import { describe, expect, it } from "vitest";
import { requireModuleTreeAlignment } from "../e2e/quality/consistency";

const label = (left: number, depth = 1, tree = "modules") => ({
  dom: "span.module-label", tree, depth, left
});

describe("module navigator label anchors", () => {
  it("accepts the 1px tolerance independently for every depth and tree", () => {
    expect(() => requireModuleTreeAlignment([
      label(42), label(43), label(65, 2), label(65.5, 2),
      label(320, 1, "other-tree"), label(320.5, 1, "other-tree")
    ], "/parameters")).not.toThrow();
  });

  it("compares the full depth range rather than only the first label", () => {
    expect(() => requireModuleTreeAlignment([label(42), label(41.5), label(42.6)], "/parameters"))
      .toThrow(/label anchors differ by .*maximum 1px/);
  });

  it("does not pass an empty module tree measurement", () => {
    expect(() => requireModuleTreeAlignment([], "/dts-reload"))
      .toThrow("/dts-reload: missing consistency measurements: moduleTreeLabels");
  });

  it.each(["/parameters", "/node-debugging", "/dts-reload", "/parameter-admin/specs"])(
    "rejects length-dependent sibling drift on %s", (route) => {
      expect(() => requireModuleTreeAlignment([label(369), label(387)], route))
        .toThrow(`${route}: module tree modules depth 1 label anchors differ by 18px (maximum 1px)`);
    }
  );
});
