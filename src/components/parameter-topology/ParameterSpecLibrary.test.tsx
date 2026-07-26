import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  organizationId: "org-chargelab",
  propertyKey: "gpio_int",
  moduleName: "充电策略",
  moduleMapped: true,
  driverModule: "sc8562",
  compatible: "vendor,sc8562",
  valueType: "phandle-list",
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  schemaSource: "vendor",
  schemaVersion: "3",
  exampleValue: "<&gpio13 29 0>",
  businessCategory: "Charge Pump IC",
  reviewState: "active",
  usageCount: 2
};

const gpioIntMt5788: ParameterSpecLibraryRow = {
  id: "spec-mt5788-gpio-int",
  organizationId: "org-chargelab",
  propertyKey: "gpio_int",
  moduleName: "未分类 · mt5788",
  moduleMapped: false,
  driverModule: "mt5788",
  compatible: "mediatek,mt5788",
  valueType: "phandle-list",
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  schemaSource: "linux",
  schemaVersion: "1",
  exampleValue: "<&gpio6 15 0>",
  businessCategory: "Wireless Charging",
  reviewState: "needs_review",
  usageCount: 1
};

const pathLikeLegacy: ParameterSpecLibraryRow = {
  id: "spec-status",
  organizationId: "org-chargelab",
  propertyKey: "status",
  moduleName: "充电策略",
  moduleMapped: true,
  driverModule: "sc8562",
  compatible: "vendor,sc8562",
  valueType: "string-list",
  valueShape: { kind: "string-list" },
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

    for (const header of ["参数名", "所属模块", "值类型", "审核状态", "操作"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(within(table).queryByRole("columnheader", { name: /^驱动模块$/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /compatible/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选compatible" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选所属模块" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选驱动模块" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选审核状态" })).toBeInTheDocument();

    expect(within(table).queryByRole("columnheader", { name: /推荐值|默认值|使用量|示例值/ })).not.toBeInTheDocument();
    expect(within(table).queryByText(/amba\.i2c@|\/amba\//)).not.toBeInTheDocument();

    const nameCells = within(table).getAllByRole("cell", { name: /gpio_int/ });
    expect(nameCells.length).toBe(2);
    for (const cell of nameCells) {
      expect(cell.textContent).not.toMatch(/amba|i2c@|FDF5E000/);
    }

    expect(within(table).getByText("sc8562")).toBeInTheDocument();
    expect(within(table).getByText("mt5788")).toBeInTheDocument();
    expect(within(table).queryByText("充电策略")).not.toBeInTheDocument();
    expect(within(table).queryByText("未映射")).not.toBeInTheDocument();
    expect(within(table).queryByText("vendor,sc8562")).not.toBeInTheDocument();
    expect(within(table).getAllByText("phandle-list").length).toBeGreaterThan(0);

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
    expect(within(library).getByText(/2 \/ 3 项/)).toBeInTheDocument();
  });

  it("filters by driver and lifecycle via ColumnFilter multi-select", async () => {
    const user = userEvent.setup();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, pathLikeLegacy]}
        onSelectSpec={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "筛选所属模块" }));
    await user.click(screen.getByRole("checkbox", { name: "sc8562" }));
    await user.click(screen.getByRole("button", { name: "筛选审核状态" }));
    await user.click(screen.getByRole("checkbox", { name: "active" }));

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

  it("paginates dense pages of 50 specs", () => {
    const specs = Array.from({ length: 55 }, (_, index) => ({
      ...gpioIntSc8562,
      id: `spec-${index}`,
      propertyKey: `prop_${String(index).padStart(3, "0")}`
    }));

    render(<ParameterSpecLibrary specs={specs} onSelectSpec={vi.fn()} />);

    const library = screen.getByRole("region", { name: "参数规格库" });
    expect(within(library).getByText(/55 \/ 55 项 · 第 1 \/ 2 页/)).toBeInTheDocument();
    const pageOneRows = within(library)
      .getAllByRole("row")
      .filter((row) => row.querySelector("td"));
    expect(pageOneRows).toHaveLength(50);
    expect(within(library).getByText("prop_000")).toBeInTheDocument();
    expect(within(library).queryByText("prop_050")).not.toBeInTheDocument();

    fireEvent.click(within(library).getByRole("button", { name: "下一页" }));
    expect(within(library).getByText(/55 \/ 55 项 · 第 2 \/ 2 页/)).toBeInTheDocument();
    const pageTwoRows = within(library)
      .getAllByRole("row")
      .filter((row) => row.querySelector("td"));
    expect(pageTwoRows).toHaveLength(5);
    expect(within(library).getByText("prop_050")).toBeInTheDocument();
  });

  it("opens detail with separated schema default, example, policy, usage, and history", () => {
    const onSelectSpec = vi.fn();
    const onCloseSpec = vi.fn();
    const onSaveSpec = vi.fn();
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
        onCloseSpec={onCloseSpec}
        onSaveSpec={onSaveSpec}
      />
    );

    const detail = screen.getByRole("dialog", { name: /规格详情 gpio_int/ });
    expect(within(detail).getByLabelText("compatible")).toHaveValue("vendor,sc8562");
    expect(within(detail).getByLabelText("Schema 默认值")).toHaveValue("<0>");
    expect(within(detail).getByLabelText("示例值")).toHaveValue("<&gpio13 29 0>");
    expect(within(detail).getByText(/仅作示例，不参与校验或初始化/)).toBeInTheDocument();
    expect(within(detail).getByLabelText("策略目标")).toHaveValue("<&gpio_policy 1 0>");
    expect(within(detail).getByLabelText("使用情况")).toHaveValue("P-AURORA · sc8562@6E");
    expect((within(detail).getByLabelText("Schema 历史") as HTMLTextAreaElement).value).toMatch(/narrowed phandle/);
    expect(detail.textContent).not.toMatch(/推荐值/);
    expect(within(detail).getByText("参数规格库 · 可编辑")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "保存" })).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "取消" }));
    expect(onCloseSpec).toHaveBeenCalled();
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
    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
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

  it("requires mismatch confirmation before approving cross-property schema", () => {
    const onApprove = vi.fn();
    const mismatchTask: SpecReviewTaskView = {
      id: "task-mismatch",
      propertyKey: "gpio_int",
      driverModule: "vendor,sc8562",
      evidence: ["library pick"],
      candidates: [],
      ambiguous: false,
      projectCount: 1
    };
    const librarySpecs = [
      {
        id: "schema-other",
        label: "vendor,sc8562 / other_key",
        propertyKey: "other_key",
        driverModule: "vendor,sc8562"
      }
    ];

    render(
      <SpecReviewQueue
        tasks={[mismatchTask]}
        librarySpecs={librarySpecs}
        onApprove={onApprove}
        onDismiss={vi.fn()}
      />
    );

    const queue = screen.getByRole("region", { name: "规格审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "展开 gpio_int" }));
    fireEvent.change(within(queue).getByRole("combobox", { name: "选择 Schema" }), {
      target: { value: "schema-other" }
    });
    fireEvent.change(within(queue).getByLabelText("审核原因"), {
      target: { value: "Cross-key bind with governance" }
    });

    const approve = within(queue).getByRole("button", { name: "批准" });
    expect(approve).toBeDisabled();
    expect(within(queue).getByText(/高风险/)).toBeInTheDocument();

    fireEvent.click(within(queue).getByLabelText(/高风险/));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);

    expect(onApprove).toHaveBeenCalledWith({
      taskId: "task-mismatch",
      parameterSpecId: "schema-other",
      reason: "Cross-key bind with governance",
      confirmPropertyMismatch: true
    });
  });

  it("shows create-spec action for unmatched tasks and respects pending state", () => {
    const onCreateSpec = vi.fn();
    const unmatchedTask: SpecReviewTaskView = {
      id: "task-unmatched",
      propertyKey: "mystery_prop",
      driverModule: null,
      evidence: ["no schema match"],
      candidates: [],
      ambiguous: false,
      projectCount: 1
    };

    render(
      <SpecReviewQueue
        tasks={[unmatchedTask]}
        librarySpecs={[]}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onCreateSpec={onCreateSpec}
        pendingTaskId="task-unmatched"
        pendingAction="create"
      />
    );

    const queue = screen.getByRole("region", { name: "规格审核队列" });
    expect(within(queue).getByText("未匹配")).toBeInTheDocument();
    fireEvent.click(within(queue).getByRole("button", { name: "展开 mystery_prop" }));
    const createButton = within(queue).getByRole("button", { name: "创建中…" });
    expect(createButton).toBeDisabled();
  });
});
