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
    businessCategory: null,
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
    expect(submit).toBeEnabled();

    fireEvent.change(within(confirm).getByLabelText("修改原因"), {
      target: { value: "docs tweak" },
    });
    fireEvent.click(submit);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ reason: "docs tweak" });
  });
});
