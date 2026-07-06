import { describe, expect, it } from "vitest";
import { parseJsonImport } from "./parseJson";

describe("parseJsonImport", () => {
  it("parses a JSON array of objects with English keys", () => {
    const source = JSON.stringify([
      {
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        currentValue: "3200",
        recommendedValue: "3400",
        range: "2500 - 4500",
        unit: "mA",
        risk: "High",
        valueKind: "scalar"
      }
    ]);

    const rows = parseJsonImport(source);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      recommendedValue: "3400",
      range: "2500 - 4500",
      unit: "mA",
      risk: "High",
      valueKind: "scalar",
      sourceFormat: "json",
      sourceLocation: "json:1"
    });
  });

  it("parses JSON wrapped in an items property", () => {
    const source = JSON.stringify({
      items: [
        {
          name: "battery_health_reserve_pct",
          module: "Battery Safety",
          currentValue: "10",
          risk: "Medium"
        }
      ]
    });

    const rows = parseJsonImport(source);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "battery_health_reserve_pct",
      module: "Battery Safety",
      currentValue: "10",
      risk: "Medium",
      sourceFormat: "json",
      sourceLocation: "json:1"
    });
  });
});
