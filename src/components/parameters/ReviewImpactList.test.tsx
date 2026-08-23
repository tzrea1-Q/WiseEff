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
    note: "通过 chip-handle → chip_label 的 phandle 引用指向 amba/i2c@1/chip@6E。",
    risk: "Medium"
  },
  {
    kind: "compatible",
    name: "amba/i2c@2/chip@70",
    note: "与 amba/i2c@1/chip@6E 共用 compatible「vendor,chip123」。",
    risk: "Low"
  },
  {
    kind: "config-set",
    name: "board-overlay.dts",
    note: "与 board.dts 属于同一配置集变体。",
    risk: "Medium"
  },
  {
    kind: "parameter",
    name: "status",
    note: "直接参数变更。",
    risk: "High"
  }
];

describe("ReviewImpactList", () => {
  it("localizes impact categories and risk while preserving technical identifiers", () => {
    const { container } = render(<ReviewImpactList items={items} />);

    expect(screen.getByText("影响面")).toBeTruthy();
    expect(screen.getByText("phandle 引用")).toBeTruthy();
    expect(screen.getByText("compatible 关联")).toBeTruthy();
    expect(screen.getByText("配置集")).toBeTruthy();
    expect(screen.getByText("参数")).toBeTruthy();
    expect(screen.getAllByText("中风险")).toHaveLength(2);
    expect(screen.getByText("低风险")).toBeTruthy();
    expect(screen.getByText("高风险")).toBeTruthy();
    expect(screen.getByText("amba/consumer")).toBeTruthy();
    expect(screen.getByText("board-overlay.dts")).toBeTruthy();
    expect(screen.queryByText("parameter")).toBeNull();
    expect(screen.queryByText("Low")).toBeNull();
    expect(container.textContent).not.toMatch(
      /Phandle reference via|Shares compatible|Same configuration set variant/
    );
  });

  it("renders nothing when impact is empty", () => {
    const { container } = render(<ReviewImpactList items={[]} />);
    expect(container.textContent?.trim()).toBe("");
  });
});
