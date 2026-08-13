import { describe, expect, it } from "vitest";
import { formatPercent, normalizePercentValue } from "./formatPercent";

describe("formatPercent", () => {
  it("multiplies 0–1 fractions by 100", () => {
    expect(formatPercent(0.91)).toBe("91%");
    expect(formatPercent(0.5)).toBe("50%");
  });

  it("passes 0–100 numbers through", () => {
    expect(formatPercent(91)).toBe("91%");
    expect(formatPercent(24)).toBe("24%");
  });

  it("special-cases 0 and 100", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
  });

  // Deliberate decision: the literal value 1 is treated as the fraction 1.0
  // (=> 100%), NOT as integer one percent. Confidence sources emit either
  // 0–1 fractions or 0–100 integers, and a genuine 1% confidence does not
  // occur in this domain.
  it("treats 1 as a fraction meaning 100%", () => {
    expect(formatPercent(1)).toBe("100%");
  });

  it("keeps at most one decimal place and drops trailing zeros", () => {
    expect(formatPercent(0.915)).toBe("91.5%");
    expect(formatPercent(91.44)).toBe("91.4%");
    expect(formatPercent(91.0)).toBe("91%");
  });

  it("clamps out-of-range and invalid input", () => {
    expect(formatPercent(120)).toBe("100%");
    expect(formatPercent(-5)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
  });
});

describe("normalizePercentValue", () => {
  it("normalizes both source shapes onto the 0–100 domain", () => {
    expect(normalizePercentValue(0.91)).toBeCloseTo(91);
    expect(normalizePercentValue(91)).toBe(91);
    expect(normalizePercentValue(0)).toBe(0);
    expect(normalizePercentValue(Number.NaN)).toBe(0);
  });
});
