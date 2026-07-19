import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import { DtsBindingDetailDialog } from "./DtsBindingDetailDialog";

function gpioRow(overrides: Partial<DtsParameterWorkbenchRow> = {}): DtsParameterWorkbenchRow {
  return {
    bindingId: "binding-gpio-int",
    parameterSpecId: "spec-gpio-int",
    parameterSpecVersionId: "spec-version-gpio-int-v3",
    logicalNodeId: "logical-sc8562-6e",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatible: "vendor,sc8562",
    instanceName: "sc8562@6E",
    unitAddress: "6E",
    topologyPath: "/amba/i2c@FDF5E000/sc8562@6E",
    topologyNodeId: "effective-sc8562-6e",
    sourceOccurrenceId: "occurrence-gpio-int",
    sourceFileName: "board-power.dtsi",
    sourceNodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    sourceLine: 27,
    rawValue: "<&gpio13 29 0>",
    effectiveValue: {
      kind: "cells",
      bits: 32,
      groups: [[
        { kind: "phandle", label: "gpio13" },
        { kind: "integer", raw: "29", value: "29" },
        { kind: "integer", raw: "0", value: "0" }
      ]]
    },
    valueShapeSummary: "phandle-list · bits=32 · groups=1 · cellsPerGroup=3",
    schemaState: "valid",
    policyState: "pass",
    mappingOpen: true,
    governanceState: "attention",
    effects: [
      {
        id: "effect-base",
        propertyName: "gpio_int",
        effectKind: "set",
        nodeOccurrenceId: "occurrence-base",
        propertyOccurrenceId: "property-base",
        sourceOrder: 1
      },
      {
        id: "effect-overlay",
        propertyName: "gpio_int",
        effectKind: "override",
        nodeOccurrenceId: "occurrence-overlay",
        propertyOccurrenceId: "property-overlay",
        sourceOrder: 4
      }
    ],
    searchText: "gpio_int sc8562 sc8562@6e gpio13",
    view: "effective",
    ...overrides
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DtsBindingDetailDialog>> = {}) {
  const props: React.ComponentProps<typeof DtsBindingDetailDialog> = {
    row: gpioRow(),
    canEdit: true,
    onClose: vi.fn(),
    onCreateDraft: vi.fn().mockResolvedValue({ valid: true, diagnostics: [] }),
    ...overrides
  };
  return { ...render(<DtsBindingDetailDialog {...props} />), props };
}

describe("DtsBindingDetailDialog", () => {
  it("shows stable identity, DTS location, provenance, value contract and honest spec availability", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    for (const heading of ["身份", "DTS 位置", "来源链", "值与约束", "类型化编辑"]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(within(dialog).getByText("binding-gpio-int")).toBeInTheDocument();
    expect(within(dialog).getByText("spec-gpio-int")).toBeInTheDocument();
    expect(within(dialog).getByText("spec-version-gpio-int-v3")).toBeInTheDocument();
    expect(within(dialog).getByText("logical-sc8562-6e")).toBeInTheDocument();
    expect(within(dialog).getAllByText("sc8562@6E · sc8562").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("/amba/i2c@FDF5E000/sc8562@6E").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("board-power.dtsi · L27")).toBeInTheDocument();
    expect(within(dialog).getAllByText("<&gpio13 29 0>").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText("phandle-list · bits=32 · groups=1 · cellsPerGroup=3")).toBeInTheDocument();
    expect(within(dialog).getByText("schema: valid · policy: pass · governance: attention · mapping: open")).toBeInTheDocument();
    expect(within(dialog).getByText("set · order 1 · occurrence-base")).toBeInTheDocument();
    expect(within(dialog).getByText("override · order 4 · occurrence-overlay")).toBeInTheDocument();
    expect(within(dialog).getByText("当前接口未提供规格详情")).toBeInTheDocument();
  });

  it("hides every draft submission entry for read-only users", () => {
    renderDialog({ canEdit: false });

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(within(dialog).queryByRole("textbox", { name: "目标值 raw" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "修改原因" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "校验并创建草稿" })).not.toBeInTheDocument();
  });

  it("submits exact semantic identity once and reports authoritative validation success", async () => {
    const user = userEvent.setup();
    let resolveValidation!: (result: { valid: boolean; diagnostics: [] }) => void;
    const onCreateDraft = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveValidation = resolve;
    }));
    renderDialog({ onCreateDraft });

    const rawValue = screen.getByRole("textbox", { name: "目标值 raw" });
    const reason = screen.getByRole("textbox", { name: "修改原因" });
    const submit = screen.getByRole("button", { name: "校验并创建草稿" });
    expect(rawValue).toHaveValue("<&gpio13 29 0>");
    expect(submit).toBeDisabled();

    await user.clear(rawValue);
    await user.type(rawValue, "<&gpio13 30 0>");
    await user.type(reason, "  Move interrupt line  ");
    await user.click(submit);
    await user.click(screen.getByRole("button", { name: "创建中…" }));

    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreateDraft).toHaveBeenCalledWith({
      bindingId: "binding-gpio-int",
      rawValue: "<&gpio13 30 0>",
      reason: "Move interrupt line"
    });
    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();

    resolveValidation({ valid: true, diagnostics: [] });
    expect(await screen.findByRole("status")).toHaveTextContent("服务端校验通过，草稿已创建");
  });

  it("keeps server diagnostics authoritative and preserves the user's input after rejection", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue({
      valid: false,
      diagnostics: [{ code: "DTS_CELL_COUNT", message: "gpio_int 需要 3 个 cell" }]
    });
    renderDialog({ onCreateDraft });

    fireEvent.change(screen.getByRole("textbox", { name: "目标值 raw" }), {
      target: { value: "<&gpio13 30>" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move interrupt line" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("服务端校验未通过");
    expect(screen.getByRole("list", { name: "编辑诊断" })).toHaveTextContent("DTS_CELL_COUNT");
    expect(screen.getByRole("list", { name: "编辑诊断" })).toHaveTextContent("gpio_int 需要 3 个 cell");
    expect(screen.getByRole("textbox", { name: "目标值 raw" })).toHaveValue("<&gpio13 30>");
  });

  it("shows a readable server failure and lets the user retry", async () => {
    const onCreateDraft = vi.fn()
      .mockRejectedValueOnce(new Error("candidate revision is stale"))
      .mockResolvedValueOnce({ valid: true, diagnostics: [] });
    renderDialog({ onCreateDraft });

    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move interrupt line" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("candidate revision is stale");
    await waitFor(() => expect(screen.getByRole("button", { name: "校验并创建草稿" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("服务端校验通过，草稿已创建");
    expect(onCreateDraft).toHaveBeenCalledTimes(2);
  });
});
