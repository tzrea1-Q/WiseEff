import { describe, expect, it } from "vitest";
import { readDebugNodeCatalogSearch, writeDebugNodeCatalogSearch } from "./debugNodeCatalogSearch";

describe("debug node catalog location", () => {
  it("round-trips filters, sort and pagination while retaining unrelated context", () => {
    const search = { q: "充电 / 电流", protocol: "hdc" as const, modules: ["module-a", "module-b"], sort: "module-desc", page: 2 };
    const url = writeDebugNodeCatalogSearch("?context=return", search);
    expect(readDebugNodeCatalogSearch(url)).toEqual(search);
    expect(new URLSearchParams(url).get("context")).toBe("return");
    expect(writeDebugNodeCatalogSearch(url, readDebugNodeCatalogSearch(""))).toBe("?context=return");
  });

  it("normalizes invalid state and deduplicates selected modules", () => {
    expect(readDebugNodeCatalogSearch("?protocol=unknown&sort=bindings-bad&page=NaN&modules=a,a,b")).toEqual({
      q: "", protocol: "all", modules: ["a", "b"], sort: "name-asc", page: 1
    });
    for (const page of ["0", "-1", "1.5", "Infinity", "9007199254740992"]) {
      expect(readDebugNodeCatalogSearch(`?page=${page}`).page).toBe(1);
    }
  });
});
