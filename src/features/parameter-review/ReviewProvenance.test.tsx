import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewProvenance } from "./ReviewProvenance";

describe("ReviewProvenance", () => {
  it("keeps all evidence in one disclosure with one complete copy action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ReviewProvenance entries={[
      { label: "请求 ID", value: "request-1" },
      { label: "冻结证明", value: { members: [{ fileId: "file-1", checksum: "sha256:frozen" }], locator: { pointer: "/limit" } } }
    ]} />);
    const disclosure = screen.getByText("溯源信息").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("溯源信息"));
    expect(disclosure.open).toBe(true);
    expect(await screen.findByLabelText("完整溯源数据")).toBeVisible();
    expect(disclosure.querySelectorAll("details")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(JSON.parse(screen.getByLabelText("完整溯源数据").textContent!)).toMatchObject({
      "请求 ID": "request-1",
      "冻结证明": { members: [{ fileId: "file-1", checksum: "sha256:frozen" }], locator: { pointer: "/limit" } }
    });
    fireEvent.click(screen.getByRole("button", { name: "复制完整技术数据" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(screen.getByLabelText("完整溯源数据").textContent));
    expect(screen.getByRole("status")).toHaveTextContent("已复制完整技术数据");
  });

  it("keeps complete evidence readable when copying fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("clipboard unavailable")) } });
    render(<ReviewProvenance entries={[{ label: "请求 ID", value: "request-1" }]} />);
    fireEvent.click(screen.getByText("溯源信息"));
    fireEvent.click(await screen.findByRole("button", { name: "复制完整技术数据" }));
    expect(await screen.findByRole("status")).toHaveTextContent("复制失败，请选择内容手动复制。");
    expect(screen.getByLabelText("完整溯源数据")).toBeVisible();
    expect(screen.getByLabelText("完整溯源数据")).toHaveAttribute("tabindex", "0");
  });
});
