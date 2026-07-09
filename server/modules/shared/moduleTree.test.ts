import { describe, expect, it } from "vitest";
import {
  assertNoCycle,
  buildPath,
  depthOf,
  isDescendant,
  subtreePrefix
} from "./moduleTree";

describe("moduleTree helpers", () => {
  describe("buildPath", () => {
    it("returns id alone for a root node", () => {
      expect(buildPath(null, "pm_a")).toBe("pm_a");
      expect(buildPath(undefined, "pm_a")).toBe("pm_a");
      expect(buildPath("", "pm_a")).toBe("pm_a");
    });

    it("joins parent path and id with slash", () => {
      expect(buildPath("pm_a", "pm_b")).toBe("pm_a/pm_b");
      expect(buildPath("pm_a/pm_b", "pm_c")).toBe("pm_a/pm_b/pm_c");
    });
  });

  describe("depthOf", () => {
    it("counts path segments", () => {
      expect(depthOf("pm_a")).toBe(1);
      expect(depthOf("pm_a/pm_b")).toBe(2);
      expect(depthOf("pm_a/pm_b/pm_c")).toBe(3);
    });
  });

  describe("isDescendant", () => {
    it("returns true when candidate is under ancestor", () => {
      expect(isDescendant("pm_a/pm_b", "pm_a")).toBe(true);
      expect(isDescendant("pm_a/pm_b/pm_c", "pm_a")).toBe(true);
      expect(isDescendant("pm_a/pm_b/pm_c", "pm_a/pm_b")).toBe(true);
    });

    it("returns false for same node, unrelated, or prefix false positives", () => {
      expect(isDescendant("pm_a", "pm_a")).toBe(false);
      expect(isDescendant("pm_a", "pm_b")).toBe(false);
      expect(isDescendant("pm_ab", "pm_a")).toBe(false);
      expect(isDescendant("pm_a", "pm_a/pm_b")).toBe(false);
    });
  });

  describe("subtreePrefix", () => {
    it("returns exact path and descendant prefix matchers", () => {
      expect(subtreePrefix("pm_a")).toEqual({
        exactPath: "pm_a",
        descendantPrefix: "pm_a/"
      });
      expect(subtreePrefix("pm_a/pm_b")).toEqual({
        exactPath: "pm_a/pm_b",
        descendantPrefix: "pm_a/pm_b/"
      });
    });
  });

  describe("assertNoCycle", () => {
    const byId = new Map([
      ["a", { id: "a", path: "a" }],
      ["b", { id: "b", path: "a/b" }],
      ["c", { id: "c", path: "a/b/c" }],
      ["x", { id: "x", path: "x" }]
    ]);

    it("allows reparent to root or unrelated branch", () => {
      expect(() => assertNoCycle("c", null, byId)).not.toThrow();
      expect(() => assertNoCycle("c", "x", byId)).not.toThrow();
    });

    it("rejects moving node onto itself", () => {
      expect(() => assertNoCycle("b", "b", byId)).toThrow(/cycle/i);
    });

    it("rejects moving node under its descendant", () => {
      expect(() => assertNoCycle("a", "c", byId)).toThrow(/cycle/i);
      expect(() => assertNoCycle("b", "c", byId)).toThrow(/cycle/i);
    });
  });
});
