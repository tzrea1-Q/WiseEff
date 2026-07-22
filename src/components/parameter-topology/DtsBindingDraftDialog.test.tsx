import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import {
  DtsBindingDraftDialog,
  type LocalBindingDraftBag
} from "./DtsBindingDraftDialog";

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
    moduleId: "module:charge",
    moduleName: "充电策略",
    modulePath: ["充电策略"],
    importance: "high",
    moduleSortOrder: 0,
    moduleMapped: true,
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
    effects: [],
    searchText: "gpio_int sc8562 sc8562@6e gpio13",
    view: "effective",
    ...overrides
  };
}

function StatefulDraftHarness({
  overrides = {},
  initialBag = {
    "binding-gpio-int": { rawValue: "<&gpio13 29 0>", reason: "" }
  }
}: {
  overrides?: Partial<React.ComponentProps<typeof DtsBindingDraftDialog>>;
  initialBag?: LocalBindingDraftBag;
}) {
  const [draftBag, setDraftBag] = useState(initialBag);
  const rowsByBindingId = new Map([[gpioRow().bindingId, gpioRow()]]);
  return (
    <DtsBindingDraftDialog
      rowsByBindingId={rowsByBindingId}
      draftBag={draftBag}
      focusedBindingId="binding-gpio-int"
      canEdit
      onClose={vi.fn()}
      onUpdateDraft={(bindingId, patch) => {
        setDraftBag((current) => ({
          ...current,
          [bindingId]: {
            rawValue: patch.rawValue ?? current[bindingId]?.rawValue ?? "",
            reason: patch.reason ?? current[bindingId]?.reason ?? ""
          }
        }));
      }}
      onRemoveDraft={(bindingId) => {
        setDraftBag((current) => {
          const next = { ...current };
          delete next[bindingId];
          return next;
        });
      }}
      onClearAll={() => setDraftBag({})}
      onCreateDraft={vi.fn().mockResolvedValue({ valid: true, diagnostics: [] })}
      {...overrides}
    />
  );
}

function renderDraftDialog(
  overrides: Partial<React.ComponentProps<typeof DtsBindingDraftDialog>> = {},
  initialBag?: LocalBindingDraftBag
) {
  return render(<StatefulDraftHarness overrides={overrides} initialBag={initialBag} />);
}

function PendingCloseHarness({
  onCreateDraft
}: {
  onCreateDraft: React.ComponentProps<typeof DtsBindingDraftDialog>["onCreateDraft"];
}) {
  const [open, setOpen] = useState(true);
  const [draftBag, setDraftBag] = useState<LocalBindingDraftBag>({
    "binding-gpio-int": { rawValue: "<&gpio13 29 0>", reason: "" }
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>重新打开草稿</button>
      {open ? (
        <DtsBindingDraftDialog
          rowsByBindingId={new Map([[gpioRow().bindingId, gpioRow()]])}
          draftBag={draftBag}
          focusedBindingId="binding-gpio-int"
          canEdit
          onClose={() => {
            setOpen(false);
            setDraftBag({ "binding-gpio-int": { rawValue: "<&gpio13 29 0>", reason: "" } });
          }}
          onUpdateDraft={(bindingId, patch) => {
            setDraftBag((current) => ({
              ...current,
              [bindingId]: {
                rawValue: patch.rawValue ?? current[bindingId]?.rawValue ?? "",
                reason: patch.reason ?? current[bindingId]?.reason ?? ""
              }
            }));
          }}
          onRemoveDraft={(bindingId) => {
            setDraftBag((current) => {
              const next = { ...current };
              delete next[bindingId];
              return next;
            });
          }}
          onClearAll={() => setDraftBag({})}
          onCreateDraft={onCreateDraft}
        />
      ) : null}
    </>
  );
}

describe("DtsBindingDraftDialog", () => {
  it("focuses the target editor and exposes draft summary actions", () => {
    renderDraftDialog();

    expect(screen.getByRole("dialog", { name: "修改草稿" })).toBeInTheDocument();
    expect(screen.getByText("本轮草稿 1 项")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "全部清空" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "校验并加入本轮" })).toBeDisabled();
    expect(screen.getByLabelText("gpio_int 当前到目标预览")).toBeInTheDocument();
    expect(screen.queryByLabelText("gpio_int 变更 diff")).not.toBeInTheDocument();
  });

  it("renders line-level diff and a code editor for complex multi-line values", () => {
    const complexCurrent = [
      '"charge-profile-a",',
      '"charge-profile-b",',
      '"charge-profile-c"'
    ].join("\n");
    const complexTarget = [
      '"charge-profile-a",',
      '"charge-profile-b-revised",',
      '"charge-profile-c"'
    ].join("\n");
    const row = gpioRow({
      bindingId: "binding-profiles",
      propertyKey: "charge_profiles",
      rawValue: complexCurrent,
      valueShapeSummary: "string-list"
    });
    render(
      <DtsBindingDraftDialog
        rowsByBindingId={new Map([[row.bindingId, row]])}
        draftBag={{ [row.bindingId]: { rawValue: complexTarget, reason: "" } }}
        focusedBindingId={row.bindingId}
        canEdit
        onClose={vi.fn()}
        onUpdateDraft={vi.fn()}
        onRemoveDraft={vi.fn()}
        onClearAll={vi.fn()}
        onCreateDraft={vi.fn().mockResolvedValue({ valid: true, diagnostics: [] })}
      />
    );

    const card = screen.getByLabelText("charge_profiles 草稿");
    expect(card).toHaveClass("dts-binding-draft-card--complex");
    expect(screen.getByLabelText("charge_profiles 草稿摘要")).toHaveTextContent("复杂配置");
    const diff = screen.getByLabelText("charge_profiles 变更 diff");
    expect(diff.querySelector(".submission-preview-diff")).toBeInTheDocument();
    expect(diff.querySelectorAll(".submission-preview-diff-row[data-kind='remove']").length).toBeGreaterThan(0);
    expect(diff.querySelectorAll(".submission-preview-diff-row[data-kind='add']").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveAttribute("wrap", "off");
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveClass("dts-binding-draft-card__code-editor");
  });

  it("submits exact semantic identity once and reports authoritative validation success", async () => {
    const user = userEvent.setup();
    let resolveValidation!: (result: { valid: boolean; diagnostics: [] }) => void;
    const onCreateDraft = vi.fn().mockReturnValue(new Promise((resolve) => {
      resolveValidation = resolve;
    }));
    const { props: _props } = renderDraftDialog({ onCreateDraft });
    const rawValue = screen.getByRole("textbox", { name: "目标值" });
    const reason = screen.getByRole("textbox", { name: "修改原因" });
    const submit = screen.getByRole("button", { name: "校验并加入本轮" });

    await user.clear(rawValue);
    await user.type(rawValue, "<&gpio13 30 0>");
    await user.type(reason, "  Move interrupt line  ");
    await user.click(submit);
    await waitFor(() => expect(screen.getByRole("button", { name: "校验中…" })).toBeDisabled());

    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreateDraft).toHaveBeenCalledWith({
      bindingId: "binding-gpio-int",
      rawValue: "<&gpio13 30 0>",
      reason: "Move interrupt line"
    });

    resolveValidation({ valid: true, diagnostics: [] });
    await waitFor(() => expect(screen.queryByLabelText("gpio_int 草稿")).not.toBeInTheDocument());
  });

  it("keeps server diagnostics authoritative and preserves the user's input after rejection", async () => {
    const onCreateDraft = vi.fn().mockResolvedValue({
      valid: false,
      diagnostics: [{ code: "DTS_CELL_COUNT", message: "gpio_int 需要 3 个 cell" }]
    });
    renderDraftDialog({ onCreateDraft });

    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), {
      target: { value: "<&gpio13 30>" }
    });
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move interrupt line" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并加入本轮" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("服务端校验未通过");
    expect(screen.getByRole("list", { name: "编辑诊断" })).toHaveTextContent("DTS_CELL_COUNT");
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue("<&gpio13 30>");
  });

  it("shows a readable server failure and lets the user retry", async () => {
    const onCreateDraft = vi.fn()
      .mockRejectedValueOnce(new Error("candidate revision is stale"))
      .mockResolvedValueOnce({ valid: true, diagnostics: [] });
    renderDraftDialog({ onCreateDraft });

    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), {
      target: { value: "Move interrupt line" }
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并加入本轮" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("candidate revision is stale");
    await waitFor(() => expect(screen.getByRole("button", { name: "校验并加入本轮" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "校验并加入本轮" }));
    await waitFor(() => expect(onCreateDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("gpio_int 草稿")).not.toBeInTheDocument());
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
      fireEvent.click(screen.getByRole("button", { name: "校验并加入本轮" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "校验中…" })).toBeDisabled());

      fireEvent.keyDown(screen.getByRole("dialog", { name: "修改草稿" }), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "重新打开草稿" }));
      expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("");

      await act(async () => {
        if (outcome === "resolve") resolveRequest({ valid: true, diagnostics: [] });
        else rejectRequest(new Error("old candidate failed"));
        await request.catch(() => undefined);
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "校验并加入本轮" })).toBeDisabled();
    }
  );
});
