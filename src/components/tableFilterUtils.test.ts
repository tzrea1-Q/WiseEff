import { describe, expect, it } from "vitest";
import { uniqueFilterValues } from "./tableFilterUtils";

describe("uniqueFilterValues", () => {
  it("returns unique trimmed values", () => {
    expect(uniqueFilterValues([{ name: " a " }, { name: "a" }, { name: "b" }], (row) => row.name)).toEqual(["a", "b"]);
  });

  it("skips nullish or non-string filter values without throwing", () => {
    expect(
      uniqueFilterValues(
        [{ name: "ready" }, { name: undefined }, { name: null }, { name: "ready" }],
        (row) => row.name as string
      )
    ).toEqual(["ready"]);
  });
});
