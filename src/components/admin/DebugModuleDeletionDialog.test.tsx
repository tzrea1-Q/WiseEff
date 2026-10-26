import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DebugModuleDeletionPreview } from "@/infrastructure/http/debuggingAdminClient";
import { DebugModuleDeletionDialog } from "./DebugModuleDeletionDialog";

const modules = [
  { id: "source", name: "原分类", path: "source", parentId: null, depth: 1 },
  { id: "target", name: "目标", path: "target", parentId: null, depth: 1 }
];

describe("DebugModuleDeletionDialog", () => {
  it("invalidates the old proof before requesting a changed target and preserves that target after a conflict", async () => {
    const user = userEvent.setup();
    const initial: DebugModuleDeletionPreview = {
      module: modules[0]!, target: null, nodeCount: 2, legacyNodeCount: 1,
      children: [], ambiguousNodes: [], canDelete: true, previewDigest: "initial-proof"
    };
    let resolvePreview!: (preview: DebugModuleDeletionPreview) => void;
    const disabledAtRequest: boolean[] = [];
    const onPreview = vi.fn((_moduleId: string, targetId: string | null) => {
      if (targetId === null) return Promise.resolve(initial);
      // Inspect the committed UI before the request effect's state updates can render.
      disabledAtRequest.push((screen.getByRole("button", { name: "迁移节点并删除模块" }) as HTMLButtonElement).disabled);
      return new Promise<DebugModuleDeletionPreview>(resolve => { resolvePreview = resolve; });
    });
    const onDelete = vi.fn().mockRejectedValue(new Error("删除预览已变化，请重新预览。"));
    const onCancel = vi.fn();
    render(<DebugModuleDeletionDialog module={modules[0]!} modules={modules} onPreview={onPreview}
      onDelete={onDelete} onCancel={onCancel} onMoveChild={vi.fn()} onEditNode={vi.fn()} />);
    const confirm = screen.getByRole("button", { name: "迁移节点并删除模块" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "节点迁移目标" }));
    await user.click(within(screen.getByRole("tree")).getByRole("button", { name: "目标" }));

    expect(disabledAtRequest).toEqual([true]);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => resolvePreview({ ...initial, target: modules[1]!, previewDigest: "target-proof" }));
    expect(confirm).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "节点迁移目标" }));
    await user.click(within(screen.getByRole("tree")).getByRole("button", { name: "目标" }));
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(confirm).toBeEnabled();
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onDelete).toHaveBeenCalledExactlyOnceWith("source", {
      targetModuleId: "target", previewDigest: "target-proof", clientMutationId: expect.any(String)
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("预览已变化");
    expect(screen.getByRole("button", { name: "节点迁移目标" })).toHaveTextContent("目标");
    expect(confirm).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("deletes a module without nodes directly, without asking for a migration target", async () => {
    const user = userEvent.setup();
    const empty: DebugModuleDeletionPreview = {
      module: modules[0]!, target: null, nodeCount: 0, legacyNodeCount: 0,
      children: [], ambiguousNodes: [], canDelete: true, previewDigest: "empty-proof"
    };
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(<DebugModuleDeletionDialog module={modules[0]!} modules={modules} onPreview={vi.fn().mockResolvedValue(empty)}
      onDelete={onDelete} onCancel={onCancel} onMoveChild={vi.fn()} onEditNode={vi.fn()} />);
    const confirm = await screen.findByRole("button", { name: "删除模块" });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByRole("button", { name: "节点迁移目标" })).not.toBeInTheDocument();
    expect(screen.queryByText(/将迁移/)).not.toBeInTheDocument();
    await user.click(confirm);
    expect(onDelete).toHaveBeenCalledExactlyOnceWith("source", {
      targetModuleId: null, previewDigest: "empty-proof", clientMutationId: expect.any(String)
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
