import { render, screen } from "@testing-library/react";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { xiaozeStreamdownComponents } from "./xiaozeStreamdownComponents";

const twoColumnMarkdown = `
| 参数 ID | 名称 |
| --- | --- |
| charge-voltage-limit | charge_voltage_limit_mv (恒压补电电压上限) |
`;

const wideTableMarkdown = `
| 参数 ID | 名称 | 当前值 | 推荐值 | 范围 | 风险 |
| --- | --- | --- | --- | --- | --- |
| charge-voltage-limit | charge_voltage_limit_mv | 4350 mV | 4320 mV | 4200-4400 mV | 高 |
`;

describe("xiaozeStreamdownComponents", () => {
  it("renders table headers without nowrap so cells can wrap in the popup", () => {
    const Th = xiaozeStreamdownComponents.th!;
    render(<Th>charge_voltage_limit_mv</Th>);

    const cell = screen.getByRole("columnheader");
    expect(cell).toHaveClass("xiaoze-md-table__header");
    expect(cell.className).not.toContain("whitespace-nowrap");
  });

  it("renders two-column tables without the streamdown horizontal scroll wrapper", () => {
    render(
      <div style={{ width: 320 }}>
        <Streamdown mode="static" components={xiaozeStreamdownComponents} controls={{ table: false }}>
          {twoColumnMarkdown}
        </Streamdown>
      </div>
    );

    expect(document.querySelector('[data-streamdown="table"]')).toBeInTheDocument();
    expect(document.querySelector(".overflow-x-auto")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-streamdown="table-header-cell"]')).toHaveLength(2);
  });

  it("renders wide tables with six header cells", () => {
    render(
      <div style={{ width: 320 }}>
        <Streamdown mode="static" components={xiaozeStreamdownComponents} controls={{ table: false }}>
          {wideTableMarkdown}
        </Streamdown>
      </div>
    );

    expect(document.querySelectorAll('[data-streamdown="table-header-cell"]')).toHaveLength(6);
  });
});
