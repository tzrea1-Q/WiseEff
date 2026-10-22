import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugModuleDeletionPreview } from "@/infrastructure/http/debuggingAdminClient";
import { DebugModuleDeletionDialog } from "./DebugModuleDeletionDialog";

const modules: FlatModuleNode[] = [
  { id: "source", name: "原分类", parentId: null, path: "source", depth: 1 },
  { id: "target", name: "目标", parentId: null, path: "target", depth: 1 }
];

const rootPreview: DebugModuleDeletionPreview = {
  module: { id: "source", name: "原分类" }, target: null, nodeCount: 2, legacyNodeCount: 0,
  children: [], ambiguousNodes: [], canDelete: true, previewDigest: "digest-root"
};

describe("DebugModuleDeletionDialog", () => {
  it("disables confirmation in the same render that changes the transfer target", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onPreview = vi.fn((_moduleId: string, targetModuleId: string | null) =>
      targetModuleId ? new Promise<DebugModuleDeletionPreview>(() => undefined) : Promise.resolve(rootPreview));
    render(<DebugModuleDeletionDialog module={modules[0]!} modules={modules} onPreview={onPreview} onDelete={onDelete}
      onCancel={vi.fn()} onMoveChild={vi.fn()} onEditNode={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: "迁移节点并删除模块" });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "节点迁移目标" }));
    const target = within(screen.getByRole("tree")).getByRole("button", { name: "目标" });

    // Outside act(), React renders the target change synchronously but defers updates made
    // by effects, which is the window a fast keyboard confirmation can land in.
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      target.click();
      await Promise.resolve();
      expect(screen.getByRole("button", { name: "节点迁移目标" })).toHaveTextContent("目标");
      expect(confirm).toBeDisabled();
      confirm.click();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });
});
