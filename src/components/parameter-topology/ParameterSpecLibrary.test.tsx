import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterSpecLibrary } from "./ParameterSpecLibrary";
import type { ParameterSpecLibraryRow } from "./ParameterSpecLibrary";
import { SpecReviewQueue } from "./SpecReviewQueue";
import type { SpecReviewTaskView } from "./SpecReviewQueue";

afterEach(() => {
  cleanup();
});

const gpioIntSc8562: ParameterSpecLibraryRow = {
  id: "spec-sc8562-gpio-int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  compatible: "vendor,sc8562",
  valueType: "phandle-list",
  schemaSource: "vendor",
  schemaVersion: "3",
  exampleValue: "<&gpio13 29 0>",
  businessCategory: "Charge Pump IC",
  reviewState: "active",
  usageCount: 2
};

const gpioIntMt5788: ParameterSpecLibraryRow = {
  id: "spec-mt5788-gpio-int",
  propertyKey: "gpio_int",
  driverModule: "mt5788",
  compatible: "mediatek,mt5788",
  valueType: "phandle-list",
  schemaSource: "linux",
  schemaVersion: "1",
  exampleValue: "<&gpio6 15 0>",
  businessCategory: "Wireless Charging",
  reviewState: "needs_review",
  usageCount: 1
};

const pathLikeLegacy: ParameterSpecLibraryRow = {
  id: "spec-status",
  propertyKey: "status",
  driverModule: "sc8562",
  compatible: "vendor,sc8562",
  valueType: "string-list",
  schemaSource: "manual",
  schemaVersion: "1",
  exampleValue: '"okay"',
  businessCategory: "Charge Pump IC",
  reviewState: "draft",
  usageCount: 0
};

describe("ParameterSpecLibrary", () => {
  it("renders semantic columns without path identity or recommended/default labels", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788]}
        onSelectSpec={vi.fn()}
      />
    );

    const library = screen.getByRole("region", { name: "参数规格库" });
    const table = within(library).getByRole("table");

    for (const header of [
      "属性键",
      "驱动模块",
      "compatible",
      "值类型",
      "Schema 来源/版本",
      "示例值",
      "业务分类",
      "审核状态",
      "使用量"
    ]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }

    expect(within(table).queryByRole("columnheader", { name: /推荐值|默认值/ })).not.toBeInTheDocument();
    expect(within(table).queryByText(/amba\.i2c@|\/amba\//)).not.toBeInTheDocument();

    const nameCells = within(table).getAllByRole("cell", { name: /gpio_int/ });
    expect(nameCells.length).toBe(2);
    for (const cell of nameCells) {
      expect(cell.textContent).not.toMatch(/amba|i2c@|FDF5E000/);
    }

    expect(within(table).getByText("示例值")).toBeInTheDocument();
    expect(within(table).getByText("<&gpio13 29 0>")).toBeInTheDocument();
    expect(library.textContent).not.toMatch(/推荐值|默认值/);
  });

  it("searches by property key and shows driver instances separately", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, pathLikeLegacy]}
        onSelectSpec={vi.fn()}
      />
    );

    const search = screen.getByRole("searchbox", { name: "搜索规格" });
    fireEvent.change(search, { target: { value: "gpio_int" } });

    const library = screen.getByRole("region", { name: "参数规格库" });
    const rows = within(library).getAllByRole("row");
    expect(rows.some((row) => row.textContent?.includes("sc8562") && row.textContent?.includes("gpio_int"))).toBe(true);
    expect(rows.some((row) => row.textContent?.includes("mt5788") && row.textContent?.includes("gpio_int"))).toBe(true);
    expect(within(library).queryByText("status")).not.toBeInTheDocument();
    expect(within(library).getByText("2 / 3 项")).toBeInTheDocument();
  });

  it("filters by driver, compatible, business category, schema source, and lifecycle", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, pathLikeLegacy]}
        onSelectSpec={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "驱动模块" }), {
      target: { value: "sc8562" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "compatible" }), {
      target: { value: "vendor,sc8562" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "业务分类" }), {
      target: { value: "Charge Pump IC" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Schema 来源" }), {
      target: { value: "vendor" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "生命周期" }), {
      target: { value: "active" }
    });

    const library = screen.getByRole("region", { name: "参数规格库" });
    const dataRows = within(library)
      .getAllByRole("row")
      .filter((row) => row.querySelector("td"));
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]?.textContent).toContain("gpio_int");
    expect(dataRows[0]?.textContent).toContain("sc8562");
    expect(dataRows[0]?.textContent).not.toContain("mt5788");
    expect(dataRows[0]?.textContent).not.toContain("status");
  });

  it("opens detail with separated schema default, example, policy, usage, and history", () => {
    const onSelectSpec = vi.fn();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562]}
        selectedSpecId={gpioIntSc8562.id}
        detail={{
          ...gpioIntSc8562,
          schemaDefault: "<0>",
          policyTarget: "<&gpio_policy 1 0>",
          usage: [{ projectCode: "P-AURORA", instanceName: "sc8562@6E" }],
          schemaHistory: [{ version: 3, source: "vendor", note: "narrowed phandle" }]
        }}
        onSelectSpec={onSelectSpec}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /查看 gpio_int/ }));
    expect(onSelectSpec).toHaveBeenCalledWith("spec-sc8562-gpio-int");

    const detail = screen.getByRole("region", { name: "规格详情" });
    expect(within(detail).getByText("Schema 默认值")).toBeInTheDocument();
    expect(within(detail).getByText("<0>")).toBeInTheDocument();
    expect(within(detail).getByText("示例值")).toBeInTheDocument();
    expect(within(detail).getByText("<&gpio13 29 0>")).toBeInTheDocument();
    expect(within(detail).getByText("策略目标")).toBeInTheDocument();
    expect(within(detail).getByText("<&gpio_policy 1 0>")).toBeInTheDocument();
    expect(within(detail).getByText("使用情况")).toBeInTheDocument();
    expect(within(detail).getByText(/sc8562@6E/)).toBeInTheDocument();
    expect(within(detail).getByText("Schema 历史")).toBeInTheDocument();
    expect(within(detail).getByText(/narrowed phandle/)).toBeInTheDocument();
    expect(detail.textContent).not.toMatch(/推荐值/);
  });
});

describe("SpecReviewQueue", () => {
  const ambiguousTask: SpecReviewTaskView = {
    id: "task-1",
    propertyKey: "gpio_int",
    driverModule: "unknown-ic",
    evidence: ["compatible unmatched", "nodename sc8562@6E"],
    candidates: [
      { id: "schema-a", label: "vendor,sc8562 / gpio_int" },
      { id: "schema-b", label: "mediatek,mt5788 / gpio_int" }
    ],
    ambiguous: true,
    projectCount: 2
  };

  it("requires explicit schema choice and reason; no accept-first action", () => {
    const onApprove = vi.fn();
    render(<SpecReviewQueue tasks={[ambiguousTask]} onApprove={onApprove} onDismiss={vi.fn()} />);

    const queue = screen.getByRole("region", { name: "规格审核队列" });
    expect(within(queue).getByText("compatible unmatched")).toBeInTheDocument();
    expect(within(queue).getAllByText("vendor,sc8562 / gpio_int").length).toBeGreaterThan(0);
    expect(within(queue).getAllByText("mediatek,mt5788 / gpio_int").length).toBeGreaterThan(0);
    expect(within(queue).queryByRole("button", { name: /接受第一个|accept first/i })).not.toBeInTheDocument();

    const approve = within(queue).getByRole("button", { name: "批准" });
    expect(approve).toBeDisabled();

    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "schema-b" }
    });
    expect(approve).toBeDisabled();

    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Matched MT5788 by board overlay evidence" }
    });
    expect(approve).toBeEnabled();

    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledWith({
      taskId: "task-1",
      parameterSpecId: "schema-b",
      reason: "Matched MT5788 by board overlay evidence"
    });
  });
});
