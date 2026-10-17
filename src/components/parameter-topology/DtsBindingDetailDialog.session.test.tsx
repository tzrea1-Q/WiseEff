import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

import { DtsBindingDetailDialog, type DtsParameterEdit } from "./DtsBindingDetailDialog";

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
    nodeEnablement: null,
    nodeEnablementNotice: null,
    ...overrides
  };
}

type Props = React.ComponentProps<typeof DtsBindingDetailDialog>;
function Session({ overrides = {}, initialDraft }: { overrides?: Partial<Props>; initialDraft?: DtsParameterEdit }) {
  const row = overrides.row ?? gpioRow();
  const original = initialDraft ?? { rawValue: row.rawValue, reason: "", action: "set" as const };
  const [draft, setDraft] = useState<DtsParameterEdit>(original);
  const [saved, setSaved] = useState<DtsParameterEdit>(original);
  const onSave = overrides.onSaveDraft ?? vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
  return <DtsBindingDetailDialog row={row} canEdit onClose={vi.fn()} {...overrides} draft={draft}
    hasSavedDraft={Boolean(saved.reason.trim())}
    hasLocalChanges={draft.rawValue !== saved.rawValue || draft.reason.trim() !== saved.reason.trim() || (draft.action ?? "set") !== (saved.action ?? "set")}
    onDraftChange={setDraft} onResetDraft={() => setDraft(saved)}
    onSaveDraft={async (input) => { const result = await onSave(input); if (result.valid) setSaved({ ...input }); return result; }} />;
}
function renderSession(overrides: Partial<Props> = {}, initialDraft?: DtsParameterEdit) { return render(<Session overrides={overrides} initialDraft={initialDraft} />); }
function editReason(reason = "调整中断配置") { fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: reason } }); }

describe("DtsBindingDetailDialog authoring session", () => {
  it("starts without a local edit and keeps pinned documentation beside the editor", () => {
    renderSession({ row: gpioRow({ documentation: "固定版本的参数说明。" }) });
    expect(screen.getByRole("dialog", { name: "gpio_int · 参数详情" })).toBeInTheDocument();
    expect(screen.getByText("固定版本的参数说明。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue("<&gpio13 29 0>");
    expect(screen.queryByRole("button", { name: "全部清空" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "变更预览" })).toBeVisible();
  });

  it("sends a deletion as the exact binding identity and empty raw payload after a reason is supplied", async () => {
    const onSaveDraft = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    renderSession({ onSaveDraft });
    fireEvent.click(screen.getByText("更多修改操作")); fireEvent.click(screen.getByRole("button", { name: "移除属性" }));
    expect(screen.queryByRole("textbox", { name: "目标值" })).not.toBeInTheDocument();
    expect(screen.getByText("已选择移除属性，提交审核通过后生效。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    editReason("移除过时属性"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledWith({ bindingId: "binding-gpio-int", rawValue: "", action: "delete", reason: "移除过时属性" }));
    expect(await screen.findByText("草稿已保存，待提交审核。")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("uses typed boolean presence and removal without requiring a literal value", async () => {
    const onSaveDraft = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    renderSession({ onSaveDraft, row: gpioRow({ propertyKey: "wakeup-source", rawValue: "", effectiveValue: { kind: "boolean", present: true } }) });
    expect(screen.getByRole("button", { name: "属性存在（启用）" })).toHaveAttribute("aria-pressed", "true");
    editReason("保留唤醒属性"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledWith({ bindingId: "binding-gpio-int", rawValue: "", reason: "保留唤醒属性", action: "set" }));
  });

  it("renders a multiline source editor and added/removed lines for complex values", () => {
    const current = ['"charge-profile-a",', '"charge-profile-b",', '"charge-profile-c"'].join("\n");
    const target = ['"charge-profile-a",', '"charge-profile-b-revised",', '"charge-profile-c"'].join("\n");
    renderSession({ row: gpioRow({ bindingId: "binding-profiles", propertyKey: "charge_profiles", rawValue: current,
      effectiveValue: { kind: "strings", values: ["charge-profile-a", "charge-profile-b", "charge-profile-c"] } }) }, { rawValue: target, reason: "校准配置表" });
    const editor = screen.getByRole("textbox", { name: "目标值" });
    expect(editor.tagName).toBe("TEXTAREA"); expect(editor).toHaveValue(target);
    expect(Number(editor.getAttribute("rows"))).toBeGreaterThanOrEqual(6);
    const diff = screen.getByRole("heading", { name: "变更预览" }).parentElement!;
    expect(diff.querySelectorAll("[data-kind='remove']").length).toBeGreaterThan(0);
    expect(diff.querySelectorAll("[data-kind='add']").length).toBeGreaterThan(0);
    expect(diff).toHaveTextContent('"charge-profile-b-revised",');
  });

  it("submits exact semantic identity once, locks in-flight controls and leaves a saved detail open", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { valid: boolean; diagnostics: [] }) => void;
    const request = new Promise<{ valid: boolean; diagnostics: [] }>((done) => { resolve = done; });
    const onSaveDraft = vi.fn().mockReturnValue(request); const onClose = vi.fn();
    renderSession({ onSaveDraft, onClose });
    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), { target: { value: "<&gpio13 30 0>" } });
    editReason("  调整中断引脚  "); await user.dblClick(screen.getByRole("button", { name: "保存草稿" }));
    expect(onSaveDraft).toHaveBeenCalledOnce();
    expect(onSaveDraft).toHaveBeenCalledWith({ bindingId: "binding-gpio-int", rawValue: "<&gpio13 30 0>", reason: "调整中断引脚", action: "set" });
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "目标值" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭参数详情" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" }); expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve({ valid: true, diagnostics: [] }));
    expect(await screen.findByText("草稿已保存，待提交审核。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps authoritative server rejection and the exact input without reporting a saved draft", async () => {
    const onSaveDraft = vi.fn().mockResolvedValue({ valid: false, diagnostics: [{ code: "DTS_CELL_COUNT", message: "gpio_int 需要 3 个 cell" }] });
    renderSession({ onSaveDraft });
    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), { target: { value: "<&gpio13 30>" } }); editReason();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gpio_int 需要 3 个 cell");
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue("<&gpio13 30>");
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("调整中断配置");
    expect(screen.queryByText("草稿已保存，待提交审核。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });

  it("retains input on an exception and retries the same exact payload", async () => {
    const onSaveDraft = vi.fn().mockRejectedValueOnce(new Error("candidate revision is stale")).mockResolvedValueOnce({ valid: true, diagnostics: [] });
    renderSession({ onSaveDraft }); editReason();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，已保留输入，请重试。");
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue("<&gpio13 29 0>");
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("调整中断配置");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("草稿已保存，待提交审核。");
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
    expect(onSaveDraft.mock.calls[0]).toEqual(onSaveDraft.mock.calls[1]);
  });

  it("preserves a saved baseline across tab changes and only re-enables save for a new change", async () => {
    renderSession(); editReason(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("草稿已保存，待提交审核。");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "变更历史" })); fireEvent.mouseDown(screen.getByRole("tab", { name: "配置" }));
    expect(screen.getByText("草稿已保存，待提交审核。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), { target: { value: "<&gpio13 31 0>" } });
    expect(screen.queryByText("草稿已保存，待提交审核。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), { target: { value: "<&gpio13 29 0>" } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByText("已保存草稿 · 待提交")).toBeVisible();
  });

  it("blocks malformed source locally and preserves entered text", () => {
    const onSaveDraft = vi.fn(); renderSession({ onSaveDraft });
    fireEvent.change(screen.getByRole("textbox", { name: "目标值" }), { target: { value: "<unterminated" } }); editReason();
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); expect(onSaveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "目标值" })).toHaveValue("<unterminated");
  });

  it("retains the input but disables mutation after permission is revoked", () => {
    const view = renderSession(); editReason();
    view.rerender(<Session overrides={{ canEdit: false }} />);
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("调整中断配置");
    expect(screen.getByRole("textbox", { name: "修改原因" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "目标值" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });

  it.each(["resolve", "reject"] as const)("ignores an old request that %ss after external unmount and a fresh detail opens", async (outcome) => {
    let resolve!: (value: { valid: boolean; diagnostics: [] }) => void; let reject!: (error: Error) => void;
    const request = new Promise<{ valid: boolean; diagnostics: [] }>((done, fail) => { resolve = done; reject = fail; });
    const oldSave = vi.fn().mockReturnValue(request);
    const view = renderSession({ onSaveDraft: oldSave }); editReason(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled(); view.unmount();
    const newSave = vi.fn(); renderSession({ onSaveDraft: newSave });
    await act(async () => { if (outcome === "resolve") resolve({ valid: true, diagnostics: [] }); else reject(new Error("old candidate failed")); await request.catch(() => undefined); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("草稿已保存，待提交审核。")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled(); expect(newSave).not.toHaveBeenCalled();
  });
});
