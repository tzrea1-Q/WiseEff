import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockKnowledgeFixtures } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgeEntryDetailDialog } from "./KnowledgeEntryDetailDialog";

describe("knowledge source workflow publication", () => {
  it("retains source facts while omitting unpublished source destinations", () => {
    const entry = { ...createMockKnowledgeFixtures().entries[0], sourceLogId: "source-log", sourceReloadRunId: "source-run" };
    const props = { open: true, entry, capability: { userId: "reader", canView: true, canEdit: false, canManage: false },
      onNavigate: vi.fn(), onClose: vi.fn(), onEdit: vi.fn(), onReplaceFile: vi.fn(), onShowRevisions: vi.fn(),
      onPublish: vi.fn().mockResolvedValue(undefined), onArchive: vi.fn().mockResolvedValue(undefined), onRestore: vi.fn().mockResolvedValue(undefined), onDownloadFile: vi.fn().mockResolvedValue(undefined) };
    const view = render(<KnowledgeEntryDetailDialog {...props} visibleWorkflows={["knowledge"]} />);
    expect(screen.getByText("来源：日志分析")).toBeVisible();
    expect(screen.getByText("来源：重载运行")).toBeVisible();
    expect(screen.queryByRole("button", { name: "查看日志分析" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看重载运行" })).toBeNull();
    view.rerender(<KnowledgeEntryDetailDialog {...props} visibleWorkflows={["knowledge", "log-analysis"]} />);
    expect(screen.getByRole("button", { name: "查看日志分析" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "查看重载运行" })).toBeNull();
  });
});
