import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StepBatchPreview } from "./StepBatchPreview";

it("keeps complete multiline values keyboard-readable in batch preview", () => {
  const currentValue = `current ${"x".repeat(300)}\ncurrent last`;
  const recommendedValue = "recommended first\nrecommended last";
  render(<StepBatchPreview targetProjectId="project" sourceName="import.json" reviewedRows={[]}
    dispatch={vi.fn()} selectedItemIds={new Set()} onPreviewBatchChange={vi.fn()}
    onSelectedItemIdsChange={vi.fn()} onBack={vi.fn()} onNext={vi.fn()}
    previewBatch={{ id: "batch", projectId: "project", sourceName: "import.json", status: "previewed", createdAt: "2026-01-01",
      summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [{ id: "item", name: "config", module: "module", risk: "Low", unit: "", range: "",
        classification: "updated", currentValue, recommendedValue }] }} />);
  const value = screen.getByLabelText("config 完整导入值");
  expect(value.textContent).toBe(`${currentValue} → ${recommendedValue}`);
  expect(value).toHaveAttribute("tabindex", "0");
});
