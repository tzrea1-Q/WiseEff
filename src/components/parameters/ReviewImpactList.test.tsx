import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ImpactItem } from "@/domain/parameters/types";
import { ReviewImpactList } from "./ReviewImpactList";

afterEach(() => {
  cleanup();
});

const items: ImpactItem[] = [
  {
    kind: "phandle",
    name: "amba/consumer",
    note: "References changed node via chip-handle.",
    risk: "Medium"
  },
  {
    kind: "compatible",
    name: "amba/i2c@2/chip@70",
    note: "Shares compatible vendor,chip123.",
    risk: "Low"
  },
  {
    kind: "config-set",
    name: "board-overlay.dts",
    note: "Same configuration set variant as the source file.",
    risk: "Medium"
  },
  {
    kind: "parameter",
    name: "status",
    note: "Direct parameter change.",
    risk: "High"
  }
];

describe("ReviewImpactList", () => {
  it("renders impact categories for structural and legacy kinds", () => {
    render(<ReviewImpactList items={items} />);

    expect(screen.getByText("影响面")).toBeTruthy();
    expect(screen.getByText("phandle")).toBeTruthy();
    expect(screen.getByText("compatible")).toBeTruthy();
    expect(screen.getByText("config-set")).toBeTruthy();
    expect(screen.getByText("parameter")).toBeTruthy();
    expect(screen.getByText("amba/consumer")).toBeTruthy();
    expect(screen.getByText("board-overlay.dts")).toBeTruthy();
  });

  it("renders nothing when impact is empty", () => {
    const { container } = render(<ReviewImpactList items={[]} />);
    expect(container.textContent?.trim()).toBe("");
  });
});
