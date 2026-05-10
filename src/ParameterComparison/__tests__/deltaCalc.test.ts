import { describe, expect, it } from "vitest";
import { calculateDelta } from "../utils/deltaCalc";

describe("calculateDelta", () => {
  it("returns synced when values are equal", () => {
    expect(calculateDelta({ baseValue: "2048", targetValue: "2048", unit: "" })).toEqual({
      kind: "synced"
    });
  });

  it("returns percentage delta for numeric values with non-zero base", () => {
    const delta = calculateDelta({ baseValue: "3850", targetValue: "4200", unit: "mA" });

    expect(delta.kind).toBe("percent");
    if (delta.kind === "percent") {
      expect(delta.percent).toBeCloseTo(9.09, 1);
      expect(delta.direction).toBe("up");
    }
  });

  it("returns negative percentage for decrease", () => {
    const delta = calculateDelta({ baseValue: "100", targetValue: "85", unit: "%" });

    expect(delta.kind).toBe("percent");
    if (delta.kind === "percent") {
      expect(delta.percent).toBeCloseTo(-15, 1);
      expect(delta.direction).toBe("down");
    }
  });

  it("falls back to absolute delta when base is zero", () => {
    const delta = calculateDelta({ baseValue: "0", targetValue: "30", unit: "mV" });

    expect(delta.kind).toBe("absolute");
    if (delta.kind === "absolute") {
      expect(delta.amount).toBe(30);
      expect(delta.unit).toBe("mV");
      expect(delta.direction).toBe("up");
    }
  });

  it("returns new when base is missing", () => {
    expect(calculateDelta({ baseValue: null, targetValue: "ON", unit: "" }).kind).toBe("new");
  });

  it("returns missing when target is missing", () => {
    expect(calculateDelta({ baseValue: "ON", targetValue: null, unit: "" }).kind).toBe("missing");
  });

  it("returns changed for non-numeric differing enums", () => {
    expect(calculateDelta({ baseValue: "eco", targetValue: "turbo", unit: "" }).kind).toBe("changed");
  });
});
