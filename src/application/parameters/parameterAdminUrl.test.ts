import { describe, expect, it } from "vitest";

import {
  buildParameterAdminSearch,
  parseParameterAdminUrl,
  toParameterAdminFilters
} from "./parameterAdminUrl";

describe("parameterAdminUrl", () => {
  it("does not round-trip the retired spec-library category query key", () => {
    const parsed = parseParameterAdminUrl("?q=gpio_int&category=Charge%20Pump%20IC&module=充电策略");
    expect(parsed.q).toBe("gpio_int");
    expect(parsed.moduleNames).toEqual(["充电策略"]);
    expect(parsed).not.toHaveProperty("businessCategories");

    const filters = toParameterAdminFilters(parsed);
    expect(filters).not.toHaveProperty("businessCategories");
    expect(filters.moduleNames).toEqual(["充电策略"]);

    const search = buildParameterAdminSearch({}, parsed);
    expect(search).toContain("q=gpio_int");
    expect(search).toContain("module=");
    expect(search).not.toMatch(/(^|&)category=/);
  });
});
