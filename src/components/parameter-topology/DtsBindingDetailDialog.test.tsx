import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    valueShapeSummary: "phandle-list · 32 bit · 3 cells",
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

function field(container: HTMLElement, label: string): HTMLElement {
  return within(container).getByText(label).closest("div") as HTMLElement;
}

function PendingCloseHarness({
  onCreateDraft
}: {
  onCreateDraft: React.ComponentProps<typeof DtsBindingDetailDialog>["onCreateDraft"];
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>重新打开详情</button>
      {open ? (
        <DtsBindingDetailDialog
          row={gpioRow()}
          canEdit
          onClose={() => setOpen(false)}
          onCreateDraft={onCreateDraft}
        />
      ) : null}
    </>
  );
}

describe("DtsBindingDetailDialog", () => {
  it("shows stable identity, DTS location, provenance, value contract and honest spec availability", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "gpio_int 参数详情" });
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "dts-binding-detail-dialog__overlay"
    );
    for (const heading of ["身份", "DTS 位置", "来源链", "值与约束", "类型化编辑"]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(within(dialog).getByText("binding-gpio-int")).toBeInTheDocument();
    expect(within(dialog).getByText("spec-gpio-int")).toBeInTheDocument();
    expect(within(dialog).getByText("spec-version-gpio-int-v3")).toBeInTheDocument();
    expect(within(dialog).getByText("logical-sc8562-6e")).toBeInTheDocument();
    expect(within(dialog).getAllByText("sc8562@6E · sc8562").length).toBeGreaterThan(0);
    const location = within(dialog).getByRole("region", { name: "DTS 位置" });
    expect(field(location, "Unit address")).toHaveTextContent("6E");
    expect(field(location, "Topology node ID")).toHaveTextContent("effective-sc8562-6e");
    expect(within(dialog).getAllByText("/amba/i2c@FDF5E000/sc8562@6E").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("board-power.dtsi · L27")).toBeInTheDocument();
    expect(within(dialog).getAllByText("<&gpio13 29 0>").length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByText("phandle-list · 32 bit · 3 cells")).toBeInTheDocument();
    expect(within(dialog).getByText("schema: valid · policy: pass · governance: attention · mapping: open")).toBeInTheDocument();
    expect(within(dialog).getByText("set · order 1 · occurrence-base")).toBeInTheDocument();
    expect(within(dialog).getByText("override · order 4 · occurrence-overlay")).toBeInTheDocument();
    expect(within(dialog).getByText("当前接口未提供规格详情")).toBeInTheDocument();
  });

  it("shows a clean empty history message without any phase-1 placeholder wording", () => {
    renderDialog({ historyEntries: [] });

    const history = screen.getByRole("region", { name: "历史与 diff" });
    expect(within(history).getByText("暂无历史记录。")).toBeInTheDocument();
    expect(within(history).queryByText(/阶段一占位/)).not.toBeInTheDocument();
    expect(within(history).queryByText(/阶段二接入/)).not.toBeInTheDocument();
  });

  it("renders binding-revision history entries newest-first with from→to raw values", () => {
    renderDialog({
      historyEntries: [
        { id: "rev-3", changedAt: "2026-01-03T00:00:00.000Z", fromRawValue: "<1>", toRawValue: "<2>" },
        { id: "rev-1", changedAt: "2026-01-01T00:00:00.000Z", fromRawValue: null, toRawValue: "<0>" }
      ]
    });

    const history = screen.getByRole("list", { name: "参数历史" });
    const entries = within(history).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("<1> → <2>");
    expect(entries[1]).toHaveTextContent("∅ → <0>");
    expect(screen.queryByText("暂无历史记录。")).not.toBeInTheDocument();
  });

  it("marks missing unit address and topology node identity as unavailable without substituting the path", () => {
    renderDialog({ row: gpioRow({ unitAddress: null, topologyNodeId: null }) });

    const location = screen.getByRole("region", { name: "DTS 位置" });
    expect(field(location, "Unit address")).toHaveTextContent("不可用");
    expect(field(location, "Topology node ID")).toHaveTextContent("不可用");
    expect(field(location, "完整路径")).toHaveTextContent("/amba/i2c@FDF5E000/sc8562@6E");
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

  it("resets every edit state on binding identity change and ignores a delayed response from the previous binding", async () => {
    let resolveFirst!: (result: { valid: boolean; diagnostics: [] }) => void;
    const firstRequest = new Promise<{ valid: boolean; diagnostics: [] }>((resolve) => {
      resolveFirst = resolve;
    });
    const onCreateDraft = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ valid: true, diagnostics: [] });
    const { props, rerender } = renderDialog({ onCreateDraft });

    fireEvent.change(screen.getByRole("textbox", { name: "目标值 raw" }), {
      target: { value: "<&gpio13 30 0>" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move A interrupt" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();

    const rowB = gpioRow({
      bindingId: "binding-gpio-int-b",
      topologyNodeId: "effective-sc8562-6f",
      logicalNodeId: "logical-sc8562-6f",
      instanceName: "sc8562@6F",
      unitAddress: "6F",
      rawValue: "<&gpio14 31 0>"
    });
    rerender(<DtsBindingDetailDialog {...props} row={rowB} />);

    expect(screen.getByRole("textbox", { name: "目标值 raw" })).toHaveValue("<&gpio14 31 0>");
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      resolveFirst({ valid: true, diagnostics: [] });
      await firstRequest;
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "目标值 raw" }), {
      target: { value: "<&gpio14 32 0>" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move B interrupt" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));

    await waitFor(() => expect(onCreateDraft).toHaveBeenCalledTimes(2));
    expect(onCreateDraft).toHaveBeenLastCalledWith({
      bindingId: "binding-gpio-int-b",
      rawValue: "<&gpio14 32 0>",
      reason: "Move B interrupt"
    });
  });

  it("does not resubmit a successful raw value and reason until the user changes the input", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    renderDialog({ onCreateDraft });
    const rawValue = screen.getByRole("textbox", { name: "目标值 raw" });
    const reason = screen.getByRole("textbox", { name: "修改原因" });

    fireEvent.change(reason, { target: { value: "Move interrupt line" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("草稿已创建");

    const submit = screen.getByRole("button", { name: "校验并创建草稿" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onCreateDraft).toHaveBeenCalledTimes(1);

    fireEvent.change(reason, { target: { value: "Move interrupt line safely" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onCreateDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("草稿已创建");

    fireEvent.change(rawValue, { target: { value: "<&gpio13 30 0>" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it("keeps the successful feedback when reason whitespace changes but its normalized signature does not", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    renderDialog({ onCreateDraft });
    const reason = screen.getByRole("textbox", { name: "修改原因" });

    fireEvent.change(reason, { target: { value: "Move interrupt line" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("草稿已创建");

    fireEvent.change(reason, { target: { value: "  Move interrupt line  " } });

    expect(screen.getByRole("status")).toHaveTextContent("草稿已创建");
    expect(screen.getByRole("button", { name: "校验并创建草稿" })).toBeDisabled();
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
  });

  it("restores successful feedback when edited input returns to the already-created signature", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    renderDialog({ onCreateDraft });
    const rawValue = screen.getByRole("textbox", { name: "目标值 raw" });
    const reason = screen.getByRole("textbox", { name: "修改原因" });

    fireEvent.change(reason, { target: { value: "Move interrupt line" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
    expect(await screen.findByRole("status")).toHaveTextContent("草稿已创建");

    fireEvent.change(rawValue, { target: { value: "<&gpio13 30 0>" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "校验并创建草稿" })).toBeEnabled();

    fireEvent.change(rawValue, { target: { value: "<&gpio13 29 0>" } });
    expect(screen.getByRole("status")).toHaveTextContent("草稿已创建");
    expect(screen.getByRole("button", { name: "校验并创建草稿" })).toBeDisabled();
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending request that %ss after Escape closes and a clean dialog reopens",
    async (outcome) => {
      let resolveRequest!: (result: { valid: boolean; diagnostics: [] }) => void;
      let rejectRequest!: (error: Error) => void;
      const request = new Promise<{ valid: boolean; diagnostics: [] }>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      render(<PendingCloseHarness onCreateDraft={vi.fn().mockReturnValue(request)} />);

      fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
        target: { value: "Move interrupt line" }
      });
      fireEvent.click(screen.getByRole("button", { name: "校验并创建草稿" }));
      expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();

      fireEvent.keyDown(screen.getByRole("dialog", { name: "gpio_int 参数详情" }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "gpio_int 参数详情" })).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "重新打开详情" }));
      expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("");

      await act(async () => {
        if (outcome === "resolve") resolveRequest({ valid: true, diagnostics: [] });
        else rejectRequest(new Error("old candidate failed"));
        await request.catch(() => undefined);
      });

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("");
      expect(screen.getByRole("button", { name: "校验并创建草稿" })).toBeDisabled();
    }
  );
});
