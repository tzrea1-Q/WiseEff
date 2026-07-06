import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_HEADERS, mapRowRecordToFields } from "./columnMap";

describe("columnMap", () => {
  it("maps Chinese template headers to internal fields", () => {
    const row = mapRowRecordToFields({
      参数名称: "fast_charge_current_limit_ma",
      模块: "Charging Policy",
      当前值: "3200",
      推荐值: "3400",
      范围: "2500 - 4500",
      单位: "mA",
      重要性: "高"
    });
    expect(row.name).toBe("fast_charge_current_limit_ma");
    expect(row.module).toBe("Charging Policy");
    expect(row.risk).toBe("高");
  });

  it("exports stable template header order", () => {
    expect(IMPORT_TEMPLATE_HEADERS[0]).toBe("参数名称");
    expect(IMPORT_TEMPLATE_HEADERS).toContain("值类型");
  });
});
