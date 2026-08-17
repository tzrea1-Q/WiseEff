import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

import type { ParameterSpecDetailView } from "./ParameterSpecDetail";
import { ParameterSpecDetailDialog } from "./ParameterSpecDetailDialog";

const EMPTY_IDENTITY_MODULES: ParameterModule[] = [];

afterEach(() => {
  cleanup();
});

function baseDetail(overrides: Partial<ParameterSpecDetailView> = {}): ParameterSpecDetailView {
  return {
    id: "pspec:org:demo",
    organizationId: "org-1",
    propertyKey: "active_perf_limit",
    attributionSubjectId: "asub:driver:demo",
    attributionModules: [],
    driverModule: "middle_cpu",
    compatible: null,
    valueType: "u32-array",
    valueShape: { kind: "u32-array" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    reviewState: "active",
    usageCount: 0,
    displayName: "Perf limit",
    description: "desc",
    documentation: "docs",
    units: "mV",
    constraints: { min: 0, max: 100 },
    ...overrides,
  };
}

function renderEditor(overrides: Partial<ParameterSpecDetailView> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <ParameterSpecDetailDialog
      detail={baseDetail(overrides)}
      identityModules={EMPTY_IDENTITY_MODULES}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose };
}

function openSaveConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  return screen.getByRole("dialog", { name: "确认保存" });
}

describe("ParameterSpecDetailDialog save confirm (SE-D5)", () => {
  it("states reference count once and omits placeholder usage history", () => {
    renderEditor({ usageCount: 4 });
    const editor = screen.getByRole("dialog", { name: /active_perf_limit/ });
    expect(within(editor).getByLabelText("引用数")).toHaveTextContent("引用数：4");
    expect(within(editor).queryByLabelText("使用情况")).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText("Schema 历史")).not.toBeInTheDocument();
    expect(within(editor).queryByText("使用与历史")).not.toBeInTheDocument();
  });

  it("shows a before/after for constraints when a key is removed", () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText("约束 constraints"), {
      target: { value: '{"min":0}' },
    });

    const confirm = openSaveConfirm();
    expect(within(confirm).getByLabelText("约束 constraints 变更前")).toHaveTextContent('"max": 100');
    expect(within(confirm).getByLabelText("约束 constraints 变更后")).not.toHaveTextContent('"max": 100');
    expect(within(confirm).getByLabelText("约束 constraints 变更后")).toHaveTextContent('"min": 0');
    expect(within(confirm).queryByLabelText("值形状 valueShape 变更前")).not.toBeInTheDocument();
  });

  it("does not invent a shape/constraints diff when only documentation changes", () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText("参数说明"), {
      target: { value: "updated documentation" },
    });

    const confirm = openSaveConfirm();
    expect(within(confirm).queryByLabelText("约束 constraints 变更前")).not.toBeInTheDocument();
    expect(within(confirm).queryByLabelText("值形状 valueShape 变更前")).not.toBeInTheDocument();
    expect(within(confirm).queryByText("变更前")).not.toBeInTheDocument();
  });

  it("requires an acknowledgement that mentions the reference count when usageCount > 0", () => {
    const { onSave } = renderEditor({ usageCount: 3 });

    fireEvent.change(screen.getByLabelText("约束 constraints"), {
      target: { value: '{"min":0}' },
    });

    const confirm = openSaveConfirm();
    const acknowledgement = within(confirm).getByRole("checkbox");
    expect(acknowledgement).toHaveAccessibleName(/3 处引用/);
    const submit = within(confirm).getByRole("button", { name: "确认保存" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(confirm).getByLabelText("修改原因"), {
      target: { value: "shrink constraints" },
    });
    expect(submit).toBeDisabled();

    fireEvent.click(acknowledgement);
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      constraints: { min: 0 },
      reason: "shrink constraints",
    });
  });

  it("does not require acknowledgement when usageCount is 0", () => {
    const { onSave } = renderEditor({ usageCount: 0 });

    fireEvent.change(screen.getByLabelText("参数说明"), {
      target: { value: "docs only" },
    });

    const confirm = openSaveConfirm();
    expect(within(confirm).queryByRole("checkbox")).not.toBeInTheDocument();

    const submit = within(confirm).getByRole("button", { name: "确认保存" });
    const reason = within(confirm).getByLabelText("修改原因");
    expect(reason).toHaveAttribute("aria-required", "true");
    expect(within(confirm).getByText("必填")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(reason, {
      target: { value: "docs tweak" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ reason: "docs tweak" });
  });
});

describe("ParameterSpecDetailDialog editing affordances (Batch 3)", () => {
  it("uses the readonly eyebrow on deprecated definitions even when onSave is wired", () => {
    renderEditor({ reviewState: "deprecated" });
    expect(screen.getByText("参数定义库 · 只读")).toBeInTheDocument();
    expect(screen.queryByText("参数定义库 · 可编辑")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.getByText("已废弃，仅可查看或恢复。")).toBeInTheDocument();
  });

  it("marks read-only fields with a 只读 hint beyond the background tint", () => {
    renderEditor({ reviewState: "deprecated" });
    expect(screen.getByLabelText("审核状态").closest("label")).toHaveTextContent("只读");
    expect(screen.getByLabelText("展示名").closest("label")).toHaveTextContent("只读");
  });

  it("treats constraints as a JSON object editor with inline validation", () => {
    renderEditor();
    const constraints = screen.getByLabelText("约束 constraints");
    expect(constraints.closest("label")).toHaveTextContent("JSON");
    fireEvent.change(constraints, { target: { value: "not-json" } });
    expect(constraints).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("不是合法 JSON");
  });

  it("keeps 示例值 as free text so a DTS fragment is not a JSON error", () => {
    renderEditor();
    const example = screen.getByLabelText("示例值");
    expect(example.closest("label")).toHaveTextContent("原文或 JSON");
    fireEvent.change(example, { target: { value: "<&gpio13 29 0>" } });
    expect(example).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/示例值 不是合法 JSON/)).not.toBeInTheDocument();
  });
});

describe("ParameterSpecDetailDialog chrome (Batch 4)", () => {
  it("styles the cutover panel with classes instead of inline margins (SE-22)", () => {
    render(
      <ParameterSpecDetailDialog
        detail={baseDetail({
          cutover: {
            runId: "cut-1",
            status: "ready",
            fromVersionId: "v1",
            toVersionId: "v2",
            fromVersion: 1,
            toVersion: 2,
            impact: { pending: 0, ready: 1, incompatible: 0, skipped: 0, total: 1 },
          },
        })}
        identityModules={EMPTY_IDENTITY_MODULES}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onFinalizeCutover={vi.fn()}
      />,
    );

    const panel = document.querySelector(".param-admin-cutover-panel");
    expect(panel).toBeTruthy();
    expect(panel).not.toHaveAttribute("style");
    const finalize = screen.getByRole("button", { name: "完成切换…" });
    expect(finalize).toHaveClass("param-admin-cutover-panel__finalize");
    expect(finalize).not.toHaveAttribute("style");
  });

  it("disables confirmation 取消 while pending (SE-21)", () => {
    const onSave = vi.fn();
    const props = {
      detail: baseDetail(),
      identityModules: EMPTY_IDENTITY_MODULES,
      onClose: vi.fn(),
      onSave,
    };
    const { rerender } = render(<ParameterSpecDetailDialog {...props} />);

    fireEvent.change(screen.getByLabelText("参数说明"), {
      target: { value: "pending docs" },
    });
    const confirm = openSaveConfirm();
    expect(within(confirm).getByRole("button", { name: "取消" })).toBeEnabled();
    expect(document.querySelector(".param-admin-modal-backdrop--nested")).toBeTruthy();

    rerender(<ParameterSpecDetailDialog {...props} pending />);
    expect(within(screen.getByRole("dialog", { name: "确认保存" })).getByRole("button", { name: "取消" })).toBeDisabled();
  });
});

describe("ParameterSpecDetailDialog round-trip (PARAM-SPEC-EDIT-001)", () => {
  it("reopens units, constraints, example value, and documentation from the save payload", () => {
    const onSave = vi.fn();
    const initial = baseDetail({
      units: "mV",
      constraints: { min: 0, max: 100 },
      exampleValue: "<&gpio 1 0>",
      documentation: "docs",
    });
    const { unmount } = render(
      <ParameterSpecDetailDialog
        detail={initial}
        identityModules={EMPTY_IDENTITY_MODULES}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("单位"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("约束 constraints"), {
      target: { value: '{"min":0}' },
    });
    fireEvent.change(screen.getByLabelText("示例值"), {
      target: { value: "<&gpio13 29 0>" },
    });
    fireEvent.change(screen.getByLabelText("参数说明"), {
      target: { value: "updated docs" },
    });

    const confirm = openSaveConfirm();
    fireEvent.change(within(confirm).getByLabelText("修改原因"), {
      target: { value: "round trip" },
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "确认保存" }));

    const payload = onSave.mock.calls[0][0];
    expect(payload).toMatchObject({
      units: null,
      constraints: { min: 0 },
      exampleValue: "<&gpio13 29 0>",
      documentation: "updated docs",
      reason: "round trip",
    });
    expect(payload.constraints).not.toHaveProperty("max");

    unmount();
    render(
      <ParameterSpecDetailDialog
        detail={{
          ...initial,
          units: payload.units,
          constraints: payload.constraints,
          exampleValue: payload.exampleValue,
          documentation: payload.documentation,
        }}
        identityModules={EMPTY_IDENTITY_MODULES}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText("单位")).toHaveValue("");
    expect(screen.getByLabelText("约束 constraints")).toHaveValue(
      JSON.stringify({ min: 0 }, null, 2),
    );
    expect(screen.getByLabelText("示例值")).toHaveValue("<&gpio13 29 0>");
    expect(screen.getByLabelText("参数说明")).toHaveValue("updated docs");
  });
});
