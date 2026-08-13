import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterSpecLibrary } from "./ParameterSpecLibrary";
import type { ParameterSpecLibraryRow } from "./ParameterSpecLibrary";
import {
  filterParameterSpecLibrary,
  formatSpecPrimaryLabel,
  isSpecSelectableForReview,
} from "./ParameterSpecLibrary";
import { SpecReviewQueue } from "./SpecReviewQueue";
import type { SpecReviewTaskView } from "./SpecReviewQueue";

afterEach(() => {
  cleanup();
});

const gpioIntSc8562: ParameterSpecLibraryRow = {
  id: "spec-sc8562-gpio-int",
  organizationId: "org-chargelab",
  propertyKey: "gpio_int",
  attributionSubjectId: "asub:driver-registration:sc8562",
  attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }],
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
  attributionSubjectId: "asub:driver-registration:mt5788",
  attributionModules: [],
  driverModule: "mt5788",
  compatible: "mediatek,mt5788",
  valueType: "phandle-list",
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  schemaSource: "linux",
  schemaVersion: "1",
  exampleValue: "<&gpio6 15 0>",
  businessCategory: "Wireless Charging",
  reviewState: "draft",
  usageCount: 1
};

const gpioIntDeprecated: ParameterSpecLibraryRow = {
  ...gpioIntSc8562,
  id: "spec-deprecated-gpio-int",
  propertyKey: "gpio_int_legacy",
  reviewState: "deprecated",
};

const pathLikeLegacy: ParameterSpecLibraryRow = {
  id: "spec-status",
  organizationId: "org-chargelab",
  propertyKey: "status",
  attributionSubjectId: "asub:driver-registration:sc8562",
  attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }],
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

const deprecatedLegacy: ParameterSpecLibraryRow = {
  ...pathLikeLegacy,
  id: "spec-deprecated-legacy",
  propertyKey: "legacy_status",
  reviewState: "deprecated",
  usageCount: 3
};

describe("ParameterSpecLibrary", () => {
  it("places create-spec as a primary button in the library heading", () => {
    const onCreateSpec = vi.fn();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562]}
        onSelectSpec={vi.fn()}
        onCreateSpec={onCreateSpec}
      />
    );

    const library = screen.getByRole("region", { name: "参数定义库" });
    const create = within(library).getByRole("button", { name: "新建定义" });
    expect(create).toHaveClass("button", "primary");
    expect(create.closest(".param-admin-library-heading-actions")).toBeTruthy();
    expect(create.closest(".parameters-table-filters")).toBeNull();
    fireEvent.click(create);
    expect(onCreateSpec).toHaveBeenCalledTimes(1);
  });

  it("hides deprecated definitions from the default library view", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, deprecatedLegacy]}
        onSelectSpec={vi.fn()}
      />
    );
    const library = screen.getByRole("region", { name: "参数定义库" });
    expect(within(library).queryByText("legacy_status")).not.toBeInTheDocument();
    expect(within(library).getAllByText("gpio_int").length).toBeGreaterThan(0);
  });

  it("renders semantic columns without path identity or recommended/default labels", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788]}
        onSelectSpec={vi.fn()}
      />
    );

    const library = screen.getByRole("region", { name: "参数定义库" });
    const table = within(library).getByRole("table");

    for (const header of ["参数定义", "驱动模块", "值类型", "审核状态", "操作"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    expect(within(table).queryByRole("columnheader", { name: /^参数名$/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /^归属模块$/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /compatible/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选compatible" })).not.toBeInTheDocument();
    const driverHeader = within(table).getByRole("columnheader", { name: /驱动模块/ });
    expect(within(driverHeader).getByRole("button", { name: "筛选归属模块" })).toBeInTheDocument();
    expect(
      within(within(table).getByRole("columnheader", { name: /^参数定义$/ })).queryByRole("button", {
        name: "筛选归属模块"
      })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选驱动模块" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选审核状态" })).toBeInTheDocument();
    expect(within(library).getByRole("table", { name: "参数定义库列表" })).toBeInTheDocument();

    expect(within(table).queryByRole("columnheader", { name: /推荐值|默认值|使用量|示例值/ })).not.toBeInTheDocument();
    expect(within(table).queryByText(/amba\.i2c@|\/amba\//)).not.toBeInTheDocument();

    const nameCells = within(table).getAllByRole("cell", { name: /gpio_int/ });
    expect(nameCells.length).toBe(2);
    for (const cell of nameCells) {
      expect(cell.textContent).toMatch(/gpio_int/);
      expect(cell.textContent).not.toMatch(/amba|i2c@|FDF5E000/);
    }

    expect(within(table).getAllByText("gpio_int")).toHaveLength(2);
    expect(within(table).getByText("充电策略")).toBeInTheDocument();
    expect(within(table).getByText("mt5788（未实测）")).toBeInTheDocument();
    expect(within(table).queryByText("（预测）")).not.toBeInTheDocument();
    expect(within(table).queryByText("vendor,sc8562")).not.toBeInTheDocument();
    expect(within(table).getAllByText("phandle-list").length).toBeGreaterThan(0);

    // Hierarchy lives in 驱动模块, not concatenated into 参数定义.
    const definitionCells = within(table).getAllByRole("cell", { name: /^gpio_int$/ });
    expect(definitionCells.length).toBe(2);
    for (const cell of definitionCells) {
      expect(cell.textContent).toBe("gpio_int");
    }

    expect(library.textContent).not.toMatch(/推荐值|默认值/);
  });

  it("searches by property key and shows attribution modules separately", () => {
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, pathLikeLegacy]}
        onSelectSpec={vi.fn()}
      />
    );

    const search = screen.getByRole("searchbox", { name: "搜索参数定义" });
    fireEvent.change(search, { target: { value: "gpio_int" } });

    const library = screen.getByRole("region", { name: "参数定义库" });
    const rows = within(library).getAllByRole("row");
    expect(rows.some((row) => row.textContent?.includes("充电策略") && row.textContent?.includes("gpio_int"))).toBe(true);
    expect(rows.some((row) => row.textContent?.includes("mt5788（未实测）") && row.textContent?.includes("gpio_int"))).toBe(true);
    expect(rows.some((row) => row.textContent?.includes("mt5788") && row.textContent?.includes("gpio_int"))).toBe(true);
    expect(within(library).queryByText("status")).not.toBeInTheDocument();
    // Structural keys (status) are excluded from the library scope.
    expect(within(library).getByText(/2 \/ 2 项/)).toBeInTheDocument();
  });

  it("hides deprecated specs by default and allows explicit lifecycle filter", async () => {
    const user = userEvent.setup();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, gpioIntDeprecated]}
        onSelectSpec={vi.fn()}
      />
    );

    const library = screen.getByRole("region", { name: "参数定义库" });
    expect(within(library).getByText(/2 \/ 3 项/)).toBeInTheDocument();
    expect(within(library).queryByText(formatSpecPrimaryLabel(gpioIntDeprecated))).not.toBeInTheDocument();
    expect(within(library).queryByText("gpio_int_legacy")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "筛选审核状态" }));
    await user.click(screen.getByRole("checkbox", { name: "deprecated" }));
    expect(within(library).getByText(formatSpecPrimaryLabel(gpioIntDeprecated))).toBeInTheDocument();
  });

  it("exposes review selection helpers for active and org drafts only", () => {
    expect(isSpecSelectableForReview(gpioIntSc8562)).toBe(true);
    expect(isSpecSelectableForReview(gpioIntMt5788)).toBe(true);
    expect(isSpecSelectableForReview(gpioIntDeprecated)).toBe(false);
    expect(
      isSpecSelectableForReview({
        ...gpioIntMt5788,
        organizationId: null,
      })
    ).toBe(false);
    expect(
      filterParameterSpecLibrary([gpioIntSc8562, gpioIntDeprecated], {
        q: "",
        driverModules: [],
        compatibles: [],
        businessCategories: [],
        schemaSources: [],
        lifecycles: [],
        moduleNames: [],
      })
    ).toEqual([gpioIntSc8562]);
  });

  it("filters by attribution module and lifecycle via ColumnFilter multi-select", async () => {
    const user = userEvent.setup();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562, gpioIntMt5788, pathLikeLegacy]}
        onSelectSpec={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "筛选归属模块" }));
    await user.click(screen.getByRole("checkbox", { name: "充电策略" }));
    await user.click(screen.getByRole("button", { name: "筛选审核状态" }));
    await user.click(screen.getByRole("checkbox", { name: "active" }));

    const library = screen.getByRole("region", { name: "参数定义库" });
    const dataRows = within(library)
      .getAllByRole("row")
      .filter((row) => row.querySelector("td"));
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]?.textContent).toContain("gpio_int");
    expect(dataRows[0]?.textContent).toContain("充电策略");
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

    const library = screen.getByRole("region", { name: "参数定义库" });
    expect(within(library).getByText(/55 \/ 55 项 · 第 1 \/ 2 页/)).toBeInTheDocument();
    expect(within(library).getByLabelText("每页条数")).toHaveValue("50");
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
    expect(within(library).getAllByText("充电策略").length).toBeGreaterThan(0);
  });

  it("lets the operator switch page size among typical values", () => {
    const specs = Array.from({ length: 55 }, (_, index) => ({
      ...gpioIntSc8562,
      id: `spec-${index}`,
      propertyKey: `prop_${String(index).padStart(3, "0")}`
    }));

    render(<ParameterSpecLibrary specs={specs} onSelectSpec={vi.fn()} />);

    const library = screen.getByRole("region", { name: "参数定义库" });
    fireEvent.change(within(library).getByLabelText("每页条数"), { target: { value: "20" } });

    expect(within(library).getByText(/55 \/ 55 项 · 第 1 \/ 3 页/)).toBeInTheDocument();
    const rows = within(library)
      .getAllByRole("row")
      .filter((row) => row.querySelector("td"));
    expect(rows).toHaveLength(20);
    expect(within(library).getByText("prop_000")).toBeInTheDocument();
    expect(within(library).queryByText("prop_020")).not.toBeInTheDocument();

    fireEvent.change(within(library).getByLabelText("每页条数"), { target: { value: "100" } });
    expect(within(library).getByText(/55 \/ 55 项 · 第 1 \/ 1 页/)).toBeInTheDocument();
    expect(
      within(library)
        .getAllByRole("row")
        .filter((row) => row.querySelector("td"))
    ).toHaveLength(55);
  });

  it("opens detail with separated schema default, example, usage, and history", () => {
    const onSelectSpec = vi.fn();
    const onCloseSpec = vi.fn();
    const onSaveSpec = vi.fn();
    render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562]}
        selectedSpecId={gpioIntSc8562.id}
        detail={{
          ...gpioIntSc8562,
          attributionModules: [
            {
              id: "mod-direct-charge-comp",
              name: "direct_charge_comp",
              kind: "node-type",
              path: ["Power", "Direct Charging", "direct_charge_comp"]
            }
          ],
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

    const detail = screen.getByRole("dialog", { name: /gpio_int/ });
    expect(within(detail).getByLabelText("归属主体")).toHaveValue("sc8562");
    expect(within(detail).queryByLabelText("compatible")).not.toBeInTheDocument();
    expect(within(detail).getByLabelText("所属模块")).toHaveValue(
      "Power / Direct Charging / direct_charge_comp"
    );
    expect(within(detail).getByLabelText("Schema 默认值")).toHaveValue("<0>");
    expect(within(detail).getByLabelText("示例值")).toHaveValue("<&gpio13 29 0>");
    expect(within(detail).getByLabelText("示例值帮助")).toBeInTheDocument();
    expect(within(detail).getByLabelText("值形状 valueShape")).toBeInTheDocument();
    expect(within(detail).queryByLabelText("值类型")).not.toBeInTheDocument();
    expect(within(detail).queryByLabelText("策略目标")).not.toBeInTheDocument();
    expect(within(detail).getByLabelText("使用情况")).toHaveValue("P-AURORA · sc8562@6E");
    expect((within(detail).getByLabelText("Schema 历史") as HTMLTextAreaElement).value).toMatch(/narrowed phandle/);
    expect(detail.textContent).not.toMatch(/推荐值/);
    expect(within(detail).getByText("参数定义库 · 可编辑")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "完成" })).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "取消" }));
    expect(onCloseSpec).toHaveBeenCalled();
  });

  it("deprecates and restores definitions through reason-gated lifecycle dialogs", () => {
    const onDeprecateSpec = vi.fn();
    const onRestoreSpec = vi.fn();
    const { rerender } = render(
      <ParameterSpecLibrary
        specs={[gpioIntSc8562]}
        detail={{ ...gpioIntSc8562, usage: [], schemaHistory: [] }}
        selectedSpecId={gpioIntSc8562.id}
        onSelectSpec={vi.fn()}
        onDeprecateSpec={onDeprecateSpec}
        onRestoreSpec={onRestoreSpec}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "废弃" }));
    const deprecateDialog = screen.getByRole("dialog", { name: "废弃参数定义" });
    fireEvent.change(within(deprecateDialog).getByLabelText("废弃原因"), {
      target: { value: "由新版定义替代" }
    });
    fireEvent.click(within(deprecateDialog).getByRole("button", { name: "确认废弃" }));
    expect(onDeprecateSpec).toHaveBeenCalledWith({
      specId: gpioIntSc8562.id,
      reason: "由新版定义替代"
    });

    rerender(
      <ParameterSpecLibrary
        specs={[{ ...gpioIntSc8562, reviewState: "deprecated" }]}
        detail={{
          ...gpioIntSc8562,
          reviewState: "deprecated",
          usage: [],
          schemaHistory: []
        }}
        selectedSpecId={gpioIntSc8562.id}
        onSelectSpec={vi.fn()}
        onDeprecateSpec={onDeprecateSpec}
        onRestoreSpec={onRestoreSpec}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    const restoreDialog = screen.getByRole("dialog", { name: "恢复参数定义" });
    fireEvent.change(within(restoreDialog).getByLabelText("恢复原因"), {
      target: { value: "重新投入使用" }
    });
    fireEvent.click(within(restoreDialog).getByRole("button", { name: "确认恢复" }));
    expect(onRestoreSpec).toHaveBeenCalledWith({
      specId: gpioIntSc8562.id,
      reason: "重新投入使用"
    });
  });
});

describe("SpecReviewQueue", () => {
  const ambiguousTask: SpecReviewTaskView = {
    id: "task-1",
    propertyKey: "gpio_int",
    driverModule: "unknown-ic",
    evidence: ["compatible unmatched", "nodename=sc8562@6E"],
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

    const queue = screen.getByRole("region", { name: "定义匹配审核队列" });
    expect(within(queue).getByText("匹配冲突")).toBeInTheDocument();
    expect(within(queue).getByText("sc8562@6E")).toBeInTheDocument();
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));

    const dialog = screen.getByRole("dialog", { name: "gpio_int" });
    expect(within(dialog).getByLabelText("匹配依据")).toHaveValue(
      "compatible unmatched\nnodename=sc8562@6E"
    );
    expect(within(dialog).getAllByText("vendor,sc8562 / gpio_int").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("mediatek,mt5788 / gpio_int").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: /接受第一个|accept first/i })).not.toBeInTheDocument();

    const approve = within(dialog).getByRole("button", { name: "批准" });
    expect(approve).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("combobox", { name: "选择参数定义" }), {
      target: { value: "schema-b" }
    });
    expect(approve).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
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

    const queue = screen.getByRole("region", { name: "定义匹配审核队列" });
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 gpio_int" }));

    const dialog = screen.getByRole("dialog", { name: "gpio_int" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "选择参数定义" }), {
      target: { value: "schema-other" }
    });
    fireEvent.change(within(dialog).getByLabelText("审核原因"), {
      target: { value: "Cross-key bind with governance" }
    });

    const approve = within(dialog).getByRole("button", { name: "批准" });
    expect(approve).toBeDisabled();
    expect(within(dialog).getByText(/高风险/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByLabelText(/高风险/));
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

    const queue = screen.getByRole("region", { name: "定义匹配审核队列" });
    expect(within(queue).getByText("未找到定义")).toBeInTheDocument();
    fireEvent.click(within(queue).getByRole("button", { name: "编辑 mystery_prop" }));
    const dialog = screen.getByRole("dialog", { name: "mystery_prop" });
    const createButton = within(dialog).getByRole("button", { name: "创建中…" });
    expect(createButton).toBeDisabled();
  });

  it("uses 下一页 to fetch the next cursor page instead of a standalone 加载更多 button", async () => {
    const onLoadMore = vi.fn().mockResolvedValue(undefined);
    const task: SpecReviewTaskView = {
      id: "task-1",
      propertyKey: "gpio_int",
      driverModule: "unknown-ic",
      evidence: ["nodename=sc8562@6E"],
      candidates: [],
      ambiguous: false,
      projectCount: 1
    };

    const { rerender } = render(
      <SpecReviewQueue
        tasks={[task]}
        onApprove={vi.fn()}
        nextCursor="cursor-2"
        onLoadMore={onLoadMore}
      />
    );

    const queue = screen.getByRole("region", { name: "定义匹配审核队列" });
    expect(within(queue).queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    fireEvent.change(within(queue).getByLabelText("每页条数"), { target: { value: "20" } });

    const next = within(queue).getByRole("button", { name: "下一页" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <SpecReviewQueue
        tasks={[
          task,
          {
            ...task,
            id: "task-2",
            propertyKey: "status",
            evidence: ["nodename=battery"]
          }
        ]}
        onApprove={vi.fn()}
        nextCursor={null}
        onLoadMore={onLoadMore}
        loadingMore={false}
      />
    );

    expect(await within(queue).findByText("status")).toBeInTheDocument();
    expect(within(queue).getByRole("button", { name: "下一页" })).toBeDisabled();
  });
});
