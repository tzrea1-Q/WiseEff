import { describe, expect, it } from "vitest";
import { exportComparisonRowsAsExcel } from "../utils/exportToExcel";
import type { ComparisonRow } from "../types";

describe("exportComparisonRowsAsExcel", () => {
  it("returns an Excel HTML payload with the provided rows", () => {
    const rows: ComparisonRow[] = [
      {
        key: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        description: "限制快充阶段的最大充电电流。",
        baseValue: "3850 mA",
        targetValue: "4200 mA",
        baseNumeric: 3850,
        targetNumeric: 4200,
        unit: "mA",
        status: "drift",
        risk: "High"
      }
    ];

    const html = exportComparisonRowsAsExcel(rows, "AUR-Prod", "NEB-RD", { returnString: true });

    expect(html).toContain("AUR-Prod vs NEB-RD 项目参数对比");
    expect(html).toContain("fast_charge_current_limit_ma");
    expect(html).toContain("3850 mA");
    expect(html).toContain("4200 mA");
  });
});
