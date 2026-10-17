import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ParameterPageActions } from "@/app/routes";
import { StepBatchPreview } from "./StepBatchPreview";
import { StepConfirmApply } from "./StepConfirmApply";

const batch = {
  id: "batch-retained", projectId: "aurora", sourceName: "values.json", status: "previewed" as const,
  createdAt: "2026-10-15T00:00:00Z",
  summary: { added: 0, updated: 2, unchanged: 0, conflict: 0, highRisk: 0 },
  items: ["first", "second"].map((id) => ({
    id, name: id, module: "power", risk: "Low" as const, unit: "mA", range: "0-10",
    currentValue: "1", recommendedValue: "2", classification: "updated" as const, riskFlag: false,
    baseRevisionId: "revision-1"
  }))
};

describe("import preview and completion", () => {
  it("reuses an existing preview and preserves the user's selected subset when returning", async () => {
    const createImportPreview = vi.fn().mockResolvedValue(batch);
    const onSelectedItemIdsChange = vi.fn();
    render(<StepBatchPreview targetProjectId="aurora" sourceName="values.json" reviewedRows={batch.items.map((item) => ({ ...item, rowId: item.id, matchKey: item.name, status: "approved", sourceFormat: "json" }))}
      parameterActions={{ createImportPreview } as unknown as ParameterPageActions} dispatch={vi.fn()}
      previewBatch={batch} selectedItemIds={new Set(["first"])} onPreviewBatchChange={vi.fn()}
      onSelectedItemIdsChange={onSelectedItemIdsChange} onBack={vi.fn()} onNext={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "选择 first" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "选择 second" })).not.toBeChecked();
    expect(createImportPreview).not.toHaveBeenCalled();
    expect(onSelectedItemIdsChange).not.toHaveBeenCalled();
  });

  it("retains a staged receipt with routes to drafts and review, without allowing another apply", async () => {
    const onApplied = vi.fn();
    const onNavigate = vi.fn();
    const applyImportBatch = vi.fn().mockResolvedValue({ ...batch, status: "staged", summary: { ...batch.summary, staged: 1 } });
    const props = { project: { id: "aurora", name: "Aurora", code: "AUR" }, sourceName: "values.json",
      previewBatch: batch, selectedItemIds: new Set(["first"]), reviewedRows: [],
      parameterActions: { applyImportBatch } as unknown as ParameterPageActions,
      dispatch: vi.fn(), onBack: vi.fn(), onApplied, onNavigate } as ComponentProps<typeof StepConfirmApply>;
    render(<StepConfirmApply {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "暂存待提交" }));
    await screen.findByRole("status");
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "暂存待提交" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看草稿并继续提交审核" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters?project=aurora");
  });
});
