import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { WorkbenchMemberRemovalDialog } from "./WorkbenchMemberRemovalDialog";

afterEach(cleanup);
const preview = { canApply: true as const, proofToken: "a".repeat(64), removedFileId: "overlay", members: [
  { fileId: "root", fileVersionId: "v1", sourceName: "board.dts", format: "dts" as const, role: "base", sortOrder: 0, checksum: "x", sizeBytes: 10 },
  { fileId: "overlay", fileVersionId: "v2", sourceName: "overlay.dts", format: "dts" as const, role: "overlay", sortOrder: 1, checksum: "y", sizeBytes: 10 }
], dependencies: [{ file: "board.dts", kind: "overlay" as const, target: "overlay.dts" }], impact: { nodeRemovals: 2, removedBindings: 3, retainedBindings: 4, exposedBindings: 0 } };

describe("administrator member removal confirmation", () => {
  it("shows source dependencies and parameter impact, keeps cancel focused and sends no mutation on Escape", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview), apply: vi.fn() };
    const cancel = vi.fn();
    render(<WorkbenchMemberRemovalDialog projectId="project" configSetId="set" fileId="overlay" fileName="overlay.dts" client={client} onDismiss={cancel} onApplied={vi.fn()} />);
    await screen.findByText(/移除 2 个结构节点、3 个当前参数/);
    expect(screen.getByRole("dialog")).toHaveTextContent("board.dts → 覆盖文件：overlay.dts");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledOnce(); expect(client.apply).not.toHaveBeenCalled();
  });
  it("keeps the reason after a stale proof and requires a new preview before confirming", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview), apply: vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "成员已变化，请重新预览", {}, "trace")).mockResolvedValue({ requestId: "request", tombstoneId: "t", successorConfigRevisionId: "revision", replayed: false }) };
    const applied = vi.fn();
    render(<WorkbenchMemberRemovalDialog projectId="project" configSetId="set" fileId="overlay" fileName="overlay.dts" client={client} onDismiss={vi.fn()} onApplied={applied} />);
    await screen.findByText(/移除 2 个结构节点/);
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: "旧驱动已停用" } });
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("移除原因")).toHaveValue("旧驱动已停用");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新预览" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认移除" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  });
  it("retries the same idempotent confirmation after an uncertain result", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview), apply: vi.fn().mockRejectedValueOnce(new Error("network lost")).mockResolvedValue({ requestId: "request", tombstoneId: "t", successorConfigRevisionId: "revision", replayed: true }) };
    render(<WorkbenchMemberRemovalDialog projectId="project" configSetId="set" fileId="overlay" fileName="overlay.dts" client={client} onDismiss={vi.fn()} onApplied={vi.fn()} />);
    await screen.findByText(/移除 2 个结构节点/);
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: "旧驱动已停用" } });
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试同一操作" }));
    await waitFor(() => expect(client.apply).toHaveBeenCalledTimes(2));
    expect(client.apply.mock.calls[0]).toEqual(client.apply.mock.calls[1]);
  });
});
