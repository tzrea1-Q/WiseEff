import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterRecord } from "@/domain/parameters/types";
import { ParameterDraftDialog, type ParameterDraftDialogItem } from "./ParameterDraftDialog";

const parameter: ParameterRecord = {
  id: "aurora-fast-charge-current",
  name: "fast_charge_current_limit_ma",
  description: "限制快充阶段的最大充电电流。",
  explanation: "Keeps charging within thermal limits.",
  configFormat: "charging.fast_charge_current_limit_ma=3200",
  module: "Charging Policy",
  projectId: "aurora",
  currentValue: "3850",
  recommendedValue: "3200",
  range: "2500 - 4500",
  unit: "mA",
  risk: "High",
  updatedAt: "今天 08:12",
  updatedAtTs: "2026-05-23T00:12:00.000Z",
  history: []
};

const draft: ParameterDraftDialogItem = {
  parameterId: parameter.id,
  targetValue: "3200",
  reason: "",
  parameter
};

const dtsValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "11000", "4200", "46", "burst";`;

const dtsParameter: ParameterRecord = {
  ...parameter,
  id: "aurora-dts-fast-charge-profile-matrix",
  name: "dts_fast_charge_profile_matrix",
  description: "DTS string-list fast charge profile matrix.",
  explanation: "Uses a device-tree string-list property.",
  configFormat: `DTS: ${dtsValue}`,
  currentValue: dtsValue,
  recommendedValue: dtsValue,
  range: "0 - 1",
  unit: "profile",
  risk: "Low"
};

const dtsDraft: ParameterDraftDialogItem = {
  parameterId: dtsParameter.id,
  targetValue: dtsValue.replace('"burst"', '"boost"'),
  reason: "同步 DTS 矩阵",
  parameter: dtsParameter
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof ParameterDraftDialog>> = {}) {
  const props = {
    open: true,
    title: "修改草稿",
    description: "点击编辑会加入草稿，提交参数后才会进入上方的本轮已修改参数表。",
    drafts: [draft],
    focusedParameterId: draft.parameterId,
    canEdit: true,
    onClose: vi.fn(),
    onClearAll: vi.fn(),
    onRemoveItem: vi.fn(),
    onUpdateDraft: vi.fn(),
    onSubmit: vi.fn(),
    onViewSubmissions: vi.fn(),
    ...overrides
  };

  render(<ParameterDraftDialog {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("ParameterDraftDialog", () => {
  it("renders as a centered modal shell with draft controls", () => {
    const props = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    expect(dialog.querySelector(".parameter-draft-dialog")).toBeInTheDocument();
    expect(dialog.querySelector(".workbench-sheet")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("heading", { name: "修改草稿" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("本轮提交 1 项")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("3200")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "查看我的提交" }));
    expect(props.onViewSubmissions).toHaveBeenCalledTimes(1);
  });

  it("renders simple and complex drafts with distinct card layouts", () => {
    renderDialog({
      drafts: [draft, dtsDraft],
      focusedParameterId: draft.parameterId
    });

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    const simpleCard = within(dialog).getByText("fast_charge_current_limit_ma").closest(".parameter-draft-card");
    const complexCard = within(dialog).getByText("dts_fast_charge_profile_matrix").closest(".parameter-draft-card");

    expect(simpleCard).toHaveClass("parameter-draft-card--simple");
    expect(complexCard).toHaveClass("parameter-draft-card--complex");
    expect(dialog.querySelector(".parameter-draft-dialog")).toHaveClass("parameter-draft-dialog--wide");
    expect(within(complexCard as HTMLElement).getByText("当前配置")).toBeInTheDocument();
    expect(within(complexCard as HTMLElement).getByText("目标配置")).toBeInTheDocument();
    expect(within(complexCard as HTMLElement).getByText("复杂配置")).toBeInTheDocument();
    expect(within(complexCard as HTMLElement).getAllByText(/"0", "5000", "1500", "40", "entry"/).length).toBeGreaterThan(0);
    expect(within(complexCard as HTMLElement).getByLabelText("目标值 dts_fast_charge_profile_matrix")).toHaveAttribute("wrap", "off");
    expect(within(complexCard as HTMLElement).queryByText(/Agent 建议调整/)).not.toBeInTheDocument();
  });

  it("updates, removes, clears, and submits drafts through button-like controls", () => {
    const props = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "修改草稿" });

    fireEvent.change(within(dialog).getByLabelText("目标值"), { target: { value: "99999" } });
    expect(props.onUpdateDraft).toHaveBeenCalledWith(parameter, { targetValue: "99999" });

    fireEvent.click(within(dialog).getByRole("button", { name: "移除本项" }));
    expect(props.onRemoveItem).toHaveBeenCalledWith(parameter.id);

    fireEvent.click(within(dialog).getByRole("button", { name: "全部清空" }));
    expect(props.onClearAll).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "提交参数" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("connects out-of-range warnings to the target editor", () => {
    const invalidDraft = { ...draft, targetValue: "99999" };
    renderDialog({ drafts: [invalidDraft] });

    const dialog = screen.getByRole("dialog", { name: "修改草稿" });
    const targetEditor = within(dialog).getByLabelText("目标值");
    const warning = within(dialog).getByText("超出 2500 - 4500 mA");

    expect(targetEditor).toHaveAttribute("aria-invalid", "true");
    expect(targetEditor).toHaveAttribute("aria-describedby", warning.id);
  });

  it("keeps draft action buttons visually styled as buttons", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const bodyButtonRule = styles.match(/\.parameter-draft-dialog__body \.button\s*\{[^}]*\}/)?.[0] ?? "";
    const bodySubtleRule = styles.match(/\.parameter-draft-dialog__body \.button\.subtle\s*\{[^}]*\}/)?.[0] ?? "";
    const bodyHoverRule = styles.match(/\.parameter-draft-dialog__body \.button\.subtle:hover:not\(:disabled\)\s*\{[^}]*\}/)?.[0] ?? "";
    const submitLinkRule = styles.match(/\.parameter-draft-dialog__submit-link\s*\{[^}]*\}/)?.[0] ?? "";

    expect(bodyButtonRule).toContain("display: inline-flex;");
    expect(bodyButtonRule).toContain("min-height: 36px;");
    expect(bodyButtonRule).toContain("padding: 0 14px;");
    expect(bodyButtonRule).toContain("border-radius: 9px;");
    expect(bodyButtonRule).toContain("box-shadow:");
    expect(bodySubtleRule).toContain("background: #ffffff;");
    expect(bodySubtleRule).toContain("border: 1px solid rgba(148, 163, 184, 0.64);");
    expect(bodyHoverRule).toContain("box-shadow:");
    expect(submitLinkRule).toContain("display: inline-flex;");
    expect(submitLinkRule).toContain("border: 1px solid rgba(148, 163, 184, 0.64);");
  });

  it("does not render when closed", () => {
    renderDialog({ open: false });

    expect(screen.queryByRole("dialog", { name: "修改草稿" })).not.toBeInTheDocument();
  });
});
