import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportReviewCard } from "./ImportReviewCard";
import type { ReviewedImportRow } from "@/application/parameters/import/types";
import type { ParameterRecord, Project } from "@/mockData";
import type { PowerManagementParameterTemplate } from "@/powerManagementConfig";

const projects: Project[] = [{ id: "aurora", name: "Aurora", code: "AUR" }];
const moduleNames = ["Charging Policy"];
const libraryParameters: PowerManagementParameterTemplate[] = [];

const existingParameter: ParameterRecord = {
  id: "aurora-fast-charge-current",
  name: "fast_charge_current_limit_ma",
  description: "快充限流",
  explanation: "限制快充电流上限",
  configFormat: "",
  module: "Charging Policy",
  projectId: "aurora",
  currentValue: "3000",
  recommendedValue: "3200",
  range: "2500 - 4000",
  unit: "mA",
  risk: "Medium",
  valueKind: "scalar",
  updatedAt: "2026-01-01",
  updatedAtTs: "2026-01-01T00:00:00Z",
  history: []
};

function buildRow(overrides: Partial<ReviewedImportRow> = {}): ReviewedImportRow {
  return {
    name: "fast_charge_current_limit_ma",
    module: "Charging Policy",
    currentValue: "3200",
    recommendedValue: "3400",
    range: "2500 - 4500",
    unit: "mA",
    risk: "High",
    sourceFormat: "spreadsheet",
    rowId: "import-row-1",
    matchKey: "fast_charge_current_limit_ma::Charging Policy",
    status: "pending",
    ...overrides
  };
}

function renderCard(overrides: Partial<Parameters<typeof ImportReviewCard>[0]> = {}) {
  const onApprove = vi.fn();
  const onSkip = vi.fn();
  const onUpdate = vi.fn();
  const onConfirmNew = vi.fn();
  const utils = render(
    <ImportReviewCard
      row={buildRow()}
      projects={projects}
      moduleNames={moduleNames}
      libraryParameters={libraryParameters}
      onApprove={onApprove}
      onSkip={onSkip}
      onUpdate={onUpdate}
      onConfirmNew={onConfirmNew}
      {...overrides}
    />
  );
  return { ...utils, onApprove, onSkip, onUpdate, onConfirmNew };
}

describe("ImportReviewCard", () => {
  it("shows a diff table comparing imported values against the existing parameter", () => {
    renderCard({ row: buildRow({ existingParameter }) });

    const table = screen.getByRole("table", { name: "字段差异" });
    const rows = within(table).getAllByRole("row");
    const currentValueRow = rows.find((row) => within(row).queryByText("当前值"));
    expect(currentValueRow).toBeDefined();
    expect(within(currentValueRow!).getByText("3000")).toBeInTheDocument();
    expect(within(currentValueRow!).getByText("3200")).toBeInTheDocument();
  });

  it("approves a pending row matched to an existing parameter", () => {
    const { onApprove } = renderCard({ row: buildRow({ existingParameter }) });

    fireEvent.click(screen.getByRole("button", { name: "通过" }));

    expect(onApprove).toHaveBeenCalledWith("import-row-1");
  });

  it("skips a row after entering a reason", () => {
    const { onSkip } = renderCard({ row: buildRow({ existingParameter }) });

    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    fireEvent.change(screen.getByLabelText("跳过原因"), { target: { value: "本次不导入该项" } });
    fireEvent.click(screen.getByRole("button", { name: "确认跳过" }));

    expect(onSkip).toHaveBeenCalledWith("import-row-1", "本次不导入该项");
  });

  it("shows the not-in-library badge and prefill action for new candidates", () => {
    renderCard({ row: buildRow({ name: "brand_new_param", existingParameter: undefined }) });

    expect(screen.getByText("库中不存在")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预填并创建" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
  });

  it("opens a prefilled ParameterDefinitionForm and confirms new-parameter creation", () => {
    const { onConfirmNew } = renderCard({
      row: buildRow({ name: "brand_new_param", recommendedValue: "42", existingParameter: undefined })
    });

    fireEvent.click(screen.getByRole("button", { name: "预填并创建" }));

    const dialog = screen.getByRole("dialog", { name: "预填并创建参数 brand_new_param" });
    expect(within(dialog).getByLabelText("参数名")).toHaveValue("brand_new_param");
    expect(within(dialog).getByLabelText(/推荐值/)).toHaveValue("42");

    fireEvent.click(within(dialog).getByRole("button", { name: "确认创建" }));

    expect(onConfirmNew).toHaveBeenCalledWith(
      "import-row-1",
      expect.objectContaining({ name: "brand_new_param", module: "Charging Policy", recommendedValue: "42" })
    );
  });

  it("requires a module before it can be confirmed for needs-module rows", () => {
    const { onUpdate } = renderCard({ row: buildRow({ module: "", status: "needs-module", existingParameter: undefined }) });

    expect(screen.getByRole("button", { name: "确认模块" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("补全模块"), { target: { value: "Charging Policy" } });
    fireEvent.click(screen.getByRole("button", { name: "确认模块" }));

    expect(onUpdate).toHaveBeenCalledWith("import-row-1", { module: "Charging Policy" });
  });

  it("only allows edit or skip for conflicting rows", () => {
    renderCard({ row: buildRow({ status: "conflict", existingParameter: undefined }) });

    expect(screen.queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("编辑参数名")).toBeInTheDocument();
  });
});
