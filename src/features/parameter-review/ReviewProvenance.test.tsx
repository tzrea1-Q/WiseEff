import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewProvenance } from "./ReviewProvenance";

describe("ReviewProvenance", () => {
  it("starts collapsed and copies individual nested IDs and digests without losing source metadata", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ReviewProvenance entries={[
      { label: "请求 ID", value: "request-1" },
      { label: "冻结证明", value: { members: [{ fileId: "file-1", checksum: "sha256:frozen" }], locator: { pointer: "/limit" } } }
    ]} />);
    const disclosure = screen.getByText("溯源信息").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.queryByRole("button", { name: "复制 冻结证明 · members · 1 · fileId" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("溯源信息"));
    expect(disclosure.open).toBe(true);
    expect(await screen.findByText("/limit")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "复制 冻结证明 · members · 1 · fileId" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("file-1"));
    expect(screen.getByRole("status")).toHaveTextContent("已复制");
    fireEvent.click(screen.getByRole("button", { name: "复制 冻结证明 · members · 1 · checksum" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("sha256:frozen"));
  });
});
