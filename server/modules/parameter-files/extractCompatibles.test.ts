import { describe, expect, it } from "vitest";

import { extractCompatiblesFromDtsSource } from "./service";

describe("extractCompatiblesFromDtsSource", () => {
  it("collects quoted compatible values from DTS properties", () => {
    const source = `
/ {
  sc8562@6E {
    compatible = "sc8562", "richtek,sc8562";
  };
  orphan {
    compatible = "huawei,orphan";
  };
};
`;
    expect(extractCompatiblesFromDtsSource(source).sort()).toEqual([
      "huawei,orphan",
      "richtek,sc8562",
      "sc8562",
    ]);
  });
});
